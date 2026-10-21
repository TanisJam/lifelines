import type { CreateLifeRequest, LifeSex, LifeStreamEvent } from "@/contracts/life";
import { isLocale } from "@/domain/locale";
import { drainSimulation, SimulationAbortedError, simulateYears } from "@/domain/simulate";
import { generateWorld, resolveProtagonistSex } from "@/domain/worldgen";
import { guardSimulation } from "@/server/abuse-guard";
import { decisionMakerRunStats, snapshotDecisionMakerStats } from "@/server/decision-engine";
import { assertCompletedLife } from "@/server/completed-life";
import { getDb } from "@/server/db";
import { buildCandidateLifeChronicle, buildProvisionalTickEntries } from "@/server/life-chronicle";
import { streamLifecycleLife } from "@/server/lifecycle-life";
import { LifecycleRepository } from "@/server/lifecycle-repository";
import { createSceneTracker } from "@/server/life-scene";
import { newLifeBranchId, newLifeId, registerLife, type LifeBranchRecord } from "@/server/life-store";
import { sseResponse, yieldToEventLoop } from "@/server/sse";

export const runtime = "nodejs";

/** Period-setting capability: the run begins at the start of the 1327–1361 period this engine models. */
const START_YEAR = 1327;
/** Legacy bounded horizon, NOT completion: survivors must fail admission. Autonomous continuation is pending. */
const MAX_LIFESPAN_YEARS = 100;

function randomSeed(): string {
  return Math.random().toString(36).slice(2, 10);
}

function errorResponse(message: string, status = 400): Response {
  return new Response(JSON.stringify({ error: message }), { status, headers: { "Content-Type": "application/json" } });
}

/**
 * Streams the birth-to-death simulation of one protagonist (round 9, decision 034/036).
 * Incremental-simulation capability (round 13): `tick.entries` is now built LIVE, one simulated
 * year at a time, from `simulateYears()`'s own generator — heuristic significance only, no Jev
 * calls (design decision 9) — rather than replaying the final chronicle after the whole life has
 * already finished simulating (the old round-9 approach, docs/decisions.md 036). `done` still
 * carries the one authoritative `Chronicle`, built by `buildLifeChronicle` (which DOES call Jev).
 * A client disconnect aborts the in-flight simulation and skips persisting a branch (see
 * `sseResponse`'s `AbortSignal` and `drainSimulation`'s `SimulationAbortedError`).
 *
 * RI1c (spec S7): `engine: "lifecycle"` streams the same `LifeStreamEvent` frames from the new
 * engine instead, through `lifecycle-life.ts`. Absent or `"legacy"` keeps this legacy body exactly
 * as it was; the shared admission guard applies to both branches.
 */
export async function POST(request: Request): Promise<Response> {
  let body: Partial<CreateLifeRequest> = {};
  try {
    body = (await request.json()) as Partial<CreateLifeRequest>;
  } catch {
    // Empty body is invalid (name is required) — caught below.
  }

  const name = body.name?.trim();
  if (!name) return errorResponse('"name" is required.');
  const sex = body.sex;
  if (sex !== "f" && sex !== "m" && sex !== "random") return errorResponse('"sex" must be "f", "m" or "random".');
  // Versioned branch selection (RI1c): absent or "legacy" is the original path, unchanged. An
  // unknown value is refused here — with the other cheap local shape checks, before admission —
  // and is never coerced into either representation.
  const engine = body.engine;
  if (engine !== undefined && engine !== "legacy" && engine !== "lifecycle") {
    return errorResponse('"engine" must be "legacy" or "lifecycle".');
  }

  // Rate limit + (if configured) Turnstile verification, BEFORE any simulation work starts —
  // validated above only checks cheap, purely local input shape, so a malformed request never
  // costs the caller a rate-limit slot.
  const guard = await guardSimulation(request, body);
  if (guard instanceof Response) return guard;

  const seed = body.seed?.trim() || randomSeed();
  const locale = body.lang && isLocale(body.lang) ? body.lang : "en";

  if (engine === "lifecycle") {
    // New engine (spec S7): the existing admission guard above still applies; no DecisionMaker is
    // used, and persistence goes only through `LifecycleRepository`. The route owns identity and
    // transport; the orchestration, projection and persist live in `lifecycle-life.ts`. The ids
    // come from the same allocator as legacy lives (one identity space, `counters` rows only) —
    // no `lives` or `life_branches` row is written by this branch.
    const lifeId = newLifeId();
    const branchId = newLifeBranchId();
    const villageName = body.villageName?.trim() || undefined;
    return sseResponse(async (send, signal) => {
      await streamLifecycleLife({
        // Per-request seam: the repository owns no state beyond its prepared statements.
        repository: new LifecycleRepository(getDb()),
        lifeId,
        branchId,
        name,
        sex,
        seed,
        ...(villageName === undefined ? {} : { villageName }),
        locale,
        signal,
        emit: (event) => send(event.type, event),
        flushFrame: yieldToEventLoop,
      });
    });
  }

  const { decisionMaker, engineSource, backgroundDecisionMaker } = guard.engine;

  const startYear = START_YEAR;
  const endYear = startYear + MAX_LIFESPAN_YEARS;

  // "Let fate decide" (decision 041): resolve "random" to a concrete sex via the DecisionMaker
  // BEFORE the world (and the protagonist's own PersonMind) exists, rather than a name-blind coin
  // flip — see `resolveProtagonistSex`.
  const resolvedSex: LifeSex = sex === "random" ? await resolveProtagonistSex(decisionMaker, seed, name, startYear) : sex;

  const { config, people, events } = generateWorld({ seed, townName: body.villageName?.trim() || undefined, startYear, endYear, protagonist: { name, sex: resolvedSex } });
  const protagonist = people.protagonist;
  if (!protagonist) return errorResponse("Failed to generate the protagonist.", 500);

  const lifeId = newLifeId();
  const branchId = newLifeBranchId();

  const protagonistSex = protagonist.sex as LifeSex;

  return sseResponse(async (send, signal) => {
    const start: LifeStreamEvent = {
      type: "start",
      lifeId,
      branchId,
      villageName: config.town.name,
      protagonist: { name: protagonist.name, sex: protagonistSex, birthYear: protagonist.birthYear },
    };
    send("start", start);

    // Round 12 (decision 045): `decisionMaker` is a process-wide singleton (see decision-engine.ts),
    // so its own stats are cumulative across every life — snapshot before/after this ONE run so the
    // reported numbers are this life's alone, not inflated by whatever ran earlier in the process.
    const statsBefore = snapshotDecisionMakerStats(decisionMaker);

    const tracker = createSceneTracker({ seed: config.seed });
    let report;
    try {
      report = await drainSimulation(
        simulateYears(config, people, events, { decisionMaker, backgroundDecisionMaker, engineSource, protagonistId: "protagonist" }),
        async (tick) => {
          tracker.observe(tick.snapshot);
          const scene = tracker.scene();
          const entries = await buildProvisionalTickEntries(
            "protagonist",
            tick.year,
            tick.snapshot.events,
            tick.snapshot.people,
            tick.snapshot.decisions,
            protagonistSex,
            config.seed,
            config.town.name,
            locale,
            scene,
          );
          // One tick per simulated year, quiet years included: the sky's clock needs the frontier to advance.
          send("tick", { type: "tick", year: tick.year, entries, scene });
          // Decision 081: flush this year's frame (and let a disconnect register) before simulating the next.
          await yieldToEventLoop();
        },
        signal,
      );
    } catch (error) {
      if (error instanceof SimulationAbortedError) return; // client disconnected — no persistence, no more frames
      throw error;
    }

    if (signal.aborted) return;
    assertCompletedLife(report.result, report.snapshots);
    const candidate: LifeBranchRecord = {
      id: branchId, lifeId, label: "Original life", result: report.result,
      snapshots: report.snapshots, createdAt: Date.now(),
    };
    const chronicleResult = await buildCandidateLifeChronicle(candidate, [candidate], locale);
    if (signal.aborted) return;
    if (!chronicleResult.data) {
      send("error", { type: "error", message: chronicleResult.error ?? "Failed to build the chronicle." });
      return;
    }
    const chronicle = chronicleResult.data;

    // Snapshotted AFTER `buildLifeChronicle` too, since its own `significance()` calls (life-chronicle
    // narration) belong to this life just as much as the simulation's own `decideYear`/`decide` calls.
    const runStats = decisionMakerRunStats(decisionMaker, statsBefore);
    const done: LifeStreamEvent = {
      type: "done",
      chronicle,
      stats: { jevCalls: report.decisionCalls, cacheHits: runStats.cacheHits, wallTimeMs: report.wallTimeMs, jevRequests: runStats.jevRequests, jevQuestions: runStats.jevQuestions, inputTokens: runStats.inputTokens, estimatedUsd: runStats.estimatedUsd },
    };
    // No await between the final cancellation check and synchronous visible publication.
    if (signal.aborted) return;
    registerLife(lifeId, branchId, config, protagonist.name, protagonistSex, report.result, report.snapshots);
    send("done", done);
  });
}

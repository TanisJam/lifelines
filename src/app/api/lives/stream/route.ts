import type { CreateLifeRequest, LifeSex, LifeStreamEvent } from "@/contracts/life";
import { isLocale } from "@/domain/locale";
import { drainSimulation, SimulationAbortedError, simulateYears } from "@/domain/simulate";
import { generateWorld, resolveProtagonistSex } from "@/domain/worldgen";
import { guardSimulation } from "@/server/abuse-guard";
import { decisionMakerRunStats, snapshotDecisionMakerStats } from "@/server/decision-engine";
import { buildLifeChronicle, buildProvisionalTickEntries } from "@/server/life-chronicle";
import { newLifeBranchId, newLifeId, registerLife } from "@/server/life-store";
import { sseResponse } from "@/server/sse";

export const runtime = "nodejs";

/** Period-setting capability: the run begins at the start of the 1327–1361 period this engine models. */
const START_YEAR = 1327;
/** A generous safety cap (see mortality.ts): the sim always stops earlier, at the protagonist's death, but the actuarial curve alone never guarantees that before some fixed year. */
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

  // Rate limit + (if configured) Turnstile verification, BEFORE any simulation work starts —
  // validated above only checks cheap, purely local input shape, so a malformed request never
  // costs the caller a rate-limit slot.
  const guard = await guardSimulation(request, body);
  if (guard instanceof Response) return guard;
  const { decisionMaker, engineSource } = guard.engine;

  const seed = body.seed?.trim() || randomSeed();
  const startYear = START_YEAR;
  const endYear = startYear + MAX_LIFESPAN_YEARS;
  const locale = body.lang && isLocale(body.lang) ? body.lang : "en";

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

    let report;
    try {
      report = await drainSimulation(
        simulateYears(config, people, events, { decisionMaker, engineSource, protagonistId: "protagonist" }),
        async (tick) => {
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
          );
          if (entries.length > 0) send("tick", { type: "tick", year: tick.year, entries });
        },
        signal,
      );
    } catch (error) {
      if (error instanceof SimulationAbortedError) return; // client disconnected — no persistence, no more frames
      throw error;
    }

    registerLife(lifeId, branchId, config, protagonist.name, protagonistSex, report.result, report.snapshots);

    const chronicleResult = await buildLifeChronicle(lifeId, branchId, locale);
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
    send("done", done);
  });
}

import type { LifeStreamEvent, RewriteRequest } from "@/contracts/life";
import { buildGhostAnnotations } from "@/domain/decision-id";
import { ForkError, getRestoreSnapshot } from "@/domain/fork";
import { isLocale } from "@/domain/locale";
import { drainSimulation, SimulationAbortedError, simulateYears } from "@/domain/simulate";
import type { Override } from "@/domain/types";
import { validateOverride } from "@/domain/validate-override";
import { guardSimulation } from "@/server/abuse-guard";
import { decisionMakerRunStats, snapshotDecisionMakerStats } from "@/server/decision-engine";
import { buildLifeChronicle, buildProvisionalTickEntries } from "@/server/life-chronicle";
import { getLife, getLifeBranch, newLifeBranchId, registerLifeBranch } from "@/server/life-store";
import { sseResponse, yieldToEventLoop } from "@/server/sse";

export const runtime = "nodejs";

let overrideCounter = 0;

function errorResponse(message: string, status = 400): Response {
  return new Response(JSON.stringify({ error: message }), { status, headers: { "Content-Type": "application/json" } });
}

/**
 * Streams a rewrite of one protagonist's life from the changed turn forward (round 9, decision
 * 034/036) — originally the single-life counterpart to the legacy `/api/worlds/[worldId]/edit/stream`
 * (removed in decision 060). Sends `divergence` right after `start` (the old vs. new outcome label
 * for the turn being changed), then `tick` frames from the divergence year on, then `done` with
 * sparse `ghosts` for every downstream turn whose outcome actually changed.
 *
 * Incremental-simulation capability (round 13): re-simulation resumes `simulateYears()` from the
 * restored snapshot's year (`fromYear`) and drains it live — every yielded tick is already
 * `>= forkYear`, so no separate "since the fork" filter is needed the way the old post-hoc replay
 * required. Ticks are heuristic-significance-only (no Jev calls); `done`'s chronicle is still built
 * by `buildLifeChronicle` (which DOES call Jev). A client disconnect aborts the re-simulation and
 * skips registering the new branch.
 */
export async function POST(request: Request, context: { params: Promise<{ lifeId: string }> }): Promise<Response> {
  const { lifeId } = await context.params;
  const life = getLife(lifeId);
  if (!life) return errorResponse("Life not found.", 404);

  const body = (await request.json().catch(() => ({}))) as Partial<RewriteRequest>;
  const branchId = body.branchId?.trim();
  if (!branchId) return errorResponse('"branchId" is required.');
  const baseBranch = getLifeBranch(lifeId, branchId);
  if (!baseBranch) return errorResponse("Branch not found.", 404);
  if (!body.decisionId || !body.optionId) return errorResponse('"decisionId" and "optionId" are required.');
  const locale = body.lang && isLocale(body.lang) ? body.lang : "en";

  overrideCounter += 1;
  const override: Override = { id: `lov${overrideCounter}-${Date.now().toString(36)}`, decisionId: body.decisionId, optionId: body.optionId };

  // Decision-identity capability: the target decision's `year` comes from the decision record
  // itself (found by its own literal id, exactly as rendered to the user), never parsed back out of
  // `override.decisionId` — see `decision-id.ts`. Found BEFORE restoring a snapshot or validating,
  // since both of those need this same year.
  const originalDecision = baseBranch.result.decisions.find((d) => d.id === override.decisionId);
  if (!originalDecision) return errorResponse(`No such decision "${override.decisionId}" in this branch.`);
  const chosenOption = originalDecision.options.find((o) => o.id === originalDecision.chosen);
  const newOption = originalDecision.options.find((o) => o.id === override.optionId);
  if (!newOption) return errorResponse(`"${override.optionId}" is not one of this decision's options.`);
  const originalLabel = chosenOption?.label ?? originalDecision.chosen;
  const newLabel = newOption.label;
  const entryId = originalDecision.resultingEventIds[0] ?? override.decisionId;
  const forkYear = originalDecision.year;

  let restoreSnapshot;
  try {
    restoreSnapshot = getRestoreSnapshot(baseBranch.snapshots, forkYear);
  } catch (error) {
    if (error instanceof ForkError) return errorResponse(error.message);
    throw error;
  }

  const validation = validateOverride(override, restoreSnapshot.people, restoreSnapshot.events, forkYear, life.config.seed, life.config, "protagonist");
  if (!validation.ok) return errorResponse(validation.error);

  // Rate limit + (if configured) Turnstile verification, BEFORE any simulation work starts.
  const guard = await guardSimulation(request, body);
  if (guard instanceof Response) return guard;
  const { decisionMaker, engineSource } = guard.engine;
  const newBranchId = newLifeBranchId();

  return sseResponse(async (send, signal) => {
    const start: LifeStreamEvent = {
      type: "start",
      lifeId,
      branchId: newBranchId,
      villageName: life.config.town.name,
      protagonist: { name: life.protagonistName, sex: life.protagonistSex, birthYear: restoreSnapshot.people.protagonist?.birthYear ?? life.config.startYear },
    };
    send("start", start);

    const divergence: LifeStreamEvent = { type: "divergence", entryId, year: forkYear, originalLabel, newLabel };
    send("divergence", divergence);

    // Round 12 (decision 045): see stream/route.ts's identical note — `decisionMaker` is a
    // process-wide singleton, so its stats are cumulative across every life/rewrite; snapshot
    // before/after this ONE run so the reported numbers are this rewrite's alone.
    const statsBefore = snapshotDecisionMakerStats(decisionMaker);

    let report;
    try {
      report = await drainSimulation(
        simulateYears(life.config, restoreSnapshot.people, restoreSnapshot.events, {
          decisionMaker,
          engineSource,
          overrides: [override],
          fromYear: forkYear,
          protagonistId: "protagonist",
        }),
        async (tick) => {
          const entries = await buildProvisionalTickEntries(
            "protagonist",
            tick.year,
            tick.snapshot.events,
            tick.snapshot.people,
            tick.snapshot.decisions,
            life.protagonistSex,
            life.config.seed,
            life.config.town.name,
            locale,
          );
          if (entries.length > 0) send("tick", { type: "tick", year: tick.year, entries });
          // Decision 081: flush this year's frame (and let a disconnect register) before simulating the next.
          await yieldToEventLoop();
        },
        signal,
      );
    } catch (error) {
      if (error instanceof SimulationAbortedError) return; // client disconnected — no persistence, no more frames
      throw error;
    }

    const label = `Changed in ${forkYear}`;
    const newBranch = registerLifeBranch(lifeId, newBranchId, branchId, forkYear, override, report.result, report.snapshots, label);
    if (!newBranch) {
      send("error", { type: "error", message: "Failed to create the new branch." });
      return;
    }

    const chronicleResult = await buildLifeChronicle(lifeId, newBranchId, locale);
    if (!chronicleResult.data) {
      send("error", { type: "error", message: chronicleResult.error ?? "Failed to build the chronicle." });
      return;
    }
    const chronicle = chronicleResult.data;

    // Matched by causal position (kind + personId + Nth occurrence), not literal decision id —
    // decision-identity capability: a rewritten decision's id shares neither a year nor (for a
    // legacy branch) even a FORMAT with the one it replaced (see `decision-id.ts#buildGhostAnnotations`).
    // `forkYear` (fixed after review, R3-002) numbers the base branch's occurrences from the fork
    // point on, matching `report.result.decisions`'s own fresh-from-`forkYear` numbering.
    const newEntriesFromFork = chronicle.entries.filter((e) => (e.endYear ?? e.year) >= forkYear);
    const ghosts = buildGhostAnnotations(baseBranch.result.decisions, report.result.decisions, newEntriesFromFork, forkYear);

    const runStats = decisionMakerRunStats(decisionMaker, statsBefore);
    const done: LifeStreamEvent = {
      type: "done",
      chronicle,
      ghosts,
      stats: { jevCalls: report.decisionCalls, cacheHits: runStats.cacheHits, wallTimeMs: report.wallTimeMs, jevRequests: runStats.jevRequests, jevQuestions: runStats.jevQuestions, inputTokens: runStats.inputTokens, estimatedUsd: runStats.estimatedUsd },
    };
    send("done", done);
  });
}

import type { DecisionRecord } from "@/domain/decisions";
import { decisionYear } from "@/domain/decisions";
import { diffBranches } from "@/domain/diff";
import { ForkError, getRestoreSnapshot } from "@/domain/fork";
import { simulate } from "@/domain/simulate";
import type { Override } from "@/domain/types";
import { validateOverride } from "@/domain/validate-override";
import { guardSimulation } from "@/server/abuse-guard";
import { sseResponse } from "@/server/sse";
import { addBranch, getBranch, getWorld } from "@/server/world-store";

export const runtime = "nodejs";

let overrideCounter = 0;

interface EditBody {
  branchId?: string;
  override?: { decisionId?: string; optionId?: string };
  turnstileToken?: string;
}

/**
 * Streams a fork the same way world creation streams (decision 010): a
 * `start` frame, then per-year `tick` frames from the fork year forward
 * (everything before it is already known — no ticks are sent for it), then
 * a `done` frame with the new branch id and the diff against the base.
 */
export async function POST(request: Request, context: { params: Promise<{ worldId: string }> }): Promise<Response> {
  const { worldId } = await context.params;
  const world = getWorld(worldId);
  if (!world) return new Response(JSON.stringify({ error: "World not found." }), { status: 404 });

  const body = (await request.json().catch(() => ({}))) as EditBody;
  const branchId = body.branchId ?? world.originalBranchId;
  const baseBranch = getBranch(worldId, branchId);
  if (!baseBranch) return new Response(JSON.stringify({ error: "Base branch not found." }), { status: 404 });
  if (!body.override?.decisionId || !body.override.optionId) return new Response(JSON.stringify({ error: "override.decisionId and override.optionId are required." }), { status: 400 });

  overrideCounter += 1;
  const override: Override = { id: `ov${overrideCounter}-${Date.now().toString(36)}`, decisionId: body.override.decisionId, optionId: body.override.optionId };

  let restoreSnapshot;
  try {
    restoreSnapshot = getRestoreSnapshot(baseBranch.snapshots, override);
  } catch (error) {
    if (error instanceof ForkError) return new Response(JSON.stringify({ error: error.message }), { status: 400 });
    throw error;
  }

  const validation = validateOverride(override, restoreSnapshot.people, restoreSnapshot.events, world.config.seed, world.config);
  if (!validation.ok) return new Response(JSON.stringify({ error: validation.error }), { status: 400 });

  // Rate limit + (if configured) Turnstile verification, BEFORE any simulation work or the SSE
  // stream starts.
  const guard = await guardSimulation(request, body);
  if (guard instanceof Response) return guard;
  const { decisionMaker, engineSource } = guard.engine;
  const forkYear = decisionYear(override.decisionId);

  return sseResponse(async (send) => {
    send("start", { forkYear, override });

    let lastEventCount = restoreSnapshot.events.length;
    let lastDecisionCount = restoreSnapshot.decisions.length;

    const report = await simulate(world.config, restoreSnapshot.people, restoreSnapshot.events, {
      decisionMaker,
      engineSource,
      overrides: [override],
      fromYear: forkYear,
      onYearComplete: (snapshot) => {
        const newEvents = snapshot.events.slice(lastEventCount);
        const newDecisions: DecisionRecord[] = snapshot.decisions.slice(lastDecisionCount);
        lastEventCount = snapshot.events.length;
        lastDecisionCount = snapshot.decisions.length;
        const population = Object.values(snapshot.people).filter((p) => p.deathYear === undefined).length;
        send("tick", { year: snapshot.year, population, newEvents, newDecisions });
      },
    });

    const forcedDecision = report.result.decisions.find((d) => d.id === override.decisionId);
    const label = forcedDecision
      ? `${forcedDecision.question} -> ${forcedDecision.options.find((o) => o.id === override.optionId)?.label ?? override.optionId}`
      : `Force "${override.optionId}" at ${override.decisionId}`;

    const newBranch = addBranch(worldId, branchId, forkYear, override, report.result, report.snapshots, label);
    if (!newBranch) {
      send("error", { message: "Failed to create branch." });
      return;
    }

    const diff = diffBranches(baseBranch.result, report.result, forkYear);

    send("done", {
      branchId: newBranch.id,
      parentBranchId: branchId,
      forkYear,
      override,
      engine: engineSource,
      stats: { decisionCalls: report.decisionCalls, wallTimeMs: report.wallTimeMs, adapterStats: decisionMaker.getStats?.() },
      diff,
    });
  });
}

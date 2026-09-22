import { NextResponse } from "next/server";
import { decisionYear } from "@/domain/decisions";
import { diffBranches } from "@/domain/diff";
import { ForkError, forkWorld, getRestoreSnapshot } from "@/domain/fork";
import type { Override } from "@/domain/types";
import { validateOverride } from "@/domain/validate-override";
import { guardSimulation } from "@/server/abuse-guard";
import { activeEngineName } from "@/server/decision-engine";
import { addBranch, getBranch, getWorld } from "@/server/world-store";

export const runtime = "nodejs";

let overrideCounter = 0;

interface EditBody {
  branchId?: string;
  override?: {
    decisionId?: string;
    optionId?: string;
  };
  turnstileToken?: string;
}

function buildOverride(body: NonNullable<EditBody["override"]>): Override | { error: string } {
  if (!body.decisionId) return { error: "override.decisionId is required." };
  if (!body.optionId) return { error: "override.optionId is required." };
  overrideCounter += 1;
  return { id: `ov${overrideCounter}-${Date.now().toString(36)}`, decisionId: body.decisionId, optionId: body.optionId };
}

export async function POST(request: Request, context: { params: Promise<{ worldId: string }> }): Promise<NextResponse | Response> {
  const { worldId } = await context.params;
  const world = getWorld(worldId);
  if (!world) return NextResponse.json({ error: "World not found." }, { status: 404 });

  const body = (await request.json().catch(() => ({}))) as EditBody;
  const branchId = body.branchId ?? world.originalBranchId;
  const baseBranch = getBranch(worldId, branchId);
  if (!baseBranch) return NextResponse.json({ error: "Base branch not found." }, { status: 404 });
  if (!body.override) return NextResponse.json({ error: "override is required." }, { status: 400 });

  const override = buildOverride(body.override);
  if ("error" in override) return NextResponse.json({ error: override.error }, { status: 400 });

  // Validate against the exact state the fork would restore and build from
  // (decision 008: "the decision exists in the base branch and the option
  // is one of its options"), so an edit targeting an ineligible decision
  // fails with a clear 400 instead of silently no-op'ing.
  let restoreSnapshot;
  try {
    restoreSnapshot = getRestoreSnapshot(baseBranch.snapshots, override);
  } catch (error) {
    if (error instanceof ForkError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }

  const validation = validateOverride(override, restoreSnapshot.people, restoreSnapshot.events, world.config.seed, world.config);
  if (!validation.ok) return NextResponse.json({ error: validation.error }, { status: 400 });

  // Rate limit + (if configured) Turnstile verification, BEFORE any simulation work starts.
  const guard = await guardSimulation(request, body);
  if (guard instanceof Response) return guard;
  const { decisionMaker } = guard.engine;
  const engineSource = activeEngineName();
  const forkYear = decisionYear(override.decisionId);

  try {
    const report = await forkWorld(baseBranch.snapshots, override, decisionMaker, engineSource, world.config);
    const forcedDecision = report.result.decisions.find((d) => d.id === override.decisionId);
    const label = forcedDecision ? `${forcedDecision.question} -> ${forcedDecision.options.find((o) => o.id === override.optionId)?.label ?? override.optionId}` : `Force "${override.optionId}" at ${override.decisionId}`;
    const newBranch = addBranch(worldId, branchId, forkYear, override, report.result, report.snapshots, label);
    if (!newBranch) return NextResponse.json({ error: "Failed to create branch." }, { status: 500 });

    const diff = diffBranches(baseBranch.result, report.result, forkYear);

    return NextResponse.json({
      branchId: newBranch.id,
      parentBranchId: branchId,
      forkYear,
      override,
      engine: engineSource,
      stats: { decisionCalls: report.decisionCalls, wallTimeMs: report.wallTimeMs, adapterStats: decisionMaker.getStats?.() },
      diff,
    });
  } catch (error) {
    if (error instanceof ForkError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}

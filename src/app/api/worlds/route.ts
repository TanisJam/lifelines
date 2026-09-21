import { NextResponse } from "next/server";
import { simulate } from "@/domain/simulate";
import { generateWorld } from "@/domain/worldgen";
import { activeEngineName, getDecisionMaker } from "@/server/decision-engine";
import { createWorld } from "@/server/world-store";

export const runtime = "nodejs";

interface CreateWorldBody {
  seed?: string;
  townName?: string;
}

function randomSeed(): string {
  return Math.random().toString(36).slice(2, 10);
}

export async function POST(request: Request): Promise<NextResponse> {
  let body: CreateWorldBody = {};
  try {
    body = (await request.json()) as CreateWorldBody;
  } catch {
    // Empty body is fine — we'll randomize the seed.
  }

  const seed = body.seed?.trim() || randomSeed();
  const { config, people, events } = generateWorld({ seed, townName: body.townName });

  const decisionMaker = getDecisionMaker();
  const report = await simulate(config, people, events, { decisionMaker, engineSource: activeEngineName() });

  const world = createWorld(config, report.result, report.snapshots);

  return NextResponse.json({
    worldId: world.id,
    branchId: world.originalBranchId,
    config,
    engine: activeEngineName(),
    stats: { decisionCalls: report.decisionCalls, wallTimeMs: report.wallTimeMs, adapterStats: decisionMaker.getStats?.() },
    peopleCount: Object.keys(report.result.people).length,
    eventCount: report.result.events.length,
  });
}

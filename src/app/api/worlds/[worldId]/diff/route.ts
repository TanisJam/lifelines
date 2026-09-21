import { NextResponse } from "next/server";
import { diffBranches } from "@/domain/diff";
import { getBranch, getWorld } from "@/server/world-store";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ worldId: string }> }): Promise<NextResponse> {
  const { worldId } = await context.params;
  const world = getWorld(worldId);
  if (!world) return NextResponse.json({ error: "World not found." }, { status: 404 });

  const url = new URL(request.url);
  const branchAId = url.searchParams.get("branchA") ?? world.originalBranchId;
  const branchBId = url.searchParams.get("branchB");
  const personId = url.searchParams.get("personId");
  if (!branchBId) return NextResponse.json({ error: "branchB query param is required." }, { status: 400 });

  const branchA = getBranch(worldId, branchAId);
  const branchB = getBranch(worldId, branchBId);
  if (!branchA || !branchB) return NextResponse.json({ error: "Branch not found." }, { status: 404 });

  const forkYear = branchB.forkYear ?? branchA.forkYear ?? world.config.startYear;
  const diff = diffBranches(branchA.result, branchB.result, forkYear);

  let personComparison = null;
  if (personId) {
    const before = branchA.result.people[personId];
    const after = branchB.result.people[personId];
    if (before && after) {
      personComparison = {
        personId,
        name: after.name,
        before: { alive: before.deathYear === undefined, deathYear: before.deathYear ?? null, job: before.job, spouseId: before.spouseId ?? null },
        after: { alive: after.deathYear === undefined, deathYear: after.deathYear ?? null, job: after.job, spouseId: after.spouseId ?? null },
        eventsBefore: branchA.result.events.filter((e) => e.actors.includes(personId) && e.year >= forkYear).map((e) => ({ year: e.year, kind: e.kind })),
        eventsAfter: branchB.result.events.filter((e) => e.actors.includes(personId) && e.year >= forkYear).map((e) => ({ year: e.year, kind: e.kind })),
      };
    }
  }

  return NextResponse.json({
    branchA: { id: branchA.id, label: branchA.label },
    branchB: { id: branchB.id, label: branchB.label, override: branchB.override ?? null, forkYear: branchB.forkYear ?? null },
    diff,
    personComparison,
  });
}

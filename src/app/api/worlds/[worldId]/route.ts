import { NextResponse } from "next/server";
import { ageInYear } from "@/domain/actuarial";
import { getBranch, getWorld, listBranches } from "@/server/world-store";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ worldId: string }> }): Promise<NextResponse> {
  const { worldId } = await context.params;
  const world = getWorld(worldId);
  if (!world) return NextResponse.json({ error: "World not found." }, { status: 404 });

  const url = new URL(request.url);
  const branchId = url.searchParams.get("branchId") ?? world.originalBranchId;
  const branch = getBranch(worldId, branchId);
  if (!branch) return NextResponse.json({ error: "Branch not found." }, { status: 404 });

  const now = world.config.endYear;
  const people = Object.values(branch.result.people)
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((person) => ({
      id: person.id,
      name: person.name,
      sex: person.sex,
      birthYear: person.birthYear,
      deathYear: person.deathYear ?? null,
      alive: person.deathYear === undefined,
      age: person.deathYear !== undefined ? ageInYear(person.birthYear, person.deathYear) : ageInYear(person.birthYear, now),
      job: person.job,
      spouseId: person.spouseId ?? null,
      spouseName: person.spouseId ? (branch.result.people[person.spouseId]?.name ?? null) : null,
      founder: person.founder,
    }));

  return NextResponse.json({
    worldId,
    config: world.config,
    branch: { id: branch.id, label: branch.label, parentBranchId: branch.parentBranchId ?? null, forkYear: branch.forkYear ?? null, override: branch.override ?? null },
    branches: listBranches(worldId).map((b) => ({ id: b.id, label: b.label, forkYear: b.forkYear ?? null })),
    people,
    eventCount: branch.result.events.length,
  });
}

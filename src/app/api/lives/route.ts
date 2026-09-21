import { NextResponse } from "next/server";
import type { LifeListItem } from "@/contracts/life";
import { DEATH_CAUSE_PHRASE, type DeathCause } from "@/domain/mortality";
import { listLifeBranches, listLives } from "@/server/life-store";

export const runtime = "nodejs";

/** "Your lives" (contract: `GET /api/lives`) — one row per life, read from its latest branch. */
export async function GET(): Promise<NextResponse> {
  const items: LifeListItem[] = listLives().map((life) => {
    const branch = life.branches.get(life.latestBranchId)!;
    const protagonist = branch.result.people.protagonist;
    const deathEvent = branch.result.events.find((e) => e.kind === "death" && e.actors[0] === "protagonist");
    const causeCode = deathEvent && typeof deathEvent.payload.cause === "string" ? (deathEvent.payload.cause as DeathCause) : undefined;
    const causeOfDeath = causeCode && causeCode in DEATH_CAUSE_PHRASE ? DEATH_CAUSE_PHRASE[causeCode] : "misfortune";
    const deathYear = protagonist?.deathYear ?? life.config.endYear;
    return {
      lifeId: life.id,
      name: life.protagonistName,
      birthYear: life.config.startYear,
      deathYear,
      ageAtDeath: deathYear - life.config.startYear,
      causeOfDeath,
      branchCount: listLifeBranches(life.id).length,
    };
  });
  return NextResponse.json(items);
}

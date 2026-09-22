import { NextResponse } from "next/server";
import type { LifeListItem } from "@/contracts/life";
import { isLocale } from "@/domain/locale";
import { deathCauseDisplay } from "@/domain/narrate";
import { DEATH_CAUSE_PHRASE, type DeathCause } from "@/domain/mortality";
import { listLifeSummaries } from "@/server/life-store";

export const runtime = "nodejs";

/**
 * "Your lives" (contract: `GET /api/lives`) — one row per life, read from its latest branch.
 * Decision 059: `causeOfDeath` is display text (not model- or cache-facing, unlike `DecisionRecord`
 * `question`), so unlike `simulate.ts`'s `questionText` it DOES honor the reader's locale — read
 * from an optional `?lang=` query param, since this route lives outside `app/[lang]` (API routes
 * never move under the locale segment) and so can't read it from the URL path the way a page can.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const langParam = new URL(request.url).searchParams.get("lang");
  const locale = langParam && isLocale(langParam) ? langParam : "en";
  const items: LifeListItem[] = listLifeSummaries().map((summary) => {
    const protagonist = summary.latestResult.people.protagonist;
    const deathEvent = summary.latestResult.events.find((e) => e.kind === "death" && e.actors[0] === "protagonist");
    const causeCode = deathEvent && typeof deathEvent.payload.cause === "string" ? (deathEvent.payload.cause as DeathCause) : undefined;
    const causeOfDeath = causeCode && causeCode in DEATH_CAUSE_PHRASE ? deathCauseDisplay(locale, causeCode) : locale === "es" ? "mala fortuna" : "misfortune";
    const deathYear = protagonist?.deathYear ?? summary.config.endYear;
    return {
      lifeId: summary.id,
      name: summary.protagonistName,
      birthYear: summary.config.startYear,
      deathYear,
      ageAtDeath: deathYear - summary.config.startYear,
      causeOfDeath,
      branchCount: summary.branchCount,
    };
  });
  return NextResponse.json(items);
}

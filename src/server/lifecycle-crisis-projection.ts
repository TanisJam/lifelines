/** Lifecycle-only context derived from recorded town events, never an authoritative event. */
import type { ChronicleEntry } from "@/contracts/life";
import type { Locale } from "@/domain/locale";
import { eventTimes } from "@/domain/month";
import { BLACK_DEATH_YEARS, SECOND_PESTILENCE_YEARS } from "@/domain/period/events";
import type { Event, Person } from "@/domain/types";

export function isRecordedCrisis(event: Event): boolean {
  return event.kind === "town" && event.actors.length === 0 &&
    ((event.payload.eventType === "black-death" && BLACK_DEATH_YEARS.has(event.year)) ||
     (event.payload.eventType === "second-pestilence" && SECOND_PESTILENCE_YEARS.has(event.year)));
}

function moveAway(event: Event): boolean | undefined {
  if (event.payload.away === true || event.payload.destination === "away") return true;
  if (event.payload.away === false || event.payload.returned === true || event.payload.destination === "home") return false;
  return undefined;
}

export function crisisEntries(input: {
  year: number; frontier: number; events: readonly Event[]; protagonist: Person;
  previousPerson?: Person; seed: string; town: string; locale: Locale;
}): ChronicleEntry[] {
  const { year, frontier, events, protagonist, previousPerson, seed, town, locale } = input;
  if (year > frontier || year < protagonist.birthYear || (protagonist.deathYear !== undefined && year > protagonist.deathYear)) return [];
  const yearEvents = events.filter(event => event.year === year);
  const times = eventTimes(seed, yearEvents, protagonist.id);
  const changes = yearEvents.filter(event => event.actors[0] === protagonist.id &&
    (event.kind === "move" || event.kind === "death" || event.kind === "birth"));
  const baseline = previousPerson ?? protagonist;
  const residence = baseline.lifeState?.residence;
  let initialAway = residence ? residence.status === "away" : baseline.away === true;
  const earlierMoves = events.filter(event => event.year < year && event.kind === "move" &&
    event.actors[0] === protagonist.id && moveAway(event) !== undefined);
  if (earlierMoves.length) {
    const latestYear = Math.max(...earlierMoves.map(event => event.year));
    const yearMoves = earlierMoves.filter(event => event.year === latestYear);
    const priorTimes = eventTimes(seed, events.filter(event => event.year === latestYear), protagonist.id);
    yearMoves.sort((a, b) => priorTimes.get(a.id)! - priorTimes.get(b.id)!);
    if (!residence || residence.since <= latestYear) initialAway = moveAway(yearMoves.at(-1)!)!;
  } else if (!previousPerson) {
    const firstMove = changes.find(event => event.kind === "move" && moveAway(event) !== undefined);
    if (firstMove) initialAway = !moveAway(firstMove);
  }
  return yearEvents.filter(isRecordedCrisis).flatMap(event => {
    const at = times.get(event.id)!;
    let away = initialAway;
    let alive = true;
    let born = protagonist.birthYear < year || !changes.some(change => change.kind === "birth");
    for (const change of [...changes].sort((a, b) => times.get(a.id)! - times.get(b.id)!)) {
      if (times.get(change.id)! >= at) break;
      if (change.kind === "move") away = moveAway(change) ?? away;
      else if (change.kind === "death") alive = false;
      else born = true;
    }
    if (away || !alive || !born) return [];
    const blackDeath = event.payload.eventType === "black-death";
    const title = locale === "es" ? (blackDeath ? "La peste negra" : "La segunda peste") : (blackDeath ? "The Black Death" : "The second pestilence");
    const prose = locale === "es" ? `${title} llegó a ${town}.` : `${title} reached ${town}.`;
    return [{ id: event.id, year, level: 2 as const, kind: "town", title, prose, links: [], at, who: [] }];
  });
}

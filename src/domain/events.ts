import type { Event, EventKind, Person } from "./types";

/**
 * Deterministic, content-derived event id. Deliberately NOT backed by a
 * mutable module-level counter: an id must depend only on the events array
 * passed in, so that two independent `simulate()` calls that produce the
 * same logical events (e.g. the base branch and a fork's untouched years)
 * assign the exact same ids, and structural comparisons (tests, diffing)
 * don't spuriously fail on id strings alone. The occurrence count of this
 * exact (year, kind, actors) combination so far acts as the disambiguator
 * for the rare case of two otherwise-identical events in the same year.
 */
export function makeEventId(events: readonly Event[], year: number, kind: EventKind, actors: readonly string[]): string {
  const actorsKey = actors.join("-");
  const occurrence = events.filter((e) => e.year === year && e.kind === kind && e.actors.join("-") === actorsKey).length;
  return `ev-${year}-${kind}-${actorsKey}-${occurrence}`;
}

export function eventsFor(events: readonly Event[], personId: string): Event[] {
  return events.filter((e) => e.actors.includes(personId)).sort((a, b) => a.year - b.year);
}

export function eventsOfKind(events: readonly Event[], kind: EventKind): Event[] {
  return events.filter((e) => e.kind === kind);
}

export function eventsUpToYear(events: readonly Event[], year: number): Event[] {
  return events.filter((e) => e.year <= year);
}

/** The pair key for a two-person relationship event, order-independent. */
export function pairKey(a: string, b: string): string {
  return [a, b].sort().join("::");
}

/**
 * A romance is "active" for a pair if there's a romance event with no later
 * breakup or marriage event for that same pair.
 */
export function activeRomancePair(events: readonly Event[], personId: string): string | undefined {
  const romances = events.filter((e) => e.kind === "romance" && e.actors.includes(personId)).sort((a, b) => b.year - a.year);
  for (const romance of romances) {
    const other = romance.actors.find((a) => a !== personId);
    if (!other) continue;
    const key = pairKey(personId, other);
    const resolved = events.some(
      (e) => (e.kind === "breakup" || e.kind === "marriage") && e.year >= romance.year && pairKey(e.actors[0] ?? "", e.actors[1] ?? "") === key,
    );
    if (!resolved) return other;
  }
  return undefined;
}

/** Most recent breakup for this person with no romance since, within `withinYears` of `year`. */
export function recentUnresolvedBreakup(events: readonly Event[], personId: string, year: number, withinYears: number): Event | undefined {
  const breakups = events
    .filter((e) => e.kind === "breakup" && e.actors.includes(personId) && year - e.year <= withinYears && year - e.year >= 0)
    .sort((a, b) => b.year - a.year);
  for (const breakup of breakups) {
    const hasNewerRomance = events.some((e) => e.kind === "romance" && e.actors.includes(personId) && e.year > breakup.year);
    if (!hasNewerRomance) return breakup;
  }
  return undefined;
}

/** Active (unreconciled) feud partner, if any. */
export function activeFeudPair(events: readonly Event[], personId: string): string | undefined {
  const feuds = events.filter((e) => e.kind === "feud" && e.actors.includes(personId)).sort((a, b) => b.year - a.year);
  for (const feud of feuds) {
    const other = feud.actors.find((a) => a !== personId);
    if (!other) continue;
    const key = pairKey(personId, other);
    const resolved = events.some((e) => e.kind === "reconciliation" && e.year >= feud.year && pairKey(e.actors[0] ?? "", e.actors[1] ?? "") === key);
    if (!resolved) return other;
  }
  return undefined;
}

/** Most recent illness year for this person, or undefined if none. Used to enforce a cooldown so illness doesn't spam. */
export function lastIllnessYear(events: readonly Event[], personId: string): number | undefined {
  const illnesses = events.filter((e) => e.kind === "illness" && e.actors.includes(personId));
  if (illnesses.length === 0) return undefined;
  return Math.max(...illnesses.map((e) => e.year));
}

/** Illness event ids that are cited as a cause of a same-or-later-year death — these are folded into the death narration instead of shown separately. */
export function illnessIdsSubsumedByDeath(events: readonly Event[]): Set<string> {
  const subsumed = new Set<string>();
  for (const event of events) {
    if (event.kind !== "death") continue;
    for (const causeId of event.causes) subsumed.add(causeId);
  }
  return subsumed;
}

/** Whether the person has "left the story" via a move-away event with no later "returned" event. */
export function hasMovedAway(events: readonly Event[], personId: string): boolean {
  const moves = events.filter((e) => e.kind === "move" && e.actors.includes(personId)).sort((a, b) => b.year - a.year);
  const last = moves[0];
  if (!last) return false;
  return last.payload.away === true;
}

/** The year the person's most recent move-away event happened, or undefined if they never left (or have since returned). */
export function awayMoveYear(events: readonly Event[], personId: string): number | undefined {
  const moves = events.filter((e) => e.kind === "move" && e.actors.includes(personId)).sort((a, b) => b.year - a.year);
  const last = moves[0];
  return last && last.payload.away === true ? last.year : undefined;
}

/** Alive *during* `year` means not-yet-processed-for-death this year: died-this-year people are still processed up to their death event. */
export function isAlive(person: Person, year: number): boolean {
  return person.deathYear === undefined || person.deathYear >= year;
}

import { keyedRng } from "./rng";
import { SEASONS, seasonFor } from "./town";
import type { Event } from "./types";

/**
 * Deterministic, season-consistent months for the night-sky scene. Prose names a season for birth,
 * romance and vignette events (`town.ts#seasonFor`, same keys and salts as `narrate.ts` and
 * `simulate.ts`), so the month an event lands in must fall inside that season. Everything here is
 * a pure function of (seed, events): nothing reads a clock, and the month for a given year only
 * depends on that year's events, so a provisional tick and the final chronicle agree.
 */

const SEASON_MONTHS: Readonly<Record<(typeof SEASONS)[number], readonly number[]>> = {
  "the depths of winter": [12, 1, 2],
  "the first days of spring": [3, 4, 5],
  "high summer": [6, 7, 8],
  "the golden days of autumn": [9, 10, 11],
};

const ALL_MONTHS: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
/** The Black Death reached the village in June 1348, so a plague death that year cannot fall before it. */
const BLACK_DEATH_MONTHS: readonly number[] = [6, 7, 8, 9, 10, 11, 12];

/** The months an event may land in on its own: its prose season for locked kinds, else any month (plague deaths: 1348 from June). */
export function allowedMonths(seed: string, event: Event, protagonistId: string): readonly number[] {
  const key = event.actors.join("-") || event.id;
  switch (event.kind) {
    case "birth":
      return SEASON_MONTHS[seasonFor(seed, key, event.year, "birth")];
    case "romance":
      return SEASON_MONTHS[seasonFor(seed, key, event.year, "romance")];
    case "vignette":
      return SEASON_MONTHS[seasonFor(seed, protagonistId, event.year, "D1")];
    case "death":
      return event.year === 1348 && event.payload.cause === "black-death" ? BLACK_DEATH_MONTHS : ALL_MONTHS;
    default:
      return ALL_MONTHS;
  }
}

function isSeasonLocked(event: Event): boolean {
  return event.kind === "birth" || event.kind === "romance" || event.kind === "vignette";
}

function pick(seed: string, event: Event, candidates: readonly number[]): number {
  const index = Math.floor(keyedRng(seed, event.id, event.year, "month")() * candidates.length);
  return candidates[Math.min(index, candidates.length - 1)]!;
}

/** The month (1-12) an event lands in on its own, ignoring causal neighbours. Pure in (seed, event). */
export function monthFor(seed: string, event: Event, protagonistId: string): number {
  return pick(seed, event, allowedMonths(seed, event, protagonistId));
}

/**
 * Months for every event, with causality respected inside a year: a season-locked event keeps its
 * season, and any other event takes a month between its same-year causes and its season-locked
 * same-year effects (when that range is empty, the cause wins). Two passes: an upper bound per
 * event from its effects, then a depth-first pick that resolves causes before their effects.
 */
export function resolveMonths(seed: string, events: readonly Event[], protagonistId: string): Map<string, number> {
  const byId = new Map(events.map((e) => [e.id, e]));
  // A person who dies in the year they were born dies after the birth, even without a recorded cause.
  const birthOf = new Map<string, Event>();
  for (const e of events) if (e.kind === "birth" && e.actors[0] && !birthOf.has(e.actors[0])) birthOf.set(e.actors[0], e);
  const causesOf = (event: Event): readonly string[] => {
    const birth = event.kind === "death" && event.actors[0] ? birthOf.get(event.actors[0]) : undefined;
    return birth && birth.year === event.year ? [...event.causes, birth.id] : event.causes;
  };
  const effectsOf = new Map<string, Event[]>();
  for (const event of events) {
    for (const causeId of causesOf(event)) {
      const cause = byId.get(causeId);
      if (!cause || cause.year !== event.year) continue;
      effectsOf.set(causeId, [...(effectsOf.get(causeId) ?? []), event]);
    }
  }

  const upper = new Map<string, number>();
  const upperBound = (event: Event): number => {
    const known = upper.get(event.id);
    if (known !== undefined) return known;
    let bound = 12;
    for (const effect of effectsOf.get(event.id) ?? []) {
      const effectCeiling = isSeasonLocked(effect) ? Math.max(...allowedMonths(seed, effect, protagonistId)) : upperBound(effect);
      bound = Math.min(bound, effectCeiling);
    }
    upper.set(event.id, bound);
    return bound;
  };

  const months = new Map<string, number>();
  const visiting = new Set<string>();
  // Depth-first so a cause is always resolved before its effect, whatever order the events arrive in.
  const resolve = (event: Event): void => {
    if (months.has(event.id) || visiting.has(event.id)) return;
    visiting.add(event.id);
    let lower = 1;
    for (const causeId of causesOf(event)) {
      const cause = byId.get(causeId);
      if (!cause || cause.year !== event.year) continue;
      resolve(cause);
      const causeMonth = months.get(causeId);
      if (causeMonth !== undefined) lower = Math.max(lower, causeMonth);
    }
    const allowed = allowedMonths(seed, event, protagonistId);
    const ceiling = upperBound(event);
    let candidates = allowed.filter((m) => m >= lower && m <= ceiling);
    if (candidates.length === 0) {
      // Empty range: the cause wins over the effect's ceiling; a locked season stays whole.
      candidates = allowed.filter((m) => m >= lower);
      if (candidates.length === 0) candidates = isSeasonLocked(event) ? [Math.max(...allowed)] : [lower];
    }
    months.set(event.id, pick(seed, event, candidates));
    visiting.delete(event.id);
  };
  for (const event of events) resolve(event);
  return months;
}

/**
 * Fractional year for every event: `year + (month - 1) / 12`, plus an in-month offset that spreads
 * the k-th of n same-month events across the month's inner 80%. Keeps entry order stable inside a month.
 */
export function eventTimes(seed: string, events: readonly Event[], protagonistId: string): Map<string, number> {
  const months = resolveMonths(seed, events, protagonistId);
  const counts = new Map<string, number>();
  for (const event of events) {
    const bucket = `${event.year}-${months.get(event.id)}`;
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
  }
  const seen = new Map<string, number>();
  const times = new Map<string, number>();
  for (const event of events) {
    const month = months.get(event.id)!;
    const bucket = `${event.year}-${month}`;
    const k = seen.get(bucket) ?? 0;
    seen.set(bucket, k + 1);
    times.set(event.id, at(event.year, month, k, counts.get(bucket)!));
  }
  return times;
}

/** Fractional year of the k-th (0-based) of n events in `month` of `year`. */
export function at(year: number, month: number, k: number, n: number): number {
  return year + (month - 1) / 12 + (0.1 + (0.8 * (k + 0.5)) / n) / 12;
}

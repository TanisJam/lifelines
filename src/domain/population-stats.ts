/**
 * Engine life course PR10 (population-trajectory diagnosis, `sdd/engine-life-course/state`):
 * shared, pure, unit-tested accounting helpers for `scripts/check-demographics.ts`'s life-table
 * view — extracted so the age-banding/averaging logic has real coverage under `pnpm test` (the
 * script itself is a dev tool, not part of the required verification commands, and vitest only
 * picks up `src/**\/*.test.ts` — same rationale as `cohort-stats.ts`, PR9's precedent).
 */

/** One band of an age-banded rate table, e.g. `actuarial.ts#MORTALITY_BY_AGE_BAND`'s own shape. */
export interface AgeBand {
  readonly maxAge: number;
  readonly label: string;
}

/** One person-year of exposure to a binary event (a death, a birth) at a given age. */
export interface AgeBandObservation {
  readonly age: number;
  readonly occurred: boolean;
}

export interface AgeBandRate {
  /** Person-years of exposure in this band. */
  readonly exposure: number;
  /** Of `exposure`, how many years the event actually occurred. */
  readonly events: number;
  /** `events / exposure`; `NaN` when `exposure` is 0 (never silently reported as a 0% rate). */
  readonly rate: number;
}

/**
 * Buckets `observations` into `bands` (first band whose `maxAge` the observation's `age` is
 * strictly under — mirrors `actuarial.ts#deathProbabilityAtAge`'s own lookup, so the same band
 * boundaries compare directly against that table) and returns each band's observed rate. Every
 * declared band gets an entry, even with zero exposure (`rate: NaN`, never a misleading 0) — a
 * caller comparing this against a hazard table should see "no data" as `NaN`, not silence.
 */
export function rateByAgeBand(observations: readonly AgeBandObservation[], bands: readonly AgeBand[]): Readonly<Record<string, AgeBandRate>> {
  const result: Record<string, AgeBandRate> = {};
  for (const band of bands) result[band.label] = { exposure: 0, events: 0, rate: NaN };
  for (const observation of observations) {
    const band = bands.find((b) => observation.age < b.maxAge) ?? bands[bands.length - 1];
    if (!band) continue;
    const entry = result[band.label]!;
    result[band.label] = { exposure: entry.exposure + 1, events: entry.events + (observation.occurred ? 1 : 0), rate: NaN };
  }
  for (const label of Object.keys(result)) {
    const entry = result[label]!;
    result[label] = { ...entry, rate: entry.exposure > 0 ? entry.events / entry.exposure : NaN };
  }
  return result;
}

/** A marriage the caller has already restricted to ones with real follow-up time (see check-demographics.ts's own cohort-completeness convention). */
export interface CompletedMarriage {
  readonly childCount: number;
}

/** Mean children ever born across `marriages` — the "children ever born per completed marriage" figure the research brief cites (~6-7 births historically). `NaN` for an empty list, never a division by zero. */
export function meanChildrenPerMarriage(marriages: readonly CompletedMarriage[]): number {
  if (marriages.length === 0) return NaN;
  return marriages.reduce((sum, m) => sum + m.childCount, 0) / marriages.length;
}

export interface MarriageEligibility {
  readonly everMarried: boolean;
}

/**
 * Whether a person belongs to a cohort resolved by `cohortAge`: the window follows them up to it
 * AND they survived to it. The historical "never married by 45" share is measured among survivors;
 * counting people who died as children inflates it with deaths that had nothing to do with marriage.
 *
 * PR13 STEP 0 (decision 075): the same survival semantics apply to "children ever born per
 * completed marriage" — the historical ~6-7 anchor is specifically for a woman who married and
 * SURVIVED to the end of her fertile window (45), not one cut short by early death. Before this
 * slice, `check-demographics.ts` counted EITHER outcome as "completed", deflating the figure below
 * what it's meant to compare against. `check-demographics.ts` reuses this same predicate (with
 * `cohortAge = FEMALE_FERTILE_WINDOW_END_AGE`) to gate that cohort too, not just never-married.
 */
export function inNeverMarriedCohort(person: { readonly birthYear: number; readonly deathYear?: number }, endYear: number, cohortAge: number): boolean {
  if (endYear - person.birthYear < cohortAge) return false;
  return person.deathYear === undefined || person.deathYear - person.birthYear >= cohortAge;
}

/** Percent of `cohort` (already restricted by the caller to people who reached marriageable age with real follow-up time) who never married. `NaN` for an empty cohort. */
export function neverMarriedSharePercent(cohort: readonly MarriageEligibility[]): number {
  if (cohort.length === 0) return NaN;
  const neverMarried = cohort.filter((c) => !c.everMarried).length;
  return (100 * neverMarried) / cohort.length;
}

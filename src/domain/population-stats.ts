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

/** One marriage event, as `check-demographics.ts`'s own chronologically-sorted marriage list already has it. */
export interface CompletedMarriageRecord {
  readonly wifeId: string;
  readonly marriageYear: number;
}

/** The minimal wife shape `completedMarriageWives` needs — same fields `inNeverMarriedCohort` takes. */
export interface CompletedMarriageWife {
  readonly id: string;
  readonly birthYear: number;
  readonly deathYear?: number;
}

/**
 * PR14 STEP 1 (decision 076): one wife id per qualifying "completed marriage" cohort member — NOT one
 * per marriage event. Before this fix, `check-demographics.ts` looped over every marriage event and
 * pushed a `childCount` sample for each one where the wife (by then) satisfied `inNeverMarriedCohort`.
 * Since that predicate only checks whether the WIFE survives to `cohortAge` — not which marriage — a
 * remarried wife who survives to 45 (common: the Black Death widows her mid-window) was counted once
 * per marriage, with her true lifetime children split into deflated per-husband samples. A marriage
 * that started at/after `cohortAge` (the fertile window's own end) was also counted despite having zero
 * possible fertile exposure. Both bugs deflated "children ever born per completed marriage" far below
 * what the SAME population's own age-specific marital fertility rate implies — the internal
 * contradiction the orchestrator flagged.
 *
 * `marriages` MUST already be sorted ascending by `marriageYear` (as `check-demographics.ts`'s own
 * `marriageEventsSorted` is) — a wife's first appearance in that order is her earliest marriage, which
 * decides both cohort membership (via `inNeverMarriedCohort`) and the fertile-window-start guard. The
 * caller sums each returned wife's TOTAL children (any father, any marriage) as her one sample.
 */
export function completedMarriageWives(
  marriages: readonly CompletedMarriageRecord[],
  wivesById: ReadonlyMap<string, CompletedMarriageWife>,
  endYear: number,
  cohortAge: number,
): readonly string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const marriage of marriages) {
    if (seen.has(marriage.wifeId)) continue;
    seen.add(marriage.wifeId);
    const wife = wivesById.get(marriage.wifeId);
    if (!wife) continue;
    if (!inNeverMarriedCohort(wife, endYear, cohortAge)) continue;
    if (marriage.marriageYear - wife.birthYear >= cohortAge) continue; // no possible fertile exposure in any marriage
    result.push(marriage.wifeId);
  }
  return result;
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

/**
 * Life expectancy at birth from a cohort observed from birth until `endYear`, corrected for right
 * censoring (a product-limit survival table by single year of age). The mean age at death of the
 * people who already died is biased low whenever the window ends while part of the cohort is still
 * alive — the longest lives are the ones not yet observed. Here someone still alive at `endYear` counts
 * as at risk for every age they were observed at. Age at death is `deathYear - birthYear`, so with no
 * censoring this equals the plain mean age at death. `NaN` for an empty cohort.
 */
export function lifeExpectancyFromExposure(cohort: readonly { readonly birthYear: number; readonly deathYear?: number }[], endYear: number): number {
  if (cohort.length === 0) return NaN;
  let survival = 1;
  let e0 = 0;
  for (let age = 0; survival > 0; age++) {
    let atRisk = 0;
    let deaths = 0;
    for (const person of cohort) {
      const ageAtDeath = person.deathYear !== undefined ? person.deathYear - person.birthYear : undefined;
      const observedAtAge = person.birthYear + age <= endYear;
      if (!observedAtAge || (ageAtDeath !== undefined && ageAtDeath < age)) continue;
      atRisk++;
      if (ageAtDeath === age) deaths++;
    }
    if (atRisk === 0) break;
    survival *= 1 - deaths / atRisk;
    e0 += survival;
  }
  return e0;
}

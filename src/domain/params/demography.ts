/**
 * Engine life course PR6 (design revision 2, decision 11): typed, named hazard tunables — replaces
 * scattered magic numbers (`MIN_MARRIAGE_AGE`, `ruleSelectionWeight`'s flat 0.3/0.85) with a single
 * params module. Every constant here is a DEFAULT, not a settled historical figure — see
 * `provenance.ts` for its source/range/confidence, and `targets.ts` for the calibration bands PR8
 * tunes against. Consumed by `hazards.ts` (the pure hazard-shape functions) and
 * `rule-decision-maker.ts` (the adapter that reports these hazards unchanged, per design decision 4).
 */
import type { Sex, SocialClass } from "../types";

/** One class/sex cell of the marriage-eligibility floor table. */
export interface MarriageFloor {
  /** The age from which marriage is even offered as a candidate (hard floor, never below canon law). */
  readonly minEligible: number;
  /** The logistic ramp's midpoint age — half the full-ramp hazard is reached here. */
  readonly onset: number;
}

/**
 * Design revision 2's revised marriage floors, replacing decision 053's `MIN_MARRIAGE_AGE` (whose
 * 1498-1558 figures made an 18-22 women's mean impossible for a cottar woman with a floor of 25).
 * `clergy` never actually reaches a Y1 candidate (`canMarry` excludes them) — its row carries the
 * villein figures only so this stays a total function over `SocialClass`.
 */
export const MARRIAGE_FLOORS: Readonly<Record<SocialClass, Readonly<Record<Sex, MarriageFloor>>>> = {
  gentry: { f: { minEligible: 14, onset: 16 }, m: { minEligible: 16, onset: 20 } },
  merchant: { f: { minEligible: 15, onset: 18 }, m: { minEligible: 18, onset: 23 } },
  artisan: { f: { minEligible: 15, onset: 18 }, m: { minEligible: 18, onset: 22 } },
  freeholder: { f: { minEligible: 15, onset: 18 }, m: { minEligible: 18, onset: 22 } },
  villein: { f: { minEligible: 15, onset: 18 }, m: { minEligible: 18, onset: 22 } },
  cottar: { f: { minEligible: 16, onset: 19 }, m: { minEligible: 18, onset: 22 } },
  clergy: { f: { minEligible: 15, onset: 18 }, m: { minEligible: 18, onset: 22 } },
};

/** Canon law's absolute floor (research.md, Family §rules 1) — never crossed by any class row above. */
export const CANON_MINIMUM_MARRIAGE_AGE: Readonly<Record<Sex, number>> = { f: 12, m: 14 };

/** `"*"` fallback row for `lookupHazard`'s miss chain (design decision 15): the modal commoner, villein. */
export const MARRIAGE_FLOOR_FALLBACK_ROW: Readonly<Record<Sex, MarriageFloor>> = MARRIAGE_FLOORS.villein;

/** Y1's time-in-state ramp: `D(t) = 1 + rho * min(t, cap)`, t = years marriageable and single. */
export const MARRIAGE_RAMP_RHO = 0.1;
export const MARRIAGE_RAMP_CAP_YEARS = 8;

/** Y1's base hazard at the full ramp (age well past onset, long time marriageable). */
export const MARRIAGE_BASE_AT_FULL_RAMP: Readonly<Record<Sex, number>> = { f: 0.3, m: 0.25 };

/** Y1 for an already-widowed person: a separate, flatter base (no time-in-state ramp — design decision "Widowed: separate base"). */
export const WIDOW_REMARRIAGE_BASE: Readonly<Record<Sex, number>> = { f: 0.12, m: 0.2 };

/**
 * `P_k(year)` for widow remarriage — provisional multiplier toward the research target (63% before
 * the Black Death, 26% after, `sdd/engine-life-course/research` #6144, M-S2). The exact annual curve
 * that converges to that cumulative target is PR8 calibration work; this is a directionally-correct
 * placeholder (ratio ~0.41, matching 26/63) applied from 1349 onward.
 */
export const WIDOW_REMARRIAGE_POST_BLACK_DEATH_FACTOR = 0.41;
export const WIDOW_REMARRIAGE_FACTOR_YEAR = 1349;

/** A1's Weibull hazard shape in courtship years: `h(t) = base * (k/lambda) * (t/lambda)^(k-1)`. */
export const COURTSHIP_WEIBULL_K = 1.5;
export const COURTSHIP_WEIBULL_LAMBDA = 3;
export const COURTSHIP_BASE_HAZARD = 0.45;

/** A2's fertility-band hazard by mother's age — how likely THIS is the year a couple tries, not the conception odds itself (see `simulate.ts#conceptionProbability`). */
export const FERTILITY_HAZARD_BANDS: readonly { readonly maxAge: number; readonly hazard: number }[] = [
  { maxAge: 20, hazard: 0.28 },
  { maxAge: 30, hazard: 0.35 },
  { maxAge: 35, hazard: 0.28 },
  { maxAge: 40, hazard: 0.18 },
  { maxAge: Infinity, hazard: 0.1 },
];

/** Y3 (leave-or-stay): peaks in young adulthood, lower for the unfree (chevage), further restricted after the Statute of Labourers (1351) — the mobility factor PR5 deferred to this slice. */
export const Y3_PEAK_HAZARD = 0.12;
export const Y3_OFF_PEAK_HAZARD = 0.04;
export const Y3_PEAK_MIN_AGE = 16;
export const Y3_PEAK_MAX_AGE = 30;
export const Y3_UNFREE_MOBILITY_FACTOR = 0.6;
export const Y3_STATUTE_MOBILITY_FACTOR = 0.5;

/** AP1/A3/C3 are one-shot candidates, gated to fire at most once by an exact-age eligibility check upstream — a high, near-certain hazard given eligibility (design's "one-shots: 0.95"). */
export const ONE_SHOT_HAZARD = 0.95;

/**
 * Every social decision kind NOT covered by the explicit hazard shapes above (Y4, A6, A8, A11, C1,
 * C2, C4, Y2, Y5, A4, A7, A9, A10, O1, O2, O3, O4, PIL1) — design's "Others: constant base by age
 * window". PR6's own scope (per the design's hazard-shapes table and tasks 6.1-6.10) only names
 * formulas for Y1/A1/A2/Y3/AP1/A3/C3; a genuine per-kind age-window curve for the remaining ~16
 * situational kinds has no design guidance yet and is deferred (documented deviation, see
 * apply-progress). This constant keeps them PARTICIPATING in the same absolute competing-risk draw
 * (design decision 1) at a modest, documented placeholder rather than the old relative 0.85 weight,
 * which would otherwise dominate the Σ and force a rescale on almost every person-year.
 */
export const OTHER_KIND_BASE_HAZARD = 0.08;

/** Hazard lookup miss fallback (design decision 15): never throws, degrades to this constant. */
export const FALLBACK_HAZARD = 0.02;

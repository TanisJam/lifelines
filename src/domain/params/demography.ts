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

/**
 * Y1's base hazard at the full ramp (age well past onset, long time marriageable). Design revision 2
 * marks these "provisional, calibrated" — the exact value is PR8's calibration job (task 8.2), not
 * this corrective's. PR6 corrective (engram #6280, task 1): left at the design's own default here;
 * the remaining gap between the measured mean first-marriage age and the onset+5 sanity band traces
 * to structurally rare classes (gentry/clergy are deliberately "one per village" in worldgen) facing
 * genuine partner scarcity, not the hazard rate — see the task 4 test's own doc comment.
 */
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

/**
 * A1's Weibull hazard shape in courtship years: `h(t) = base * (k/lambda) * (t/lambda)^(k-1)`.
 * PR6 corrective (engram #6280, "the marriage chain"): `lambda` lowered from 3 to 1.5 — the original
 * value put the curve's characteristic timescale at ~3 courtship years, meaning A1 stayed weak for
 * several years even after `effectiveSelectionHazard`'s P(propose) scaling (measured mean
 * courtship-to-marriage: 7.8 years). A smaller `lambda` makes the hazard substantial from the FIRST
 * eligible courtship year (courtshipYears=1, since A1 is never actually offered at t=0), matching a
 * mean courtship length closer to the design's own intent.
 */
export const COURTSHIP_WEIBULL_K = 1.5;
export const COURTSHIP_WEIBULL_LAMBDA = 1.5;
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

/**
 * PR9 (step 2, engram #6142/#6311): `actuarial.ts#deathProbabilityAtAge`'s per-age-band annual
 * death probability, moved out of that function's inline if-chain into a named, documented table —
 * decision 050 originally calibrated it against research.md's TUDOR figures (1498-1558: e0 ~35,
 * infant mortality ~150-171/1000), but PR9's period is 1327-1361, whose own research target
 * (`params/targets.ts#CALIBRATION_TARGETS.infantMortality`) is ~30% by age 1 — roughly double the
 * Tudor rate. Only the age<2 band changes here (0.14 -> 0.30); every other band is left at decision
 * 050's Tudor figure, since `under15DeathShare` (the CONDITIONAL age 2-7 death share, among infancy
 * survivors) already met its own 20-30% target under those unchanged figures — raising them too
 * would risk overshooting an already-passing band with no diagnosed reason to.
 *
 * Measured (60-seed `--stats --assert`, period 1327-1427, this table's age<2 band alone raised):
 * infantMortality 13.4% -> 29.1% (the point target is 30% exactly — effectively unhittable by any
 * stochastic simulation; 29.1% is as close as repeated tuning got it). `lifeExpectancyAtBirth`
 * moved from 23.7 (comfortably inside 22-35) to 21.9 — a small, expected, honest side effect of
 * correcting infant mortality upward (more early deaths mechanically lower the cohort's average age
 * at death) — just under its own 22 floor, reported rather than chased further; that target is
 * itself flagged "low confidence" in `targets.ts`. `widowRemarriagePostBlackDeath` moved from FAIL
 * to PASS at this same measurement (24.5%, band 23-29) as a side effect of more widowing overall.
 */
export const MORTALITY_BY_AGE_BAND: readonly { readonly maxAge: number; readonly hazard: number }[] = [
  { maxAge: 2, hazard: 0.3 }, // infant/toddler year: see actuarial.ts#deathProbabilityAtAge's age<2 band-width note
  { maxAge: 5, hazard: 0.065 },
  { maxAge: 15, hazard: 0.027 },
  { maxAge: 40, hazard: 0.016 },
  { maxAge: 60, hazard: 0.032 },
  { maxAge: 75, hazard: 0.07 },
  { maxAge: 90, hazard: 0.2 },
  { maxAge: Infinity, hazard: 0.47 },
];

/**
 * PR9 (partner-scarcity fix, engram #6142/#6311): the annual chance a new immigrant arrives in the
 * village (`simulate.ts`'s "immigration" biology candidate, gated to `livingIds.length < 38`) —
 * previously a hardcoded, undocumented `const p = 0.05` inline in `simulate.ts`. This IS the
 * engine's own "marriage market beyond the village" mechanism (`spawnImmigrant` creates an
 * unmarried adult who joins the general village pool, eligible for the same Y1 search as anyone
 * else) — raised here rather than inventing a second, parallel mechanism.
 *
 * Measured (30-seed `--stats` runs, same seeds, this constant alone varied): at the old 0.05, widow
 * remarriage was 24.5%/18.5% (pre/post-1349) against a 60-66%/23-29% target. At 0.10, post-1349
 * remarriage reaches 26.0% (inside its band); pre-1349 improves to 28.8% but stays below target.
 * This has a real, reproducible COST: first-marriage age for the born-in-sim cohort got WORSE, not
 * better (25.5/25.3 -> 27.4/28.3 years, F/M, moving further from the 18-22/21-25 target) — more
 * concurrent marriageable people in the same local search pool appears to increase per-year
 * contention, not just supply. A more surgical "only spawn a migrant for someone with zero local
 * candidates after a long wait" mechanism was tried and reverted (destabilized an unrelated
 * protagonist-storyline regression test — see apply-progress) — this blanket rate is the safer,
 * smaller change, landed with the tradeoff reported rather than hidden.
 *
 * REVERTED to 0.05 by the PR9 demography follow-up (decision 070), after `DEFAULT_FOUNDER_COUNT`
 * was enlarged to give the village a real local marriage market AND the immigration population cap
 * (`IMMIGRATION_POPULATION_CAP_RATIO`, below) was fixed so immigration can actually fire again at the
 * new size. Re-measured at the new default (`founderCount: 62`, 60-seed `--stats`, cap fix applied
 * both times): 0.10 vs 0.05 made no meaningful difference to firstMarriageAge (F 24.28 both; M 27.31
 * vs 26.98 -- 0.05 slightly BETTER, opposite of the original finding) or literacy (6.70% vs 6.77%);
 * widow remarriage post-1349 was marginally higher at 0.10 (25.20% vs 24.03%, both inside the 23-29%
 * band either way). With a real village-scale marriage market now doing the heavy lifting, the extra
 * immigrants from 0.10 cost more simulated population (and so more decideYear situations) for no
 * measurable calibration benefit — reverted to the pre-PR9 0.05.
 */
export const IMMIGRATION_ANNUAL_PROBABILITY = 0.05;

/**
 * PR9 demography follow-up (village-size enlargement, decision 069/070): `simulate.ts`'s immigration
 * candidate was gated on a hardcoded `livingIds.length < 38` since the engine's original commit
 * (`ba10883`) -- calibrated, unnamed, to the OLD `DEFAULT_FOUNDER_COUNT` of 18 adult founders
 * (~20-24 people at world start; 38/18 ≈ 2.11, "comfortably sized" meant roughly double the founder
 * headcount). Once `DEFAULT_FOUNDER_COUNT` was raised for a realistic village, that fixed 38 became
 * a silent kill switch: a ~80-person village starts ABOVE 38, so immigration never fires from year
 * one regardless of `IMMIGRATION_ANNUAL_PROBABILITY`'s value -- confirmed by measurement (a
 * `founderCount: 62` run offered zero immigration candidates across 1327-1330 before this fix).
 * Named and scaled here so the cap tracks the ACTUAL village a life was generated with (via its
 * founders' headcount in `people`, never `config` -- `WorldConfig` doesn't carry `founderCount`),
 * preserving the original ratio exactly: old lives (founderCount 18) keep the identical ~38 cap they
 * always had (no migration, no behavior change for anything already stored), new lives scale
 * proportionally.
 */
export const IMMIGRATION_POPULATION_CAP_RATIO = 38 / 18;

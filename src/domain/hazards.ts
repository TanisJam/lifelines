/**
 * Engine life course PR6 (event-hazards capability, design revision 2's "Hazard shapes"/"Hazard
 * lookup miss" sections): absolute per-kind annual hazards, replacing decision 045's flat relative
 * `ruleSelectionWeight` (0.3/0.85). `computeHazard` is pure — no RNG, no I/O — and is consumed by
 * `rule-decision-maker.ts`'s `decideYear` (design decision 4: "RuleDecisionMaker returns selection =
 * hazards, t=1", i.e. unchanged, no clamp). `resolveCompetingRisks` implements design decision 1's
 * "one exclusive categorical per person-year": `P(k) = h'_k`, residual `1 - sum(h'_k)`, proportional
 * rescale if the sum exceeds 0.95 (leaving exactly 0.05 for the residual `nothing`/`everyday`).
 */
import {
  CANON_MINIMUM_MARRIAGE_AGE,
  COURTSHIP_BASE_HAZARD,
  COURTSHIP_WEIBULL_K,
  COURTSHIP_WEIBULL_LAMBDA,
  FALLBACK_HAZARD,
  FERTILITY_HAZARD_BANDS,
  MARRIAGE_BASE_AT_FULL_RAMP,
  MARRIAGE_FLOORS,
  MARRIAGE_RAMP_CAP_YEARS,
  MARRIAGE_RAMP_RHO,
  ONE_SHOT_HAZARD,
  OTHER_KIND_BASE_HAZARD,
  WIDOW_REMARRIAGE_BASE,
  WIDOW_REMARRIAGE_FACTOR_YEAR,
  WIDOW_REMARRIAGE_POST_BLACK_DEATH_FACTOR,
  Y3_OFF_PEAK_HAZARD,
  Y3_PEAK_HAZARD,
  Y3_PEAK_MAX_AGE,
  Y3_PEAK_MIN_AGE,
  Y3_STATUTE_MOBILITY_FACTOR,
  Y3_UNFREE_MOBILITY_FACTOR,
} from "./params/demography";
import { isUnfree } from "./period/markers";
import { STATUTE_OF_LABOURERS_YEAR } from "./period/events";
import type { Sex, SocialClass } from "./types";

/** The decision kinds design revision 2 gives an explicit hazard shape to. Every other social kind uses `OTHER_KIND_BASE_HAZARD`. */
export type HazardKind = "Y1" | "A1" | "A2" | "Y3" | "AP1" | "A3" | "C3";

export interface HazardContext {
  /** Any `DecisionKind` string. Only the seven `HazardKind` values get a real shape; every other kind falls through to `OTHER_KIND_BASE_HAZARD`. */
  readonly kind: string;
  readonly age: number;
  readonly sex: Sex;
  readonly socialClass: SocialClass;
  readonly year: number;
  /** Y1 only: whether this person is re-entering the pool as a widow(er) — uses the separate flat base, no ramp. */
  readonly isWidowed?: boolean;
  /** Y1 only: years since this person first became age-eligible for marriage (see `life-state.ts`). Absent/0 for a newly eligible person. */
  readonly yearsMarriageable?: number;
  /** A1 only: years since the courtship (romance) began. */
  readonly courtshipYears?: number;
}

export interface HazardResult {
  readonly value: number;
  /** Set when a class/sex lookup missed and degraded to the `"*"` row or `FALLBACK_HAZARD` (design decision 15). */
  readonly fallbackKey?: string;
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/**
 * Generic hazard-table lookup with the design's documented miss chain: exact `(class, sex)` cell →
 * the kind's `"*"` row (here, the `villein` row — the modal commoner) → `FALLBACK_HAZARD`. Never
 * throws: a missing cell degrades instead of crashing a live SSE run (design decision 15).
 */
export function lookupHazard(table: Readonly<Record<string, Readonly<Record<string, number>> | undefined>>, kind: string, socialClass: string, sex: string): HazardResult {
  const exact = table[socialClass]?.[sex];
  if (exact !== undefined) return { value: exact };
  const starRow = table.villein?.[sex];
  const fallbackKey = `${kind}:${socialClass}`;
  if (starRow !== undefined) return { value: starRow, fallbackKey };
  return { value: FALLBACK_HAZARD, fallbackKey };
}

/** Y1's marriage floors, reshaped into a plain `Record<string, Record<string, number>>` per sex-field, for `lookupHazard`'s generic signature. */
function marriageFloorField(field: "minEligible" | "onset"): Record<string, Record<string, number>> {
  const table: Record<string, Record<string, number>> = {};
  for (const [socialClass, bySex] of Object.entries(MARRIAGE_FLOORS)) {
    table[socialClass] = { f: bySex.f[field], m: bySex.m[field] };
  }
  return table;
}

/** The age from which `person` is eligible to marry, by class/sex, never below canon law. Mirrors `simulate.ts`'s old `minMarriageAge`, now sourced from `params/demography.ts`. */
export function minEligibleAge(socialClass: SocialClass, sex: Sex): number {
  const looked = lookupHazard(marriageFloorField("minEligible"), "minEligible", socialClass, sex);
  return Math.max(looked.value, CANON_MINIMUM_MARRIAGE_AGE[sex]);
}

function onsetAge(socialClass: SocialClass, sex: Sex): HazardResult {
  return lookupHazard(marriageFloorField("onset"), "onset", socialClass, sex);
}

/** Logistic ramp centered on `onset`: 0.5 at the midpoint, approaching 1 well past it, near 0 well before it. */
function logisticRamp(age: number, midpoint: number): number {
  return 1 / (1 + Math.exp(-(age - midpoint)));
}

function y1Hazard(ctx: HazardContext): HazardResult {
  if (ctx.isWidowed) {
    const base = WIDOW_REMARRIAGE_BASE[ctx.sex];
    const factor = ctx.year >= WIDOW_REMARRIAGE_FACTOR_YEAR ? WIDOW_REMARRIAGE_POST_BLACK_DEATH_FACTOR : 1;
    return { value: clamp01(base * factor) };
  }
  const onset = onsetAge(ctx.socialClass, ctx.sex);
  const ramp = logisticRamp(ctx.age, onset.value);
  const t = Math.min(ctx.yearsMarriageable ?? 0, MARRIAGE_RAMP_CAP_YEARS);
  const timeInStateMultiplier = 1 + MARRIAGE_RAMP_RHO * t;
  const value = clamp01(MARRIAGE_BASE_AT_FULL_RAMP[ctx.sex] * ramp * timeInStateMultiplier);
  return { value, fallbackKey: onset.fallbackKey };
}

/** `h(t) = base * (k/lambda) * (t/lambda)^(k-1)`, the Weibull hazard rate — increasing in `t` for `k > 1` (design: "Weibull in courtshipYears, k≈1.5"). */
function weibullHazardRate(t: number, k: number, lambda: number): number {
  if (t <= 0) return 0;
  return (k / lambda) * Math.pow(t / lambda, k - 1);
}

function a1Hazard(ctx: HazardContext): HazardResult {
  const t = ctx.courtshipYears ?? 0;
  return { value: clamp01(COURTSHIP_BASE_HAZARD * weibullHazardRate(t, COURTSHIP_WEIBULL_K, COURTSHIP_WEIBULL_LAMBDA)) };
}

function a2Hazard(ctx: HazardContext): HazardResult {
  const band = FERTILITY_HAZARD_BANDS.find((b) => ctx.age < b.maxAge) ?? FERTILITY_HAZARD_BANDS[FERTILITY_HAZARD_BANDS.length - 1]!;
  return { value: band.hazard };
}

function y3Hazard(ctx: HazardContext): HazardResult {
  let value = ctx.age >= Y3_PEAK_MIN_AGE && ctx.age <= Y3_PEAK_MAX_AGE ? Y3_PEAK_HAZARD : Y3_OFF_PEAK_HAZARD;
  const unfree = isUnfree(ctx.socialClass);
  if (unfree) {
    value *= Y3_UNFREE_MOBILITY_FACTOR;
    if (ctx.year >= STATUTE_OF_LABOURERS_YEAR) value *= Y3_STATUTE_MOBILITY_FACTOR;
  }
  return { value: clamp01(value) };
}

/**
 * The absolute annual hazard for one candidate this person-year. Every kind not covered by an
 * explicit shape above (Y4, A6, A8, A11, C1, C2, C4, Y2, Y5, A4, A7, A9, A10, O1, O2, O3, O4, PIL1)
 * falls through to `OTHER_KIND_BASE_HAZARD` — see that constant's doc comment for the scoping
 * rationale. `AP1`/`A3`/`C3` are one-shots (already gated to a single eligible year upstream).
 */
export function computeHazard(ctx: HazardContext): HazardResult {
  switch (ctx.kind) {
    case "Y1":
      return y1Hazard(ctx);
    case "A1":
      return a1Hazard(ctx);
    case "A2":
      return a2Hazard(ctx);
    case "Y3":
      return y3Hazard(ctx);
    case "AP1":
    case "A3":
    case "C3":
      return { value: ONE_SHOT_HAZARD };
    default:
      return { value: OTHER_KIND_BASE_HAZARD };
  }
}

/**
 * PR6 corrective (validator finding, engram #6280 "the marriage chain"): the design's own hazard
 * shapes describe the FULL yearly probability that a marriage-track event happens — but this engine
 * asks a SEPARATE outcome question once a candidate wins the competing-risk draw (Y1's own
 * `ruleDistribution` branch judges "encourage" vs "decline"/"wait"; A1 judges "propose" vs
 * "delay"/"end-it"), which silently compounds two independent probabilities into a far smaller one
 * (measured: Y1 winning ~26.5% x P(encourage)~0.4, THEN A1 winning x P(propose)~0.45 — four
 * multiplied terms where the design intends roughly one effective per-year rate). Dividing the raw
 * hazard by the outcome probability (floored so a low-facet person's rare "encourage"/"propose"
 * doesn't blow the scaled hazard up unboundedly, capped at 1 so a single candidate's own marginal
 * probability never exceeds certainty) keeps the compound chain's AVERAGE matching the design's own
 * stated per-year rate, while still letting the adapter genuinely judge the outcome — the port
 * contract ("adapter judges, engine samples") is unchanged; this only corrects the UNITS of what one
 * "hazard" means once a second, independent judgment gates its effect.
 */
export const OUTCOME_PROBABILITY_FLOOR = 0.15;

export function effectiveSelectionHazard(rawHazard: number, outcomeProbability: number, floor: number = OUTCOME_PROBABILITY_FLOOR): number {
  return Math.min(1, rawHazard / Math.max(outcomeProbability, floor));
}

export interface MarriageChainExpectation {
  readonly expectedCourtshipStartAge: number;
  readonly expectedCourtshipYears: number;
  readonly expectedMarriageAge: number;
}

/**
 * PR6 corrective (engram #6280, task 4's calibration sanity check): an ANALYTIC (no RNG, no
 * simulation), instant estimate of the expected age courtship begins and the expected total years to
 * first marriage. Uses each year's RAW hazard (`computeHazard`) as "probability of progressing this
 * year" — which is exactly right by construction: `effectiveSelectionHazard` scales the SELECTION
 * weight so that (selection wins) x (outcome is positive) recovers the raw hazard, so the design's
 * own single stated per-year rate IS the effective yearly progress probability, once the outcome-roll
 * discount is corrected for. Deliberately ignores breakups/restarts and competing non-marriage
 * candidates (an optimistic lower bound on real simulated marriage age, not a replacement for one) —
 * useful as a fast, deterministic regression guard against the exact "chain multiplication" bug this
 * corrective fixes, and as a calibration aid for PR8.
 */
export function expectedMarriageChain(socialClass: SocialClass, sex: Sex, maxYears = 60): MarriageChainExpectation {
  const minEligible = minEligibleAge(socialClass, sex);

  let survivalSingle = 1;
  let expectedYearsToCourtship = 0;
  for (let t = 0; t < maxYears; t++) {
    const h = computeHazard({ kind: "Y1", age: minEligible + t, sex, socialClass, year: 1340, yearsMarriageable: t }).value;
    expectedYearsToCourtship += survivalSingle * h * t;
    survivalSingle *= 1 - h;
  }
  expectedYearsToCourtship += survivalSingle * maxYears; // censor remaining mass conservatively

  let survivalCourting = 1;
  let expectedCourtshipYears = 0;
  for (let s = 1; s <= maxYears; s++) {
    const h = computeHazard({ kind: "A1", age: 0, sex, socialClass, year: 1340, courtshipYears: s }).value;
    expectedCourtshipYears += survivalCourting * h * s;
    survivalCourting *= 1 - h;
  }
  expectedCourtshipYears += survivalCourting * maxYears;

  const expectedCourtshipStartAge = minEligible + expectedYearsToCourtship;
  return { expectedCourtshipStartAge, expectedCourtshipYears, expectedMarriageAge: expectedCourtshipStartAge + expectedCourtshipYears };
}

export interface CompetingRiskResolution {
  /** Every input id's rescaled absolute probability — sums with `residual` to exactly 1. */
  readonly selection: Readonly<Record<string, number>>;
  /** `nothing` (NPC) or `everyday` (protagonist)'s share — the remainder after every hazard. */
  readonly residual: number;
}

const RESCALE_THRESHOLD = 0.95;

/**
 * Design decision 1's competing-risk resolution: `P(k) = h'_k`, `residual = 1 - sum(h'_k)`. If the
 * raw sum exceeds `RESCALE_THRESHOLD`, every hazard is scaled down proportionally so the sum is
 * exactly `RESCALE_THRESHOLD`, leaving a `1 - RESCALE_THRESHOLD` residual — never zero, so `nothing`/
 * `everyday` always has a real (if small) chance even in the busiest person-year. Pure and
 * deterministic: the actual exclusive draw is `simulate.ts`'s existing `event-pick` Gumbel-max
 * sample, unchanged by this function.
 */
export function resolveCompetingRisks(rawHazards: Readonly<Record<string, number>>): CompetingRiskResolution {
  const entries = Object.entries(rawHazards);
  const sum = entries.reduce((total, [, h]) => total + Math.max(0, h), 0);
  const scale = sum > RESCALE_THRESHOLD ? RESCALE_THRESHOLD / sum : 1;
  const selection: Record<string, number> = {};
  for (const [id, h] of entries) selection[id] = Math.max(0, h) * scale;
  const residual = 1 - sum * scale;
  return { selection, residual };
}

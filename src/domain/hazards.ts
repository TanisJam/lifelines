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
import type { Distribution, PersonYearSituation } from "./decisions";
import { FALLBACK_CLASS } from "./period/classes";
import { isUnfree } from "./period/markers";
import { STATUTE_OF_LABOURERS_YEAR } from "./period/events";
import { normalizeDistribution } from "./rng";
import type { JsonValue, Sex, SocialClass } from "./types";

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

/**
 * The logistic ramp's own midpoint age (`MARRIAGE_FLOORS[socialClass][sex].onset`, via the same
 * miss-degrading `lookupHazard` chain `y1Hazard` uses). Exported (PR12 STEP 2, decision 074) so the
 * RULE adapter's own outcome-probability curve (`rule-heuristics.ts`) can read "years past this
 * person's own class/sex onset" without duplicating the floor table or its miss-chain — a pure lookup,
 * not a change to this file's hazard-prior/clamp machinery.
 */
export function onsetAge(socialClass: SocialClass, sex: Sex): HazardResult {
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

function asRecord(value: JsonValue | undefined): Record<string, JsonValue> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, JsonValue>) : undefined;
}

function numberField(record: Record<string, JsonValue> | undefined, key: string): number | undefined {
  const value = record?.[key];
  return typeof value === "number" ? value : undefined;
}

/**
 * Engine life course PR7 (moved from `rule-decision-maker.ts`, which introduced this in PR6, so both
 * adapters build a `HazardContext` the same way — spec's "identically for both adapters" requirement):
 * builds the `HazardContext` `computeHazard` needs from a `PersonYearSituation`'s own
 * `DecisionQuestion.state` — `self.age/sex/socialClass` (already there for every kind, see
 * `simulate.ts#personSummary`) plus the kind-specific time-in-state extras `simulate.ts` attaches to
 * `situation` (`yearsMarriageable`, `courtshipYears`, `isWidowed`).
 */
export function buildHazardContext(situation: PersonYearSituation): HazardContext {
  const self = asRecord(situation.question.state.self);
  const situationState = asRecord(situation.question.state.situation);
  return {
    kind: situation.kind,
    age: numberField(self, "age") ?? 0,
    sex: (self?.sex as Sex | undefined) ?? "f",
    socialClass: (self?.socialClass as SocialClass | undefined) ?? FALLBACK_CLASS,
    year: situation.question.year,
    isWidowed: situationState?.isWidowed === true,
    yearsMarriageable: numberField(situationState, "yearsMarriageable"),
    courtshipYears: numberField(situationState, "courtshipYears"),
  };
}

/**
 * PR6 corrective (engram #6280, "the marriage chain"), moved here in PR7: the two-stage
 * marriage-track kinds — `Y1` (courtship offer, "encourage") and `A1` (proposal, "propose") — each
 * gate their hazard's effect behind a SECOND, independent outcome roll (a `resp:<id>` Choice, or
 * `ruleDistribution`'s own branch for the rule adapter). Naming the "positive" option here lets
 * `computeHazardPrior` scale the raw hazard by `effectiveSelectionHazard` so the COMPOUND
 * (selection-wins x this-option-chosen) probability matches the design's own single stated per-year
 * rate — a THIRD two-stage kind should extend this map, per the PR6-corrective precedent, not invent a
 * new pattern.
 *
 * PR8 fix (engram #6284/#6280, the fertility collapse): `A2` (have a child, "try" vs "wait"/"refuse")
 * is exactly that third two-stage kind — its `wait`/`refuse` options are "nothing happened" outcomes,
 * the same shape as Y1's "decline"/"wait" and A1's "delay"/"end-it". It was never added when PR6
 * corrective fixed the marriage chain, so `FERTILITY_HAZARD_BANDS`' own annual hazard was silently
 * compounded by `ruleDistribution`'s `~35-40%` "try" answer on top of it — measured (engram #6284):
 * A2 won its person-year draw 21.1% of offered years (matching its raw hazard band), but only 34.6% of
 * those wins actually chose "try", so the effective birth-attempt rate was ~7.3%/eligible-year against
 * the ~25-35% the hazard curve intends. Adding `A2` here lets `effectiveSelectionHazard` cancel that
 * exact discount, the same way it already does for Y1/A1.
 */
export const OUTCOME_SCALED_KINDS: Readonly<Record<string, string>> = { Y1: "encourage", A1: "propose", A2: "try" };

export interface HazardPriorResult extends CompetingRiskResolution {
  /** Cumulative hazard-table lookup misses this call surfaced, keyed `${kind}:${socialClass}` (design decision 15). */
  readonly hazardFallbacks: Readonly<Record<string, number>>;
}

/**
 * Engine life course PR7 (extracted from `rule-decision-maker.ts`'s PR6 `decideYear`, unchanged
 * logic — spec's "identically for both adapters" requirement): the shared hazard-baseline computation
 * both `RuleDecisionMaker` (unclamped, `t=1`) and `JevDecisionMaker` (clamped, see
 * `clampJevSelection`) build their `PersonYearResult.selection` from. Skips `D1` (no hazard shape;
 * vignettes are judged separately). `response` supplies each situation's own outcome-roll answer for
 * `OUTCOME_SCALED_KINDS` — the RULE adapter passes its own `ruleDistribution` answers; the JEV adapter
 * passes Jev's own `resp:<id>` answers, so each adapter's baseline is scaled against the same
 * judgment its selection will be compared to (never a foreign one).
 */
export function computeHazardPrior(situations: Readonly<Record<string, PersonYearSituation>>, response: Readonly<Record<string, Distribution>>): HazardPriorResult {
  const rawHazards: Record<string, number> = {};
  const hazardFallbacks: Record<string, number> = {};
  for (const [id, situation] of Object.entries(situations)) {
    if (situation.kind === "D1") continue;
    const hazard = computeHazard(buildHazardContext(situation));
    if (hazard.fallbackKey) hazardFallbacks[hazard.fallbackKey] = (hazardFallbacks[hazard.fallbackKey] ?? 0) + 1;
    const outcomeOption = OUTCOME_SCALED_KINDS[situation.kind];
    const outcomeProbability = outcomeOption ? response[id]?.[outcomeOption] : undefined;
    rawHazards[id] = outcomeProbability !== undefined ? effectiveSelectionHazard(hazard.value, outcomeProbability) : hazard.value;
  }
  const { selection, residual } = resolveCompetingRisks(rawHazards);
  return { selection, residual, hazardFallbacks };
}

/**
 * Engine life course PR7 (spec's "Hybrid clamp on judged probability" requirement, design decision 2):
 * how far a decision maker's judged selection weight for one situation may diverge, either direction,
 * from that situation's own hazard baseline for this person-year. Named per design's "C=2 per kind" —
 * currently the same multiplier for every kind; a future kind-specific override would extend a lookup
 * here, not change callers.
 */
export const HAZARD_CLAMP_K_MIN = 0.5;
export const HAZARD_CLAMP_K_MAX = 2;

/**
 * `t = clamp(judged / baseline, kMin, kMax)`, `clamped = baseline * t` (design decision 2). A zero
 * baseline (the hazard says this genuinely can't happen this person-year) clamps to zero regardless of
 * the judgment — there is no multiplier of zero that lets a judgment through.
 */
export function clampJudgedSelection(judged: number, baseline: number, kMin: number = HAZARD_CLAMP_K_MIN, kMax: number = HAZARD_CLAMP_K_MAX): number {
  if (baseline <= 0) return 0;
  const ratio = Math.min(kMax, Math.max(kMin, judged / baseline));
  return baseline * ratio;
}

export interface ClampedSelectionResult {
  readonly selection: Readonly<Record<string, number>>;
  readonly hazardFallbacks: Readonly<Record<string, number>>;
}

/**
 * Spec's "Hybrid clamp on judged probability" requirement, applied to a whole person-year batch:
 * bounds a decision maker's own judged `selection` distribution to within `[baseline*K_MIN,
 * baseline*K_MAX]` of `computeHazardPrior`'s baseline for each situation, then hands the clamped raw
 * values back to `resolveCompetingRisks` for a fresh, valid distribution (never a `sum(selection) >
 * 1`, and the `nothing`/`everyday` residual absorbs whatever the clamp freed up or removed). Scaling
 * the baseline against `response` (the SAME judge's own outcome-roll answers) before clamping is what
 * stops the compound chain from recompounding for whichever adapter is being clamped (see
 * `computeHazardPrior`'s doc comment) — `JevDecisionMaker.decideYear` is this function's only caller
 * today, but it takes no adapter-specific input, so a future clamped adapter reuses it unchanged.
 */
export function clampJevSelection(
  situations: Readonly<Record<string, PersonYearSituation>>,
  judgedSelection: Readonly<Record<string, number>>,
  response: Readonly<Record<string, Distribution>>,
): ClampedSelectionResult {
  const prior = computeHazardPrior(situations, response);
  const normalizedJudged = normalizeDistribution(judgedSelection as Record<string, number>);
  const clampedRaw: Record<string, number> = {};
  for (const [id, baseline] of Object.entries(prior.selection)) {
    // No judgment for this situation means no evidence to move it: the hazard baseline governs,
    // rather than an implicit zero that the clamp would floor to baseline * K_MIN.
    clampedRaw[id] = clampJudgedSelection(normalizedJudged[id] ?? baseline, baseline);
  }
  const { selection: scaled, residual } = resolveCompetingRisks(clampedRaw);
  const selection: Record<string, number> = { ...scaled };
  const hasVignette = Object.values(situations).some((situation) => situation.kind === "D1");
  if (hasVignette) selection.everyday = residual;
  else if (Object.keys(selection).length > 0) selection.nothing = residual;
  return { selection, hazardFallbacks: prior.hazardFallbacks };
}

/**
 * Engine life course PR7 (spec's "Time-in-state MUST still be passed as prompt context to Jev"
 * requirement, design decision 3: "Jev sees time-in-state facts plus a qualitative base-rate band
 * (rare/uncommon/common), never numbers"). Named thresholds, not magic numbers — a "recent" courtship
 * or eligibility is one that just started; "long-standing" is well past `MARRIAGE_RAMP_CAP_YEARS`'
 * own ramp-cap timescale (8), so the label space stays meaningfully distinct from the ramp itself.
 */
export const TIME_IN_STATE_RECENT_MAX_YEARS = 1;
export const TIME_IN_STATE_ESTABLISHED_MAX_YEARS = 4;
export type TimeInStateBand = "recent" | "established" | "long-standing";

export function describeTimeInState(years: number): TimeInStateBand {
  if (years <= TIME_IN_STATE_RECENT_MAX_YEARS) return "recent";
  if (years <= TIME_IN_STATE_ESTABLISHED_MAX_YEARS) return "established";
  return "long-standing";
}

/** Design decision 3's qualitative base-rate band — Jev's prompt sees this label, never the underlying hazard number, so its judgment is never anchored on a probability figure it never has access to. */
export const HAZARD_BAND_RARE_MAX = 0.05;
export const HAZARD_BAND_UNCOMMON_MAX = 0.2;
export type HazardBand = "rare" | "uncommon" | "common";

export function describeHazardBand(value: number): HazardBand {
  if (value < HAZARD_BAND_RARE_MAX) return "rare";
  if (value < HAZARD_BAND_UNCOMMON_MAX) return "uncommon";
  return "common";
}

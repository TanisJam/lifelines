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
 *
 * PR10 (GOAL B, decision 071): gentry's own floor is per-class band `firstMarriageAgeWomenGentry`
 * (14-18) / `firstMarriageAgeMenGentry` (20-26), `params/targets.ts` — gentry/noble women married
 * markedly earlier via arranged matches (`docs/research.md` line 340: Hollingsworth's 14th c.
 * interpolation, women ~17; Follett narrative reference, Tilly's arranged marriage at 14, engram
 * #6321/#6149). `minEligible`/`onset` were already gentry's youngest row (decision 14/053) — men's
 * `onset` moved 20 -> 22 here to center on that SAME research.md table's 14th c. male anchor (~22,
 * "early-to-mid 20s", matching the task's own framing of noble men marrying later than their
 * brides); women's floor was already well-positioned and is unchanged. As with every other class's
 * onset (see decision 068's own finding), the REALIZED mean stays well above onset — gentry is
 * structurally "one household per village" in worldgen (decision 049), so partner scarcity, not the
 * hazard floor, dominates the remaining gap; see decision 071 for the measured before/after.
 *
 * Decision 080: two further small, targeted onset nudges, closing two of the three SMALL remaining
 * decision-079 marriage-age misses.
 *
 * Common-class women's `onset` (merchant/artisan/freeholder/villein/clergy 18 -> 17.5, cottar 19 ->
 * 18.5): `firstMarriageAgeWomen` measured 23.02 against an 18-23 band, a 0.02-year miss — unlike
 * decision 068's REVERTED ~2-year, ALL-CLASSES onset cut (which widened the age-onset gap because it
 * was large enough to shift the WHOLE local marriage market's composition, per that decision's own
 * finding: "onset shrinks faster than the partner-scarcity-bound actual age does"), this is a single
 * sex row, one order of magnitude smaller, for classes that are NOT the "one household per village"
 * scarcity case (five to six common classes' worth of population, real local supply on both sides).
 * Measured (60 seeds): 23.02 -> 22.77 (later re-measured at 22.69 once the gentry change below was
 * also applied) — **PASS**.
 *
 * Gentry men's `onset` (22 -> 20, i.e. back to its PRE-PR10 value): `firstMarriageAgeMenGentry`
 * measured 26.41 against a 20-26 band, a 0.41-year miss. Gentry men are the scarce class's OWN sex,
 * but (unlike gentry women, this table's still-open structural gap) they draw from the
 * same-class-first-then-any-class fallback pool (`simulate.ts`'s `eligiblePool`/`pickTier`) into a
 * LARGE common-class bride pool, not a mutually scarce one — the asymmetry decision 071 itself never
 * separated out (its own onset-cut experiment, decision 068, moved every class/sex row at once).
 * Tried in two steps, each measured: -1 year (21) moved the mean 26.41 -> 26.18 (still FAIL, a
 * genuine but insufficient ~0.23y/year response, nowhere near decision 068's "shrinks faster than it
 * helps" backfire); a further -1 year (20) moved it to 24.78 — **PASS**, with real margin. Common
 * men's onset (unchanged) still passes comfortably at the new measured 25.94-26.24 (band 21-27), so
 * this row's own change causes no cross-sex regression.
 *
 * `firstMarriageAgeWomenGentry` (band 14-18) is NOT touched by this decision — this table's OWN,
 * still-open, structural gap: measured 21.46-21.55 regardless of whichever men's-row nudge was in
 * effect (unaffected, as expected — this is a different class/sex row). Per decision 071's own
 * reasoning (this table's THIS row, `minEligible: 14, onset: 16`, was already positioned at the
 * research anchor and left unchanged across every decision since), the miss is population-existence
 * scarcity, not onset — a single gentry household typically produces only a handful of daughters
 * across the whole simulated run, so the "mean first-marriage age" sample is tiny and dominated by a
 * few individuals' own life-course timing, not a hazard-curve parameter any onset value can fix. A
 * clean fix needs more gentry SUPPLY (e.g. gentry-class immigrants, or a cross-manor gentry match),
 * not a smaller onset — see decision 080's own body for why that was not attempted this slice.
 *
 * See `provenance.ts` and decision 080 for the full measured 60-seed before/after.
 */
export const MARRIAGE_FLOORS: Readonly<Record<SocialClass, Readonly<Record<Sex, MarriageFloor>>>> = {
  gentry: { f: { minEligible: 14, onset: 16 }, m: { minEligible: 16, onset: 20 } },
  merchant: { f: { minEligible: 15, onset: 17.5 }, m: { minEligible: 18, onset: 23 } },
  artisan: { f: { minEligible: 15, onset: 17.5 }, m: { minEligible: 18, onset: 22 } },
  freeholder: { f: { minEligible: 15, onset: 17.5 }, m: { minEligible: 18, onset: 22 } },
  villein: { f: { minEligible: 15, onset: 17.5 }, m: { minEligible: 18, onset: 22 } },
  cottar: { f: { minEligible: 16, onset: 18.5 }, m: { minEligible: 18, onset: 22 } },
  clergy: { f: { minEligible: 15, onset: 17.5 }, m: { minEligible: 18, onset: 22 } },
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

/**
 * PR12 STEP 2 (decision 073's finding 2, decision 074, option (b)): `rule-heuristics.ts`'s Y1
 * "encourage" and A1 "propose" outcome answers previously had NO age or time-in-state term at all —
 * a person offered courtship for the first time and one offered it for the twelfth consecutive year
 * got the identical distribution. Decision 073 measured this as the dominant truncation cause: once
 * `hazards.ts#y1Hazard`'s own time-in-state ramp pushes the raw hazard above a static ~0.15-0.4
 * outcome answer, `effectiveSelectionHazard`'s `min(1, raw/outcome)` clamp caps the REALIZED rate at
 * the outcome answer for the rest of that person's marriageable life (~30% of sampled person-years).
 * Historically grounded: the social and economic pressure to marry rose the longer someone stayed
 * eligible past their class's expected marrying age (research.md Family §rules synthesis; the same
 * "age/status-linked marriage pressure" already cited for `MARRIAGE_FLOORS`' own onset ages) — an older
 * bachelor(ette), or a longer-established courtship, faced mounting kin/community pressure to commit.
 *
 * Shape (`outcomeTimePressure`, `rule-heuristics.ts`): `pressureYears = min(cap, timeInStateYears +
 * max(0, age - onset))` — time already spent in the relevant clock (`yearsMarriageable` for Y1,
 * `courtshipYears` for A1) PLUS years already past this person's own class/sex onset age
 * (`hazards.ts#onsetAge`), both >= 0 by construction, summed then capped. `increment = slope *
 * pressureYears`, added to the existing facet-driven base/floor, then capped at
 * `OUTCOME_TIME_PRESSURE_CEILING` (never certainty). The added mass is taken proportionally from the
 * SAME kind's own decline/wait (Y1) or delay/end-it (A1) split (`Math.max(0.02, 1 - encourage -
 * decline)`-style remainder, unchanged) — mechanically, this can only ever REDUCE how much
 * `effectiveSelectionHazard` truncates (a larger outcome answer can never push the realized rate above
 * the raw hazard: `min(1, raw/outcome) * outcome` is mathematically bounded by `raw` for every
 * `outcome > 0` — see decision 074), so this curve cannot cause an overshoot (e.g. "everyone marries
 * at the minimum age") on its own; the raw hazard (already near-zero before onset) stays the sole gate
 * for anyone not yet under real pressure.
 *
 * A1's Weibull raw hazard (above) grows far faster in early courtship years than Y1's logistic ramp
 * grows in early eligible years (measured: A1 raw reaches ~0.64 by courtshipYears=3 vs Y1's ~0.54
 * ASYMPTOTE reached only after ~5 years past onset) — so A1 needs its own, steeper slope and a shorter
 * cap to track it; a shared single slope was tried first and left A1 badly under-tracked (see
 * `provenance.ts`). Calibrated empirically against `hazards.ts#computeHazard`'s own Y1/A1 curves (no
 * sourced figure for the exact slope magnitude — see `provenance.ts`), not against a historical
 * marriage-pressure-by-year dataset (none was located).
 */
export const OUTCOME_TIME_PRESSURE_CEILING = 0.9;
export const Y1_OUTCOME_PRESSURE_SLOPE = 0.012;
export const Y1_OUTCOME_PRESSURE_CAP_YEARS = 13;
export const A1_OUTCOME_PRESSURE_SLOPE = 0.07;
export const A1_OUTCOME_PRESSURE_CAP_YEARS = 8;

/**
 * Decision 083: the yearly chance an unmarried gentry daughter (past `MARRIAGE_FLOORS.gentry.f`'s
 * `minEligible`, 14, with no eligible gentry son anywhere in her own village) is arranged a marriage
 * to a gentry suitor from a neighbouring manor (`simulate.ts#spawnGentrySuitor`); she moves to his
 * manor unless she is the protagonist, whose suitor comes to the village instead —
 * Follett-plausible (decision 083), invented: no sourced ANNUAL hazard exists for this (research.md
 * only sources the age itself, ~14, via Tilly's own arranged marriage). Bypasses the ordinary Y1/A1
 * courtship-hazard ramp entirely (an arranged match is a family/political decision made FOR her, not
 * a suitor's courtship she lives through) — the ordinary ramp cannot reach the 14-18 target band on
 * its own even with unlimited partner supply, since its typical time-to-marriage (~4-6 years past
 * onset, matching every other class's own measured gap over its own onset) would still land in the
 * low-to-mid 20s from a 16-year onset. Sized so most eligible daughters resolve within a year or two
 * of turning 14 (mean of a geometric wait at this rate: `(1-p)/p` extra years) — see decision 083 for
 * the measured before/after `firstMarriageAgeWomenGentry`.
 */
export const ARRANGED_GENTRY_MATCH_PROBABILITY = 0.4;

/**
 * PR13 STEP 1 (decision 075): A2's "try" has the SAME `effectiveSelectionHazard` truncation decision
 * 073/074 diagnosed and fixed for Y1/A1 — `FERTILITY_HAZARD_BANDS`' raw hazard (0.5/0.6/0.5/0.4/0.25
 * by age band) routinely exceeds `rule-heuristics.ts`'s static ~0.4-0.5 "try" answer, with NO
 * time-pressure term at all before this fix (decision 074's own addendum flagged this exact gap).
 *
 * A2 has no "onset" concept (`hazards.ts#onsetAge` is a marriage-timing lookup, not applicable to an
 * already-married couple) and no stamped courtship-style duration clock, so this reuses the
 * ALREADY-stamped `state.situation.fertileYearsLeft` (`simulate.ts`'s A2 candidate `extra`, `= max(0,
 * 45 - age)`) as the pressure clock instead: as a married woman's fertile window narrows, the
 * pressure to try for a(nother) child before it closes grows — the same "family-size completion
 * pressure" already informing the birth-spacing rules (`eligibleForAnotherChild`'s own Davenport
 * citation), not a new, unsourced mechanism. `A2_FERTILE_WINDOW_SPAN` mirrors
 * `actuarial.ts#isFertileAge`'s own f-sex span (45 - 16 = 29 years) so `yearsIntoWindow = max(0,
 * A2_FERTILE_WINDOW_SPAN - fertileYearsLeft)` reads as "years already spent inside the fertile
 * window". Honest limitation (documented, not hidden): this clock cannot distinguish a newly-married
 * older bride from one who has tried unsuccessfully for years — no `yearsMarried`/`yearsTrying` state
 * is currently stamped for A2 to do better; a future slice could add one.
 *
 * Shape: identical to `outcomeTimePressure`'s own `increment = slope * min(cap, pressureYears)`,
 * capped at the shared `OUTCOME_TIME_PRESSURE_CEILING` — the same "never over-correct past raw
 * hazard" mechanical safety (decision 066/074) applies here too. Slope/cap chosen empirically (no
 * sourced marriage-pressure-by-year dataset for fertility specifically exists, same honesty standard
 * as Y1/A1's own — see `provenance.ts`) so a couple in their late 20s/early 30s clears most of the
 * truncation while a newly-eligible teenager still tracks the low raw hazard.
 */
export const A2_FERTILE_WINDOW_SPAN = 29; // isFertileAge's own f-sex span: 45 - 16
export const A2_OUTCOME_PRESSURE_SLOPE = 0.02;
export const A2_OUTCOME_PRESSURE_CAP_YEARS = 20;

/**
 * A2's fertility-band hazard by mother's age — how likely THIS is the year a couple tries, not the
 * conception odds itself (see `simulate.ts#conceptionProbability`).
 *
 * PR10 (decision 071, population-trajectory diagnosis): raised from the design's original
 * 0.28/0.35/0.28/0.18/0.1. Diagnosed first (20-seed `check-demographics.ts --stats` run, before any
 * tuning): the REALIZED age-specific marital fertility rate (births per married-woman-year,
 * `scripts/check-demographics.ts`'s own ASMFR diagnostic) was only ~30-45% of this table's own
 * intended hazard across every band (e.g. the core <30 band: 12.4% observed vs. 35% intended) —
 * `effectiveSelectionHazard` (hazards.ts) is designed to cancel the two-stage
 * selection-then-outcome compounding exactly, but the SAME person-year categorical draw also
 * competes against every other eligible situation that fires for a married woman (`Y3` leave-home,
 * `PIL1` pilgrimage, and the ~16 `OTHER_KIND_BASE_HAZARD` kinds when eligible) — enough simultaneous
 * competing mass to meaningfully shrink A2's realized share even before `RESCALE_THRESHOLD` clips
 * an oversized sum. Pre-plague CBR measured only 11.4 per 1,000/yr against a 30-40 per 1,000/yr CDR
 * (already close to research #6144's own ~30-40‰ pre-plague target, unchanged here) — a population
 * that structurally cannot replace itself even before the plague, decision 068's own "cause 4"
 * finally quantified. Raised toward the research brief's own ~35-45‰ CBR / ~6-7 births-per-completed-
 * marriage targets, empirically (this is a magnitude tunable, not a sourced age-specific fecundity
 * curve — see `provenance.ts`), alongside `Y3_PEAK_HAZARD`/`Y3_OFF_PEAK_HAZARD` below (which reduces
 * how much of A2's own effective share gets crowded out in the first place).
 *
 * A real ceiling was found and measured while tuning this: `effectiveSelectionHazard` clamps the
 * scaled selection weight at 1 (`Math.min(1, rawHazard / outcomeProbability)`), so once a band's
 * raw hazard exceeds `outcomeProbability` (the rule adapter's own A2 "try" answer), MORE raw hazard
 * buys nothing further for that specific person-year -- the compound birth-attempt probability is
 * then bounded by `outcomeProbability` itself, not by this table. Measured directly: pushing these
 * bands from ~0.45-0.55 to ~0.7-0.85 moved the observed <30 ASMFR by well under a percentage point.
 *
 * PR11 (STEP 0, an RDD advisory carried over from PR10 flagged the <30/<35/<40 bands below as
 * potentially "past the ceiling and inert"): re-measured directly rather than assumed. A 15-seed
 * diagnostic run sampling every real `A2` "try" answer the rule adapter produced (n=3,379, the SAME
 * `RuleDecisionMaker` this table is calibrated against) gives outcomeProbability mean=0.404,
 * p10=0.107, p25=0.257, **p50=0.400**, p75=0.548, p90=0.715 -- confirming decision 071's "centered
 * ~0.4" estimate precisely, but also showing the clamp is NOT a hard, fully-dead ceiling at any one
 * of these band values: the <30 band (0.6) is already selection=1 (fully clamped) for 82.8% of
 * observed person-years, <35 (0.5) for 68.4%, <40 (0.4) for 50.1% -- real, if shrinking, headroom
 * remains for each band's own upper-tail person-years (those with an above-median "try" answer),
 * which is exactly why decision 071's own empirical test (pushing these bands further, to 0.7-0.85)
 * still moved the observed rate slightly, just under a percentage point. The values here are left
 * UNCHANGED by this slice: they already sit close to, not meaningfully past, the natural ceiling for
 * the bulk of the population, and PR11's own diagnosis (STEP 1, `sdd/engine-life-course/state`)
 * traces the dominant remaining gap to the marriage rate itself, not fertility magnitude -- retuning
 * this table with no accompanying funnel evidence that it's the bottleneck would risk destabilizing
 * curated test seeds for a component that isn't the actual constraint. The residual gap to the
 * research targets is NOT closable by this table alone; it traces mostly to the marriage rate itself
 * (68-72% of the cohort never married in the same diagnostic run -- decision 074's own addendum later
 * found this specific figure was a metric bug, not a real defect: the real share is 4.6-7.2%, see
 * that decision) -- genuine partner scarcity in `simulate.ts`'s own `eligible()` search, already
 * flagged out of scope by three prior PRs (decisions 068/069/070) and the direct target of PR11's own
 * STEP 1/2 -- see decision 071 for the full accounting and decision 072 for PR11's own funnel
 * diagnosis.
 *
 * PR14 STEP 2 (decision 076): re-confirmed this clamp-inertness finding still holds after PR13's A2
 * pressure fix and near-universal marriage (both of which raise "try" answers and married-woman-year
 * exposure) -- a 20-seed A/B pushing every band ~30-60% higher (0.5/0.6/0.5/0.4/0.25 ->
 * 0.8/0.9/0.8/0.65/0.4) moved observed <30 ASMFR from 26.7% to 27.6%, well under a percentage point,
 * same order of magnitude as decision 071's own finding. Left UNCHANGED again; STEP 2's actual fix
 * targeted `CONCEPTION_PROBABILITY_BANDS` below instead, the one lever in this chain the
 * `effectiveSelectionHazard` clamp does not touch.
 */
export const FERTILITY_HAZARD_BANDS: readonly { readonly maxAge: number; readonly hazard: number }[] = [
  { maxAge: 20, hazard: 0.5 },
  { maxAge: 30, hazard: 0.6 },
  { maxAge: 35, hazard: 0.5 },
  { maxAge: 40, hazard: 0.4 },
  { maxAge: Infinity, hazard: 0.25 },
];

/**
 * P(conception | a real "try" this year) by mother's age — `simulate.ts#conceptionProbability`'s own
 * table, distinct from `FERTILITY_HAZARD_BANDS` above (that's "is this the year we try"; this is "does
 * trying work"). Named/moved here from an inline literal (PR14 STEP 2, decision 076) so it carries the
 * same documented-tunable discipline as every other rate in this file (`provenance.ts`).
 *
 * Design intent (the ORIGINAL doc comment this replaces): this table plus the birth-spacing floor
 * (`eligibleForAnotherChild`, ~2 years general / ~1 year gentry) is meant to jointly reproduce
 * Davenport (2019)'s own measured inter-birth interval — 30-33 months ordinary, 24.6 months elite —
 * "not read off a primary source" for the probability itself, but SHAPED to land near that interval.
 *
 * PR14 STEP 2: measured directly that the OLD values (0.65/0.45/0.25) did not hit that design intent.
 * With the 2-year general floor already consuming most of a 30-33-month interval, the residual
 * probabilistic wait needs to be short — a high per-eligible-year conception odds, not a coin flip.
 * 60-seed `check-demographics.ts` measured an effective average inter-birth interval far longer than
 * Davenport's target (ASMFR implies ~4.7 years at the old values, most of it beyond the 2-year floor)
 * even after PR14 STEP 1's metric fix and PR13's A2 pressure fix — both of which touch WHETHER a
 * couple tries, not whether trying succeeds. Raised each band, still short of unity (a real chance of
 * further delay always remains, matching Davenport's own "the interval shortens... but doesn't
 * vanish" framing) — see `provenance.ts` for why this remains a magnitude tunable, not a sourced
 * age-specific fecundability curve (none was located for 1327-1361 or a close period proxy).
 */
/**
 * Decision 079 (Follett-plausible population growth): raised again from PR14 STEP 2's 0.85/0.65/0.4.
 * That raise was shaped to Davenport's sourced birth-interval figure; this further raise is NOT --
 * decision 078 already loosened the population-trajectory bands to invented, Follett-plausible targets
 * ("the town must grow before the plague"), and the pre-plague CBR (29.6 per 1,000/yr) was still well
 * under the CDR even after every prior fertility fix in this lineage (decisions 071/075/076). Pushed
 * toward the top of the table's own range rather than past it, alongside the adult-mortality lowering
 * above, so growth comes from BOTH a higher birth rate and a lower death rate, not a single lever
 * pushed to an implausible extreme. See `provenance.ts` for the measured before/after.
 */
export const CONCEPTION_PROBABILITY_BANDS: readonly { readonly maxAge: number; readonly probability: number }[] = [
  { maxAge: 36, probability: 0.95 },
  { maxAge: 41, probability: 0.83 },
  { maxAge: Infinity, probability: 0.62 },
];

/**
 * Y3 (leave-or-stay): peaks in young adulthood, lower for the unfree (chevage), further restricted
 * after the Statute of Labourers (1351) — the mobility factor PR5 deferred to this slice.
 *
 * PR10 (decision 071): lowered from 0.12/0.04. Diagnosed (20-seed `check-demographics.ts --stats`
 * run): `Y3`'s peak window (16-30) is the SAME window most classes marry in, and it fires for
 * EVERY eligible adult EVERY year as one of many competing person-year candidates — unlike `Y1`/`A2`,
 * it has no historical population-level migration-RATE source (`provenance.ts` already flags it
 * "no sourced migration-rate figure... was located", confidence low), so a lower value is not a
 * departure from any sourced figure. Measured: 68-72% of the `motherId`-set cohort never married by
 * age 45, and marital fertility ran at ~30-45% of `FERTILITY_HAZARD_BANDS`' own intended rate (see
 * that constant's doc comment) — `Y3` competing for the same person-year "slot" as `Y1`/`A2` is a
 * real, measured contributor to both. Lowering it (rather than only raising `FERTILITY_HAZARD_BANDS`
 * in isolation) reduces how much of that pie an emigration roll consumes, without inventing a new
 * mechanism; genuine emigration (apprenticeship away, service, migration) still happens, just less
 * often relative to marriage/fertility.
 */
export const Y3_PEAK_HAZARD = 0.05;
export const Y3_OFF_PEAK_HAZARD = 0.02;
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
 *
 * PR13 STEP 2 (decision 075): with `e0` measured at ~18-19 (well under its 22-35 target) after
 * PR11/PR12's marriage fixes and this slice's own A2 fertility fix raised birth volume (decision
 * 074's own explanation: more births -> a larger from-birth cohort exposed to child mortality ->
 * lower cohort-average age at death), the 5-14 band was diagnosed directly: it is the ONLY band
 * with zero direct `CALIBRATION_TARGETS` coverage (`under15DeathShare` measures only the
 * CONDITIONAL age 2-7 death share; ages 7-14 were never checked by any `--assert` run) and it was
 * STILL decision 050's original Tudor figure, never revisited for the period recalibration above.
 * A hand-computed life table using the unchanged bands (single infant-year evaluation at age 1, per
 * `deathProbabilityAtAge`'s own age<2 band-width note) gives ~56-57% cumulative death by 15 —
 * matching the measured `check-demographics.ts#under15Pct` — well above research.md line 112's own
 * "~30% of children die before 15" citation (UNVERIFIED single source, but the only sourced anchor
 * for that specific cumulative figure). Adult bands (15+) were diagnosed too and are NOT changed:
 * measured (30-seed `--stats`) adult mortality already tracks this table closely (<40 1.7%/1.6%,
 * <60 3.2%/3.2%, <75 7.6-7.7%/7.0%, <90 22.7-22.8%/20.0%) with no double-counting found in
 * `simulate.ts`'s death resolution (Black Death/second pestilence are deliberately excluded from
 * `HARDSHIP_TOWN_EVENTS`'s flat multiplier and combined as an absolute per-year probability instead,
 * confirmed never leaking outside 1348-49/1361-62). Lowered 0.027 -> 0.02: chosen so
 * `under15DeathShare` (the age 2-7 conditional share, which shares ages 5-6 with this band) stays
 * inside its own 20-30% band with real margin (measured ~21-22%, not chased to the 20% floor) while
 * meaningfully raising survival to 15 and, with it, `e0`.
 *
 * Decision 079 (Follett-plausible population growth, decision 078's own follow-up): the age<2/<5/<15
 * bands above are UNCHANGED -- decision 078 explicitly kept child mortality at its sourced figure
 * ("history already serves the drama"; `infantMortality`/`under15DeathShare` stay real calibration
 * targets, not invented ones). The five ADULT bands (15+) below are lowered instead, since they carry
 * no direct `CALIBRATION_TARGETS` coverage of their own (only `lifeExpectancyAtBirth`, itself widened
 * to a Follett-plausible 18-32 by decision 078, is sensitive to them) and diagnosis found them the
 * dominant lever actually available: pre-plague CDR measured 42.5 per 1,000/yr against a CBR of only
 * 29.6 (decision 078's own baseline, unchanged model) -- a population that structurally could not grow
 * even before the plague, entirely consistent with `populationPrePlagueChangePercent` measuring -23.2%
 * against its -5..+20% Follett-plausible band. Sourced child mortality alone (>=55% dead by 15) already
 * accounts for most of that CDR; the adult bands were the only remaining, un-target-constrained lever.
 * Invented/Follett-plausible, NOT re-sourced from Wrigley & Schofield/Galley: lowered by roughly
 * 53-60% each (an even larger, uniform cut across all five bands was tried first and reverted after it
 * pushed the full 100-year `check-demographics.ts` run's population large enough to time out several
 * `npm test` seeds -- see `IMMIGRATION_ANNUAL_PROBABILITY_POST_PLAGUE`'s own doc comment for the full
 * story, which applies equally here since both levers were dialed back together) so a Kingsbridge who
 * survives childhood plausibly lives long enough to see the town grow, marry, and rebuild after the
 * plague -- see `provenance.ts` for the exact before/after and the measured population-trajectory
 * effect.
 */
export const MORTALITY_BY_AGE_BAND: readonly { readonly maxAge: number; readonly hazard: number }[] = [
  { maxAge: 2, hazard: 0.3 }, // infant/toddler year: see actuarial.ts#deathProbabilityAtAge's age<2 band-width note
  { maxAge: 5, hazard: 0.065 },
  { maxAge: 15, hazard: 0.02 }, // PR13 STEP 2 (decision 075): lowered from 0.027 -- see this constant's own doc comment

  { maxAge: 40, hazard: 0.0075 }, // decision 079: lowered from 0.016 (Follett-plausible, invented)
  { maxAge: 60, hazard: 0.0135 }, // decision 079: lowered from 0.032 (Follett-plausible, invented)
  { maxAge: 75, hazard: 0.03 }, // decision 079: lowered from 0.07 (Follett-plausible, invented)
  { maxAge: 90, hazard: 0.085 }, // decision 079: lowered from 0.2 (Follett-plausible, invented)
  { maxAge: Infinity, hazard: 0.19 }, // decision 079: lowered from 0.47 (Follett-plausible, invented)
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
 *
 * Decision 079 (Follett-plausible population growth): raised again, 0.05 -> 0.15. Unlike the PR9
 * follow-up's reversion above (which found no calibration benefit at the OLD population-trajectory
 * bands), decision 078 now makes town growth itself a calibration target -- an immigrant arrival adds
 * directly to the population count, independent of the births-vs-deaths balance the fertility/mortality
 * levers above operate on, so it is a genuine additional growth lever, not a duplicate of them.
 * Invented/Follett-plausible (no sourced arrival-rate figure exists for this village size, same gap
 * this constant's own original entry already flagged), sized well short of the old 0.5+ tests that
 * measurably hurt first-marriage age. See `provenance.ts` for the measured before/after. Kept lower
 * than `IMMIGRATION_ANNUAL_PROBABILITY_POST_PLAGUE` below (this is the PRE-plague rate): pushing this
 * single flat rate high enough to also fix the post-plague recovery window on its own measurably
 * overshot `populationPrePlagueChangePercent`'s own +20% ceiling before the recovery window cleared
 * zero -- splitting the rate by period targets each window's own gap instead of one dial fighting two
 * targets at once.
 */
export const IMMIGRATION_ANNUAL_PROBABILITY = 0.15;

/**
 * Decision 079 (Follett-plausible population growth): a second, higher immigration rate for the
 * `[IMMIGRATION_POST_PLAGUE_YEAR, IMMIGRATION_POST_PLAGUE_END_YEAR)` window only -- narratively, the
 * plague frees land and work (the same "the plague frees land and partners" logic decision 078 already
 * used for `widowRemarriagePostBlackDeath`'s widened band), so newcomers are more plausible, not less,
 * right after it. Mechanically: `populationRecoveryChangePercent` (1350->1361) measures RIGHT THROUGH
 * the second pestilence's own first, heavier-weighted year (1361 itself,
 * `period/events.ts#SECOND_PESTILENCE_YEARS`/`SECOND_PESTILENCE_YEAR_SHARE`) -- a fixed-percentage
 * mortality shock that the permanent, always-on levers (`MORTALITY_BY_AGE_BAND`'s adult bands,
 * `CONCEPTION_PROBABILITY_BANDS`) cannot out-run without pushing the PRE-plague window past its own
 * ceiling first (see `IMMIGRATION_ANNUAL_PROBABILITY`'s own doc comment).
 *
 * DELIBERATELY BOUNDED, not left on for the rest of the run: an earlier version of this constant (0.5,
 * with no end year -- i.e. active for the ENTIRE remaining 1350-1427 span `check-demographics.ts`'s own
 * 100-year measurement window covers) was tried first and reverted after it broke `npm test` -- several
 * curated-seed and full-village-run tests (`decision 055`, `decision 053`, `decision 054` x2, the
 * life-state invariants, the dead-suitor lockout, `PR6 corrective task 4`) started TIMING OUT (5-40s
 * budgets), because 77 years of a 50% annual arrival chance, compounding through each arrival's own
 * descendants under the already-lowered mortality/raised fertility above, grows the simulated village
 * far larger than any of these tests' timing budgets assumed. Bounding the elevated rate to the 12-year
 * recovery window itself (then reverting to the permanent, modest `IMMIGRATION_ANNUAL_PROBABILITY`
 * afterward) fixes the recovery checkpoint without that runaway, unbounded population growth. Invented/
 * Follett-plausible; no sourced post-plague resettlement RATE exists (only the widow-remarriage RATIO
 * research #6144 M-S2 already cites). See `provenance.ts` for the measured before/after.
 */
export const IMMIGRATION_ANNUAL_PROBABILITY_POST_PLAGUE = 0.45;

/** The year `IMMIGRATION_ANNUAL_PROBABILITY_POST_PLAGUE` takes over from `IMMIGRATION_ANNUAL_PROBABILITY` -- `populationRecoveryChangePercent`'s own window start (`scripts/check-demographics.ts#TRAJECTORY_YEARS`), one year after the Black Death's last dated year (`period/events.ts#BLACK_DEATH_YEARS`). */
export const IMMIGRATION_POST_PLAGUE_YEAR = 1350;

/** The year `IMMIGRATION_ANNUAL_PROBABILITY_POST_PLAGUE` hands back to the permanent `IMMIGRATION_ANNUAL_PROBABILITY` -- one year past `populationRecoveryChangePercent`'s own window end (1361), so the elevated rate covers the full measured recovery window and nothing beyond it (see that constant's own "DELIBERATELY BOUNDED" note). */
export const IMMIGRATION_POST_PLAGUE_END_YEAR = 1362;

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

/**
 * Decision 080: a carrying-capacity feedback for fertility, closing the gap `IMMIGRATION_POPULATION_CAP_RATIO`
 * (above) never covered. That ratio only ever stops NEW immigrants once the village is "comfortably
 * sized" — it does nothing about births, which have no population-density feedback at all
 * (`simulate.ts`'s A2 "try" outcome is a pure function of the mother's age, `conceptionProbability`,
 * `params/demography.ts#CONCEPTION_PROBABILITY_BANDS`). With decision 079's much lower adult mortality
 * and higher conception odds, a run where births keep outrunning deaths compounds without bound —
 * each generation larger than the last, `decideYear`'s per-year candidate volume growing with it,
 * measurably slowing every long (100-year) test down (the four timeout bumps decision 079 itself made,
 * `simulate.test.ts`'s own "decision 079: see the class-multiplier test's own timeout-bump comment"
 * tests, and the still-longer `IMMIGRATION_ANNUAL_PROBABILITY_POST_PLAGUE`-driven PR9 test).
 *
 * `VILLAGE_CARRYING_CAPACITY_RATIO` names the point (as a multiple of the village's OWN founder
 * headcount, same "scale to what this village was actually generated with" approach as
 * `IMMIGRATION_POPULATION_CAP_RATIO`) past which `simulate.ts#fertilityDampingFactor` starts
 * tapering the A2 conception roll — set ABOVE the immigration cap (2.11x) so immigration is already
 * throttling growth well before fertility damping engages at all; a village that never grows past
 * ~2x its founders never feels this lever. Follett-plausible/invented: no sourced manorial
 * "carrying capacity" figure exists for a 14th-century English village of this size — the ratio is
 * chosen only to bound simulated run time and stop unbounded compounding, not to model a real
 * documented land-carrying limit. See `provenance.ts` for the measured before/after run times.
 */
export const VILLAGE_CARRYING_CAPACITY_RATIO = 3;

/**
 * Decision 080: the floor `fertilityDampingFactor` never dampens conception odds below, however far
 * past `VILLAGE_CARRYING_CAPACITY_RATIO` the living population grows. A hard cutoff (factor 0) would
 * make the village sterile forever once overcrowded — with no matching feedback that ever shrinks it
 * back down (this engine has no famine/disease density-response, only the dated Black Death/second
 * pestilence shocks), that's a one-way trap, not a ceiling. A `0.2` floor still lets population growth
 * approach a rough plateau (births keep happening at a reduced rate, roughly balancing ordinary
 * mortality) without ever fully forbidding new children — Follett-plausible/invented, chosen for that
 * qualitative "slows to a crawl, never truly stops" shape rather than sourced from any figure.
 */
export const FERTILITY_DAMPING_FLOOR = 0.2;

/**
 * PR10 (decision 071, population-trajectory diagnosis, `sdd/engine-life-course/state`): named
 * here, unchanged in VALUE — this was already a hardcoded, undocumented `0.08` in `simulate.ts`'s
 * "return" biology candidate, but PROTAGONIST-ONLY. Measured (20-seed `--stats` diagnostic, GENERAL
 * village, no protagonist): `Y3` ("leave home") fires for every eligible adult, every year, peaking
 * (`Y3_PEAK_HAZARD`) at ages 16-30 — the SAME window most classes' marriage floors sit in — and
 * across a 100-year run, 0 of the 188 people who left home (20 seeds) ever came back, because
 * `simulate.ts`'s own "return" candidate generation lived entirely inside its `if (protagonistId)`
 * away-catalog block (round 10, decision 040): only the single narrated protagonist could ever be
 * offered a way home again. The general village's own `never-married` share was 70-75% by age 45 in
 * that same run — consistent with a large share of the marriageable population drawing "leave" at
 * least once during their prime marrying years and then never being eligible for `Y1`/`A2` again
 * (`aliveNonMoved` excludes anyone `hasMovedAway`). This is a real, previously-undiagnosed
 * asymmetry, not a calibration gap: the protagonist getting to come home was never a deliberate
 * narrative-only design choice (the "return" roll itself has no narrative dependency, unlike the
 * away-CAST machinery Y1/A2/Y5 reuse there, which genuinely does need the protagonist's own lightweight
 * away cast) — it was a side effect of the single-life pivot only ever wiring biology-style rolls
 * (immigration, levy, illness, death) for the general population, and forgetting "return" belonged
 * in that same general-population set. Generalizing it (see `simulate.ts`'s `gatherCandidatesForYear`)
 * closes the population's single largest one-way emigration sink.
 */
export const RETURN_HOME_PROBABILITY = 0.08;

/** Companion to `RETURN_HOME_PROBABILITY` above — also promoted from an inline `3` in `simulate.ts`'s protagonist-only "return" gate, unchanged in value, now shared by the generalized general-village check. */
export const RETURN_HOME_MIN_AWAY_YEARS = 3;

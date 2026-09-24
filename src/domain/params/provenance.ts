/**
 * Engine life course PR6 (design revision 2, decision 11): source/range/confidence for every
 * tunable in `demography.ts`, so a reviewer (or a future calibration pass) can see at a glance which
 * numbers are sourced, which are directional, and which are pure placeholders. Mirrors the spec's
 * "Documented tunable ranges" requirement — every constant without a firm source ships with a
 * citation/gap note, never a silent magic number.
 */

export type Confidence = "high" | "medium" | "low";

export interface ParamProvenance {
  readonly source: string;
  readonly range: string;
  readonly confidence: Confidence;
}

/**
 * Keyed by the exported constant name in `demography.ts`. Table-shaped constants (e.g.
 * `MARRIAGE_FLOORS`) get one entry covering the whole table, not one per cell — the cells differ by
 * class/sex, not by source.
 */
export const PARAM_PROVENANCE: Readonly<Record<string, ParamProvenance>> = {
  MARRIAGE_FLOORS: {
    source: "Design revision 2, decision 14 (supersedes decision 053's 1498-1558 floors); research.md Family §rules synthesis for direction only. Gentry row: PR10 (GOAL B, decision 071) -- docs/research.md line 340 (Hollingsworth 14th c. interpolation: women ~17, men ~22) and the Follett narrative reference (Tilly m. 14, engram #6321/#6149). Decision 080: two further small onset nudges (common-class women 18/19 -> 17.5/18.5; gentry men 22 -> 20), invented/Follett-plausible, closing two of the three SMALL remaining decision-079 marriage-age misses (firstMarriageAgeWomen 23.02 vs 18-23; firstMarriageAgeMenGentry 26.41 vs 20-26) without repeating decision 068's REVERTED ~2-year, all-classes onset cut (which widened, not closed, the age-onset gap for the partner-scarcity-bound classes) -- this decision's own gentry-men change is the same 2-year magnitude, but on a SINGLE row that draws from a large cross-class pool rather than every class/sex row moved together, and it measurably worked (26.41 -> 24.78).",
    range: "Women 18-23 mean, men 21-27 mean, merchant men 23-30 (Follett-plausible targets, decision 078). Gentry: women 14-18, men 20-26 (params/targets.ts's own per-class bands); men's onset moved 20 -> 22 by PR10 to center on the research.md anchor, then back to 20 by decision 080 (measured stepwise: 22 -> 21 moved 26.41 -> 26.18, still FAIL; 21 -> 20 moved it to 24.78, PASS). Common-class women's onset moved 18/19 (cottar) -> 17.5/18.5 by decision 080 (23.02 -> 22.69, PASS). Gentry WOMEN's row is unchanged -- still-open structural gap, see decision 080.",
    confidence: "low",
  },
  VILLAGE_CARRYING_CAPACITY_RATIO: {
    source: "Decision 080: a carrying-capacity feedback for fertility, closing the population-ceiling gap `IMMIGRATION_POPULATION_CAP_RATIO` never covered (that ratio only ever stops NEW immigrants, never dampens births). No sourced manorial land-carrying-capacity figure exists for a 14th-century English village of this size -- Follett-plausible/invented, sized only to bound simulated run time and stop unbounded population compounding.",
    range: "3x the village's own founder headcount; set above `IMMIGRATION_POPULATION_CAP_RATIO` (2.11x) so immigration is already throttling growth before fertility damping engages at all.",
    confidence: "low",
  },
  FERTILITY_DAMPING_FLOOR: {
    source: "Decision 080: the floor `simulate.ts#fertilityDampingFactor` never dampens conception odds below, however far past `VILLAGE_CARRYING_CAPACITY_RATIO` the village grows -- a hard 0 floor would make an overcrowded village permanently sterile, with no matching mechanism that ever shrinks it back down. Invented/Follett-plausible, chosen only for a qualitative 'slows to a crawl, never truly stops' shape.",
    range: "0.2 (20% of the age-banded conception probability), not independently sourced.",
    confidence: "low",
  },
  CANON_MINIMUM_MARRIAGE_AGE: {
    source: "research.md Family §rules 1 (Lateran IV canon law: girls 12, boys 14).",
    range: "Fixed canon-law minimums, not tunable.",
    confidence: "high",
  },
  MARRIAGE_RAMP_RHO: {
    source: "Design revision 2 hazard-shapes table (D_k(t) = 1 + rho*min(t,8)).",
    range: "Provisional, calibrated; no direct historical source for the ramp's steepness.",
    confidence: "low",
  },
  MARRIAGE_BASE_AT_FULL_RAMP: {
    source: "Design revision 2 hazard-shapes table.",
    range: "Provisional (women 0.30, men 0.25 at full ramp), calibrated toward the 18-22/21-25 target.",
    confidence: "low",
  },
  WIDOW_REMARRIAGE_BASE: {
    source: "sdd/engine-life-course/research #6144, M-S2 (Razi, Durham widow-right).",
    range: "Directional only — no absolute annual hazard is sourced, just the pre/post ratio.",
    confidence: "low",
  },
  WIDOW_REMARRIAGE_POST_BLACK_DEATH_FACTOR: {
    source: "research #6144, M-S2: widow remarriage 63% before the Black Death, 26% after.",
    range: "Target ratio ~0.41 (26/63); the annual curve reaching that cumulative figure is PR8 calibration work.",
    confidence: "medium",
  },
  COURTSHIP_WEIBULL_K: {
    source: "Design revision 2 hazard-shapes table (Weibull in courtshipYears, k≈1.5).",
    range: "No sourced shape parameter located; k>1 chosen for an increasing hazard with courtship length.",
    confidence: "low",
  },
  FERTILITY_HAZARD_BANDS: {
    source: "Design revision 2 hazard-shapes table ('fertility bands by age'); raised by PR10 (decision 071) toward research #6144's own ~35-45‰ pre-plague CBR / ~6-7 births-per-completed-marriage targets, after measuring the REALIZED rate at only ~30-45% of the table's own prior values (see the constant's own doc comment for the full diagnosis).",
    range: "Provisional age bands; distinct from `CONCEPTION_PROBABILITY_BANDS` below (`simulate.ts#conceptionProbability`'s own age curve, corrected here from an earlier `actuarial.ts` misattribution). Raised 0.28/0.35/0.28/0.18/0.1 -> 0.5/0.6/0.5/0.4/0.25, empirically, alongside the Y3 reduction below -- decision 071 measured this table's own ceiling (`effectiveSelectionHazard`'s clamp) and found further raises here largely inert; PR14 STEP 2 targeted `CONCEPTION_PROBABILITY_BANDS` instead, a lever the clamp does not touch.",
    confidence: "low",
  },
  CONCEPTION_PROBABILITY_BANDS: {
    source: "Davenport, R.J. (2019) birth-interval figures (docs/research.md lines 110-111: 30-33 months ordinary, 24.6 months elite) via `eligibleForAnotherChild`'s own citation -- the interval this table plus the birth-spacing floor are jointly shaped to reproduce, not a directly sourced per-year fecundability curve (none located for 1327-1361 or a close period proxy). Decision 079's further raise is explicitly NOT shaped to that citation -- see its own range note.",
    range: "Raised 0.65/0.45/0.25 -> 0.85/0.65/0.4 by PR14 STEP 2 (decision 076) after measuring the old values implied an average inter-birth interval (~4.7 years) far longer than Davenport's own 30-33-month target, even after PR13/PR14's own fixes to WHETHER a couple tries (the fertility-window pressure term, the completed-marriage metric) -- this table governs whether trying succeeds, a lever `effectiveSelectionHazard`'s clamp does not truncate (see FERTILITY_HAZARD_BANDS's own entry). Decision 079 (Follett-plausible population growth) raised it again, 0.85/0.65/0.4 -> 0.95/0.83/0.62, one of three combined levers (alongside `MORTALITY_BY_AGE_BAND`'s adult bands and immigration) closing the pre-plague CBR/CDR gap -- invented/Follett-plausible past this point, not a further reading of Davenport.",
    confidence: "low",
  },
  Y3_UNFREE_MOBILITY_FACTOR: {
    source: "research #6144, M-S5/M-S6 (chevage licence required for the unfree to live off the manor).",
    range: "Directional (unfree move less freely); no sourced factor magnitude.",
    confidence: "low",
  },
  Y3_STATUTE_MOBILITY_FACTOR: {
    source: "research #6144, M-S5 (Statute of Labourers 1351: banned leaving the vill, work compelled under 68).",
    range: "Directional (further restriction post-1351); no sourced factor magnitude. Deferred from PR5.",
    confidence: "low",
  },
  ONE_SHOT_HAZARD: {
    source: "Design revision 2 hazard-shapes table ('AP1/A3/C3 one-shots: 0.95').",
    range: "Fixed by design, not a research figure — these candidates are already gated to at most one eligible year.",
    confidence: "high",
  },
  OTHER_KIND_BASE_HAZARD: {
    source: "PR6 scoping decision (this slice): the design's hazard-shapes table only names formulas for Y1/A1/A2/Y3/AP1/A3/C3.",
    range: "Placeholder constant for every other social kind, deferred pending a per-kind design; not a research figure.",
    confidence: "low",
  },
  FALLBACK_HAZARD: {
    source: "Design revision 2, decision 15 (hazard lookup never throws).",
    range: "Fixed defensive default, not a research figure.",
    confidence: "high",
  },
  MARRIAGE_RAMP_CAP_YEARS: {
    source: "Design revision 2 hazard-shapes table (D_k(t) = 1 + rho*min(t,8)).",
    range: "Fixed by design (the ramp's own cap, t=8); not a research figure.",
    confidence: "high",
  },
  WIDOW_REMARRIAGE_FACTOR_YEAR: {
    source: "period/events.ts#BLACK_DEATH_YEARS (the pandemic's first dated year, 1348-49).",
    range: "Fixed to the Black Death's own onset year, not independently tunable.",
    confidence: "high",
  },
  COURTSHIP_WEIBULL_LAMBDA: {
    source: "PR6 corrective (engram #6280, 'the marriage chain'): lowered from 3 to 1.5 so the Weibull's characteristic timescale matches the design's intended courtship length once effectiveSelectionHazard corrects the two-stage compounding.",
    range: "No sourced shape parameter located; calibrated against the measured mean courtship-to-marriage interval.",
    confidence: "low",
  },
  COURTSHIP_BASE_HAZARD: {
    source: "Design revision 2 hazard-shapes table (A1's Weibull base rate).",
    range: "Provisional (0.45), calibrated toward the 18-22/21-25 marriage-age target alongside the Weibull shape.",
    confidence: "low",
  },
  OUTCOME_TIME_PRESSURE_CEILING: {
    source: "PR12 STEP 2 (decision 073/074): a bounded ceiling below certainty, matching the design's own 'never over-correct past raw hazard' clamp intent (decision 066) applied to the outcome side instead of the selection side.",
    range: "0.9 -- high enough that Y1's own raw-hazard asymptote (~0.54) is comfortably reachable, low enough to always leave decline/wait (or delay/end-it) a nonzero share.",
    confidence: "low",
  },
  Y1_OUTCOME_PRESSURE_SLOPE: {
    source: "PR12 STEP 2 (decision 073 finding 2, decision 074): calibrated empirically against hazards.ts#y1Hazard's own ramp so 'encourage' tracks at or above Y1's raw hazard once pressureYears accumulates -- no sourced historical marriage-pressure-by-year curve was located.",
    range: "0.012/year of combined pressure; at the cap (13 years) adds +0.156 to the facet-driven base, landing near Y1's own ~0.54 raw-hazard asymptote for villein women.",
    confidence: "low",
  },
  Y1_OUTCOME_PRESSURE_CAP_YEARS: {
    source: "PR12 STEP 2 (decision 074): sized so the combined (time-in-state + age-over-onset) pressure saturates around the age Y1's own raw hazard reaches its asymptote (MARRIAGE_RAMP_CAP_YEARS=8 plus a typical 4-5-year onset gap).",
    range: "13 combined years; not independently sourced.",
    confidence: "low",
  },
  A1_OUTCOME_PRESSURE_SLOPE: {
    source: "PR12 STEP 2 (decision 074): A1's Weibull raw hazard grows far faster per courtship-year than Y1's logistic ramp grows per eligible-year (measured: raw ~0.64 by courtshipYears=3) -- a shared Y1 slope left 'propose' badly under-tracking it, so A1 gets its own, steeper empirical slope.",
    range: "0.07/year of combined pressure; no sourced figure, tuned against hazards.ts#a1Hazard's own curve.",
    confidence: "low",
  },
  A1_OUTCOME_PRESSURE_CAP_YEARS: {
    source: "PR12 STEP 2 (decision 074): sized shorter than Y1's cap since A1's own raw hazard saturates (approaches 1) much sooner in courtship years than Y1's does in eligibility years.",
    range: "8 combined years; not independently sourced. Real truncation remains for the rare, very long (7+ year) courtship tail -- reported, not chased further (see decision 074).",
    confidence: "low",
  },
  A2_FERTILE_WINDOW_SPAN: {
    source: "actuarial.ts#isFertileAge's own f-sex span (16-45), reused as the denominator for A2's own outcome-pressure clock (decision 075) instead of a new, separate figure.",
    range: "29 years (45 - 16); not independently sourced beyond the existing isFertileAge span.",
    confidence: "low",
  },
  A2_OUTCOME_PRESSURE_SLOPE: {
    source: "PR13 STEP 1 (decision 075): A2's 'try' has the same effectiveSelectionHazard truncation Y1/A1 had (decision 073/074's own addendum flagged it) -- calibrated empirically against FERTILITY_HAZARD_BANDS' own age-banded raw hazard so 'try' tracks toward it once fertileYearsLeft has shrunk meaningfully. No sourced fertility-specific marriage-pressure-by-year curve was located.",
    range: "0.02/year of 'years into the fertile window'; at the cap (20 years) adds +0.4 to the facet-driven base.",
    confidence: "low",
  },
  A2_OUTCOME_PRESSURE_CAP_YEARS: {
    source: "PR13 STEP 1 (decision 075): sized so a couple in their late 20s/early 30s (roughly 10-20 years into the 16-45 fertile window) has cleared most of the truncation, mirroring Y1/A1's own cap-sizing logic (decision 074) applied to A2's own, wider raw-hazard plateau (ages 20-35).",
    range: "20 years; not independently sourced.",
    confidence: "low",
  },
  Y3_PEAK_HAZARD: {
    source: "Design revision 2 hazard-shapes table ('Y3 peaks 16-30'); lowered by PR10 (decision 071) after measuring Y3's peak window overlapping the marrying-age window and competing directly against Y1/A2 for the same person-year selection, measured to meaningfully depress both the marriage rate and realized marital fertility (see FERTILITY_HAZARD_BANDS's own doc comment).",
    range: "Provisional peak-window annual hazard; no sourced migration-rate figure for 1327-1361 was located. Lowered 0.12 -> 0.05.",
    confidence: "low",
  },
  Y3_OFF_PEAK_HAZARD: {
    source: "Design revision 2 hazard-shapes table ('lower for the unfree ... after the Statute'); lowered by PR10 (decision 071) alongside Y3_PEAK_HAZARD, same reasoning.",
    range: "Provisional off-peak annual hazard, directionally lower than the peak-window value. Lowered 0.04 -> 0.02.",
    confidence: "low",
  },
  Y3_PEAK_MIN_AGE: {
    source: "Design revision 2 hazard-shapes table ('Y3 peaks 16-30').",
    range: "Fixed peak-window bound, matching working-age onset (`isWorkingAge`).",
    confidence: "medium",
  },
  Y3_PEAK_MAX_AGE: {
    source: "Design revision 2 hazard-shapes table ('Y3 peaks 16-30').",
    range: "Fixed peak-window bound; young-adulthood mobility, not sourced to a specific age-30 cutoff.",
    confidence: "low",
  },
  IMMIGRATION_ANNUAL_PROBABILITY: {
    source: "PR9 (this slice, engram #6142/#6311): promoted from an undocumented hardcoded `0.05` in simulate.ts. General medieval-mobility literature (already cited for Y3's own mobility factors, research #6144 M-S5/M-S6) documents inter-manor migration as a normal feature of the period; no sourced annual arrival RATE was located for a village this size. Decision 079 (Follett-plausible population growth): raised again, 0.05 -> 0.15, as one of three combined levers (alongside `MORTALITY_BY_AGE_BAND`'s adult bands and `CONCEPTION_PROBABILITY_BANDS`) closing `populationPrePlagueChangePercent`'s -23.2% gap against its -5..+20% Follett-plausible band.",
    range: "Raised 0.05 -> 0.10 -> (reverted to 0.05) -> 0.15 (decision 079, this is now the PRE-plague rate only). See `IMMIGRATION_ANNUAL_PROBABILITY_POST_PLAGUE` for the higher post-1350 rate decision 079 added.",
    confidence: "low",
  },
  IMMIGRATION_ANNUAL_PROBABILITY_POST_PLAGUE: {
    source: "Decision 079 (Follett-plausible population growth): a second, period-gated immigration rate, same narrative logic decision 078 already used for the widened `widowRemarriagePostBlackDeath` band (the plague frees land and partners, so newcomers are more plausible after it, not less). No sourced post-plague resettlement RATE exists for a village this size.",
    range: "0.45, active only for `[IMMIGRATION_POST_PLAGUE_YEAR, IMMIGRATION_POST_PLAGUE_END_YEAR)`. An earlier, unbounded version (0.5, left on for the rest of the 1327-1427 run) was tried first and reverted after it made `npm test` time out on several curated-seed/full-run tests -- see its own 'DELIBERATELY BOUNDED' doc comment for the full incident and why the window is capped. Sized to close most of `populationRecoveryChangePercent`'s residual gap, since that metric (1350->1361) measures straight through the second pestilence's own first, heavier-weighted year (1361) -- a fixed-percentage shock the permanent levers alone cannot out-run without first overshooting the pre-plague window's own +20% ceiling. See `MORTALITY_BY_AGE_BAND`'s entry for the measured before/after across all three levers together.",
    confidence: "low",
  },
  IMMIGRATION_POST_PLAGUE_YEAR: {
    source: "Decision 079: `scripts/check-demographics.ts#TRAJECTORY_YEARS`'s own recovery-window start, one year after `period/events.ts#BLACK_DEATH_YEARS`'s last dated year.",
    range: "Fixed at 1350, not independently tunable.",
    confidence: "high",
  },
  IMMIGRATION_POST_PLAGUE_END_YEAR: {
    source: "Decision 079: `scripts/check-demographics.ts#TRAJECTORY_YEARS`'s own recovery-window end (1361), plus one year, so the elevated rate covers the full measured window and nothing beyond it -- the bound that keeps this lever from causing the runaway `npm test` timeouts its own unbounded predecessor did (see `IMMIGRATION_ANNUAL_PROBABILITY_POST_PLAGUE`'s doc comment).",
    range: "Fixed at 1362, not independently tunable.",
    confidence: "high",
  },
  RETURN_HOME_PROBABILITY: {
    source: "PR10 (this slice, decision 071): promoted, unchanged in value, from an undocumented, protagonist-only inline `0.08` in simulate.ts's away-catalog block. No sourced annual return-rate figure was located; general medieval-mobility literature (already cited for Y3's own mobility factors) documents return migration as a normal counterpart to outward mobility (apprenticeship, service, seasonal labour), just not at a specific rate.",
    range: "Generalized from the protagonist to the whole village this slice — see simulate.ts's gatherCandidatesForYear for the measured before/after this closes (0 of 188 general-village emigrants ever returned across a 20-seed diagnostic run before this fix).",
    confidence: "low",
  },
  RETURN_HOME_MIN_AWAY_YEARS: {
    source: "PR10 (this slice, decision 071): promoted, unchanged in value, from an undocumented, protagonist-only inline `3` in simulate.ts's away-catalog block.",
    range: "Fixed wait before a 'return' candidate is even offered; not independently tuned this slice.",
    confidence: "low",
  },
  MORTALITY_BY_AGE_BAND: {
    source: "Decision 050 (research.md, Wrigley & Schofield 1981 / Galley 2019) for every band except age<2 and age 5-14; PR9 (step 2, engram #6142/#6311, decision 069) recalibrated the age<2 band for the engine's actual 1327-1361 period against research #6144's own infantMortality target (`targets.ts`, ~30% by age 1, roughly double the Tudor 1498-1558 rate). PR13 STEP 2 (decision 075) recalibrated the age 5-14 band: it was the only band with zero direct calibration-target coverage and was still decision 050's original Tudor figure; a hand-computed life table using the unchanged bands gave ~56-57% cumulative death by 15, well above research.md line 112's own '~30% of children die before 15' citation (UNVERIFIED single source). Decision 079 (Follett-plausible population growth) lowers the five ADULT bands (15+) further, invented/Follett-plausible, NOT re-sourced -- see that constant's own doc comment.",
    range: "age<2 raised 0.14 -> 0.30 (decision 069); age 5-14 lowered 0.027 -> 0.02 (decision 075), chosen so under15DeathShare (the conditional age 2-7 share, which shares ages 5-6 with this band) stays inside its own 20-30% band with real margin. Adult bands (15+): unchanged through decision 075 (confirmed tracking the table closely, no evidence of excess mortality); decision 079 lowers them by roughly 53-60% (age<40 0.016->0.0075, <60 0.032->0.0135, <75 0.07->0.03, <90 0.2->0.085, 90+ 0.47->0.19) as the dominant lever for `populationPrePlagueChangePercent`/`populationRecoveryChangePercent`, since these bands carry no direct calibration-target coverage of their own beyond the now-widened `lifeExpectancyAtBirth` (18-32). Measured (decision 069): infantMortality 13.4% -> 29.1%; lifeExpectancyAtBirth 23.7 -> 21.9 as an expected side effect. Measured (decision 075, 5-14 band alone): see decision 075 for the full before/after. Measured (decision 079, combined with `CONCEPTION_PROBABILITY_BANDS` and immigration): see decision 079 for the full 60-seed before/after table.",
    confidence: "low",
  },
} as const;

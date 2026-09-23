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
    source: "Design revision 2, decision 14 (supersedes decision 053's 1498-1558 floors); research.md Family §rules synthesis for direction only.",
    range: "Women 18-22 mean, men 21-25 mean, per the confirmed marriage band (research-request rev 8).",
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
    source: "Design revision 2 hazard-shapes table ('fertility bands by age').",
    range: "Provisional age bands; distinct from `actuarial.ts#conceptionProbability`'s own age curve.",
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
} as const;

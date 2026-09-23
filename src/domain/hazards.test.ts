import { describe, expect, it } from "vitest";
import type { PersonYearSituation } from "./decisions";
import { FALLBACK_HAZARD, MARRIAGE_FLOORS } from "./params/demography";
import {
  clampJevSelection,
  clampJudgedSelection,
  computeHazard,
  computeHazardPrior,
  describeHazardBand,
  describeTimeInState,
  effectiveSelectionHazard,
  expectedMarriageChain,
  HAZARD_BAND_RARE_MAX,
  HAZARD_BAND_UNCOMMON_MAX,
  HAZARD_CLAMP_K_MAX,
  HAZARD_CLAMP_K_MIN,
  lookupHazard,
  OUTCOME_PROBABILITY_FLOOR,
  resolveCompetingRisks,
  TIME_IN_STATE_ESTABLISHED_MAX_YEARS,
  TIME_IN_STATE_RECENT_MAX_YEARS,
} from "./hazards";
import type { JsonValue, SocialClass, Sex } from "./types";

describe("PR6 corrective: effectiveSelectionHazard (engram #6280, the marriage chain)", () => {
  it("scales a raw hazard up so the compound (selection x outcome) chain matches the raw hazard on average", () => {
    // A raw hazard of 0.30, gated behind a separate 0.4-probability outcome roll (Y1's "encourage"),
    // needs an effective selection weight of 0.75 so 0.75 * 0.4 = 0.30 on average.
    expect(effectiveSelectionHazard(0.3, 0.4)).toBeCloseTo(0.75, 10);
  });

  it("floors the outcome probability so a very low-facet person doesn't blow the hazard up unboundedly", () => {
    const withFloor = effectiveSelectionHazard(0.03, 0.02);
    expect(withFloor).toBeCloseTo(0.03 / OUTCOME_PROBABILITY_FLOOR, 10);
  });

  it("never exceeds 1, even when the raw hazard is already large relative to the outcome probability", () => {
    expect(effectiveSelectionHazard(0.9, 0.3)).toBe(1);
  });
});

describe("PR6: hazard shape (task 6.1)", () => {
  it("a longer time-marriageable-and-single person has a higher Y1 hazard than a newly eligible one, same age/sex/class", () => {
    const newlyEligible = computeHazard({ kind: "Y1", age: 20, sex: "f", socialClass: "villein", year: 1330, yearsMarriageable: 0 });
    const longWaiting = computeHazard({ kind: "Y1", age: 20, sex: "f", socialClass: "villein", year: 1330, yearsMarriageable: 5 });
    expect(longWaiting.value).toBeGreaterThan(newlyEligible.value);
  });

  it("the ramp caps at 8 years (D_k(t) = 1 + rho*min(t,8))", () => {
    const at8 = computeHazard({ kind: "Y1", age: 30, sex: "m", socialClass: "villein", year: 1330, yearsMarriageable: 8 });
    const at20 = computeHazard({ kind: "Y1", age: 30, sex: "m", socialClass: "villein", year: 1330, yearsMarriageable: 20 });
    expect(at20.value).toBeCloseTo(at8.value, 10);
  });

  it("a widowed person uses a separate flat base, not the single-and-waiting ramp", () => {
    const widow = computeHazard({ kind: "Y1", age: 30, sex: "f", socialClass: "villein", year: 1330, isWidowed: true, yearsMarriageable: 12 });
    const neverMarriedSameAge = computeHazard({ kind: "Y1", age: 30, sex: "f", socialClass: "villein", year: 1330, isWidowed: false, yearsMarriageable: 12 });
    expect(widow.value).not.toBeCloseTo(neverMarriedSameAge.value, 5);
  });

  it("widow remarriage hazard drops after the Black Death (post-1349 factor)", () => {
    const before = computeHazard({ kind: "Y1", age: 30, sex: "f", socialClass: "villein", year: 1340, isWidowed: true });
    const after = computeHazard({ kind: "Y1", age: 30, sex: "f", socialClass: "villein", year: 1355, isWidowed: true });
    expect(after.value).toBeLessThan(before.value);
  });

  it("A1's Weibull hazard increases with courtship years", () => {
    const short = computeHazard({ kind: "A1", age: 22, sex: "m", socialClass: "villein", year: 1330, courtshipYears: 1 });
    const long = computeHazard({ kind: "A1", age: 22, sex: "m", socialClass: "villein", year: 1330, courtshipYears: 6 });
    expect(long.value).toBeGreaterThan(short.value);
  });

  it("Y3 leave hazard is lower for the unfree, and lower still after the Statute of Labourers (1351)", () => {
    const freeBefore = computeHazard({ kind: "Y3", age: 20, sex: "m", socialClass: "freeholder", year: 1340 });
    const unfreeBefore = computeHazard({ kind: "Y3", age: 20, sex: "m", socialClass: "villein", year: 1340 });
    const unfreeAfterStatute = computeHazard({ kind: "Y3", age: 20, sex: "m", socialClass: "villein", year: 1355 });
    expect(unfreeBefore.value).toBeLessThan(freeBefore.value);
    expect(unfreeAfterStatute.value).toBeLessThan(unfreeBefore.value);
  });

  it("AP1/A3/C3 are flat one-shot hazards regardless of context", () => {
    expect(computeHazard({ kind: "AP1", age: 40, sex: "m", socialClass: "gentry", year: 1330 }).value).toBe(0.95);
    expect(computeHazard({ kind: "A3", age: 16, sex: "f", socialClass: "cottar", year: 1330 }).value).toBe(0.95);
    expect(computeHazard({ kind: "C3", age: 12, sex: "m", socialClass: "artisan", year: 1330 }).value).toBe(0.95);
  });

  it("A2's fertility hazard varies by age band", () => {
    const twenties = computeHazard({ kind: "A2", age: 25, sex: "f", socialClass: "villein", year: 1330 });
    const late = computeHazard({ kind: "A2", age: 42, sex: "f", socialClass: "villein", year: 1330 });
    expect(twenties.value).toBeGreaterThan(late.value);
  });
});

describe("PR8 fix: A2 joins OUTCOME_SCALED_KINDS (engram #6284/#6280, the fertility collapse)", () => {
  function a2Situation(id: string, self: Record<string, JsonValue> = { age: 25, sex: "f", socialClass: "villein" }): PersonYearSituation {
    return {
      kind: "A2",
      question: { id, kind: "A2", personId: "p1", year: 1340, state: { self, situation: { existingChildren: 0, fertileYearsLeft: 20 } }, options: ["try", "wait", "refuse"] },
    };
  }

  // PR10 (decision 071): age 42 (the 40+ band), not 25 -- FERTILITY_HAZARD_BANDS' own core bands
  // (<20/<30/<35) were deliberately raised close to `effectiveSelectionHazard`'s own clamp ceiling
  // (raw hazard / outcomeProbability >= 1), a real, measured, documented tuning finding (see that
  // constant's own doc comment) -- exercising this invariant at age 25 would now hit BOTH the
  // per-candidate clamp AND `resolveCompetingRisks`' RESCALE_THRESHOLD (a single, saturated
  // candidate's own sum already exceeds 0.95), which is a second, different, already-covered
  // mechanism, not what this test is about. Age 42 stays comfortably under the ceiling, so the
  // invariant this test actually asserts (compound = selection x outcome recovers the raw hazard)
  // still holds exactly.
  const UNSATURATED_TEST_AGE = 42;

  it("scales A2's raw fertility hazard by the try-outcome probability, the same as Y1/A1", () => {
    const situations = { a2: a2Situation("a2", { age: UNSATURATED_TEST_AGE, sex: "f", socialClass: "villein" }) };
    const response = { a2: { try: 0.4, wait: 0.4, refuse: 0.2 } };
    const rawHazard = computeHazard({ kind: "A2", age: UNSATURATED_TEST_AGE, sex: "f", socialClass: "villein", year: 1340 }).value;
    const prior = computeHazardPrior(situations, response);
    expect(prior.selection.a2!).toBeCloseTo(effectiveSelectionHazard(rawHazard, 0.4), 10);
  });

  it("the compound (selection wins x try chosen) probability recovers the raw fertility hazard on average", () => {
    const tryProb = 0.4;
    const situations = { a2: a2Situation("a2", { age: UNSATURATED_TEST_AGE, sex: "f", socialClass: "villein" }) };
    const response = { a2: { try: tryProb, wait: 0.4, refuse: 0.2 } };
    const rawHazard = computeHazard({ kind: "A2", age: UNSATURATED_TEST_AGE, sex: "f", socialClass: "villein", year: 1340 }).value;
    const prior = computeHazardPrior(situations, response);
    const compound = prior.selection.a2! * tryProb;
    expect(compound).toBeCloseTo(rawHazard, 10);
  });
});

describe("PR6: hazard lookup miss chain (task 6.7)", () => {
  const table = { villein: { f: 0.3, m: 0.25 } } as Record<string, Record<string, number> | undefined>;

  it("returns the exact cell when present, with no fallback", () => {
    const result = lookupHazard(table, "Y1", "villein", "f");
    expect(result.value).toBe(0.3);
    expect(result.fallbackKey).toBeUndefined();
  });

  it("falls back to the villein '*' row when the class is missing, and reports the fallback", () => {
    const result = lookupHazard(table, "Y1", "gentry", "f");
    expect(result.value).toBe(0.3);
    expect(result.fallbackKey).toBe("Y1:gentry");
  });

  it("never throws and degrades to FALLBACK_HAZARD when even the '*' row is missing", () => {
    const emptyTable = {} as Record<string, Record<string, number> | undefined>;
    expect(() => lookupHazard(emptyTable, "Y1", "gentry", "f")).not.toThrow();
    const result = lookupHazard(emptyTable, "Y1", "gentry", "f");
    expect(result.value).toBe(FALLBACK_HAZARD);
    expect(result.fallbackKey).toBe("Y1:gentry");
  });
});

describe("PR6 corrective task 4: the analytic marriage-chain expectation stays within onset + 5 years", () => {
  // A loose sanity band, not fine calibration (PR8's job) — deterministic and instant (no simulation
  // RNG), so it can never be flaky or slow. Guards specifically against the "chain multiplication"
  // regression this corrective fixes (engram #6280): before the fix, this same analytic chain
  // (computed with the OLD lambda=3, no effectiveSelectionHazard scaling) would have landed far
  // outside this band for every class.
  const classes: readonly SocialClass[] = ["gentry", "merchant", "artisan", "freeholder", "villein", "cottar"];
  const sexes: readonly Sex[] = ["f", "m"];

  for (const socialClass of classes) {
    for (const sex of sexes) {
      it(`${socialClass}/${sex}: expected first-marriage age is within onset + 5 years`, () => {
        const onset = MARRIAGE_FLOORS[socialClass][sex].onset;
        const { expectedMarriageAge } = expectedMarriageChain(socialClass, sex);
        expect(expectedMarriageAge).toBeLessThanOrEqual(onset + 5);
        expect(expectedMarriageAge).toBeGreaterThan(onset); // sanity: never before onset itself
      });
    }
  }
});

describe("PR7: clampJudgedSelection (design decision 2, the hybrid clamp)", () => {
  it("spec scenario: a 0.05 baseline clamped [0.5x, 2x] bounds a 0.9 judgment to 0.10", () => {
    expect(clampJudgedSelection(0.9, 0.05)).toBeCloseTo(0.1, 10);
  });

  it("clamps a judgment far BELOW the baseline up to baseline * K_MIN", () => {
    expect(clampJudgedSelection(0.001, 0.05)).toBeCloseTo(0.05 * HAZARD_CLAMP_K_MIN, 10);
  });

  it("passes a judgment through unchanged when its ratio to the baseline is already inside [K_MIN, K_MAX]", () => {
    expect(clampJudgedSelection(0.06, 0.05)).toBeCloseTo(0.06, 10);
  });

  it("a zero baseline (the hazard says this cannot happen) clamps to zero regardless of the judgment", () => {
    expect(clampJudgedSelection(0.5, 0)).toBe(0);
    expect(clampJudgedSelection(0, 0)).toBe(0);
  });
});

describe("PR7: clampJevSelection (the clamp applied to a whole person-year batch)", () => {
  function y1Situation(id: string, self: Record<string, JsonValue> = { age: 30, sex: "f", socialClass: "villein" }): PersonYearSituation {
    return {
      kind: "Y1",
      question: { id, kind: "Y1", personId: "p1", year: 1340, state: { self, situation: { code: "Y1" } }, options: ["encourage", "decline", "wait"] },
    };
  }

  it("never lets an extreme Jev judgment through unclamped — it stays within K_MAX of the hazard baseline", () => {
    const situations = { y1: y1Situation("y1") };
    const response = { y1: { encourage: 0.5, decline: 0.3, wait: 0.2 } };
    const baseline = computeHazardPrior(situations, response).selection.y1!;
    const result = clampJevSelection(situations, { y1: 0.99, nothing: 0.01 }, response);
    expect(result.selection.y1!).toBeLessThanOrEqual(baseline * HAZARD_CLAMP_K_MAX + 1e-9);
    expect(result.selection.y1!).not.toBeCloseTo(0.99, 2);
  });

  it("the clamped selection plus its residual still sums to exactly 1", () => {
    const situations = { y1: y1Situation("y1") };
    const response = { y1: { encourage: 0.5, decline: 0.3, wait: 0.2 } };
    const result = clampJevSelection(situations, { y1: 0.02, nothing: 0.98 }, response);
    const total = Object.values(result.selection).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 10);
    expect(result.selection.y1!).toBeGreaterThan(0);
  });

  it("a situation Jev's judgment omits falls back to the hazard baseline, not the clamp floor", () => {
    const situations = { y1: y1Situation("y1") };
    const response = { y1: { encourage: 0.5, decline: 0.3, wait: 0.2 } };
    const prior = computeHazardPrior(situations, response);
    const result = clampJevSelection(situations, { nothing: 1 }, response);
    expect(result.selection.y1!).toBeCloseTo(prior.selection.y1!, 10);
  });

  it("reports hazard-lookup fallbacks from the underlying prior computation", () => {
    const situations = { y1: y1Situation("y1", { age: 30, sex: "f", socialClass: "not-a-real-class" }) };
    const response = { y1: { encourage: 0.5, decline: 0.3, wait: 0.2 } };
    const result = clampJevSelection(situations, { y1: 0.5, nothing: 0.5 }, response);
    expect(Object.keys(result.hazardFallbacks).length).toBeGreaterThan(0);
  });

  // PR8 follow-up (task list note, engram #6142): every prior test's batch has no D1 vignette, so
  // `hasVignette` is always false and only the `selection.nothing` branch (line 400) ever ran — the
  // protagonist's own `selection.everyday` branch (line 399) was never exercised.
  it("uses 'everyday' as the residual key (not 'nothing') when a D1 vignette situation rides along", () => {
    const situations: Record<string, PersonYearSituation> = {
      y1: y1Situation("y1"),
      d1: {
        kind: "D1",
        question: {
          id: "d1",
          kind: "D1",
          personId: "p1",
          year: 1340,
          state: { self: { age: 30, sex: "f", socialClass: "villein" }, situation: { code: "share-grain-vignette" } },
          options: ["share-grain", "keep-grain"],
        },
      },
    };
    const response = { y1: { encourage: 0.5, decline: 0.3, wait: 0.2 }, d1: { "share-grain": 0.5, "keep-grain": 0.5 } };
    const result = clampJevSelection(situations, { y1: 0.3, everyday: 0.7 }, response);
    expect(result.selection.everyday).toBeGreaterThan(0);
    expect(result.selection.nothing).toBeUndefined();
    const total = Object.values(result.selection).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 10);
  });
});

describe("PR7: describeHazardBand / describeTimeInState (design decision 3, qualitative facts for Jev's prompt)", () => {
  it("bands a hazard value into rare/uncommon/common by the documented thresholds", () => {
    expect(describeHazardBand(0.01)).toBe("rare");
    expect(describeHazardBand(0.1)).toBe("uncommon");
    expect(describeHazardBand(0.5)).toBe("common");
  });

  it("bands years-in-state into recent/established/long-standing", () => {
    expect(describeTimeInState(0)).toBe("recent");
    expect(describeTimeInState(3)).toBe("established");
    expect(describeTimeInState(10)).toBe("long-standing");
  });

  // PR8 follow-up (task list note, engram #6142): the two existing tests above only sample INSIDE
  // each band, never the documented threshold values themselves (`HAZARD_BAND_RARE_MAX`,
  // `HAZARD_BAND_UNCOMMON_MAX`, `TIME_IN_STATE_RECENT_MAX_YEARS`, `TIME_IN_STATE_ESTABLISHED_MAX_YEARS`)
  // — both functions use a strict `<`/inclusive `<=` mix, so the exact boundary is exactly where an
  // off-by-one would hide.
  it("describeHazardBand: the boundary value itself belongs to the band ABOVE (strict < comparisons)", () => {
    expect(describeHazardBand(HAZARD_BAND_RARE_MAX)).toBe("uncommon");
    expect(describeHazardBand(HAZARD_BAND_UNCOMMON_MAX)).toBe("common");
  });

  it("describeTimeInState: the boundary value itself still belongs to the LOWER band (inclusive <= comparisons)", () => {
    expect(describeTimeInState(TIME_IN_STATE_RECENT_MAX_YEARS)).toBe("recent");
    expect(describeTimeInState(TIME_IN_STATE_RECENT_MAX_YEARS + 1)).toBe("established");
    expect(describeTimeInState(TIME_IN_STATE_ESTABLISHED_MAX_YEARS)).toBe("established");
    expect(describeTimeInState(TIME_IN_STATE_ESTABLISHED_MAX_YEARS + 1)).toBe("long-standing");
  });
});

describe("PR6: competing-risk resolution (task 6.3)", () => {
  it("sums to 1 with the residual as the remainder when hazards sum under 0.95", () => {
    const { selection, residual } = resolveCompetingRisks({ a: 0.1, b: 0.2 });
    expect(selection.a).toBeCloseTo(0.1, 10);
    expect(selection.b).toBeCloseTo(0.2, 10);
    expect(residual).toBeCloseTo(0.7, 10);
    expect(selection.a + selection.b + residual).toBeCloseTo(1, 10);
  });

  it("rescales proportionally when hazards sum over 0.95, leaving exactly 0.05 residual", () => {
    const { selection, residual } = resolveCompetingRisks({ a: 0.6, b: 0.6 });
    expect(residual).toBeCloseTo(0.05, 10);
    expect(selection.a).toBeCloseTo(selection.b, 10);
    expect(selection.a + selection.b + residual).toBeCloseTo(1, 10);
    // proportional: a and b were equal before rescale, so they stay equal after
    expect(selection.a).toBeCloseTo(0.475, 10);
  });

  it("is deterministic and reproduces the same result for the same input", () => {
    const first = resolveCompetingRisks({ a: 0.3, b: 0.4, c: 0.4 });
    const second = resolveCompetingRisks({ a: 0.3, b: 0.4, c: 0.4 });
    expect(first).toEqual(second);
  });
});

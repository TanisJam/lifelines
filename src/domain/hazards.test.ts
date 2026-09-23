import { describe, expect, it } from "vitest";
import { FALLBACK_HAZARD, MARRIAGE_FLOORS } from "./params/demography";
import { computeHazard, effectiveSelectionHazard, expectedMarriageChain, lookupHazard, OUTCOME_PROBABILITY_FLOOR, resolveCompetingRisks } from "./hazards";
import type { SocialClass, Sex } from "./types";

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

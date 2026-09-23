import { describe, expect, it } from "vitest";
import { inNeverMarriedCohort, meanChildrenPerMarriage, neverMarriedSharePercent, rateByAgeBand } from "./population-stats";

describe("rateByAgeBand", () => {
  const bands = [
    { maxAge: 20, label: "<20" },
    { maxAge: 30, label: "20-30" },
    { maxAge: Infinity, label: "30+" },
  ];

  it("buckets each observation into the first band whose maxAge it is strictly under, and computes events/exposure", () => {
    const observations = [
      { age: 18, occurred: true },
      { age: 19, occurred: false },
      { age: 25, occurred: true },
      { age: 25, occurred: true },
      { age: 25, occurred: false },
      { age: 40, occurred: false },
    ];
    const result = rateByAgeBand(observations, bands);
    expect(result["<20"]).toEqual({ exposure: 2, events: 1, rate: 0.5 });
    expect(result["20-30"]).toEqual({ exposure: 3, events: 2, rate: 2 / 3 });
    expect(result["30+"]).toEqual({ exposure: 1, events: 0, rate: 0 });
  });

  it("falls back to the last band for an age past every finite maxAge", () => {
    const oneBand = [{ maxAge: 10, label: "young" }];
    const result = rateByAgeBand([{ age: 99, occurred: true }], oneBand);
    expect(result.young).toEqual({ exposure: 1, events: 1, rate: 1 });
  });

  it("gives every declared band a zero-exposure entry even with no observations landing in it", () => {
    const result = rateByAgeBand([{ age: 5, occurred: false }], bands);
    expect(result["20-30"]).toEqual({ exposure: 0, events: 0, rate: NaN });
    expect(result["30+"]).toEqual({ exposure: 0, events: 0, rate: NaN });
  });
});

describe("meanChildrenPerMarriage", () => {
  it("averages childCount across the given (already-filtered-to-completed) marriages", () => {
    expect(meanChildrenPerMarriage([{ childCount: 4 }, { childCount: 6 }, { childCount: 8 }])).toBe(6);
  });

  it("returns NaN for an empty list rather than dividing by zero", () => {
    expect(meanChildrenPerMarriage([])).toBeNaN();
  });
});

describe("neverMarriedSharePercent", () => {
  it("computes the percent of the cohort whose everMarried flag is false", () => {
    const cohort = [{ everMarried: true }, { everMarried: true }, { everMarried: false }, { everMarried: false }];
    expect(neverMarriedSharePercent(cohort)).toBe(50);
  });

  it("returns NaN for an empty cohort", () => {
    expect(neverMarriedSharePercent([])).toBeNaN();
  });
});

describe("inNeverMarriedCohort", () => {
  it("excludes a person who died before the cohort age — a dead child is not 'never married'", () => {
    expect(inNeverMarriedCohort({ birthYear: 1330, deathYear: 1331 }, 1427, 45)).toBe(false);
    expect(inNeverMarriedCohort({ birthYear: 1330, deathYear: 1374 }, 1427, 45)).toBe(false);
  });

  it("includes a person who survived to the cohort age, alive or dead afterwards", () => {
    expect(inNeverMarriedCohort({ birthYear: 1330, deathYear: 1375 }, 1427, 45)).toBe(true);
    expect(inNeverMarriedCohort({ birthYear: 1330 }, 1427, 45)).toBe(true);
  });

  it("excludes a person the window cannot follow up to the cohort age", () => {
    expect(inNeverMarriedCohort({ birthYear: 1400 }, 1427, 45)).toBe(false);
  });

  // PR13 STEP 0 (decision 075): the same predicate gates "children ever born per completed
  // marriage" — a wife who died before 45 had her childbearing cut short by death, not by
  // completing her fertile window, so she should not count toward the ~6-7-per-completed-marriage
  // historical figure, which is specifically about wives who survived to the end of it.
  it("excludes a wife who died mid-fertile-window from the 'completed marriage' cohort", () => {
    expect(inNeverMarriedCohort({ birthYear: 1330, deathYear: 1360 }, 1427, 45)).toBe(false); // died at 30
  });

  it("includes a wife who survived to the end of her fertile window, alive or dead afterwards", () => {
    expect(inNeverMarriedCohort({ birthYear: 1330, deathYear: 1380 }, 1427, 45)).toBe(true); // died at 50, after 45
    expect(inNeverMarriedCohort({ birthYear: 1330 }, 1427, 45)).toBe(true); // still alive, past 45 by window end
  });
});

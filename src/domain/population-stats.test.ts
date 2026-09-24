import { describe, expect, it } from "vitest";
import { completedMarriageWives, inNeverMarriedCohort, meanChildrenPerMarriage, neverMarriedSharePercent, rateByAgeBand } from "./population-stats";

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

// PR14 STEP 1 (decision 076): `check-demographics.ts` used to build "children ever born per completed
// marriage" by looping over EVERY marriage EVENT, not every WIFE — a remarried wife who survived to 45
// (very common: the Black Death cuts a first marriage short mid-window, and check-demographics.ts's own
// wife-survives-to-45 cohort filter doesn't care which marriage) was pushed into the sample once PER
// marriage, with her true lifetime total split across deflated per-husband childCounts. A marriage that
// started at/after the fertile window's own end age was also counted as "completed" despite having zero
// possible fertile exposure. Both bugs deflate the metric far below what the same population's own ASMFR
// implies — the STEP 1 "internal contradiction" the orchestrator flagged. `completedMarriageWives`
// selects one wife id per qualifying cohort member (her earliest marriage decides eligibility), so the
// caller can sum her TOTAL children (any father, any marriage) exactly once.
describe("completedMarriageWives", () => {
  const wife = (id: string, birthYear: number, deathYear?: number) => [id, { id, birthYear, deathYear }] as const;

  it("counts a remarried wife once, not once per marriage", () => {
    const wives = new Map([wife("w1", 1320, 1400)]); // survives to 45 (endYear 1427)
    const marriages = [
      { wifeId: "w1", marriageYear: 1340 }, // age 20 — first marriage
      { wifeId: "w1", marriageYear: 1360 }, // age 40 — remarriage after being widowed
    ];
    expect(completedMarriageWives(marriages, wives, 1427, 45)).toEqual(["w1"]);
  });

  it("excludes a wife whose only marriage started at or after the fertile window's own end age", () => {
    const wives = new Map([wife("w2", 1300, 1400)]); // survives to 45
    const marriages = [{ wifeId: "w2", marriageYear: 1346 }]; // age 46 — no possible fertile exposure
    expect(completedMarriageWives(marriages, wives, 1427, 45)).toEqual([]);
  });

  it("includes a wife whose earliest marriage started before the fertile window's end, even if a later remarriage started after it", () => {
    const wives = new Map([wife("w3", 1300, 1400)]);
    const marriages = [
      { wifeId: "w3", marriageYear: 1320 }, // age 20 — eligible
      { wifeId: "w3", marriageYear: 1348 }, // age 48 — remarriage past the window, irrelevant once already counted
    ];
    expect(completedMarriageWives(marriages, wives, 1427, 45)).toEqual(["w3"]);
  });

  it("excludes a wife who did not survive to the cohort age, reusing inNeverMarriedCohort", () => {
    const wives = new Map([wife("w4", 1320, 1350)]); // dies at 30
    const marriages = [{ wifeId: "w4", marriageYear: 1340 }];
    expect(completedMarriageWives(marriages, wives, 1427, 45)).toEqual([]);
  });

  it("ignores a marriage record for a wife not present in the wives map", () => {
    const wives = new Map([wife("w5", 1320, 1400)]);
    const marriages = [{ wifeId: "ghost", marriageYear: 1340 }];
    expect(completedMarriageWives(marriages, wives, 1427, 45)).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import type { DecisionQuestion } from "./decisions";
import { computeHazard } from "./hazards";
import { MARRIAGE_FLOORS, OUTCOME_TIME_PRESSURE_CEILING } from "./params/demography";
import { ruleDistribution } from "./rule-heuristics";
import type { Sex, SocialClass } from "./types";

function questionWithFacets(kind: DecisionQuestion["kind"], selfFacets: Record<string, number>, otherFacets: Record<string, number> = {}): DecisionQuestion {
  return {
    id: `${kind}:p1#1.1`,
    kind,
    personId: "p1",
    year: 1330,
    state: {
      self: { mind: { facets: selfFacets, values: {} } },
      partner: { mind: { facets: otherFacets, values: {} } },
      suitor: { mind: { facets: otherFacets, values: {} } },
    },
    options: ["encourage", "decline", "wait"],
  };
}

/** A facet-typical Y1/A1/A2 question at a given age/class/sex, with the situation's own time-in-state extra set. */
function questionWithTime(
  kind: "Y1" | "A1" | "A2",
  age: number,
  socialClass: SocialClass,
  sex: Sex,
  timeInState: Record<string, number>,
): DecisionQuestion {
  return {
    id: `${kind}:p1#1.1`,
    kind,
    personId: "p1",
    year: 1330,
    state: {
      self: { age, sex, socialClass, mind: { facets: {}, values: {} } },
      partner: { mind: { facets: {}, values: {} } },
      suitor: { mind: { facets: {}, values: {} } },
      situation: { code: kind, ...timeInState },
    },
    options: kind === "Y1" ? ["encourage", "decline", "wait"] : kind === "A1" ? ["propose", "delay", "end-it"] : ["try", "wait", "refuse"],
  };
}

describe("PR6 corrective: Y1/A1 outcome floors (engram #6280, the marriage chain)", () => {
  it("Y1's 'encourage' never drops below the outcome-probability floor, even for a facet-worst-case person", () => {
    const worstCase = questionWithFacets("Y1", { lovePropensity: 0, gregariousness: 0 }, { trust: 0 });
    const result = ruleDistribution(worstCase);
    expect(result.encourage).toBeGreaterThanOrEqual(0.15);
  });

  it("A1's 'propose' never drops below the outcome-probability floor, even for a facet-worst-case person", () => {
    const worstCase = questionWithFacets("A1", { lovePropensity: 0, perseverance: 0 });
    const result = ruleDistribution({ ...worstCase, options: ["propose", "delay", "end-it"] });
    expect(result.propose).toBeGreaterThanOrEqual(0.15);
  });

  it("a facet-typical person's Y1/A1 outcome distribution is unaffected by the floor", () => {
    const typical = questionWithFacets("Y1", { lovePropensity: 50, gregariousness: 50 }, { trust: 50 });
    const result = ruleDistribution(typical);
    expect(result.encourage).toBeCloseTo(0.4, 5);
  });
});

describe("PR12 STEP 2 (decision 073/074, option (b)): Y1/A1 outcome probability grows with time pressure", () => {
  it("a newly-eligible villein woman right at onset, zero time-in-state, gets the facet-neutral base (no pressure yet)", () => {
    // Decision 080: villein/f onset moved 18 -> 17.5 (see MARRIAGE_FLOORS's own doc comment) — read it
    // dynamically rather than re-hardcoding the age, so this test means "at onset" regardless of the
    // exact value.
    const q = questionWithTime("Y1", MARRIAGE_FLOORS.villein.f.onset, "villein", "f", { yearsMarriageable: 0 });
    expect(ruleDistribution(q).encourage).toBeCloseTo(0.4, 5);
  });

  it("a long-eligible villein woman's 'encourage' grows strictly with yearsMarriageable", () => {
    const early = ruleDistribution(questionWithTime("Y1", 19, "villein", "f", { yearsMarriageable: 1 })).encourage;
    const later = ruleDistribution(questionWithTime("Y1", 23, "villein", "f", { yearsMarriageable: 8 })).encourage;
    expect(later).toBeGreaterThan(early);
  });

  it("Y1's 'encourage' never exceeds the shared OUTCOME_TIME_PRESSURE_CEILING, even for a decades-long wait", () => {
    const q = questionWithTime("Y1", 60, "villein", "f", { yearsMarriageable: 45 });
    expect(ruleDistribution(q).encourage).toBeLessThanOrEqual(OUTCOME_TIME_PRESSURE_CEILING);
  });

  it("Y1's decline/wait/encourage still sum to exactly 1 once time pressure is applied", () => {
    const q = questionWithTime("Y1", 30, "villein", "f", { yearsMarriageable: 12 });
    const { encourage, decline, wait } = ruleDistribution(q);
    expect(encourage + decline + wait).toBeCloseTo(1, 10);
  });

  it("a long-courting A1 candidate's 'propose' grows strictly with courtshipYears and stays at/under the ceiling", () => {
    const early = ruleDistribution(questionWithTime("A1", 19, "villein", "f", { courtshipYears: 1 })).propose;
    const later = ruleDistribution(questionWithTime("A1", 22, "villein", "f", { courtshipYears: 4 })).propose;
    expect(later).toBeGreaterThan(early);
    expect(later).toBeLessThanOrEqual(OUTCOME_TIME_PRESSURE_CEILING);
  });

  it("A1's distribution still sums to 1 at maximum time pressure, so 'propose' keeps its intended value", () => {
    const { propose, delay, "end-it": endIt } = ruleDistribution(questionWithTime("A1", 40, "villein", "f", { courtshipYears: 20 }));
    expect(propose + delay + endIt).toBeCloseTo(1, 10);
    expect(propose).toBeCloseTo(OUTCOME_TIME_PRESSURE_CEILING, 10);
  });

  it("years already past the class/sex onset age also add pressure, even at yearsMarriageable=0 (a late-starting eligibility)", () => {
    const atOnset = ruleDistribution(questionWithTime("Y1", MARRIAGE_FLOORS.villein.f.onset, "villein", "f", { yearsMarriageable: 0 })).encourage;
    const pastOnset = ruleDistribution(questionWithTime("Y1", 25, "villein", "f", { yearsMarriageable: 0 })).encourage;
    expect(pastOnset).toBeGreaterThan(atOnset);
  });

  it("the growing outcome probability tracks toward (never exceeds what makes realized exceed) the raw Y1 hazard by the time the ramp is fully saturated", () => {
    const age = 24;
    const yearsMarriageable = 8;
    const q = questionWithTime("Y1", age, "villein", "f", { yearsMarriageable });
    const encourage = ruleDistribution(q).encourage;
    const raw = computeHazard({ kind: "Y1", age, sex: "f", socialClass: "villein", year: 1340, yearsMarriageable }).value;
    // The whole point of option (b): once time pressure has accumulated, "encourage" should be close
    // to (here, at or above) the raw hazard so `effectiveSelectionHazard` stops truncating.
    expect(encourage).toBeGreaterThanOrEqual(raw - 0.02);
  });
});

describe("PR13 STEP 1 (decision 075): A2 'try' grows with closing-fertile-window pressure", () => {
  it("a woman at the very start of her fertile window (fertileYearsLeft at its max) gets the facet-neutral base (no pressure yet)", () => {
    const q = questionWithTime("A2", 16, "villein", "f", { fertileYearsLeft: 29 });
    expect(ruleDistribution(q).try).toBeCloseTo(0.4, 5);
  });

  it("'try' grows strictly as fertileYearsLeft shrinks (the window closing)", () => {
    const early = ruleDistribution(questionWithTime("A2", 20, "villein", "f", { fertileYearsLeft: 25 })).try;
    const later = ruleDistribution(questionWithTime("A2", 35, "villein", "f", { fertileYearsLeft: 10 })).try;
    expect(later).toBeGreaterThan(early);
  });

  it("'try' never exceeds the shared OUTCOME_TIME_PRESSURE_CEILING, even at the very end of the fertile window", () => {
    const q = questionWithTime("A2", 44, "villein", "f", { fertileYearsLeft: 1 });
    expect(ruleDistribution(q).try).toBeLessThanOrEqual(OUTCOME_TIME_PRESSURE_CEILING);
  });

  it("the pressure ceiling never lowers a person's own facet base below what it was without pressure", () => {
    const familyMinded: DecisionQuestion = {
      id: "A2:p1#1.1",
      kind: "A2",
      personId: "p1",
      year: 1330,
      state: { self: { mind: { facets: { lovePropensity: 100 }, values: { family: 100 } } }, situation: { fertileYearsLeft: 29 } },
      options: ["try", "wait", "refuse"],
    };
    expect(ruleDistribution(familyMinded).try).toBeGreaterThan(OUTCOME_TIME_PRESSURE_CEILING);
  });

  it("try/wait/refuse still sum to exactly 1 once time pressure is applied", () => {
    const q = questionWithTime("A2", 40, "villein", "f", { fertileYearsLeft: 5 });
    const { try: tryFor, wait, refuse } = ruleDistribution(q);
    expect(tryFor + wait + refuse).toBeCloseTo(1, 10);
  });

  it("the growing 'try' probability tracks toward the raw A2 hazard once the window pressure is saturated, reducing effectiveSelectionHazard's truncation", () => {
    const age = 32;
    const q = questionWithTime("A2", age, "villein", "f", { fertileYearsLeft: 13 });
    const tryFor = ruleDistribution(q).try;
    const raw = computeHazard({ kind: "A2", age, sex: "f", socialClass: "villein", year: 1340 }).value;
    expect(tryFor).toBeGreaterThanOrEqual(raw - 0.02);
  });

  it("missing fertileYearsLeft in state defaults to zero pressure (a safe fallback, not a crash)", () => {
    const q = questionWithTime("A2", 30, "villein", "f", {});
    expect(ruleDistribution(q).try).toBeCloseTo(0.4, 5);
  });

  // PR14 STEP 3 (decision 076, PR13 review advisory): when a facet base already exceeds
  // OUTCOME_TIME_PRESSURE_CEILING, "try" keeps its own value (Math.max) instead of being lowered —
  // but "refuse"/"wait" were still computed off `1 - tryFor` WITHOUT accounting for the fact that
  // `tryFor` itself can already leave less than "wait"'s own 0.02 floor: refuse=clamp01((1-0.98)*0.3)
  // =0.006, wait=max(0.02, 1-0.98-0.006)=0.02 (the floor fires), so the three summed to 1.006, not 1
  // — the same class of bug A1's own "end-it" floor already guards against (PR12 review
  // R3-a1-distribution-sum).
  it("try/wait/refuse sum to exactly 1 even when the facet base alone already exceeds the ceiling", () => {
    const q: DecisionQuestion = {
      id: "A2:p1#1.1",
      kind: "A2",
      personId: "p1",
      year: 1330,
      // family=87, lovePropensity=50 (neutral) => tryFor base = 0.4 + 87/150 + 0/200 = 0.98 exactly.
      state: { self: { mind: { facets: { lovePropensity: 50 }, values: { family: 87 } } }, situation: { fertileYearsLeft: 29 } },
      options: ["try", "wait", "refuse"],
    };
    const { try: tryFor, wait, refuse } = ruleDistribution(q);
    expect(tryFor).toBeCloseTo(0.98, 10);
    expect(tryFor + wait + refuse).toBeCloseTo(1, 10);
  });
});

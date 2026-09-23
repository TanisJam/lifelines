import { describe, expect, it } from "vitest";
import type { DecisionQuestion } from "./decisions";
import { computeHazard } from "./hazards";
import { OUTCOME_TIME_PRESSURE_CEILING } from "./params/demography";
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

/** A facet-typical Y1/A1 question at a given age/class/sex, with the situation's own time-in-state extra set. */
function questionWithTime(
  kind: "Y1" | "A1",
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
    options: kind === "Y1" ? ["encourage", "decline", "wait"] : ["propose", "delay", "end-it"],
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
    const q = questionWithTime("Y1", 18, "villein", "f", { yearsMarriageable: 0 });
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

  it("years already past the class/sex onset age also add pressure, even at yearsMarriageable=0 (a late-starting eligibility)", () => {
    const atOnset = ruleDistribution(questionWithTime("Y1", 18, "villein", "f", { yearsMarriageable: 0 })).encourage;
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

import { describe, expect, it } from "vitest";
import type { DecisionQuestion } from "./decisions";
import { ruleDistribution } from "./rule-heuristics";

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

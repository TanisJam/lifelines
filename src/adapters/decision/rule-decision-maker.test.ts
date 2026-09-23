import { describe, expect, it } from "vitest";
import type { DecisionQuestion, PersonYearBatch } from "@/domain/decisions";
import { RuleDecisionMaker } from "./rule-decision-maker";

function question(kind: DecisionQuestion["kind"], overrides: Partial<DecisionQuestion["state"]> = {}): DecisionQuestion {
  return {
    id: `${kind}:p1#1.1`,
    kind,
    personId: "p1",
    year: 1330,
    state: { self: { age: 20, sex: "f", socialClass: "villein" }, situation: { code: kind }, ...overrides },
    options: ["a", "b"],
  };
}

function batch(situations: PersonYearBatch["situations"], isProtagonist = false): PersonYearBatch {
  return { personId: "p1", year: 1330, self: {}, situations, isProtagonist };
}

describe("PR6: RuleDecisionMaker.decideYear returns absolute hazards as selection (design decision 4, task 6.9)", () => {
  it("a hazard-bearing kind's selection value comes from hazards.ts, not a flat relative weight", async () => {
    const maker = new RuleDecisionMaker();
    const y1 = question("Y1");
    const result = await maker.decideYear(batch({ y1: { kind: "Y1", question: y1 } }));
    // Newly-eligible villein woman at age 20 (onset 18): logistic ramp near full, base 0.30, D(0)=1 —
    // well under the old flat 0.85, proving this ISN'T the pre-PR6 relative weight anymore.
    expect(result.selection.y1).toBeGreaterThan(0);
    expect(result.selection.y1).toBeLessThan(0.5);
  });

  it("selection sums to 1 including the 'nothing' residual for a non-protagonist batch (task 6.3 competing risk)", async () => {
    const maker = new RuleDecisionMaker();
    const y1 = question("Y1");
    const y3 = question("Y3");
    const result = await maker.decideYear(batch({ y1: { kind: "Y1", question: y1 }, y3: { kind: "Y3", question: y3 } }));
    const total = Object.values(result.selection).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 10);
    expect(result.selection.nothing).toBeDefined();
  });

  it("rescales proportionally and leaves exactly a 0.05 residual when raw hazards would sum over 0.95", async () => {
    const maker = new RuleDecisionMaker();
    // Several "Other"-kind candidates (flat OTHER_KIND_BASE_HAZARD each) pile up past 0.95.
    const kinds = ["A6", "A8", "A11", "C2", "O2", "O4", "C1", "C4", "Y2", "Y5", "A4", "A7"] as const;
    const situations = Object.fromEntries(kinds.map((kind) => [kind, { kind, question: question(kind) }])) as PersonYearBatch["situations"];
    const result = await maker.decideYear(batch(situations));
    const total = Object.values(result.selection).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 10);
    expect(result.selection.nothing).toBeCloseTo(0.05, 5);
  });

  it("the protagonist gets 'everyday' as the residual, never 'nothing'", async () => {
    const maker = new RuleDecisionMaker();
    const y1 = question("Y1");
    const d1 = question("D1");
    const result = await maker.decideYear(batch({ y1: { kind: "Y1", question: y1 }, d1: { kind: "D1", question: d1 } }, true));
    expect(result.selection.nothing).toBeUndefined();
    expect(result.selection.everyday).toBeDefined();
    const total = Object.values(result.selection).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 10);
  });

  it("is deterministic: the same batch produces the exact same selection every time", async () => {
    const maker = new RuleDecisionMaker();
    const situations: PersonYearBatch["situations"] = { y1: { kind: "Y1", question: question("Y1") }, a2: { kind: "A2", question: question("A2") } };
    const first = await maker.decideYear(batch(situations));
    const second = await maker.decideYear(batch(situations));
    expect(first.selection).toEqual(second.selection);
  });

  it("reports hazard lookup fallbacks via getStats() (task 6.8)", async () => {
    const maker = new RuleDecisionMaker();
    // An unrecognized socialClass forces the marriage-floor lookup to fall back.
    const y1 = question("Y1", { self: { age: 20, sex: "f", socialClass: "not-a-real-class" } });
    await maker.decideYear(batch({ y1: { kind: "Y1", question: y1 } }));
    const stats = maker.getStats();
    expect(stats.hazardFallbacks).toBeDefined();
    expect(Object.keys(stats.hazardFallbacks!).length).toBeGreaterThan(0);
  });
});

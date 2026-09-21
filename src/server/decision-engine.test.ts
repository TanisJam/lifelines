import { describe, expect, it } from "vitest";
import { RuleDecisionMaker } from "@/adapters/decision/rule-decision-maker";
import type { DecisionMaker, DecisionMakerStats, DecisionQuestion, Distribution, PersonYearBatch, PersonYearResult } from "@/domain/decisions";
import { normalizeDistribution } from "@/domain/rng";
import { simulate } from "@/domain/simulate";
import { generateWorld } from "@/domain/worldgen";
import { decisionMakerRunStats, snapshotDecisionMakerStats } from "./decision-engine";

/**
 * A `decideYear`-capable fake shaped like `JevDecisionMaker`'s real usage tracking (`calls`,
 * `questions`, `inputTokens`) so `decisionMakerRunStats`'s delta math can be exercised through real
 * `simulate()` runs, not just synthetic counters — round 12, decision 045.
 */
class FakeUsageTrackingDecisionMaker implements DecisionMaker {
  private calls = 0;
  private questions = 0;
  private inputTokens = 0;

  async decide(question: DecisionQuestion): Promise<Distribution> {
    this.calls += 1;
    this.questions += 1;
    this.inputTokens += 50;
    return normalizeDistribution(Object.fromEntries(question.options.map((o) => [o, 1])));
  }

  async decideYear(batch: PersonYearBatch): Promise<PersonYearResult> {
    this.calls += 1;
    const ids = Object.keys(batch.situations);
    this.questions += ids.length + (ids.length > 0 ? 1 : 0); // one `resp:<id>` per situation, plus one `pick`
    this.inputTokens += 80 + ids.length * 20;

    const response: Record<string, Distribution> = {};
    const selection: Record<string, number> = {};
    for (const [id, situation] of Object.entries(batch.situations)) {
      response[id] = normalizeDistribution(Object.fromEntries(situation.question.options.map((o) => [o, 1])));
      selection[id] = 0.85;
    }
    if (!batch.isProtagonist && ids.length > 0) selection.nothing = 0.5;
    return { selection, response };
  }

  getStats(): DecisionMakerStats {
    return { calls: this.calls, cacheHits: 0, wallTimeMs: 0, inputTokens: this.inputTokens, questions: this.questions };
  }
}

describe("per-life Jev usage stats (decision 045) — a before/after delta, never the adapter's raw cumulative counters", () => {
  it("computes the exact delta between two snapshots on a synthetic run", () => {
    const maker = new FakeUsageTrackingDecisionMaker();

    const before = snapshotDecisionMakerStats(maker);
    // No calls made yet — the delta against itself must be all zero.
    expect(decisionMakerRunStats(maker, before)).toEqual({ cacheHits: 0, jevRequests: 0, jevQuestions: 0, inputTokens: 0, estimatedUsd: 0 });
  });

  it("estimatedUsd is inputTokens * 0.042 / 1_000_000", async () => {
    const maker = new FakeUsageTrackingDecisionMaker();
    const before = snapshotDecisionMakerStats(maker);
    await maker.decide({ id: "q1", kind: "Y1", personId: "p1", year: 1500, state: {}, options: ["encourage", "decline"] });
    const stats = decisionMakerRunStats(maker, before);
    expect(stats.inputTokens).toBe(50);
    expect(stats.estimatedUsd).toBeCloseTo((50 * 0.042) / 1_000_000);
  });

  it("two simulate() runs sharing the SAME DecisionMaker instance (the real process-wide singleton pattern) get independent, non-cumulative stats", async () => {
    const maker = new FakeUsageTrackingDecisionMaker();

    // "Life 1": a normal-sized world across many years.
    const world1 = generateWorld({ seed: "usage-life-1", startYear: 1500, endYear: 1540, founderCount: 12, protagonist: { name: "Ada", sex: "f" } });
    const before1 = snapshotDecisionMakerStats(maker);
    await simulate(world1.config, world1.people, world1.events, { decisionMaker: maker, engineSource: "jev", protagonistId: "protagonist" });
    const life1 = decisionMakerRunStats(maker, before1);

    expect(life1.jevRequests).toBeGreaterThan(0);
    expect(life1.jevQuestions).toBeGreaterThan(0);
    expect(life1.inputTokens).toBeGreaterThan(0);

    // "Life 2": a deliberately tiny, short-lived world on the SAME adapter instance.
    const world2 = generateWorld({ seed: "usage-life-2", startYear: 1500, endYear: 1501, founderCount: 4, protagonist: { name: "Bo", sex: "m" } });
    const before2 = snapshotDecisionMakerStats(maker);
    await simulate(world2.config, world2.people, world2.events, { decisionMaker: maker, engineSource: "jev", protagonistId: "protagonist" });
    const life2 = decisionMakerRunStats(maker, before2);

    // If life 2's numbers were read straight off the adapter's cumulative `getStats()` instead of a
    // delta, they could only be >= life 1's (the counters never go down) — a tiny one-year world
    // must report FEWER requests than the much larger 40-year one to prove the delta is real.
    expect(life2.jevRequests!).toBeGreaterThan(0);
    expect(life2.jevRequests!).toBeLessThan(life1.jevRequests!);
    expect(life2.inputTokens!).toBeLessThan(life1.inputTokens!);

    // The raw adapter counters, for contrast, ARE cumulative across both runs.
    const rawStats = maker.getStats();
    expect(rawStats.calls).toBe(before2!.calls + life2.jevRequests!);
    expect(rawStats.calls).toBeGreaterThan(life1.jevRequests! + life2.jevRequests! - 1); // sanity: grew across both runs
  });

  it("degrades gracefully for an adapter with no getStats() at all", () => {
    const bare: DecisionMaker = { decide: async () => ({}) };
    const before = snapshotDecisionMakerStats(bare);
    expect(before).toBeUndefined();
    expect(decisionMakerRunStats(bare, before)).toEqual({ cacheHits: 0 });
  });

  it("RuleDecisionMaker (no per-request token tracking) still reports a request-count delta, with token fields left undefined", async () => {
    const maker = new RuleDecisionMaker();
    const world = generateWorld({ seed: "usage-rules", startYear: 1500, endYear: 1510, founderCount: 6, protagonist: { name: "Cy", sex: "m" } });
    const before = snapshotDecisionMakerStats(maker);
    await simulate(world.config, world.people, world.events, { decisionMaker: maker, engineSource: "rules", protagonistId: "protagonist" });
    const stats = decisionMakerRunStats(maker, before);
    expect(stats.jevRequests).toBeGreaterThan(0);
    expect(stats.inputTokens).toBeUndefined();
    expect(stats.estimatedUsd).toBeUndefined();
  });
});

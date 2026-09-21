import { describe, expect, it } from "vitest";
import { decisionFragility, isSurprise, sampleGumbelMax } from "./rng";

describe("sampleGumbelMax", () => {
  it("is deterministic: the same distribution and key always choose the same option", () => {
    const distribution = { marry: 0.5, breakup: 0.2, continue: 0.3 };
    const a = sampleGumbelMax(distribution, "seed-1", "p001", 1520, "marry");
    const b = sampleGumbelMax(distribution, "seed-1", "p001", 1520, "marry");
    expect(a.chosen).toBe(b.chosen);
    expect(a.noise).toEqual(b.noise);
  });

  it("a different key (person, year, or kind) can choose differently, even with identical probabilities", () => {
    const distribution = { a: 0.5, b: 0.5 };
    const results = new Set<string>();
    for (let year = 1500; year < 1540; year++) {
      results.add(sampleGumbelMax(distribution, "seed-1", "p001", year, "marry").chosen);
    }
    // Over 40 independent keyed draws at a 50/50 split, both options should show up.
    expect(results.size).toBe(2);
  });

  it("counterfactual stability: raising the chosen option's probability never flips the outcome (for a fixed key)", () => {
    // Sweep many (seed, person, year) keys so this isn't a property of one lucky draw.
    let checked = 0;
    for (let year = 1500; year < 1600; year++) {
      const distribution = { a: 0.3, b: 0.3, c: 0.4 };
      const original = sampleGumbelMax(distribution, "stability-seed", "pX", year, "career-change");

      // Raise the chosen option's probability, holding the noise key fixed (same seed/person/year/kind)
      // so the same noise draws apply — only the input distribution changes.
      const boosted = { ...distribution, [original.chosen]: 0.9 };
      const after = sampleGumbelMax(boosted, "stability-seed", "pX", year, "career-change");

      expect(after.chosen).toBe(original.chosen);
      checked += 1;
    }
    expect(checked).toBe(100);
  });

  it("throws on an empty distribution", () => {
    expect(() => sampleGumbelMax({}, "seed", "p001", 1500, "move")).toThrow();
  });
});

describe("decisionFragility", () => {
  it("is small when the top two Gumbel scores are close together", () => {
    const scores = { a: 1.05, b: 1.0, c: -3 };
    expect(decisionFragility(scores)).toBeCloseTo(0.05, 10);
  });

  it("is large when the winner clearly outscored the runner-up", () => {
    const scores = { a: 5, b: 0.1 };
    expect(decisionFragility(scores)).toBeCloseTo(4.9, 10);
  });

  it("returns the not-fragile sentinel for a single-option distribution (nothing could have flipped it)", () => {
    expect(decisionFragility({ a: 1 })).toBeGreaterThan(100);
  });

  it("a low-probability option that won by a wide Gumbel-score margin is NOT fragile, even though it is a surprise", () => {
    // This is exactly the round-3 bug: a 1%-vs-99% split where the 1% won
    // should read as a long shot, not a close call, if its score win was decisive.
    const distribution = { rare: 0.01, common: 0.99 };
    // Simulate the rare option winning by a wide score margin (e.g. from a large noise draw).
    const scores = { rare: 3.0, common: -4.6 }; // log(0.01) + big noise vs log(0.99) + small noise
    expect(decisionFragility(scores)).toBeGreaterThan(1);
    expect(isSurprise(distribution, "rare")).toBe(true);
  });
});

describe("isSurprise", () => {
  it("is true when the chosen option's own probability is below the threshold", () => {
    expect(isSurprise<"a" | "b">({ a: 0.1, b: 0.9 }, "a")).toBe(true);
  });

  it("is false for a favorite winning", () => {
    expect(isSurprise<"a" | "b">({ a: 0.8, b: 0.2 }, "a")).toBe(false);
  });

  it("respects a custom threshold", () => {
    expect(isSurprise<"a" | "b">({ a: 0.25, b: 0.75 }, "a", 0.3)).toBe(true);
    expect(isSurprise<"a" | "b">({ a: 0.25, b: 0.75 }, "a", 0.2)).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { addMemory, applyCoreMemoryShift, createMind, decayMindForYear, pushThought, traitWords, updateRelationship } from "./mind";

describe("mind creation", () => {
  it("is deterministic for the same seed/person/year", () => {
    const a = createMind("seed-1", "p001", 1500);
    const b = createMind("seed-1", "p001", 1500);
    expect(a).toEqual(b);
  });

  it("children inherit a noisy blend of their parents' facets and values, not a fresh random draw", () => {
    const mother = createMind("seed-1", "p001", 1470);
    const father = createMind("seed-1", "p002", 1468);
    const child = createMind("seed-1", "child-p001-1500", 1500, [mother, father]);
    const strangerChild = createMind("different-seed", "unrelated-999", 1500);

    // A child's facets should, on average, sit closer to the parents' average than a same-year stranger's would.
    const parentAvg = (facet: keyof typeof mother.facets) => (mother.facets[facet] + father.facets[facet]) / 2;
    let childDist = 0;
    let strangerDist = 0;
    for (const facet of Object.keys(mother.facets) as (keyof typeof mother.facets)[]) {
      childDist += Math.abs(child.facets[facet] - parentAvg(facet));
      strangerDist += Math.abs(strangerChild.facets[facet] - parentAvg(facet));
    }
    expect(childDist).toBeLessThan(strangerDist);
  });
});

describe("pushThought / decayMindForYear", () => {
  it("a thought's yearsLeft decays by 1 each year and it expires at 0", () => {
    const mind = createMind("seed-1", "p001", 1500);
    pushThought(mind, "joy", "married Mira", 80, 3, 1520);
    expect(mind.thoughts).toHaveLength(1);
    expect(mind.thoughts[0]!.yearsLeft).toBe(3);

    decayMindForYear(mind);
    expect(mind.thoughts[0]!.yearsLeft).toBe(2);
    decayMindForYear(mind);
    expect(mind.thoughts[0]!.yearsLeft).toBe(1);
    decayMindForYear(mind);
    expect(mind.thoughts).toHaveLength(0); // expired at 0
  });

  it("stacks an identical (emotion, cause) thought with diminishing returns instead of adding a duplicate", () => {
    const mind = createMind("seed-1", "p001", 1500);
    pushThought(mind, "grief", "the courtship ended", 50, 4, 1520);
    const firstIntensity = mind.thoughts[0]!.intensity;
    pushThought(mind, "grief", "the courtship ended", 50, 4, 1520);
    expect(mind.thoughts).toHaveLength(1); // stacked, not duplicated
    expect(mind.thoughts[0]!.intensity).toBeGreaterThan(firstIntensity); // some increase
  });
});

describe("addMemory / applyCoreMemoryShift", () => {
  it("promotes a memory to core roughly 1 in 3 times, deterministically per (seed, personId, slot)", () => {
    const mind = createMind("seed-1", "p001", 1500);
    // Same seed/personId/year/slot always gives the same core decision.
    const coreA = addMemory("seed-1", "p001", 1520, mind, "text", "joy");
    const mind2 = createMind("seed-1", "p001", 1500);
    const coreB = addMemory("seed-1", "p001", 1520, mind2, "text", "joy");
    expect(coreA).toBe(coreB);
  });

  it("a core memory shifts the targeted facet by 2-5 in the given direction — the only way the mind rewrites itself", () => {
    const mind = createMind("seed-1", "p001", 1500);
    const before = mind.facets.trust;
    applyCoreMemoryShift("seed-1", "p001", 1520, mind, "trust", 1);
    expect(mind.facets.trust).toBeGreaterThan(before);
    expect(mind.facets.trust - before).toBeGreaterThanOrEqual(2);
    expect(mind.facets.trust - before).toBeLessThanOrEqual(5);

    const before2 = mind.facets.trust;
    applyCoreMemoryShift("seed-1", "p001", 1521, mind, "trust", -1);
    expect(mind.facets.trust).toBeLessThan(before2);
  });

  it("caps memories at 5, dropping a non-core one before ever dropping a core one", () => {
    const mind = createMind("seed-1", "p001", 1500);
    // Force enough memories to overflow, some of which will land core via the seeded roll.
    for (let i = 0; i < 8; i++) addMemory("seed-1", "p001", 1500 + i, mind, `memory ${i}`, "joy");
    expect(mind.memories.length).toBeLessThanOrEqual(5);
  });
});

describe("updateRelationship", () => {
  it("moves strength toward friend/grudge based on interaction and value compatibility", () => {
    const mind = createMind("seed-1", "p001", 1500);
    const compatibleValues = { ...mind.values }; // identical values -> maximal compatibility
    updateRelationship(mind, "p002", compatibleValues, 20);
    const rel = mind.relationships.find((r) => r.personId === "p002");
    expect(rel).toBeDefined();
    expect(rel!.strength).toBeGreaterThan(20); // interaction + compatibility bonus
  });

  it("value differences push a relationship toward a grudge even with a nominally positive interaction", () => {
    const mind = createMind("seed-1", "p001", 1500);
    const clashingValues = Object.fromEntries(Object.entries(mind.values).map(([k, v]) => [k, -(v as number)])) as typeof mind.values;
    updateRelationship(mind, "p003", clashingValues, 5, "friend");
    const rel = mind.relationships.find((r) => r.personId === "p003");
    expect(rel).toBeDefined();
    // Repeated negative-compatibility interactions should trend the strength down over time.
    for (let i = 0; i < 5; i++) updateRelationship(mind, "p003", clashingValues, -5);
    expect(mind.relationships.find((r) => r.personId === "p003")!.strength).toBeLessThan(0);
  });

  it("keeps only the top 5 relationships by absolute strength", () => {
    const mind = createMind("seed-1", "p001", 1500);
    for (let i = 0; i < 8; i++) updateRelationship(mind, `p${100 + i}`, undefined, 10 + i);
    expect(mind.relationships.length).toBeLessThanOrEqual(5);
  });
});

describe("round 5 fix: traitWords can never contain an opposite pair (decision 024)", () => {
  // The bug the coordinator caught ("cautious, reckless" together on a person page) came from
  // the OLD `Person.traits` field — three independently-random picks from one flat pool with no
  // notion of opposites. `traitWords` replaces it, deriving words from the SAME low/high band of
  // each facet/value that `renderPortrait` uses, so a facet can contribute at most one word.
  const OPPOSITE_PAIRS: readonly (readonly [string, string])[] = [
    ["cautious", "bold"],
    ["unshakable", "anxious"],
    ["even-tempered", "hot-tempered"],
    ["guarded", "romantic"],
    ["content", "ambitious"],
    ["generous", "greedy"],
    ["self-interested", "selfless"],
    ["reserved", "gregarious"],
    ["quick to give up", "stubborn"],
    ["wary", "trusting"],
    ["hardy", "easily worn down"],
    ["set in their ways", "curious"],
    ["aloof from kin", "family-minded"],
    ["unsentimental", "traditional"],
    ["indifferent to craft", "craftsmanlike"],
    ["unruly", "law-abiding"],
    ["dependent", "independent"],
    ["irreligious", "devout"],
    ["unmaterialistic", "acquisitive"],
  ];

  it("never returns both words of a known opposite pair, across many different minds", () => {
    for (let i = 0; i < 100; i++) {
      const mind = createMind(`seed-${i}`, `p${i}`, 1500);
      const words = new Set(traitWords(mind, 12)); // ask for more than usual to stress-test
      for (const [low, high] of OPPOSITE_PAIRS) {
        expect(words.has(low) && words.has(high)).toBe(false);
      }
    }
  });

  it("agrees with renderPortrait about which traits are the person's most extreme ones", () => {
    // Both are built from the same `extremeTraits` ranking — an unremarkable mind (all facets/values
    // artificially forced into the neutral band) should produce an empty traits list and the portrait's
    // generic fallback line, never a mismatched pair of the two.
    const mind = createMind("seed-1", "p001", 1500);
    for (const facet of Object.keys(mind.facets) as (keyof typeof mind.facets)[]) mind.facets[facet] = 50;
    for (const value of Object.keys(mind.values) as (keyof typeof mind.values)[]) mind.values[value] = 0;
    expect(traitWords(mind)).toEqual([]);
  });
});

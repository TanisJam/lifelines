import { describe, expect, it } from "vitest";
import { decisionCacheKey, stableStringify } from "./cache";

describe("stableStringify", () => {
  it("produces the same string regardless of key insertion order", () => {
    const a = { b: 1, a: 2, nested: { y: 1, x: 2 } };
    const b = { a: 2, nested: { x: 2, y: 1 }, b: 1 };
    expect(stableStringify(a)).toBe(stableStringify(b));
  });

  it("distinguishes different values", () => {
    expect(stableStringify({ a: 1 })).not.toBe(stableStringify({ a: 2 }));
  });
});

describe("decisionCacheKey", () => {
  const state = { self: { name: "Alice", age: 24, traits: ["romantic"] }, partner: { name: "Bob", age: 26 }, year: 1524 };

  it("is stable for the same question id and state, key order notwithstanding", () => {
    const stateReordered = { partner: state.partner, year: state.year, self: state.self };
    expect(decisionCacheKey("marry:p001::p002:1524", state)).toBe(decisionCacheKey("marry:p001::p002:1524", stateReordered));
  });

  it("changes when the question id changes, even with identical state", () => {
    expect(decisionCacheKey("marry:p001::p002:1524", state)).not.toBe(decisionCacheKey("marry:p001::p003:1524", state));
  });

  it("changes when only the relevant state changes (e.g. a trait), so an edit invalidates only affected decisions", () => {
    const changedState = { ...state, self: { ...state.self, traits: ["cautious"] } };
    expect(decisionCacheKey("marry:p001::p002:1524", state)).not.toBe(decisionCacheKey("marry:p001::p002:1524", changedState));
  });

  it("does NOT change for a question about a different, unrelated pair with unrelated state — cache keys are scoped per-decision, not global", () => {
    const unrelatedQuestionId = "marry:p010::p011:1524";
    const unrelatedState = { self: { name: "Carol", age: 30 }, partner: { name: "Dan", age: 31 }, year: 1524 };
    const key1 = decisionCacheKey("marry:p001::p002:1524", state);
    const key2 = decisionCacheKey(unrelatedQuestionId, unrelatedState);
    expect(key1).not.toBe(key2);
    // And re-deriving the original key again (as a re-simulation would) still matches.
    expect(decisionCacheKey("marry:p001::p002:1524", state)).toBe(key1);
  });
});

describe("decisionCacheKey with a round-4 PersonMind state", () => {
  // A realistic round-4 state shape: self.mind is now part of what's hashed
  // (round 4 requirement: "the cache key must include everything in the Jev
  // state; the mind is now in it").
  const mindState = {
    self: {
      name: "Mira Stonebrook",
      age: 30,
      job: "healer",
      mind: {
        facets: { bravery: 40, anxiety: 60, anger: 30, lovePropensity: 70, ambition: 55, greed: 20, altruism: 65, gregariousness: 50, perseverance: 45, trust: 60, stressVulnerability: 35, curiosity: 50 },
        values: { family: 30, tradition: -10, craft: 5, law: 0, independence: 15, faith: -5, wealth: -20 },
        dream: { goal: "master a craft", status: "pursuing" },
        needs: ["companionship (40% met)"],
        mood: 10,
        stress: 25,
        thoughts: ["hope: began courting Cedric"],
        memories: ["began courting Cedric in 1520"],
        relationshipSummary: { friends: 1, grudges: 0 },
      },
      portrait: "Mira is always in love with somebody, and holds family above all.",
    },
    situation: { code: "A1", question: "We have been courting a while now. Do I propose?" },
    town: "Oakhaven",
    year: 1524,
  };

  it("is stable across two structurally-identical mind states, even with different key insertion order", () => {
    const reordered = {
      ...mindState,
      self: {
        ...mindState.self,
        mind: {
          ...mindState.self.mind,
          values: { wealth: -20, faith: -5, independence: 15, law: 0, craft: 5, tradition: -10, family: 30 },
          facets: { curiosity: 50, stressVulnerability: 35, trust: 60, perseverance: 45, gregariousness: 50, altruism: 65, greed: 20, ambition: 55, lovePropensity: 70, anger: 30, anxiety: 60, bravery: 40 },
        },
      },
    };
    expect(decisionCacheKey("A1:p001::p002:1524", mindState)).toBe(decisionCacheKey("A1:p001::p002:1524", reordered));
  });

  it("changes when a single mind field changes (e.g. stress after a bad year) — the mind is genuinely part of the key", () => {
    const stressedState = { ...mindState, self: { ...mindState.self, mind: { ...mindState.self.mind, stress: 80 } } };
    expect(decisionCacheKey("A1:p001::p002:1524", mindState)).not.toBe(decisionCacheKey("A1:p001::p002:1524", stressedState));
  });

  it("changes when a memory or thought is added, even if facets/values are untouched", () => {
    const newMemoryState = { ...mindState, self: { ...mindState.self, mind: { ...mindState.self.mind, memories: [...mindState.self.mind.memories, "a new memory"] } } };
    expect(decisionCacheKey("A1:p001::p002:1524", mindState)).not.toBe(decisionCacheKey("A1:p001::p002:1524", newMemoryState));
  });
});

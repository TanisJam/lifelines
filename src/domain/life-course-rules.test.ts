import { describe, expect, it } from "vitest";
import { biologyDistribution } from "./life-course-rules";
import { sampleGumbelMax } from "./rng";

const cases = [
  ["illness", "illness", "healthy"],
  ["death", "die", "survive"],
  ["return", "return", "stay"],
  ["arranged-match", "arrange", "no-match"],
  ["levy", "impose", "spare"],
  ["immigration", "arrive", "no-arrival"],
  ["away-arrival", "arrive", "no-arrival"],
  ["unknown-kind", "arrive", "no-arrival"],
  ["", "arrive", "no-arrival"],
] as const;
const probabilities = [0, 0.1, 0.125, 0.3, 1, -0, -0.25, 1.25, NaN, Infinity, -Infinity];

// Manual ordered expectations retain the legacy mapping without importing simulator internals.
function expectedDistribution(first: string, second: string, p: number) {
  return { [first]: p, [second]: 1 - p };
}

describe("biologyDistribution", () => {
  describe.each(cases)("%s", (kind, first, second) => {
    it.each(probabilities)("preserves ordered keys and exact arithmetic for p=%s", (p) => {
      const actual = biologyDistribution(kind, p);
      expect(Object.keys(actual)).toEqual([first, second]);
      expect(actual[first]).toBe(p);
      expect(actual[second]).toBe(1 - p);
      expect(actual).toEqual(expectedDistribution(first, second, p));
    });

    it("returns fresh records with detached mutations", () => {
      const original = biologyDistribution(kind, 0.3);
      const next = biologyDistribution(kind, 0.3);
      expect(next).not.toBe(original);
      const mutable = original as Record<string, number>;
      mutable[first] = 99;
      mutable.extra = 1;
      expect(next).toEqual(expectedDistribution(first, second, 0.3));
      expect(biologyDistribution(kind, 0.3)).toEqual(next);
    });

    it.each([0, 0.1, 0.125, 0.3, 1])("preserves seeded legacy sampling for p=%s", (p) => {
      const contexts = [
        ["life-course-a", "person-1", 1327],
        ["life-course-b", "protagonist", 1348],
        ["life-course-a", "immigrant-1350", 1350],
      ] as const;
      for (const [seed, personId, year] of contexts) {
        const legacy = sampleGumbelMax(expectedDistribution(first, second, p), seed, personId, year, kind);
        const extracted = sampleGumbelMax(biologyDistribution(kind, p), seed, personId, year, kind);
        expect(extracted.chosen).toBe(legacy.chosen);
        expect(extracted.noise).toEqual(legacy.noise);
        expect(extracted.scores).toEqual(legacy.scores);
        expect(Object.keys(extracted.noise)).toEqual([first, second]);
        expect(Object.keys(extracted.scores)).toEqual([first, second]);
      }
    });
  });
});

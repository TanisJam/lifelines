import { describe, expect, it } from "vitest";
import { VIGNETTES } from "./vignettes";

/**
 * Decision 059: every vignette's `title`/`question`/outcome `prose` must render something in both
 * locales, and the Spanish rendering must actually differ from the English one — a cheap parity
 * check against a vignette gaining a locale branch that silently falls through to English (a
 * missing `t()` call, a typo in an `es` string equal to its `en` counterpart, etc).
 */
describe("decision 059: vignette locale parity", () => {
  const townName = "Ravenford";

  it("every vignette's title renders non-empty, distinct EN/ES text", () => {
    for (const vignette of VIGNETTES) {
      const en = vignette.title("en", townName);
      const es = vignette.title("es", townName);
      expect(en.length).toBeGreaterThan(0);
      expect(es.length).toBeGreaterThan(0);
      expect(es).not.toBe(en);
    }
  });

  it("every vignette's question renders non-empty, distinct EN/ES text", () => {
    for (const vignette of VIGNETTES) {
      const en = vignette.question("en", townName);
      const es = vignette.question("es", townName);
      expect(en.length).toBeGreaterThan(0);
      expect(es.length).toBeGreaterThan(0);
      expect(es).not.toBe(en);
    }
  });

  it("every outcome's prose renders non-empty, distinct EN/ES text, deterministically", () => {
    for (const vignette of VIGNETTES) {
      for (const outcome of Object.values(vignette.outcomes)) {
        const en = outcome.prose("en", "Elin", townName);
        const es = outcome.prose("es", "Elin", townName);
        expect(en.length).toBeGreaterThan(0);
        expect(es.length).toBeGreaterThan(0);
        expect(es).not.toBe(en);
        expect(outcome.prose("es", "Elin", townName)).toBe(es);
      }
    }
  });

  it("optionDescription (Jev-facing) stays English regardless of locale — it takes no locale argument at all", () => {
    for (const vignette of VIGNETTES) {
      for (const outcome of Object.values(vignette.outcomes)) {
        expect(typeof outcome.optionDescription).toBe("string");
        expect(outcome.optionDescription.length).toBeGreaterThan(0);
      }
    }
  });
});

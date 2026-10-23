import { describe, expect, it } from "vitest";
import { VIGNETTES, vignetteOccurrence, vignetteVariant } from "./vignettes";

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

/**
 * `odd/tasks/chronicle-variation.md` S2/S5. A variant may never be picked from anything but
 * `(seed, vignette id, year)`: if the selection path and a read path could disagree, the same
 * event would be titled differently in the chronicle and in a person sheet, and the "no repeated
 * title" promise would be unreproducible.
 */
describe("chronicle variation — deterministic variants", () => {
  const townName = "Ravenford";

  it("walks 0, 1, 2… so N occurrences use N distinct phrasings, cycling past the end", () => {
    expect(vignetteVariant(0, 3)).toBe(0);
    expect(vignetteVariant(1, 3)).toBe(1);
    expect(vignetteVariant(2, 3)).toBe(2);
    expect(vignetteVariant(3, 3)).toBe(0);
    expect(vignetteVariant(0, 1)).toBe(0);
    expect(vignetteVariant(9, 1)).toBe(0);
  });

  it("counts earlier occurrences of the same vignette in (year, id) order, and only that vignette", () => {
    const make = (id: string, year: number, vignette: string) =>
      ({ id, year, kind: "vignette", actors: ["protagonist"], payload: { vignette, outcome: "x" } }) as never;
    const events = [
      make("a", 1340, "feast-day"),
      make("b", 1341, "market-day"),
      make("c", 1343, "feast-day"),
      make("d", 1343, "feast-day"),
    ];
    expect(vignetteOccurrence(events, events[0]!, "feast-day")).toBe(0);
    expect(vignetteOccurrence(events, events[2]!, "feast-day")).toBe(1);
    expect(vignetteOccurrence(events, events[3]!, "feast-day")).toBe(2);
    expect(vignetteOccurrence(events, events[1]!, "market-day")).toBe(0);
  });

  it("renders a distinct title and distinct EN/ES prose for every declared variant", () => {
    for (const vignette of VIGNETTES) {
      const count = vignette.variants ?? 1;
      const titles = new Set<string>();
      for (let variant = 0; variant < count; variant += 1) {
        const en = vignette.title("en", townName, variant);
        const es = vignette.title("es", townName, variant);
        expect(en.length).toBeGreaterThan(0);
        expect(es).not.toBe(en);
        expect(titles.has(en)).toBe(false);
        titles.add(en);
      }
      for (const outcome of Object.values(vignette.outcomes)) {
        const prose = new Set<string>();
        for (let variant = 0; variant < count; variant += 1) {
          const en = outcome.prose("en", "Elin", townName, variant);
          const es = outcome.prose("es", "Elin", townName, variant);
          expect(en.length).toBeGreaterThan(0);
          expect(es).not.toBe(en);
          expect(prose.has(en)).toBe(false);
          prose.add(en);
        }
      }
    }
  });
});

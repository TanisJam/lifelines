import { describe, expect, it } from "vitest";
import { locales } from "./config";
import { en } from "./dictionaries/en";
import { es } from "./dictionaries/es";
import { getDictionary } from "./get-dictionary";

/** Recursively collects every leaf path in a dictionary object (a string or a function counts as a leaf) — used to compare the two locales' key sets structurally, on top of the compile-time guarantee `Dictionary` (`dictionary.ts`) already gives. */
function leafPaths(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null) return [prefix];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => leafPaths(child, prefix ? `${prefix}.${key}` : key));
}

describe("decision 059: dictionary parity", () => {
  it("en and es expose the exact same set of keys", () => {
    const enKeys = leafPaths(en).sort();
    const esKeys = leafPaths(es).sort();
    expect(esKeys).toEqual(enKeys);
  });

  it("every leaf is a non-empty string, or a function returning a non-empty string", () => {
    for (const dict of [en, es]) {
      for (const path of leafPaths(dict)) {
        const parts = path.split(".");
        let value: unknown = dict;
        for (const part of parts) value = (value as Record<string, unknown>)[part];
        if (typeof value === "function") {
          // Every dictionary template function in this app takes only strings/numbers, so calling
          // with an empty string per parameter is enough to prove it doesn't throw and produces text.
          const result = (value as (...args: unknown[]) => string)("Ravenford", 1520, 1);
          expect(typeof result).toBe("string");
          expect(result.length).toBeGreaterThan(0);
        } else {
          expect(typeof value).toBe("string");
          expect((value as string).length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("getDictionary resolves every configured locale, and falls back to English for an unrecognized one", () => {
    for (const locale of locales) {
      expect(getDictionary(locale)).toBe(locale === "en" ? en : es);
    }
    // @ts-expect-error -- exercising the runtime fallback for a value outside the `Locale` union (e.g. a malformed `?lang=` or an old bookmark).
    expect(getDictionary("fr")).toBe(en);
  });
});

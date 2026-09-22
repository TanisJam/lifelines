import { describe, expect, it } from "vitest";
import { questionText } from "./simulate";

/**
 * Decision 059 ("the display half of `questionText()`"): every real call site inside `simulate.ts`
 * passes `"en"` explicitly and always will (see that function's own comment — the string is both
 * Jev-facing and persisted, so it can't be re-localized per viewer the way `narrate.ts`'s prose can).
 * This test exercises the Spanish branch directly, since nothing in the running app reaches it yet.
 */
describe("decision 059: questionText locale support", () => {
  it("renders distinct English and Spanish text for a representative set of decision kinds", () => {
    const kinds: readonly [string, string | undefined][] = [
      ["Y1", "Tomas"],
      ["A2", undefined],
      ["C2", "Mother"],
      ["illness", undefined],
      ["levy", undefined],
    ];
    for (const [kind, otherName] of kinds) {
      const en = questionText("en", kind, otherName, "Ravenford");
      const es = questionText("es", kind, otherName, "Ravenford");
      expect(en.length).toBeGreaterThan(0);
      expect(es.length).toBeGreaterThan(0);
      expect(es).not.toBe(en);
    }
  });

  it("falls back to a labeled default for an unknown kind, in both locales", () => {
    expect(questionText("en", "not-a-real-kind")).toContain("not-a-real-kind");
    expect(questionText("es", "not-a-real-kind")).toContain("not-a-real-kind");
  });
});

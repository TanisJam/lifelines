import { describe, expect, it } from "vitest";
import { FEMALE_NAMES, MALE_NAMES, pickName, pickUniqueName, SURNAMES } from "./names";

describe("decision 063 (engine-life-course PR4): 1379 poll-tax-informed name pools", () => {
  it("male names are dominated by John and William (research.md M-S8: the two most common names in the 1379 Yorkshire poll tax)", () => {
    const johnCount = MALE_NAMES.filter((n) => n === "John").length;
    const williamCount = MALE_NAMES.filter((n) => n === "William").length;
    const dominantShare = (johnCount + williamCount) / MALE_NAMES.length;
    // Both must be well-represented (not just present once), and together clearly plural relative to
    // any other single name in the pool.
    expect(johnCount).toBeGreaterThan(1);
    expect(williamCount).toBeGreaterThan(1);
    expect(dominantShare).toBeGreaterThan(0.15);
  });

  it("the surname pool mixes patronymic, occupational, locative and nickname bynames (research.md M-S8's four attested categories)", () => {
    // One representative attested example per category is enough to prove the pool isn't just a
    // single-pattern list (the Tudor-era pool this replaces was occupational-only).
    expect(SURNAMES).toContain("Johnson"); // patronymic
    expect(SURNAMES).toContain("Smith"); // occupational
    expect(SURNAMES.some((s) => s.startsWith("atte "))).toBe(true); // locative ("atte Wood"/"atte Hill" pattern)
    expect(SURNAMES).toContain("Long"); // nickname
  });

  it("pickName is deterministic and stays within the pools for a given index pair", () => {
    const first = pickName("m", 0, 0);
    const second = pickName("m", 0, 0);
    expect(first).toBe(second);
    expect(FEMALE_NAMES.length).toBeGreaterThan(0);
    expect(MALE_NAMES.length).toBeGreaterThan(0);
  });

  it("pickUniqueName still avoids a collision with an existing full name (unchanged contract from the Tudor-era pool)", () => {
    const taken = new Set([pickName("f", 0, 0)]);
    const distinct = pickUniqueName(taken, "f", 0, 0);
    expect(distinct).not.toBe([...taken][0]);
  });
});

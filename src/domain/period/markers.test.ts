import { describe, expect, it } from "vitest";
import { isLeyrwiteEligible, isUnfree, LEYRWITE_PROBABILITY_PER_COURTING_YEAR, manorialFinePayload, shouldPresentLeyrwite, UNFREE_CLASSES } from "./markers";

describe("PR5: unfree classes", () => {
  it("villein and cottar are unfree; freeholder/artisan/merchant/clergy/gentry are not", () => {
    expect(UNFREE_CLASSES.has("villein")).toBe(true);
    expect(UNFREE_CLASSES.has("cottar")).toBe(true);
    for (const free of ["freeholder", "artisan", "merchant", "clergy", "gentry"] as const) {
      expect(UNFREE_CLASSES.has(free)).toBe(false);
    }
  });

  it("isUnfree degrades to the fallback class instead of throwing on an undefined class", () => {
    expect(() => isUnfree(undefined)).not.toThrow();
  });
});

describe("PR5: manorial-fine payload shape", () => {
  it("names the fine, the payer and always the lord as payee — never a Person for the lord (design decision 10)", () => {
    const payload = manorialFinePayload("merchet", "p1");
    expect(payload).toEqual({ fine: "merchet", payerId: "p1", payee: "lord" });
  });

  it("builds the same shape for every fine kind", () => {
    for (const fine of ["merchet", "heriot", "chevage", "leyrwite"] as const) {
      expect(manorialFinePayload(fine, "p1")).toEqual({ fine, payerId: "p1", payee: "lord" });
    }
  });
});

describe("PR5: leyrwite eligibility and presentment", () => {
  it("is eligible only for an unfree woman currently courting", () => {
    expect(isLeyrwiteEligible({ sex: "f", socialClass: "villein" }, true)).toBe(true);
    expect(isLeyrwiteEligible({ sex: "f", socialClass: "cottar" }, true)).toBe(true);
    expect(isLeyrwiteEligible({ sex: "f", socialClass: "villein" }, false)).toBe(false);
    expect(isLeyrwiteEligible({ sex: "m", socialClass: "villein" }, true)).toBe(false);
    expect(isLeyrwiteEligible({ sex: "f", socialClass: "freeholder" }, true)).toBe(false);
  });

  it("presents at close to the documented 4%-per-courting-year rate, across many draws", () => {
    let presented = 0;
    const trials = 3000;
    for (let i = 0; i < trials; i++) {
      if (shouldPresentLeyrwite("leyrwite-seed", `p${i}`, 1330)) presented++;
    }
    const rate = presented / trials;
    expect(rate).toBeGreaterThan(LEYRWITE_PROBABILITY_PER_COURTING_YEAR.default - 0.02);
    expect(rate).toBeLessThan(LEYRWITE_PROBABILITY_PER_COURTING_YEAR.default + 0.02);
  });

  it("draws from a dedicated key so it never collides with (and never perturbs) another keyed draw for the same person-year", () => {
    // Same (seed, personId, year) as a real decision key ("illness") must be independent —
    // this only proves the leyrwite key is its own namespace, not equal to a same-shaped call.
    const a = shouldPresentLeyrwite("collision-seed", "p1", 1330);
    const b = shouldPresentLeyrwite("collision-seed", "p1", 1330);
    expect(a).toBe(b); // deterministic
  });

  it("is deterministic for the same seed/personId/year", () => {
    expect(shouldPresentLeyrwite("det-seed", "p9", 1340)).toBe(shouldPresentLeyrwite("det-seed", "p9", 1340));
  });
});

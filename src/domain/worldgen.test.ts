import { describe, expect, it } from "vitest";
import type { DecisionMaker, DecisionQuestion, Distribution } from "./decisions";
import type { SocialClass } from "./types";
import { generateWorld, JOB_POOL_BY_CLASS, resolveProtagonistSex } from "./worldgen";

/** A fake DecisionMaker that returns a fixed, name-keyed f/m distribution — never calls a real adapter. */
class FakeSexDecisionMaker implements DecisionMaker {
  constructor(private readonly byName: Record<string, Distribution>) {}
  async decide(question: DecisionQuestion): Promise<Distribution> {
    const name = (question.state.name as string).toLowerCase();
    return this.byName[name] ?? { f: 0.5, m: 0.5 };
  }
}

describe("resolveProtagonistSex", () => {
  it("almost always resolves an f-heavy name to f", async () => {
    const maker = new FakeSexDecisionMaker({ mara: { f: 0.9, m: 0.1 } });
    let fCount = 0;
    for (let i = 0; i < 20; i++) {
      const sex = await resolveProtagonistSex(maker, `seed-${i}`, "Mara", 1500);
      if (sex === "f") fCount += 1;
    }
    expect(fCount).toBeGreaterThan(15);
  });

  it("almost always resolves an m-heavy name to m", async () => {
    const maker = new FakeSexDecisionMaker({ rowan: { f: 0.1, m: 0.9 } });
    let mCount = 0;
    for (let i = 0; i < 20; i++) {
      const sex = await resolveProtagonistSex(maker, `seed-${i}`, "Rowan", 1500);
      if (sex === "m") mCount += 1;
    }
    expect(mCount).toBeGreaterThan(15);
  });

  it("is deterministic for the same seed and name", async () => {
    const maker = new FakeSexDecisionMaker({ ash: { f: 0.5, m: 0.5 } });
    const first = await resolveProtagonistSex(maker, "same-seed", "Ash", 1500);
    const second = await resolveProtagonistSex(maker, "same-seed", "Ash", 1500);
    expect(first).toBe(second);
  });
});

/** Every seed's founder cast (default `founderCount`, big enough that `singleCount > 1` so clergy is always assigned — see `assignFounderClasses`-equivalent logic in `generateWorld`). */
const SEEDS = Array.from({ length: 20 }, (_, i) => `class-seed-${i}`);

describe("decision 049: social class at worldgen", () => {
  it("assigns exactly one clergy founder per village", () => {
    for (const seed of SEEDS) {
      const { people } = generateWorld({ seed });
      const clergy = Object.values(people).filter((p) => p.founder && p.socialClass === "clergy");
      expect(clergy.length).toBe(1);
    }
  });

  it("never assigns clergy to a couple (clergy is drawn only from unattached singles)", () => {
    for (const seed of SEEDS) {
      const { people } = generateWorld({ seed });
      const clergyPerson = Object.values(people).find((p) => p.socialClass === "clergy");
      expect(clergyPerson?.spouseId).toBeUndefined();
    }
  });

  it("assigns 1-2 gentry households, a small minority of founders", () => {
    for (const seed of SEEDS) {
      const { people } = generateWorld({ seed });
      const founders = Object.values(people).filter((p) => p.founder);
      const gentryFounders = founders.filter((p) => p.socialClass === "gentry");
      expect(gentryFounders.length).toBeGreaterThanOrEqual(1);
      expect(gentryFounders.length).toBeLessThanOrEqual(4); // at most 2 households x 2 spouses
      expect(gentryFounders.length / founders.length).toBeLessThan(0.3);
    }
  });

  it("class shares across many seeds land within a generous tolerance of the sourced defaults (cottar ~25%, villein ~45% — decision 063 renamed labourer/husbandman)", () => {
    const counts: Record<SocialClass, number> = { cottar: 0, villein: 0, freeholder: 0, artisan: 0, merchant: 0, clergy: 0, gentry: 0 };
    let total = 0;
    for (const seed of SEEDS) {
      const { people } = generateWorld({ seed, founderCount: 30 });
      for (const person of Object.values(people)) {
        counts[person.socialClass ?? "cottar"] += 1;
        total += 1;
      }
    }
    expect(counts.cottar / total).toBeGreaterThan(0.12);
    expect(counts.cottar / total).toBeLessThan(0.4);
    expect(counts.villein / total).toBeGreaterThan(0.25);
    expect(counts.villein / total).toBeLessThan(0.65);
  });

  it("a founder child inherits its class from the father", () => {
    for (const seed of SEEDS) {
      const { people } = generateWorld({ seed, founderCount: 30 });
      const children = Object.values(people).filter((p) => !p.founder && p.fatherId);
      for (const child of children) {
        const father = people[child.fatherId!];
        expect(child.socialClass).toBe(father!.socialClass);
      }
    }
  });
});

describe("decision 063 (was decision 057): literacy at worldgen, period rates + lord's-licence gate", () => {
  it("literacy rates by class land within the documented c.1330 ranges, aggregated across many seeds", () => {
    const literateByClass: Record<SocialClass, { literate: number; total: number }> = {
      cottar: { literate: 0, total: 0 },
      villein: { literate: 0, total: 0 },
      freeholder: { literate: 0, total: 0 },
      artisan: { literate: 0, total: 0 },
      merchant: { literate: 0, total: 0 },
      clergy: { literate: 0, total: 0 },
      gentry: { literate: 0, total: 0 },
    };
    for (const seed of SEEDS) {
      const { people } = generateWorld({ seed, founderCount: 30 });
      for (const person of Object.values(people)) {
        const cls = person.socialClass ?? "cottar";
        literateByClass[cls].total += 1;
        if (person.literate) literateByClass[cls].literate += 1;
      }
    }
    // Cottars (was labourer): gated male base 0.04*0.3=0.012, female 0.002 — an overwhelming majority illiterate.
    expect(literateByClass.cottar.literate / literateByClass.cottar.total).toBeLessThan(0.1);
    // Clergy: "near-universal literacy (Latin literacy required for office)".
    if (literateByClass.clergy.total > 0) expect(literateByClass.clergy.literate / literateByClass.clergy.total).toBeGreaterThan(0.7);
  });
});

describe("JOB_POOL_BY_CLASS", () => {
  it("never lists 'scholar' or 'guard' (removed per decision 049) for any class", () => {
    for (const jobs of Object.values(JOB_POOL_BY_CLASS)) {
      expect(jobs).not.toContain("scholar");
      expect(jobs).not.toContain("guard");
    }
  });
});

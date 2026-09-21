import { describe, expect, it } from "vitest";
import type { DecisionMaker, DecisionQuestion, Distribution } from "./decisions";
import { resolveProtagonistSex } from "./worldgen";

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

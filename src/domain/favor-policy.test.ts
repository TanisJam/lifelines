import { describe, expect, it } from "vitest";
import { favorPolicy, selectFavorResponse, type FavorFactors } from "./favor-policy";

const neutral: FavorFactors = { openDebt: true, altruism: 50, anxiety: 50, wealthPreference: 0, trust: 0, resentment: 0 };
describe("consumed favor policy", () => {
  it("isolates debt salience without forging state; a small fixed draw corpus shows influence and both outcomes", () => {
    const debt = favorPolicy(neutral);
    const masked = favorPolicy(neutral, true);
    expect(debt.options).toEqual(["help", "refuse"]);
    expect(debt.distribution[0]).toBeCloseTo(0.6);
    expect(masked.distribution[0]).toBe(0.4);
    const draws = [0.1, 0.45, 0.55, 0.9];
    expect(draws.map((u) => selectFavorResponse(debt.factors, u))).toEqual(["help", "help", "help", "refuse"]);
    expect(draws.map((u) => selectFavorResponse(masked.factors, u))).toEqual(["help", "refuse", "refuse", "refuse"]);
    expect(neutral.openDebt).toBe(true);
  });
  it("clamps extremes but does not make either outcome certain", () => {
    expect(favorPolicy({ ...neutral, altruism: 100, anxiety: 0, wealthPreference: -50, trust: 100 }).distribution[0]).toBe(0.9);
    expect(favorPolicy({ ...neutral, openDebt: false, altruism: 0, anxiety: 100, wealthPreference: 50, trust: -100, resentment: 100 }).distribution[0]).toBe(0.1);
  });
  it.each([{ openDebt: 1 }, { altruism: "50" }, { altruism: 101 }, { anxiety: -1 }, { wealthPreference: 51 }, { trust: -101 }, { resentment: -1 }, { trust: NaN }, { extra: 1 }])("rejects invalid factors %j", (patch) => {
    expect(() => favorPolicy({ ...neutral, ...patch } as FavorFactors)).toThrow();
  });
  it.each([-1, 1, Infinity, NaN, "0.5"])("rejects invalid draw %s", (noise) => {
    expect(() => selectFavorResponse(neutral, noise as number)).toThrow();
  });
  it("rejects accessor and nonplain factors before reads", () => {
    let calls = 0;
    const bad = { ...neutral };
    Object.defineProperty(bad, "trust", { enumerable: true, get() { calls++; return 0; } });
    expect(() => favorPolicy(bad)).toThrow();
    expect(calls).toBe(0);
    expect(() => favorPolicy(Object.create(neutral))).toThrow();
    expect(favorPolicy(Object.assign(Object.create(null), neutral))).toEqual(favorPolicy(neutral));
  });
});

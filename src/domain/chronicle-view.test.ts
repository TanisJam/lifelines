import { describe, expect, it } from "vitest";
import { isRealTurn } from "./chronicle-view";

describe("round 8 fix: three event levels (decision 033)", () => {
  it("a near-certain Jev decision (chosen probability >= 90%, not fragile, not surprising) is NOT a turn", () => {
    expect(isRealTurn({ chosen: "stay", fragility: 5, surprise: false, source: "jev", final: { stay: 0.95, leave: 0.05 } })).toBe(false);
  });

  it("a genuinely contested Jev decision (chosen probability < 90%) IS a turn", () => {
    expect(isRealTurn({ chosen: "propose", fragility: 5, surprise: false, source: "jev", final: { propose: 0.6, delay: 0.3, "end-it": 0.1 } })).toBe(true);
  });

  it("a near-certain Jev decision that was still fragile or surprising IS a turn", () => {
    expect(isRealTurn({ chosen: "stay", fragility: 0.5, surprise: false, source: "jev", final: { stay: 0.95, leave: 0.05 } })).toBe(true);
    expect(isRealTurn({ chosen: "leave", fragility: 5, surprise: true, source: "jev", final: { stay: 0.95, leave: 0.05 } })).toBe(true);
  });

  it("a near-certain chance event (death/illness) with a tiny runner-up is NOT a turn — e.g. a 98%-certain survival", () => {
    expect(isRealTurn({ chosen: "survive", fragility: 5, surprise: false, source: "biology", final: { survive: 0.98, die: 0.02 } })).toBe(false);
  });

  it("a chance event with a genuinely plausible alternative (>=10%) IS a turn", () => {
    expect(isRealTurn({ chosen: "survive", fragility: 5, surprise: false, source: "biology", final: { survive: 0.85, die: 0.15 } })).toBe(true);
  });

  it("a chance event that was a surprise IS a turn even with a tiny runner-up", () => {
    expect(isRealTurn({ chosen: "die", fragility: 5, surprise: true, source: "biology", final: { survive: 0.98, die: 0.02 } })).toBe(true);
  });
});

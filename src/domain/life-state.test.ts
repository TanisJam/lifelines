import { describe, expect, it } from "vitest";
import { EMPTY_SLOTS, advanceSlot, slotKey } from "./life-state";

describe("slotKey", () => {
  it("joins kind and subject with a colon", () => {
    expect(slotKey("Y1", "protagonist")).toBe("Y1:protagonist");
  });

  it("produces a different key for a different kind or subject (no collisions)", () => {
    expect(slotKey("Y1", "protagonist")).not.toBe(slotKey("A1", "protagonist"));
    expect(slotKey("Y1", "protagonist")).not.toBe(slotKey("Y1", "p002"));
  });
});

describe("advanceSlot", () => {
  it("starts a fresh key at occurred=1, attempts=0 when the decision occurred", () => {
    const next = advanceSlot(EMPTY_SLOTS, "death:p001", true);
    expect(next["death:p001"]).toEqual({ occurred: 1, attempts: 0 });
  });

  it("starts a fresh key at occurred=0, attempts=1 when the decision was only offered, not occurred", () => {
    const next = advanceSlot(EMPTY_SLOTS, "Y1:protagonist", false);
    expect(next["Y1:protagonist"]).toEqual({ occurred: 0, attempts: 1 });
  });

  it("increments occurred and resets attempts to 0 when a later offer occurs, keeping prior attempts out of it", () => {
    const offered = advanceSlot(EMPTY_SLOTS, "Y1:protagonist", false);
    const offeredAgain = advanceSlot(offered, "Y1:protagonist", false);
    const occurred = advanceSlot(offeredAgain, "Y1:protagonist", true);
    expect(occurred["Y1:protagonist"]).toEqual({ occurred: 1, attempts: 0 });
  });

  it("keeps incrementing occurred across repeated occurrences (2nd, 3rd time)", () => {
    const first = advanceSlot(EMPTY_SLOTS, "illness:p001", true);
    const second = advanceSlot(first, "illness:p001", true);
    const third = advanceSlot(second, "illness:p001", true);
    expect(third["illness:p001"]).toEqual({ occurred: 3, attempts: 0 });
  });

  it("leaves other keys in the slot state untouched", () => {
    const withA = advanceSlot(EMPTY_SLOTS, "Y1:protagonist", true);
    const withBoth = advanceSlot(withA, "A1:protagonist", true);
    expect(withBoth["Y1:protagonist"]).toEqual({ occurred: 1, attempts: 0 });
    expect(withBoth["A1:protagonist"]).toEqual({ occurred: 1, attempts: 0 });
  });
});

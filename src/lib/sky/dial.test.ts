import { describe, expect, it } from "vitest";
import { arcPath, dialAngle, monthTapeX, odometerOffsets, plagueIntensity, rolled } from "./dial";

describe("dial", () => {
  it("maps a year to an angle starting at the top", () => {
    expect(dialAngle(1327, 1327, 45)).toBe(-90);
    expect(dialAngle(1327 + 22.5, 1327, 45)).toBe(90);
  });

  it("peaks the plague wash mid-band and is zero outside it", () => {
    const bands = [{ kind: "black-death" as const, from: 1348.5, to: 1350 }];
    expect(plagueIntensity(bands, 1340)).toBe(0);
    expect(plagueIntensity(bands, 1349.25)).toBeCloseTo(1, 9);
  });
});

describe("arcPath", () => {
  it("is empty without a sweep and flags the long way round past half a turn", () => {
    expect(arcPath(100, -90, -90)).toBe("");
    expect(arcPath(100, -90, 0)).toBe("M0.00,-100.00 A100,100 0 0 1 100.00,0.00");
    expect(arcPath(100, -90, 100)).toContain(" 0 1 1 ");
  });
});

describe("odometer", () => {
  it("holds a whole value, then rolls into the next over the last third", () => {
    expect(rolled(1350.0, 1327)).toBe(1349);
    expect(rolled(1350.33, 1327)).toBeCloseTo(1350, 6);
    expect(rolled(1327.1, 1327)).toBe(1327);
  });

  it("carries only through a run of nines", () => {
    expect(odometerOffsets(1349.5, 4)).toEqual([-1, -3, -4.5, -9.5]);
    expect(odometerOffsets(1350, 4)).toEqual([-1, -3, -5, 0]);
  });
});

describe("month tape", () => {
  it("centres the cursor on the current month", () => {
    expect(monthTapeX(1350, 800, 64)).toBe(400 - 12 * 64);
    expect(monthTapeX(1350.5, 800, 64)).toBe(400 - 18 * 64);
  });
});

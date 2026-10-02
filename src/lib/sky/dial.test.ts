import { describe, expect, it } from "vitest";
import { arcPath, dialAngle, monthTapeX, odometerOffsets, plagueIntensity, rolled, timeline } from "./dial";
import { TYPE_FAST, TYPE_TITLE } from "./typewriter";

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

describe("timeline end", () => {
  const scene = { people: [], edges: [], village: [], bands: [], span: { start: 1327, end: 1403.2 } };
  const entry = (at: number, title: string, prose: string) => ({ at, title, prose, links: [], turn: undefined });

  it("keeps the 0.7 tail when every entry finishes typing before it", () => {
    expect(timeline(scene, 1403.2, [entry(1403.2, "Dies", "He died.")]).end).toBeCloseTo(1403.9, 9);
  });

  it("extends the clock so the last entry finishes typing", () => {
    const long = entry(1403.8, "Widowed", "x".repeat(120));
    const end = timeline(scene, 1403.2, [long]).end;
    expect(end).toBeGreaterThanOrEqual(1403.8 + "Widowed".length * TYPE_TITLE + 120 * TYPE_FAST);
    expect(timeline(scene, 1403.2, [long]).end).toBe(end);
  });

  it("is unchanged by entries while the life is still being written", () => {
    const live = { ...scene, span: { start: 1327, end: null } };
    expect(timeline(live, 1340, [entry(1339, "t", "p")]).end).toBe(timeline(live, 1340).end);
  });
});

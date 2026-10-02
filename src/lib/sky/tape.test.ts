import { describe, expect, it } from "vitest";
import { GAP, PX_PER_YEAR } from "./constants";
import { entryYs, scrollAt, tapeShift, tapeYs } from "./tape";

const ats = [1500, 1500.5, 1510];

describe("tapeYs", () => {
  it("spaces entries by their time gap but never closer than GAP", () => {
    const ys = tapeYs(ats);
    expect(ys[0]).toBe(0);
    expect(ys[1]).toBe(GAP);
    expect(ys[2]! - ys[1]!).toBeCloseTo(9.5 * PX_PER_YEAR, 9);
  });

  it("is empty for no entries", () => {
    expect(tapeYs([])).toEqual([]);
  });
});

describe("scrollAt", () => {
  const ys = tapeYs(ats);

  it("puts each entry under the present exactly at its own moment", () => {
    ats.forEach((at, i) => expect(scrollAt(ats, ys, at)).toBeCloseTo(ys[i]!, 9));
  });

  it("moves continuously between entries and never goes backwards as time advances", () => {
    let prev = -Infinity;
    for (let t = 1499; t <= 1512; t += 0.05) {
      const s = scrollAt(ats, ys, t);
      expect(s).toBeGreaterThanOrEqual(prev);
      prev = s;
    }
  });

  it("extends at PX_PER_YEAR before the first and after the last entry", () => {
    expect(scrollAt(ats, ys, 1499)).toBeCloseTo(-PX_PER_YEAR, 9);
    expect(scrollAt(ats, ys, 1511)).toBeCloseTo(ys[2]! + PX_PER_YEAR, 9);
  });

  it("reads 0 for an empty tape", () => {
    expect(scrollAt([], [], 1500)).toBe(0);
  });
});

describe("entryYs", () => {
  it("is zero for the entry being told and positive for older ones", () => {
    const ys = tapeYs(ats);
    const at = entryYs(ats, ys, 1510);
    expect(at[2]).toBeCloseTo(0, 9);
    expect(at[0]).toBeGreaterThan(at[1]!);
    expect(at[1]).toBeGreaterThan(0);
  });
});

describe("tapeShift", () => {
  const t = 1511;
  const shown = scrollAt(ats, tapeYs(ats), t);

  it("is zero while the entries are the same", () => {
    expect(tapeShift(shown, ats, t)).toBe(0);
  });

  it("measures the hop a new entry just after the present would cause, so the reel can ease it away", () => {
    const grown = [...ats, 1511.5];
    const shift = tapeShift(shown, grown, t);
    expect(shift).not.toBe(0);
    expect(shown + shift).toBeCloseTo(scrollAt(grown, tapeYs(grown), t), 9);
  });
});

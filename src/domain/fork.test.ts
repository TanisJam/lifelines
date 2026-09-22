import { describe, expect, it } from "vitest";
import { ForkError, getRestoreSnapshot } from "./fork";
import type { YearSnapshot } from "./types";

function makeSnapshot(year: number): YearSnapshot {
  return { year, people: {}, events: [], decisions: [] };
}

describe("getRestoreSnapshot", () => {
  it("restores the snapshot from exactly one year before the given decision year, reading the year directly (no id parsing)", () => {
    const snapshots = new Map<number, YearSnapshot>([
      [1344, makeSnapshot(1344)],
      [1345, makeSnapshot(1345)],
    ]);
    const restored = getRestoreSnapshot(snapshots, 1345);
    expect(restored.year).toBe(1344);
  });

  it("throws a ForkError when no snapshot exists for the year before the target decision", () => {
    const snapshots = new Map<number, YearSnapshot>([[1345, makeSnapshot(1345)]]);
    expect(() => getRestoreSnapshot(snapshots, 1345)).toThrow(ForkError);
  });
});

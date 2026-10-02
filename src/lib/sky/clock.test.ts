import { describe, expect, it } from "vitest";
import { RATE } from "./constants";
import { scrubTo, stepClock } from "./clock";

const base = { t: 1500, playing: true, speed: 1, frontier: 1600, end: 1700 };

describe("stepClock", () => {
  it("advances at RATE years per second times speed", () => {
    expect(stepClock(base, 0.05).t).toBeCloseTo(1500 + 0.05 * RATE, 12);
    expect(stepClock({ ...base, speed: 4 }, 0.05).t).toBeCloseTo(1500 + 0.05 * RATE * 4, 12);
  });

  it("does not move while paused", () => {
    expect(stepClock({ ...base, playing: false }, 0.05)).toMatchObject({ t: 1500, playing: false, waiting: false });
  });

  it("caps a long frame so a stalled tab does not leap", () => {
    expect(stepClock(base, 30).t).toBeCloseTo(1500 + 0.1 * RATE, 12);
  });

  it("stops at the frontier while generating, keeps playing and flags waiting", () => {
    const s = stepClock({ ...base, t: 1599.99, frontier: 1600 }, 0.1);
    expect(s).toMatchObject({ t: 1600, playing: true, waiting: true });
    expect(stepClock({ ...base, t: 1600, frontier: 1600 }, 0.1).t).toBe(1600);
  });

  it("resumes when a tick moves the frontier", () => {
    const starved = stepClock({ ...base, t: 1600, frontier: 1600 }, 0.1);
    const next = stepClock({ ...base, t: starved.t, frontier: 1601 }, 0.1);
    expect(next.t).toBeGreaterThan(1600);
    expect(next.waiting).toBe(false);
  });

  it("pauses at the end of the life", () => {
    expect(stepClock({ ...base, t: 1699.99, frontier: 1700, end: 1700 }, 0.1)).toMatchObject({ t: 1700, playing: false, waiting: false });
  });

  it("never rewinds when the frontier is below t", () => {
    expect(stepClock({ ...base, t: 1650, frontier: 1600 }, 0.1).t).toBe(1650);
  });
});

describe("scrubTo", () => {
  it("clamps into [start, min(frontier, end)]", () => {
    const bounds = { start: 1490.3, frontier: 1520, end: 1554 };
    expect(scrubTo(1400, bounds)).toBe(1490.3);
    expect(scrubTo(1530, bounds)).toBe(1520);
    expect(scrubTo(1500, bounds)).toBe(1500);
  });
});

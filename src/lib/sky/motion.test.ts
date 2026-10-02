import { describe, expect, it } from "vitest";
import { clamp01, control, paramAt, partial, polar, quad, sideFor, travel, type Vec } from "./motion";

describe("travel", () => {
  it("runs 0 to 1 without overshoot", () => {
    expect(travel(0)).toBe(0);
    expect(travel(1)).toBeCloseTo(1, 12);
    for (let i = 0; i <= 200; i++) expect(travel(i / 200)).toBeLessThanOrEqual(1 + 1e-12);
    expect(travel(-3)).toBe(0);
    expect(travel(9)).toBeCloseTo(1, 12);
  });

  it("moves at constant speed, then brakes linearly to rest over the last 20%", () => {
    const d = (u: number) => (travel(u + 1e-6) - travel(u)) / 1e-6;
    expect(d(0.1)).toBeCloseTo(d(0.6), 4);
    const v = d(0.5);
    expect(d(0.9)).toBeCloseTo(v / 2, 2);
    expect(d(0.9999)).toBeCloseTo(0, 2);
    let last = -1;
    for (let i = 0; i <= 100; i++) {
      const x = travel(i / 100);
      expect(x).toBeGreaterThanOrEqual(last);
      last = x;
    }
  });
});

describe("curves", () => {
  const a: Vec = [0, 0];
  const b: Vec = [100, 0];

  it("picks the side that bows away from the centre, and reverses with the direction", () => {
    const p: Vec = [-50, 30];
    const q: Vec = [120, -80];
    const away = Math.hypot(...control(p, q, 0.2, sideFor(p, q)));
    const toward = Math.hypot(...control(p, q, 0.2, -sideFor(p, q) as 1 | -1));
    expect(away).toBeGreaterThan(toward);
    expect(sideFor(q, p)).toBe(-sideFor(p, q));
  });

  it("bows toward the chosen side", () => {
    const up = control(a, b, 0.2, 1);
    const down = control(a, b, 0.2, -1);
    expect(up[1]).toBeCloseTo(-down[1], 9);
    expect(Math.abs(up[1])).toBeCloseTo(20, 9);
  });

  it("maps a share of the curve's length to a parameter, with equal steps covering equal length", () => {
    const c = control(a, b, 0.4, 1);
    const len = (s0: number, s1: number) => {
      let sum = 0;
      let prev = quad(a, c, b, paramAt(a, c, b, s0));
      for (let i = 1; i <= 400; i++) {
        const q = quad(a, c, b, paramAt(a, c, b, s0 + ((s1 - s0) * i) / 400));
        sum += Math.hypot(q[0] - prev[0], q[1] - prev[1]);
        prev = q;
      }
      return sum;
    };
    expect(len(0, 0.25)).toBeCloseTo(len(0.5, 0.75), 0);
    expect(paramAt(a, c, b, 0)).toBe(0);
    expect(paramAt(a, c, b, 1)).toBe(1);
  });

  it("builds a partial path that ends where the full curve is at s", () => {
    const c = control(a, b, 0.2, 1);
    const end = quad(a, c, b, 0.5);
    expect(partial(a, c, b, 0.5)).toMatch(new RegExp(`^M0.0,0.0 Q[-\\d.]+,[-\\d.]+ ${end[0].toFixed(1)},${end[1].toFixed(1)}$`));
  });

  it("clamps and converts polar coordinates", () => {
    expect(clamp01(2)).toBe(1);
    expect(clamp01(-1)).toBe(0);
    const [x, y] = polar(90, 10);
    expect(x).toBeCloseTo(0, 9);
    expect(y).toBeCloseTo(10, 9);
  });
});

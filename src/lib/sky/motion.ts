import { SETTLE } from "./constants";

export type Vec = readonly [number, number];
export type Side = 1 | -1;

export const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

/** One constant speed, braking linearly to rest over the last SETTLE share: no acceleration, overshoot or bounce. 0..1 in, 0..1 out. */
export function travel(u: number): number {
  const x = clamp01(u);
  const a = 1 - SETTLE;
  const v = 1 / (a + SETTLE / 2);
  if (x <= a) return x * v;
  const y = (x - a) / SETTLE;
  return a * v + v * SETTLE * (y - (y * y) / 2);
}

export const polar = (deg: number, r: number): Vec => [r * Math.cos((deg * Math.PI) / 180), r * Math.sin((deg * Math.PI) / 180)];
export const lerp = (a: Vec, b: Vec, s: number): Vec => [a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s];

/** Which way a curve bows, decided once from fixed places so it never flips. */
export function sideFor(a: Vec, b: Vec): Side {
  const mx = (a[0] + b[0]) / 2;
  const my = (a[1] + b[1]) / 2;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  return Math.hypot(mx - dy / len, my + dx / len) >= Math.hypot(mx + dy / len, my - dx / len) ? 1 : -1;
}

export function control(a: Vec, b: Vec, bowK: number, side: Side): Vec {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  const k = len * bowK * side;
  return [(a[0] + b[0]) / 2 - (dy / len) * k, (a[1] + b[1]) / 2 + (dx / len) * k];
}

export function quad(p0: Vec, c: Vec, p1: Vec, s: number): Vec {
  const u = 1 - s;
  return [u * u * p0[0] + 2 * u * s * c[0] + s * s * p1[0], u * u * p0[1] + 2 * u * s * c[1] + s * s * p1[1]];
}

/** Share of the curve's length to Bezier parameter, so whatever travels along it keeps a constant speed. */
export function paramAt(p0: Vec, c: Vec, p1: Vec, s: number): number {
  if (s <= 0 || s >= 1) return s;
  const N = 16;
  const acc = [0];
  let prev = p0;
  for (let i = 1; i <= N; i++) {
    const q = quad(p0, c, p1, i / N);
    acc.push(acc[i - 1]! + Math.hypot(q[0] - prev[0], q[1] - prev[1]));
    prev = q;
  }
  const target = s * acc[N]!;
  let i = 1;
  while (i < N && acc[i]! < target) i++;
  const seg = acc[i]! - acc[i - 1]! || 1;
  return (i - 1 + (target - acc[i - 1]!) / seg) / N;
}

/** SVG path of the curve from its start to parameter `s` (a quadratic sub-curve). */
export function partial(p0: Vec, c: Vec, p1: Vec, s: number): string {
  const q = lerp(p0, c, s);
  const end = quad(p0, c, p1, s);
  return `M${p0[0].toFixed(1)},${p0[1].toFixed(1)} Q${q[0].toFixed(1)},${q[1].toFixed(1)} ${end[0].toFixed(1)},${end[1].toFixed(1)}`;
}

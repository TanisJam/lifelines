import { GAP, PX_PER_YEAR } from "./constants";

/**
 * The reel is a rigid tape: consecutive entries sit as far apart as their time gap, but never closer than
 * `gap`. Nothing is ever pushed, so nothing jumps; the clock scrolls the tape instead. `ats` must be sorted.
 */
export function tapeYs(ats: readonly number[], gap: number = GAP, pxPerYear: number = PX_PER_YEAR): number[] {
  const ys: number[] = [];
  ats.forEach((at, i) => ys.push(i === 0 ? 0 : ys[i - 1]! + Math.max(gap, (at - ats[i - 1]!) * pxPerYear)));
  return ys;
}

/** Tape position under the present at time `t`: linear between neighbours, PX_PER_YEAR beyond the ends. */
export function scrollAt(ats: readonly number[], ys: readonly number[], t: number, pxPerYear: number = PX_PER_YEAR): number {
  const n = ats.length;
  if (n === 0) return 0;
  if (t <= ats[0]!) return ys[0]! - (ats[0]! - t) * pxPerYear;
  if (t >= ats[n - 1]!) return ys[n - 1]! + (t - ats[n - 1]!) * pxPerYear;
  let i = 0;
  while (ats[i + 1]! <= t) i++;
  return ys[i]! + ((t - ats[i]!) / (ats[i + 1]! - ats[i]!)) * (ys[i + 1]! - ys[i]!);
}

/** Each entry's distance behind the present (0 = being told now, positive = older), a pure function of `t`. */
export function entryYs(ats: readonly number[], ys: readonly number[], t: number): number[] {
  const scroll = scrollAt(ats, ys, t);
  return ys.map((y) => scroll - y);
}

/**
 * When entries are added or replaced, the tape position under the present changes. This is how far it moved
 * against what the reader was last shown (`shownScroll` at `t`): the reel starts that far off and eases back,
 * so a new tick or the done swap never makes the rows hop.
 */
export function tapeShift(shownScroll: number, ats: readonly number[], t: number): number {
  return scrollAt(ats, tapeYs(ats), t) - shownScroll;
}

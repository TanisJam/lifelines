import type { LifeScene, SceneBand } from "@/contracts/life";
import { polar, travel } from "./motion";

/** Angle (degrees, top = -90) of year `t` on a dial of `span` years starting at `start`. */
export const dialAngle = (t: number, start: number, span: number): number => ((t - start) / span) * 360 - 90;
export const dialRad = (t: number, start: number, span: number): number => ((t - start) / span) * Math.PI * 2;

/** SVG path of a stroked arc on radius `r` between two angles in degrees. Empty for no sweep; a full circle stops a hair short so it still draws. */
export function arcPath(r: number, from: number, to: number): string {
  const sweep = Math.min(Math.max(to - from, 0), 359.99);
  if (sweep === 0) return "";
  const [x0, y0] = polar(from, r);
  const [x1, y1] = polar(from + sweep, r);
  return `M${x0.toFixed(2)},${y0.toFixed(2)} A${r},${r} 0 ${sweep > 180 ? 1 : 0} 1 ${x1.toFixed(2)},${y1.toFixed(2)}`;
}

/** 0..1 sine swell while inside a plague band, 0 outside. */
export function plagueIntensity(bands: readonly SceneBand[], t: number): number {
  let intensity = 0;
  for (const b of bands) if (t > b.from && t < b.to) intensity = Math.max(intensity, Math.sin((Math.PI * (t - b.from)) / (b.to - b.from)));
  return intensity;
}

/** Share of the year the last odometer digit spends rolling over. */
const ROLL_SHARE = 0.33;

/** The value an odometer shows: holds the whole number, rolling to the next over the last third of the year. */
export const rolled = (value: number, floor: number): number => {
  const whole = Math.floor(value);
  return Math.max(floor, whole - 1 + travel((value - whole) / ROLL_SHARE));
};

/** Per-digit strip offsets (em), most significant first; a digit only carries while the digits below it sit on 9. */
export function odometerOffsets(value: number, digits: number): number[] {
  let v = Math.floor(value);
  let carry = value - v;
  const out: number[] = new Array<number>(digits).fill(0);
  for (let k = digits - 1; k >= 0; k--) {
    const d = v % 10;
    out[k] = 0 - (d + carry);
    carry = d === 9 ? carry : 0;
    v = Math.floor(v / 10);
  }
  return out;
}

/** Horizontal offset of the 36-cell month tape so the current month sits under a cursor at `width / 2`. */
export const monthTapeX = (t: number, width: number, cell: number): number => width / 2 - (12 + (t - Math.floor(t)) * 12) * cell;
export const monthCell = (t: number): number => 12 + Math.floor((t - Math.floor(t)) * 12);

export interface Timeline {
  readonly start: number;
  /** Where the clock stops: the death while it is known, else a provisional horizon. */
  readonly end: number;
  readonly dialStart: number;
  readonly dialSpan: number;
}

/** The life's time axis. Live (end unknown) it stays at least 60 years wide and 8 past the frontier; once known the clock runs 0.7 past the death. */
export function timeline(scene: LifeScene, frontier: number): Timeline {
  const { start, end } = scene.span;
  const known = end !== null;
  const stop = known ? end + 0.7 : Math.max(start + 60, frontier + 8);
  const dialStart = Math.floor(start);
  return { start, end: stop, dialStart, dialSpan: Math.ceil(stop) - dialStart };
}

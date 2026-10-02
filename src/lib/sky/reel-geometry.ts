import { A_NOW, GAP, R_COMPASS } from "./constants";
import { clamp01, type Vec } from "./motion";

export interface Rect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** Where the reel's arc sits, in the stage's own pixel space. */
export interface ReelGeo {
  /** Centre of the sky disc. */
  readonly cx: number;
  readonly cy: number;
  /** Radius of the arc the entries hang on. */
  readonly ra: number;
  /** Right limit for entry text. */
  readonly right: number;
  /** Top-left of the disc inside the stage, and its pixels per SVG unit. */
  readonly dx: number;
  readonly dy: number;
  readonly unit: number;
}

/** Entries are never drawn past this share of the arc's radius (near its top and bottom). */
const ARC_LIMIT = 0.92;

export function reelGeo(area: Rect, disc: Rect): ReelGeo {
  const unit = disc.width / 800;
  const dx = disc.left - area.left;
  const dy = disc.top - area.top;
  return { cx: dx + disc.width / 2, cy: dy + disc.height / 2, ra: (R_COMPASS + 72) * unit, right: area.width - 160, dx, dy, unit };
}

/** Distance (px along the tape) from an entry at the present to the arc's vertical origin. */
export const yNow = (geo: ReelGeo): number => geo.ra * Math.sin((A_NOW * Math.PI) / 180);

/** A point of the sky's SVG space in stage pixels. */
export const toPx = (geo: ReelGeo, [x, y]: Vec): Vec => [geo.dx + (x + 400) * geo.unit, geo.dy + (y + 400) * geo.unit];

/** Where an entry `y` pixels behind the present sits on the arc, or null when it is off the visible arc. */
export function arcPlace(geo: ReelGeo, y: number): { x: number; y: number } | null {
  const s = (yNow(geo) + y) / geo.ra;
  if (Math.abs(s) > ARC_LIMIT) return null;
  const a = Math.asin(s);
  return { x: geo.cx + geo.ra * Math.cos(a), y: geo.cy + geo.ra * Math.sin(a) };
}

/** Width available to an entry's text at arc position `x`. */
export const reelWidth = (geo: ReelGeo, x: number): number => Math.max(190, Math.min(330, geo.right - x));

/** Row opacity and node opacity: future entries come down faint, past ones ink in and fade into deeper time. */
export function entryLook(y: number, future: boolean): { opacity: number; node: number } {
  if (future) return { opacity: clamp01(1 + y / (GAP * 1.4)), node: 0.45 };
  return { opacity: Math.max(0, 1 - Math.max(0, y - GAP * 0.8) / (GAP * 4.2)), node: 1 };
}

/** How strongly the entry being told is "in focus": ramps in over 0.12 years, releases as it slides away. Callers pass 0 for every other entry. */
export const toldStrength = (y: number, t: number, at: number): number => clamp01(1 - (y - GAP * 0.55) / (GAP * 0.9)) * clamp01((t - at) / 0.12);

/** Angles (degrees) where the visible rail starts and ends. */
export function railAngles(geo: ReelGeo): { from: number; to: number } {
  return { from: (Math.asin(Math.sin((A_NOW * Math.PI) / 180) - (GAP * 1.6) / geo.ra) * 180) / Math.PI, to: (Math.asin(ARC_LIMIT) * 180) / Math.PI };
}

/**
 * The wheel scrolls the reel anywhere right of the compass ring and inside the stage, the gaps between rows
 * included. `ringCenter` and `stage` share the pointer's coordinate space (viewport pixels).
 */
export function inReelZone(x: number, y: number, ringCenter: { x: number; y: number }, ringOuterR: number, stage: { left: number; top: number; right: number; bottom: number }): boolean {
  return x >= ringCenter.x + ringOuterR && x >= stage.left && x <= stage.right && y >= stage.top && y <= stage.bottom;
}

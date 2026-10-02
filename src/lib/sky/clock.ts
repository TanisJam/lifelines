import { MAX_DT, RATE } from "./constants";

export interface ClockInput {
  readonly t: number;
  readonly playing: boolean;
  readonly speed: number;
  /** Last tick year + 1 while generating; the end of the life once it is saved. */
  readonly frontier: number;
  readonly end: number;
}

export interface ClockState {
  readonly t: number;
  readonly playing: boolean;
  /** Playing but starved: t is at the frontier and generation has not reached the end. */
  readonly waiting: boolean;
}

/** Advances the sim clock by `dt` real seconds. Never passes the frontier, never rewinds, pauses at the end. */
export function stepClock(clock: ClockInput, dt: number): ClockState {
  const limit = Math.min(clock.frontier, clock.end);
  if (!clock.playing) return { t: clock.t, playing: false, waiting: false };
  const t = Math.max(clock.t, Math.min(limit, clock.t + Math.min(MAX_DT, Math.max(0, dt)) * RATE * clock.speed));
  const atEnd = t >= clock.end;
  return { t, playing: !atEnd, waiting: !atEnd && t >= clock.frontier };
}

/** A scrub or jump target, kept inside the life and behind the frontier. */
export function scrubTo(t: number, bounds: { readonly start: number; readonly frontier: number; readonly end: number }): number {
  return Math.max(bounds.start, Math.min(Math.min(bounds.frontier, bounds.end), t));
}

/** Share of the life already played, 0..1. A zero-length (or inverted) span reads as 0 so callers never see NaN or Infinity. */
export function progressOf(t: number, start: number, end: number): number {
  const span = end - start;
  if (!(span > 0)) return 0;
  return Math.max(0, Math.min(1, (t - start) / span));
}

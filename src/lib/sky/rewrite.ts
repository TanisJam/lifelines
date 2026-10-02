import type { Chronicle, LifeStreamEvent } from "@/contracts/life";
import { mergeTick, type LiveModel } from "./live-model";

/**
 * A rewrite on the sky, in four phases (the mock's rewrite sequence):
 * A the divergence card, the clock at the fork; B the old future blurs away, the clock held at the fork;
 * C new ticks stream in and the clock plays from the fork, capped by the frontier; D the saved branch, with ghosts.
 * `idle` is no rewrite at all (or one that failed or was switched away from).
 */
export type RewritePhase = "idle" | "A" | "B" | "C" | "D";

/** The turn being changed. `at` is the moment inside `year` the clock rests on. */
export interface Fork {
  readonly entryId: string;
  readonly year: number;
  readonly at: number;
  readonly originalLabel: string;
  readonly newLabel: string;
}

export interface RewriteState {
  readonly phase: RewritePhase;
  readonly fork: Fork | null;
  /** The chronicle on show instead of the one passed in: the saved branch (D) or a branch switched to. Null: show the passed-in one. */
  readonly current: Chronicle | null;
  /** C only: the new life as it streams in, over the retained old one. */
  readonly live: LiveModel | null;
  /** Entry id -> the line that says how this turn played out before. */
  readonly ghosts: Readonly<Record<string, string>>;
  readonly error: string | null;
}

export const initialRewrite: RewriteState = { phase: "idle", fork: null, current: null, live: null, ghosts: {}, error: null };

export type RewriteAction =
  | { readonly type: "begin"; readonly fork: Fork }
  /** A -> B */
  | { readonly type: "hold" }
  /** B -> C, from the chronicle on show. */
  | { readonly type: "stream"; readonly from: Chronicle }
  | Extract<LifeStreamEvent, { type: "tick" }>
  | { readonly type: "done"; readonly chronicle: Chronicle; readonly ghosts: Readonly<Record<string, string>> }
  | { readonly type: "fail"; readonly message: string }
  /** Another branch of the same life was loaded. */
  | { readonly type: "loaded"; readonly chronicle: Chronicle };

export const rewriteBusy = (state: RewriteState): boolean => state.phase === "A" || state.phase === "B" || state.phase === "C";

/** Folds a rewrite's events into its state. Events out of order (a tick before C, a begin while busy) change nothing. */
export function rewriteReducer(state: RewriteState, action: RewriteAction): RewriteState {
  switch (action.type) {
    case "begin":
      return rewriteBusy(state) ? state : { ...state, phase: "A", fork: action.fork, live: null, ghosts: {}, error: null };
    case "hold":
      return state.phase === "A" ? { ...state, phase: "B" } : state;
    case "stream": {
      if (state.phase !== "B" || !state.fork) return state;
      const { fork } = state;
      const entries = action.from.entries.filter((e) => e.year < fork.year);
      return { ...state, phase: "C", live: { scene: action.from.scene, entries, frontier: fork.at, saved: false } };
    }
    case "tick":
      return state.phase === "C" && state.live ? { ...state, live: mergeTick(state.live, action) } : state;
    case "done":
      return state.phase === "C" ? { ...state, phase: "D", current: action.chronicle, live: null, ghosts: action.ghosts } : state;
    case "fail":
      // A failed rewrite drops the new life and everything about it, so the old sky is what is left; a failed branch load only reports.
      return rewriteBusy(state) ? { ...state, phase: "idle", fork: null, live: null, ghosts: {}, error: action.message } : { ...state, error: action.message };
    case "loaded":
      return rewriteBusy(state) ? state : { ...state, phase: "idle", fork: null, current: action.chronicle, live: null, ghosts: {}, error: null };
  }
}

/** What the sky draws: the streamed new life in C, otherwise the retained or loaded chronicle. */
export function shownChronicle(state: RewriteState, base: Chronicle): Chronicle {
  const shown = state.current ?? base;
  return state.phase === "C" && state.live ? { ...shown, scene: state.live.scene, entries: state.live.entries } : shown;
}

/** How far the clock may run because of the rewrite; undefined leaves it to the caller (the end of the life). */
export function rewriteFrontier(state: RewriteState): number | undefined {
  if (state.phase === "B") return state.fork?.at;
  if (state.phase === "C") return state.live?.frontier;
  return undefined;
}

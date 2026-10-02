"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import type { Chronicle } from "@/contracts/life";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/dictionary";
import { guardErrorMessage } from "@/lib/guard-error";
import { getChronicle, rewriteStream } from "@/lib/life-client";
import { travel } from "@/lib/sky/motion";
import { prefersReducedMotion } from "@/lib/sky/motion-pref";
import type { PlayerStore } from "@/lib/sky/player-store";
import { runRewrite } from "@/lib/sky/rewrite-run";
import { initialRewrite, rewriteBusy, rewriteFrontier, rewriteReducer, shownChronicle, type Fork } from "@/lib/sky/rewrite";
import type { TurnEntry } from "./change-rules";

/** How long the clock takes to reach the fork in phase A, and how long A and B are held so each registers. */
const GLIDE_MS = 600;
const HOLD_A_MS = 1600;
const HOLD_B_MS = 900;
const HOLD_REDUCED_MS = 150;

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(timer), resolve()), { once: true });
  });

export interface StartRewrite {
  /** The chronicle on show now: the rewrite retains it until the new life is saved. */
  readonly chronicle: Chronicle;
  readonly entry: TurnEntry;
  readonly optionId: string;
  readonly turnstileToken?: string;
}

/**
 * The rewrite of a saved life, on the sky it is already showing: the reducer in `lib/sky/rewrite` holds the phases,
 * this hook runs them (the holds in A and B, the stream in C) and keeps the address bar on the branch on show with
 * a shallow `history.replaceState`, never `router.*` (Next's router observes the History API globally and would
 * remount the loader, losing the state held here). Nothing here touches the engine: it only decides what to show.
 */
export function useRewrite(base: Chronicle, { lang, dict }: { lang: Locale; dict: Dictionary }) {
  const [state, dispatch] = useReducer(rewriteReducer, initialRewrite);
  const chronicle = useMemo(() => shownChronicle(state, base), [state, base]);
  const running = useRef<AbortController | null>(null);
  useEffect(() => () => running.current?.abort(), []);

  const start = useCallback(
    async ({ chronicle: from, entry, optionId, turnstileToken }: StartRewrite): Promise<void> => {
      const { turn } = entry;
      const newLabel = [turn.chosen, ...turn.alternatives].find((o) => o.optionId === optionId)?.label ?? optionId;
      const fork: Fork = { entryId: entry.id, year: entry.year, at: entry.at, originalLabel: turn.chosen.label, newLabel };
      const run = new AbortController();
      running.current?.abort();
      running.current = run;
      const reduced = prefersReducedMotion();
      dispatch({ type: "begin", fork });
      await runRewrite({
        signal: run.signal,
        sleep: (phase) => sleep(reduced ? HOLD_REDUCED_MS : phase === "A" ? HOLD_A_MS : HOLD_B_MS, run.signal),
        dispatch,
        from,
        stream: (onEvent) => rewriteStream(from.lifeId, { branchId: from.branchId, decisionId: turn.decisionId, optionId, lang, turnstileToken }, onEvent, run.signal),
        onDone: (saved) => window.history.replaceState(null, "", `/${lang}/life/${saved.lifeId}?branch=${saved.branchId}`),
        messages: { incomplete: dict.chronicle.rewriteIncomplete, failed: (err) => guardErrorMessage(err, dict, dict.chronicle.rewriteFailed) },
      });
    },
    [lang, dict],
  );

  /** Shows another branch of the same life in place. Not while a rewrite runs. */
  const switchBranch = useCallback(
    async (branchId: string): Promise<void> => {
      if (rewriteBusy(state) || branchId === chronicle.branchId) return;
      try {
        const fresh = await getChronicle(chronicle.lifeId, branchId, lang);
        dispatch({ type: "loaded", chronicle: fresh });
        window.history.replaceState(null, "", `/${lang}/life/${fresh.lifeId}?branch=${fresh.branchId}`);
      } catch (err) {
        dispatch({ type: "fail", message: err instanceof Error ? err.message : dict.chronicle.branchLoadError });
      }
    },
    [state, chronicle.branchId, chronicle.lifeId, lang, dict],
  );

  return { state, chronicle, frontier: rewriteFrontier(state), busy: rewriteBusy(state), start, switchBranch };
}

/**
 * Drives the clock through a rewrite: in A it glides to the fork and stops there; in C it plays on from the fork
 * (the frontier holds it to the years written so far). Imperative on purpose, so no frame reaches React.
 */
export function useForkGlide(phase: string, fork: Fork | null, store: PlayerStore, seek: (t: number) => void, toggle: () => void): void {
  useEffect(() => {
    if (phase === "C" && !store.get().playing) toggle();
    if (phase !== "A" || !fork) return;
    const target = fork.at;
    let raf = 0;
    const glide = (from: number) => {
      if (prefersReducedMotion()) return seek(target);
      const began = performance.now();
      const step = (now: number) => {
        const k = Math.min(1, (now - began) / GLIDE_MS);
        seek(from + (target - from) * travel(k));
        if (k < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    };
    // The engine is already drawing frames: the first one says where the clock is.
    const off = store.onFrame((f) => {
      off();
      glide(f.t);
    });
    return () => {
      off();
      cancelAnimationFrame(raf);
    };
  }, [phase, fork, store, seek, toggle]);
}

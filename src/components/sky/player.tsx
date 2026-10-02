"use client";

import { useEffect, useRef } from "react";
import { progressOf } from "@/lib/sky/clock";
import type { PlayerState, PlayerStore } from "@/lib/sky/player-store";

export interface PlayerLabels {
  readonly play: string;
  readonly pause: string;
  readonly speed: string;
  readonly year: string;
  readonly caption: string;
}

export interface PlayerControls {
  toggle(): void;
  cycleSpeed(): void;
  seek(t: number): void;
}

/** Play/pause, speed and the year scrubber. The scrubber follows the clock through frames, never through state. */
export function Player({ store, state, controls, start, end, labels }: { store: PlayerStore; state: PlayerState; controls: PlayerControls; start: number; end: number; labels: PlayerLabels }) {
  const range = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const el = range.current;
    if (!el) return;
    return store.onFrame((frame) => {
      el.value = String(frame.t);
      el.style.setProperty("--p", `${(progressOf(frame.t, start, end) * 100).toFixed(2)}%`);
    });
  }, [store, start, end]);
  return (
    <div className="sky-player">
      <button type="button" className="sky-playbtn" onClick={controls.toggle} aria-label={state.playing ? labels.pause : labels.play}>
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          {state.playing ? (
            <>
              <rect x="6.5" y="5" width="3.6" height="14" rx="1" />
              <rect x="13.9" y="5" width="3.6" height="14" rx="1" />
            </>
          ) : (
            <path d="M8 5 L19 12 L8 19 Z" />
          )}
        </svg>
      </button>
      <span className="sky-yr">{Math.floor(start)}</span>
      <input ref={range} type="range" min={start} max={end} step={0.01} defaultValue={start} aria-label={labels.year} onChange={(e) => controls.seek(Number(e.currentTarget.value))} />
      <span className="sky-yr">{Math.floor(end)}</span>
      <button type="button" className="sky-speed" onClick={controls.cycleSpeed} aria-label={labels.speed}>
        {state.speed}×
      </button>
      <div className="sky-caption">{labels.caption}</div>
    </div>
  );
}

"use client";

import { useEffect, useRef } from "react";
import type { Timeline } from "@/lib/sky/dial";
import type { PlayerStore } from "@/lib/sky/player-store";
import type { ReelEntry } from "@/lib/sky/reel-model";
import { tapeShift } from "@/lib/sky/tape";
import { createReel, type ReelInit } from "./engine/draw-reel";

export interface ReelLabels {
  readonly label: string;
  /** "Go to this moment." appended to each row's accessible name. */
  readonly go: string;
}

/**
 * The chronicle on its arc. React renders each row once, keyed by entry id (so a later tick or done never
 * remounts a row); the controller types, places and fades them from the clock.
 */
export function Reel({ entries, store, timeline, focus, seek, openPerson, labels }: { entries: readonly ReelEntry[]; store: PlayerStore; timeline: Timeline; focus: ReelInit["focus"]; seek: (t: number) => void; openPerson?: (personId: string) => void; labels: ReelLabels }) {
  const olRef = useRef<HTMLOListElement>(null);
  const railRef = useRef<SVGSVGElement>(null);
  /** Where the previous controller left the clock and the tape, so a new one (new tick, done) eases instead of hopping. */
  const carry = useRef<{ t: number; scroll: number } | null>(null);
  useEffect(() => {
    const ol = olRef.current;
    const rail = railRef.current;
    const area = ol?.parentElement;
    if (!ol || !rail || !area) return;
    const from = carry.current;
    const tapeOffset = from ? tapeShift(from.scroll, entries.map((e) => e.at), from.t) : 0;
    const reel = createReel({ area, ol, rail, entries, store, timeline, focus, seek, openPerson, tapeOffset });
    return () => {
      carry.current = reel.snapshot();
      reel.destroy();
    };
  }, [entries, store, timeline, focus, seek, openPerson]);
  return (
    <>
      <svg ref={railRef} className="sky-rail" aria-hidden="true">
        <defs>
          <linearGradient id="sky-rail-grad" gradientUnits="userSpaceOnUse" x1="0" x2="0">
            <stop offset="0" stopColor="rgb(227 191 114 / 0.08)" />
            <stop offset="0.28" stopColor="rgb(227 191 114 / 0.65)" />
            <stop offset="1" stopColor="rgb(227 191 114 / 0.06)" />
          </linearGradient>
        </defs>
        <path data-rail-arc fill="none" stroke="url(#sky-rail-grad)" strokeWidth="1.2" />
        <line data-rail-now className="sky-now-tick" />
        <g data-rail-leaders />
      </svg>
      <ol ref={olRef} className={`sky-reel${openPerson ? " linkable" : ""}`} aria-label={labels.label}>
        {entries.map((e) => (
          <li key={e.id} className={e.turn ? "turn" : undefined} tabIndex={0} role="button" aria-label={`${e.year}: ${e.text.title}. ${labels.go}`} style={{ display: "none" }}>
            <span className="node" />
            <div className="body">
              <span className="y">{e.year}</span>
              <div className="txt">
                <div className="t" />
                {e.text.by !== undefined && <div className="by" />}
                <div className="p" />
              </div>
            </div>
          </li>
        ))}
      </ol>
    </>
  );
}

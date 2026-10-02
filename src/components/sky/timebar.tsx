"use client";

import { useEffect, useRef } from "react";
import type { Dictionary } from "@/i18n/dictionary";
import { progressOf } from "@/lib/sky/clock";
import type { PlayerStore } from "@/lib/sky/player-store";

const lines = (text: string) => text.split(" ").flatMap((word, i) => (i === 0 ? [word] : [<br key={i} />, word]));

/** The right-hand edge: a closing line and the time bar, where the moon is the present, climbing from deep time toward the unwritten future. */
export function TimeBar({ sky, store, start, end }: { sky: Dictionary["sky"]; store: PlayerStore; start: number; end: number }) {
  const moon = useRef<SVGSVGElement>(null);
  useEffect(() => {
    const el = moon.current;
    if (!el) return;
    return store.onFrame((frame) => {
      el.style.top = `${(88 - progressOf(frame.t, start, end) * 46).toFixed(2)}%`;
    });
  }, [store, start, end]);
  return (
    <aside className="sky-edge-panel">
      <div>
        <q>{sky.edge.quote}</q>
        <hr className="sky-rule" />
      </div>
      <div className="sky-timebar" aria-hidden="true">
        <div className="lbl top">{lines(sky.edge.future)}</div>
        <div className="line" />
        <div className="tick" style={{ top: "42%" }} />
        <div className="tick" style={{ top: "88%" }} />
        <svg ref={moon} className="moon" viewBox="0 0 24 24" fill="currentColor">
          <path d="M15.5 3.5 A8.5 8.5 0 1 0 20.5 17 A7 7 0 1 1 15.5 3.5 Z" />
        </svg>
        <div className="lbl bottom">{lines(sky.edge.deeper)}</div>
      </div>
    </aside>
  );
}

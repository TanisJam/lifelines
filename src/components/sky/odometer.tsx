"use client";

import { useEffect, useRef } from "react";
import { odometerOffsets } from "@/lib/sky/dial";
import type { Frame } from "@/lib/sky/scene-model";
import type { PlayerStore } from "@/lib/sky/player-store";

const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0];
const defaultLabel = (frame: Frame): string => String(Math.floor(frame.t));

/** Rolling digits driven straight from engine frames: `read` picks the value, the strips are moved imperatively. */
export function Odometer({
  store,
  digits,
  read,
  label = defaultLabel,
  hideLeadingZero = false,
  className,
}: {
  store: PlayerStore;
  digits: number;
  read: (frame: Frame) => number;
  /** The accessible value, refreshed whenever the whole number changes. Defaults to the year. */
  label?: (frame: Frame, value: number) => string;
  /** Hides the first digit while the value is a single digit (an age of 7 reads "7", not "07"). */
  hideLeadingZero?: boolean;
  className?: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const strips = [...el.querySelectorAll<HTMLElement>(".sky-strip")];
    let whole = NaN;
    return store.onFrame((frame) => {
      const value = read(frame);
      odometerOffsets(value, digits).forEach((offset, k) => {
        strips[k]!.style.transform = `translateY(${offset}em)`;
      });
      if (hideLeadingZero) strips[0]!.parentElement!.style.display = value < 9.5 ? "none" : "";
      if (Math.floor(value) !== whole) {
        whole = Math.floor(value);
        el.setAttribute("aria-label", label(frame, value));
      }
    });
  }, [store, digits, read, label, hideLeadingZero]);
  return (
    <div ref={root} className={`sky-odo ${className ?? ""}`} role="img">
      {Array.from({ length: digits }, (_, k) => (
        <span key={k} className="sky-digit">
          <span className="sky-strip">
            {DIGITS.map((n, i) => (
              <span key={i}>{n}</span>
            ))}
          </span>
        </span>
      ))}
    </div>
  );
}

"use client";

import { useEffect, useRef } from "react";
import type { LifeSex } from "@/contracts/life";
import type { Dictionary } from "@/i18n/dictionary";
import type { PlayerStore } from "@/lib/sky/player-store";

/** The village's name with the living counts of its souls and of the story circle, written straight from frames. */
export function PlacePanel({ village, sex, sky, store }: { village: string; sex: LifeSex; sky: Dictionary["sky"]; store: PlayerStore }) {
  const souls = useRef<HTMLElement>(null);
  const circle = useRef<HTMLElement>(null);
  useEffect(() => {
    const a = souls.current;
    const b = circle.current;
    if (!a || !b) return;
    return store.onFrame((frame) => {
      if (a.textContent !== String(frame.souls)) a.textContent = String(frame.souls);
      if (b.textContent !== String(frame.circle)) b.textContent = String(frame.circle);
    });
  }, [store]);
  return (
    <section className="sky-place">
      <div className="name">{village}</div>
      <div className="souls">
        <b ref={souls}>0</b> {sky.place.souls} · <b ref={circle}>0</b> {sky.place.circle(sex)}
      </div>
      <hr className="sky-rule" />
      <q>{sky.place.quote}</q>
    </section>
  );
}

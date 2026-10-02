"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import type { LifeScene } from "@/contracts/life";
import type { Dictionary } from "@/i18n/dictionary";
import type { Locale } from "@/i18n/config";
import { festivalAt, MONTHS } from "@/lib/sky/calendar";
import { monthCell, monthTapeX, rolled } from "@/lib/sky/dial";
import type { PlayerStore } from "@/lib/sky/player-store";
import type { Frame } from "@/lib/sky/scene-model";
import { ageAt } from "@/lib/sky/star-facts";
import { Odometer } from "./odometer";

const CELL = 64;

/** The year odometer, the protagonist's age with the season and place, and the sliding month tape. All of it follows frames imperatively. */
export function NowPanel({ scene, store, lang, village, sky, yearFloor }: { scene: LifeScene; store: PlayerStore; lang: Locale; village: string; sky: Dictionary["sky"]; yearFloor: number }) {
  const readYear = useMemo(() => (frame: Frame) => rolled(frame.t, yearFloor), [yearFloor]);
  const readAge = useCallback(
    (frame: Frame) => {
      const { age, alive } = ageAt(scene, frame.t);
      return alive ? rolled(frame.t - scene.span.start, 0) : age;
    },
    [scene],
  );
  const ageLabel = useCallback((frame: Frame) => String(ageAt(scene, frame.t).age), [scene]);
  const prefixRef = useRef<HTMLSpanElement>(null);
  const whereRef = useRef<HTMLSpanElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const tapeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const prefix = prefixRef.current;
    const where = whereRef.current;
    const viewport = viewportRef.current;
    const tape = tapeRef.current;
    if (!prefix || !where || !viewport || !tape) return;
    const cells = [...tape.children] as HTMLElement[];
    let width = viewport.clientWidth;
    const observer = new ResizeObserver(() => (width = viewport.clientWidth));
    observer.observe(viewport);
    let living: boolean | null = null;
    let place = "";
    let cell = -1;
    const off = store.onFrame((frame) => {
      const now = ageAt(scene, frame.t);
      if (now.alive !== living) {
        living = now.alive;
        prefix.textContent = now.alive ? sky.now.age : sky.now.died;
      }
      const next = sky.now.where(festivalAt(frame.t, lang), village);
      if (next !== place) {
        place = next;
        where.textContent = next;
      }
      tape.style.transform = `translateX(${monthTapeX(frame.t, width, CELL).toFixed(1)}px)`;
      const c = monthCell(frame.t);
      if (c !== cell) {
        cells[cell]?.classList.remove("cur");
        cells[c]?.classList.add("cur");
        cell = c;
      }
    });
    return () => {
      off();
      observer.disconnect();
    };
  }, [store, scene, lang, village, sky]);

  return (
    <section className="sky-now">
      <Odometer store={store} digits={4} read={readYear} className="big" />
      <div className="sky-agerow">
        <span ref={prefixRef} />
        <Odometer store={store} digits={2} read={readAge} label={ageLabel} hideLeadingZero />
        <span className="sep">·</span>
        <span ref={whereRef} />
      </div>
      <div ref={viewportRef} className="sky-months" aria-hidden="true">
        <div ref={tapeRef} className="sky-tape">
          {Array.from({ length: 36 }, (_, i) => (
            <span key={i}>{MONTHS[lang][i % 12]}</span>
          ))}
        </div>
        <span className="cursor" />
      </div>
    </section>
  );
}

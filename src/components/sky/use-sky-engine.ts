"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { LifeScene } from "@/contracts/life";
import type { Timeline } from "@/lib/sky/dial";
import { createPlayerStore } from "@/lib/sky/player-store";
import { createSkyEngine, type SkyEngine } from "./engine/create-sky-engine";

export interface SkyEngineOptions {
  /** How far the clock may run (live: last tick year + 1). Defaults to the end of the timeline. */
  readonly frontier?: number;
  /** Start playing at once (a life being written live). A saved life starts paused. */
  readonly autoplay?: boolean;
}

/**
 * Binds the imperative engine to a rendered <SkySvg>. The engine is created once, inside the effect, and held
 * in a ref there, so handlers reach it through `controls` and nothing mutable lives in render. A grown scene
 * (live ticks, done) reaches the same engine through `update`, so the sky never remounts and the clock never
 * jumps. Only the slow state (playing, speed, waiting) is exposed to React, through an external store.
 */
export function useSkyEngine(scene: LifeScene, timeline: Timeline, { frontier, autoplay = false }: SkyEngineOptions = {}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const engineRef = useRef<SkyEngine | null>(null);
  const [store] = useState(() => createPlayerStore({ playing: autoplay, speed: 1, waiting: false }));
  const [initial] = useState({ scene, timeline, frontier });
  const state = useSyncExternalStore(store.subscribe, store.get, store.get);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const engine = createSkyEngine({ svg, store, ...initial });
    engineRef.current = engine;
    return () => {
      engine.destroy();
      engineRef.current = null;
    };
  }, [store, initial]);

  useEffect(() => {
    engineRef.current?.update({ scene, timeline, frontier });
  }, [scene, timeline, frontier]);

  const controls = useMemo(
    () => ({
      toggle: () => engineRef.current?.toggle(),
      pause: () => engineRef.current?.pause(),
      cycleSpeed: () => engineRef.current?.cycleSpeed(),
      seek: (t: number) => engineRef.current?.seek(t),
    }),
    [],
  );
  return { svgRef, store, state, controls };
}

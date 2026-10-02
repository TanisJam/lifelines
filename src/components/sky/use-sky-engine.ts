"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { LifeScene } from "@/contracts/life";
import type { Timeline } from "@/lib/sky/dial";
import { createPlayerStore } from "@/lib/sky/player-store";
import { createSkyEngine, type SkyEngine } from "./engine/create-sky-engine";

/**
 * Binds the imperative engine to a rendered <SkySvg>. The engine is created inside the effect and held
 * in a ref there, so handlers reach it through `controls` and nothing mutable lives in render. Only the
 * slow state (playing, speed, waiting) is exposed to React, through an external store.
 */
export function useSkyEngine(scene: LifeScene, timeline: Timeline) {
  const svgRef = useRef<SVGSVGElement>(null);
  const engineRef = useRef<SkyEngine | null>(null);
  const [store] = useState(createPlayerStore);
  const state = useSyncExternalStore(store.subscribe, store.get, store.get);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const engine = createSkyEngine({ svg, scene, timeline, store });
    engineRef.current = engine;
    return () => {
      engine.destroy();
      engineRef.current = null;
    };
  }, [scene, timeline, store]);

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

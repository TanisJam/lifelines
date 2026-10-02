"use client";

import { useEffect, useMemo, useRef, type RefObject } from "react";
import type { LifeScene, ScenePerson } from "@/contracts/life";
import type { StarText } from "@/lib/sky/describe-star";
import type { PlayerStore } from "@/lib/sky/player-store";
import { createFocus, type Focus } from "./engine/focus";

export interface SkyFocusOptions {
  readonly svgRef: RefObject<SVGSVGElement | null>;
  readonly tipRef: RefObject<HTMLElement | null>;
  readonly scene: LifeScene;
  readonly store: PlayerStore;
  readonly describe: (person: ScenePerson, t: number) => StarText;
  readonly activate: (personId: string) => boolean;
}

/** Binds star and entry focus to the rendered sky. `controls` reach the focus created inside the effect. */
export function useSkyFocus({ svgRef, tipRef, scene, store, describe, activate }: SkyFocusOptions) {
  const focusRef = useRef<Focus | null>(null);
  useEffect(() => {
    const svg = svgRef.current;
    const tip = tipRef.current;
    if (!svg || !tip) return;
    const focus = createFocus({ svg, tip, scene, store, describe, activate });
    focusRef.current = focus;
    return () => {
      focus.destroy();
      focusRef.current = null;
    };
  }, [svgRef, tipRef, scene, store, describe, activate]);
  return useMemo(
    () => ({
      setEntry: (ids: readonly string[] | null) => focusRef.current?.setEntry(ids),
      setNamed: (ids: ReadonlySet<string>) => focusRef.current?.setNamed(ids),
    }),
    [],
  );
}

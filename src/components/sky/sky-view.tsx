"use client";

import { useMemo } from "react";
import type { Chronicle } from "@/contracts/life";
import type { Dictionary } from "@/i18n/dictionary";
import { rolled, timeline } from "@/lib/sky/dial";
import type { Frame } from "@/lib/sky/scene-model";
import "./sky.css";
import { BackdropCanvas } from "./backdrop-canvas";
import { Odometer } from "./odometer";
import { Player } from "./player";
import { SkySvg } from "./sky-svg";
import { useSkyEngine } from "./use-sky-engine";

/** The finished life as a night sky. Mounted behind `?view=sky` until the cutover slice makes it the default. */
export function SkyView({ chronicle, dict }: { chronicle: Chronicle; dict: Dictionary }) {
  const { scene } = chronicle;
  const line = useMemo(() => timeline(scene, scene.span.end ?? scene.span.start), [scene]);
  const { svgRef, store, state, controls } = useSkyEngine(scene, line);
  const readYear = useMemo(() => (frame: Frame) => rolled(frame.t, line.dialStart), [line.dialStart]);
  const { sky } = dict;
  return (
    <section className="sky-frame" aria-label={sky.title(chronicle.protagonist.name)}>
      <BackdropCanvas />
      <div className="sky-area">
        <h1 className="sky-heading">{sky.title(chronicle.protagonist.name)}</h1>
        <div className="sky-disc">
          <SkySvg svgRef={svgRef} scene={scene} timeline={line} label={sky.constellationLabel(chronicle.protagonist.name)} />
        </div>
        <div className="sky-now">
          <Odometer store={store} digits={4} read={readYear} className="big" />
        </div>
      </div>
      <Player store={store} state={state} controls={controls} start={line.start} end={line.end} labels={sky.player} />
    </section>
  );
}

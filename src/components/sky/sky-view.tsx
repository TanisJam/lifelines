"use client";

import { AnimatePresence } from "motion/react";
import { useCallback, useMemo, useRef, useState } from "react";
import { PersonSheet } from "@/components/person-sheet";
import type { Chronicle } from "@/contracts/life";
import type { Dictionary } from "@/i18n/dictionary";
import { describeStar, relationLabel } from "@/lib/sky/describe-star";
import { rolled, timeline } from "@/lib/sky/dial";
import { reelEntries } from "@/lib/sky/reel-model";
import type { Frame } from "@/lib/sky/scene-model";
import "./sky.css";
import { BackdropCanvas } from "./backdrop-canvas";
import { Legend } from "./legend";
import { Odometer } from "./odometer";
import { Player } from "./player";
import { Reel } from "./reel";
import { SkySvg } from "./sky-svg";
import { StarTip } from "./star-tip";
import { useSkyEngine } from "./use-sky-engine";
import { useSkyFocus } from "./use-sky-focus";

/**
 * The finished life as a night sky. Mounted behind `?view=sky` until the cutover slice makes it the default.
 * `saved` is false while a life is still being generated: stars then focus and show their tooltip, and the
 * person sheet (which reads persisted data) opens once the life is saved.
 */
export function SkyView({ chronicle, dict, lang, saved = true }: { chronicle: Chronicle; dict: Dictionary; lang: string; saved?: boolean }) {
  const { scene } = chronicle;
  const { sky } = dict;
  const line = useMemo(() => timeline(scene, scene.span.end ?? scene.span.start), [scene]);
  const { svgRef, store, state, controls } = useSkyEngine(scene, line);
  const entries = useMemo(() => reelEntries(chronicle.entries), [chronicle.entries]);
  const readYear = useMemo(() => (frame: Frame) => rolled(frame.t, line.dialStart), [line.dialStart]);

  const tipRef = useRef<HTMLDivElement>(null);
  const [openPersonId, setOpenPersonId] = useState<string | null>(null);
  const describe = useMemo(() => describeStar.bind(null, sky, scene, chronicle.protagonist.sex), [sky, scene, chronicle.protagonist.sex]);
  const activate = useCallback(
    (personId: string) => {
      if (!saved) return false;
      setOpenPersonId(personId);
      return true;
    },
    [saved],
  );
  useSkyFocus({ svgRef, tipRef, scene, store, describe, activate });
  const bandLabels = sky.plague;
  const relation = useMemo(() => relationLabel.bind(null, sky, scene), [sky, scene]);

  return (
    <section className="sky-frame" aria-label={sky.title(chronicle.protagonist.name)}>
      <BackdropCanvas />
      <div className="sky-area">
        <h1 className="sky-heading">{sky.title(chronicle.protagonist.name)}</h1>
        <div className="sky-disc">
          <SkySvg svgRef={svgRef} scene={scene} timeline={line} label={sky.constellationLabel(chronicle.protagonist.name)} relation={relation} bandLabels={bandLabels} entries={entries} />
          <StarTip tipRef={tipRef} />
        </div>
        <div className="sky-now">
          <Odometer store={store} digits={4} read={readYear} className="big" />
        </div>
        <Reel entries={entries} store={store} seek={controls.seek} openPerson={saved ? setOpenPersonId : undefined} labels={sky.reel} />
      </div>
      <div className="sky-bottom">
        <Player store={store} state={state} controls={controls} start={line.start} end={line.end} labels={sky.player} />
        <Legend sky={sky} village={chronicle.villageName} sex={chronicle.protagonist.sex} />
      </div>
      <AnimatePresence>
        {openPersonId && <PersonSheet key={openPersonId} lifeId={chronicle.lifeId} branchId={chronicle.branchId} personId={openPersonId} lang={lang} onClose={() => setOpenPersonId(null)} />}
      </AnimatePresence>
    </section>
  );
}

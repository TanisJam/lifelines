"use client";

import { AnimatePresence } from "motion/react";
import { useCallback, useMemo, useRef, useState } from "react";
import { PersonSheet } from "@/components/person-sheet";
import type { Chronicle } from "@/contracts/life";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/dictionary";
import { describeStar, relationLabel } from "@/lib/sky/describe-star";
import { timeline } from "@/lib/sky/dial";
import { reelEntries } from "@/lib/sky/reel-model";
import "./sky.css";
import { BackdropCanvas } from "./backdrop-canvas";
import { Legend } from "./legend";
import { IntroPanel } from "./intro-panel";
import { NowPanel } from "./now-panel";
import { PlacePanel } from "./place-panel";
import { TimeBar } from "./timebar";
import { Player } from "./player";
import { Reel } from "./reel";
import { SkySvg } from "./sky-svg";
import { StarTip } from "./star-tip";
import { useSkyEngine } from "./use-sky-engine";
import { useSkyFocus } from "./use-sky-focus";

/**
 * A life as a night sky: saved (the default) or still being written. `saved` is false while the life is generated:
 * the scene grows tick by tick over the same engine (never a remount), the clock plays up to `frontier` and waits
 * there, stars focus and show their tooltip, and the person sheet (which reads persisted data) opens once the life
 * is saved. `tapeOffset` is the reconcile shift the reel glides away when done replaces the streamed entries.
 */
export function SkyView({ chronicle, dict, lang, saved = true, frontier, tapeOffset }: { chronicle: Chronicle; dict: Dictionary; lang: Locale; saved?: boolean; frontier?: number; tapeOffset?: number }) {
  const { scene } = chronicle;
  const { sky } = dict;
  const line = useMemo(() => timeline(scene, scene.span.end ?? frontier ?? scene.span.start), [scene, frontier]);
  const { svgRef, store, state, controls } = useSkyEngine(scene, line, { frontier: saved ? undefined : frontier, autoplay: !saved });
  const entries = useMemo(() => reelEntries(chronicle.entries), [chronicle.entries]);

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
  const focus = useSkyFocus({ svgRef, tipRef, scene, store, describe, activate });
  const bandLabels = sky.plague;
  const relation = useMemo(() => relationLabel.bind(null, sky, scene), [sky, scene]);

  return (
    <section className="sky-frame" aria-label={sky.title(chronicle.protagonist.name)}>
      <BackdropCanvas />
      <div className="sky-area">
        <IntroPanel chronicle={chronicle} sky={sky} store={store} />
        <div className="sky-disc">
          <SkySvg svgRef={svgRef} scene={scene} timeline={line} label={sky.constellationLabel(chronicle.protagonist.name)} relation={relation} bandLabels={bandLabels} entries={entries} />
          <StarTip tipRef={tipRef} />
        </div>
        <NowPanel scene={scene} store={store} lang={lang} village={chronicle.villageName} sky={sky} yearFloor={line.dialStart} />
        <TimeBar sky={sky} store={store} start={line.start} end={line.end} />
        <PlacePanel village={chronicle.villageName} sex={chronicle.protagonist.sex} sky={sky} store={store} />
        <Reel entries={entries} store={store} timeline={line} focus={focus} seek={controls.seek} openPerson={saved ? setOpenPersonId : undefined} tapeOffset={tapeOffset} labels={sky.reel} />
      </div>
      <div className="sky-bottom">
        <Player store={store} state={state} controls={controls} start={line.start} end={line.end} open={!saved} labels={sky.player} />
        <Legend sky={sky} village={chronicle.villageName} sex={chronicle.protagonist.sex} />
      </div>
      <AnimatePresence>
        {openPersonId && <PersonSheet key={openPersonId} lifeId={chronicle.lifeId} branchId={chronicle.branchId} personId={openPersonId} lang={lang} onClose={() => setOpenPersonId(null)} />}
      </AnimatePresence>
    </section>
  );
}

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
import { useTurnstileSiteKey } from "@/lib/turnstile-client";
import "./sky.css";
import { BackdropCanvas } from "./backdrop-canvas";
import { ChangeModal } from "./change-modal";
import type { TurnEntry } from "./change-rules";
import { Legend } from "./legend";
import { IntroPanel } from "./intro-panel";
import { NowPanel } from "./now-panel";
import { PlacePanel } from "./place-panel";
import { RewriteCard } from "./rewrite-card";
import { TimeBar } from "./timebar";
import { Player } from "./player";
import { Reel } from "./reel";
import { SkySvg } from "./sky-svg";
import { StarTip } from "./star-tip";
import { useSkyEngine } from "./use-sky-engine";
import { useForkGlide, useRewrite } from "./use-rewrite";
import { useSkyFocus } from "./use-sky-focus";

/**
 * A life as a night sky: saved (the default) or still being written. `saved` is false while the life is generated:
 * the scene grows tick by tick over the same engine (never a remount), the clock plays up to `frontier` and waits
 * there, stars focus and show their tooltip, and the person sheet (which reads persisted data) opens once the life
 * is saved.
 *
 * A saved life can be rewritten from any of its turns, on this same sky: the rewrite retains the old life (A, B),
 * streams the new one through the same engine update as a live life (C) and settles on the saved branch (D). See
 * `useRewrite`; what the sky shows during it comes from `lib/sky/rewrite`.
 */
export function SkyView({ chronicle: base, dict, lang, saved = true, frontier: liveFrontier }: { chronicle: Chronicle; dict: Dictionary; lang: Locale; saved?: boolean; frontier?: number }) {
  const rewrite = useRewrite(base, { lang, dict });
  const { state: rw, chronicle } = rewrite;
  const frontier = rewrite.frontier ?? (saved ? undefined : liveFrontier);
  const { scene } = chronicle;
  const { sky } = dict;
  const line = useMemo(() => timeline(scene, scene.span.end ?? frontier ?? scene.span.start), [scene, frontier]);
  const { svgRef, store, state, controls } = useSkyEngine(scene, line, { frontier, autoplay: !saved });
  const entries = useMemo(() => reelEntries(chronicle.entries), [chronicle.entries]);
  useForkGlide(rw.phase, rw.fork, store, controls.seek, controls.toggle);

  const tipRef = useRef<HTMLDivElement>(null);
  const [openPersonId, setOpenPersonId] = useState<string | null>(null);
  const [openEntry, setOpenEntry] = useState<TurnEntry | null>(null);
  const turnstileSiteKey = useTurnstileSiteKey();
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  /** Persisted data and a settled sky: the person sheet and "Change what happened" both read the saved branch. */
  const settled = saved && !rewrite.busy;
  const describe = useMemo(() => describeStar.bind(null, sky, scene, chronicle.protagonist.sex), [sky, scene, chronicle.protagonist.sex]);
  const activate = useCallback(
    (personId: string) => {
      if (!settled) return false;
      setOpenPersonId(personId);
      return true;
    },
    [settled],
  );
  const focus = useSkyFocus({ svgRef, tipRef, scene, store, describe, activate });
  const bandLabels = sky.plague;
  const relation = useMemo(() => relationLabel.bind(null, sky, scene), [sky, scene]);
  const reelLabels = useMemo(() => ({ ...sky.reel, change: dict.chronicle.changeWhatHappened }), [sky.reel, dict.chronicle.changeWhatHappened]);
  const change = useCallback(
    (entryId: string) => {
      const entry = chronicle.entries.find((e) => e.id === entryId);
      if (entry?.turn) setOpenEntry(entry as TurnEntry);
    },
    [chronicle.entries],
  );
  const choose = (optionId: string) => {
    if (!openEntry) return;
    void rewrite.start({ chronicle, entry: openEntry, optionId, turnstileToken: turnstileToken ?? undefined });
    setOpenEntry(null);
    setTurnstileToken(null);
  };
  // Phase B: everything after the fork is the old future, about to blur away.
  const forkAt = rw.phase === "B" ? (rw.fork?.at ?? null) : null;

  return (
    <section className={`sky-frame${forkAt === null ? "" : " rewriting"}`} aria-label={sky.title(chronicle.protagonist.name)}>
      <BackdropCanvas />
      <div className="sky-area">
        <IntroPanel chronicle={chronicle} sky={sky} store={store} labels={dict.chronicle} busy={rewrite.busy} seek={controls.seek} onBranch={rewrite.switchBranch} />
        <div className="sky-disc">
          <SkySvg svgRef={svgRef} scene={scene} timeline={line} label={sky.constellationLabel(chronicle.protagonist.name)} relation={relation} bandLabels={bandLabels} entries={entries} forkAt={forkAt} />
          <StarTip tipRef={tipRef} />
        </div>
        <NowPanel scene={scene} store={store} lang={lang} village={chronicle.villageName} sky={sky} yearFloor={line.dialStart} />
        <TimeBar sky={sky} store={store} start={line.start} end={line.end} />
        <PlacePanel village={chronicle.villageName} sex={chronicle.protagonist.sex} sky={sky} store={store} />
        <Reel entries={entries} store={store} timeline={line} focus={focus} seek={controls.seek} openPerson={settled ? setOpenPersonId : undefined} change={settled ? change : undefined} ghosts={rw.ghosts} forkAt={forkAt} labels={reelLabels} />
        <RewriteCard state={rw} firstName={chronicle.protagonist.name.split(" ")[0]!} dict={dict.chronicle} />
      </div>
      <div className="sky-bottom">
        <Player store={store} state={state} controls={controls} start={line.start} end={line.end} open={!saved || rw.phase === "C"} labels={sky.player} />
        <Legend sky={sky} village={chronicle.villageName} sex={chronicle.protagonist.sex} />
      </div>
      <AnimatePresence>
        {openPersonId && <PersonSheet key={openPersonId} lifeId={chronicle.lifeId} branchId={chronicle.branchId} personId={openPersonId} lang={lang} onClose={() => setOpenPersonId(null)} />}
        {openEntry && (
          <ChangeModal entry={openEntry} personSex={chronicle.protagonist.sex} dict={dict} onClose={() => setOpenEntry(null)} onChoose={choose} busy={rewrite.busy} turnstileSiteKey={turnstileSiteKey} turnstileToken={turnstileToken} onTurnstileToken={setTurnstileToken} />
        )}
      </AnimatePresence>
    </section>
  );
}

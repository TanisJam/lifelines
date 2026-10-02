"use client";

import { useEffect, useState } from "react";
import type { Chronicle } from "@/contracts/life";
import type { Dictionary } from "@/i18n/dictionary";
import { firstSentence } from "@/lib/sky/epitaph";
import type { PlayerStore } from "@/lib/sky/player-store";
import { ageAt } from "@/lib/sky/star-facts";

/** Title, lede and motto. Once the protagonist has died the motto gives way to the epitaph; only that flip reaches React. */
export function IntroPanel({ chronicle, sky, store }: { chronicle: Chronicle; sky: Dictionary["sky"]; store: PlayerStore }) {
  const { scene, protagonist } = chronicle;
  const [living, setLiving] = useState(true);
  useEffect(() => store.onFrame((frame) => setLiving(ageAt(scene, frame.t).alive)), [store, scene]);
  const epitaph = `${sky.intro.epitaph(protagonist.name, protagonist.birthYear, protagonist.deathYear ?? protagonist.birthYear)} ${firstSentence(chronicle.summary, chronicle.summaryLinks)}`.trim();
  return (
    <section className="sky-intro">
      <h1 className="sky-heading">{sky.title(protagonist.name)}</h1>
      <p className="sky-lede">{sky.intro.lede(protagonist.sex, chronicle.villageName)}</p>
      <hr className="sky-rule" />
      {living ? (
        <p key="motto" className="sky-motto">
          {sky.intro.mottoA}
          <br />
          {sky.intro.mottoB}
        </p>
      ) : (
        <p key="epitaph" className="sky-motto epitaph">
          {epitaph}
        </p>
      )}
      <hr className="sky-rule" />
    </section>
  );
}

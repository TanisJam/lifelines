"use client";

import { useEffect, useState } from "react";
import type { Chronicle } from "@/contracts/life";
import type { Dictionary } from "@/i18n/dictionary";
import { firstSentence } from "@/lib/sky/epitaph";
import type { PlayerStore } from "@/lib/sky/player-store";
import { ageAt } from "@/lib/sky/star-facts";

/**
 * Title, lede and motto. Once the protagonist has died the motto gives way to the epitaph; only that flip reaches React.
 * Under the motto, small links: "Changed in YYYY" (jumps the clock to the fork) on a rewritten branch, and the other
 * histories of this life (shown only when there is more than one; locked while a rewrite runs).
 */
export function IntroPanel({ chronicle, sky, store, labels, busy, seek, onBranch }: { chronicle: Chronicle; sky: Dictionary["sky"]; store: PlayerStore; labels: Pick<Dictionary["chronicle"], "changedInYear" | "originalLife" | "thisHistory">; busy: boolean; seek: (t: number) => void; onBranch: (branchId: string) => void }) {
  const { scene, protagonist } = chronicle;
  const [living, setLiving] = useState(true);
  useEffect(() => store.onFrame((frame) => setLiving(ageAt(scene, frame.t).alive)), [store, scene]);
  const { branches, branchId } = chronicle;
  const forkYear = branches.find((b) => b.branchId === branchId)?.forkYear ?? null;
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
      {forkYear !== null && (
        <p className="sky-branch-ribbon">
          <button type="button" onClick={() => seek(forkYear)}>
            {labels.changedInYear(forkYear)}
          </button>
        </p>
      )}
      {branches.length > 1 && (
        <ul className="sky-branches" aria-label={labels.thisHistory}>
          {branches.map((b) => (
            <li key={b.branchId}>
              <button type="button" aria-current={b.branchId === branchId} disabled={busy} onClick={() => onBranch(b.branchId)}>
                {b.forkYear === null ? labels.originalLife : labels.changedInYear(b.forkYear)}
              </button>
            </li>
          ))}
        </ul>
      )}
      <hr className="sky-rule" />
    </section>
  );
}

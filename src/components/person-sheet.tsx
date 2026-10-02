"use client";

import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { getPersonSheet } from "@/lib/life-client";
import type { PersonSheet as PersonSheetData } from "@/contracts/life";
import { isNarrowViewport, prefersReducedMotion } from "@/lib/viewport";
import { VineCorner } from "@/components/ornaments";
import "@/components/sky/sky-sheet.css";

/**
 * The read-only side sheet (single-life pivot, decision 041): clicking a `{{personId}}` link or a
 * cast-rail entry no longer switches the protagonist — there is only one protagonist now — it
 * opens this panel instead. A right-anchored slide-in panel on desktop, a bottom sheet on mobile,
 * on the night palette (`sky-sheet-*`, sky-sheet.css).
 */
/** Callers should pass `key={personId}` so switching to a different person remounts this panel
 * (and its loading state) from scratch, instead of resetting state imperatively inside an effect. */
export function PersonSheet({ lifeId, branchId, personId, lang, onClose }: { lifeId: string; branchId: string; personId: string; lang?: string; onClose: () => void }) {
  const [data, setData] = useState<PersonSheetData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mobile = isNarrowViewport();
  const reduceMotion = prefersReducedMotion();

  useEffect(() => {
    let cancelled = false;
    getPersonSheet(lifeId, personId, branchId, lang)
      .then((sheet) => {
        if (!cancelled) setData(sheet);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Couldn't load this person.");
      });
    return () => {
      cancelled = true;
    };
  }, [lifeId, personId, branchId, lang]);

  return (
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduceMotion ? 0 : 0.2 }} className="sky-sheet-backdrop" onClick={onClose} />
      <motion.div
        initial={mobile ? { y: "100%" } : { x: "100%" }}
        animate={mobile ? { y: 0 } : { x: 0 }}
        exit={mobile ? { y: "100%" } : { x: "100%" }}
        transition={{ duration: reduceMotion ? 0 : 0.25, ease: "easeOut" }}
        className={`sky-sheet${mobile ? " bottom" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={data ? data.name : "Person"}
      >
        <VineCorner className="sky-sheet-vine left" />
        <VineCorner className="sky-sheet-vine right" />
        <div className="sky-sheet-grabber" aria-hidden="true" />
        <button type="button" className="sky-sheet-close" onClick={onClose} aria-label="Close">
          ×
        </button>

        {error && <p className="sky-sheet-blurb">{error}</p>}
        {!data && !error && <p className="sky-sheet-blurb">Loading…</p>}

        {data && (
          <>
            <div className="sky-sheet-kicker">{data.relation}</div>
            <h2>{data.name}</h2>
            <div className="sky-sheet-years">
              {data.birthYear} — {data.deathYear ?? "living"}
            </div>
            {data.job && <p className="sky-sheet-job">{data.job}</p>}
            <p className="sky-sheet-blurb">{data.blurb}</p>

            {data.moments.length > 0 && (
              <div>
                <div className="sky-sheet-label">Moments</div>
                <ul className="sky-sheet-moments">
                  {data.moments.map((m, i) => (
                    <li key={i}>
                      <span>{m.year}</span> {m.title}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </motion.div>
    </>
  );
}

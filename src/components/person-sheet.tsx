"use client";

import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { getPersonSheet } from "@/lib/life-client";
import type { PersonSheet as PersonSheetData } from "@/contracts/life";
import { isNarrowViewport, prefersReducedMotion } from "@/lib/viewport";

/**
 * The read-only side sheet (single-life pivot, decision 041): clicking a `{{personId}}` link or a
 * cast-rail entry no longer switches the protagonist — there is only one protagonist now — it
 * opens this panel instead. A right-anchored slide-in panel on desktop, a bottom sheet on mobile,
 * reusing the Living Chronicle's existing dark drawer chrome.
 */
/** Callers should pass `key={personId}` so switching to a different person remounts this panel
 * (and its loading state) from scratch, instead of resetting state imperatively inside an effect. */
export function PersonSheet({ lifeId, branchId, personId, onClose }: { lifeId: string; branchId: string; personId: string; onClose: () => void }) {
  const [data, setData] = useState<PersonSheetData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mobile = isNarrowViewport();
  const reduceMotion = prefersReducedMotion();

  useEffect(() => {
    let cancelled = false;
    getPersonSheet(lifeId, personId, branchId)
      .then((sheet) => {
        if (!cancelled) setData(sheet);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Couldn't load this person.");
      });
    return () => {
      cancelled = true;
    };
  }, [lifeId, personId, branchId]);

  return (
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduceMotion ? 0 : 0.2 }} className="cw-drawer-backdrop" onClick={onClose} />
      <motion.div
        initial={mobile ? { y: "100%" } : { x: "100%" }}
        animate={mobile ? { y: 0 } : { x: 0 }}
        exit={mobile ? { y: "100%" } : { x: "100%" }}
        transition={{ duration: reduceMotion ? 0 : 0.25, ease: "easeOut" }}
        className={`cw-person-sheet-panel${mobile ? " cw-sheet-bottom" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={data ? data.name : "Person"}
      >
        <button type="button" className="cw-sheet-close" onClick={onClose} aria-label="Close">
          ×
        </button>

        {error && <p className="cw-sheet-blurb">{error}</p>}
        {!data && !error && <p className="cw-sheet-blurb">Loading…</p>}

        {data && (
          <>
            <div className="cw-modal-kicker">{data.relation}</div>
            <h2>{data.name}</h2>
            <div className="cw-years">
              {data.birthYear} — {data.deathYear ?? "living"}
            </div>
            {data.job && <p className="cw-sheet-job">{data.job}</p>}
            <p className="cw-sheet-blurb">{data.blurb}</p>

            {data.moments.length > 0 && (
              <div>
                <div className="cw-rail-label">Moments</div>
                <ul className="cw-sheet-moments">
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

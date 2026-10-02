"use client";

import { motion } from "motion/react";
import { useState } from "react";
import type { Dictionary } from "@/i18n/dictionary";
import { CheckCircleIcon, ChevronRightIcon, LeafGlyph, VineCorner } from "@/components/ornaments";
import { TurnstileWidget } from "@/components/turnstile-widget";
import { applyDisabled, chosenOption, whyQuestion, type TurnEntry } from "./change-rules";
import "./change-modal.css";

/**
 * The change sheet (design-system.md §6): a bottom sheet on mobile, a centered card ≥640px
 * (`.sky-change-card` picks the breakpoint). The current history is always the first option,
 * sage-tinted with a check; the rest are plain option cards that arm the primary "Apply this
 * change" button on click — "select first, then confirm" (ui-ux-handoff.md §8), so a stray click
 * can't accidentally rewrite a life.
 */
export function ChangeModal({
  entry,
  personSex,
  dict,
  onClose,
  onChoose,
  busy,
  turnstileSiteKey,
  turnstileToken,
  onTurnstileToken,
}: {
  entry: TurnEntry;
  personSex: "f" | "m";
  dict: Dictionary;
  onClose: () => void;
  onChoose: (optionId: string) => void;
  busy: boolean;
  turnstileSiteKey: string | null;
  turnstileToken: string | null;
  onTurnstileToken: (token: string | null) => void;
}) {
  const [showNumbers, setShowNumbers] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const { turn } = entry;
  const gate = { selected, busy, turnstileSiteKey, turnstileToken };
  const choice = chosenOption(gate);

  return (
    <div className="sky-change-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <motion.div initial={{ opacity: 0, scale: 0.97, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ duration: 0.2, ease: "easeOut" }} className="sky-change-card" onClick={(e) => e.stopPropagation()}>
        <VineCorner className="sky-sheet-vine left" />
        <VineCorner className="sky-sheet-vine right" />
        <div className="sky-change-grabber" aria-hidden="true" />

        <div className="sky-change-kicker">{entry.year}</div>
        <h2>{entry.title}</h2>
        <p>{dict.chronicle.modal.willBeRewritten}</p>

        <hr className="sky-change-sprig" />

        <p className="sky-change-prompt">{dict.chronicle.modal.howDoesThisUnfold}</p>
        <div className="sky-change-options">
          <div className="sky-change-option current" aria-current="true">
            <LeafGlyph className="sky-change-leaf" />
            <span className="sky-change-label">
              {turn.chosen.label}
              <span className="sky-change-sub">{dict.chronicle.modal.currentHistory}</span>
            </span>
            <CheckCircleIcon className="sky-change-chevron" />
          </div>
          {turn.alternatives.map((o) => (
            <button key={o.optionId} type="button" disabled={busy} onClick={() => setSelected(o.optionId)} className={`sky-change-option${selected === o.optionId ? " selected" : ""}`}>
              <LeafGlyph className="sky-change-leaf" />
              <span className="sky-change-label">{o.label}</span>
              {selected === o.optionId ? <CheckCircleIcon className="sky-change-chevron" /> : <ChevronRightIcon className="sky-change-chevron" />}
            </button>
          ))}
        </div>

        {turnstileSiteKey && (
          <div className="sky-change-turnstile" style={{ display: "flex", justifyContent: "center", margin: "12px 0" }}>
            <TurnstileWidget siteKey={turnstileSiteKey} onToken={onTurnstileToken} />
          </div>
        )}

        <button type="button" className="sky-change-apply" disabled={applyDisabled(gate)} onClick={() => choice && onChoose(choice)}>
          {busy ? dict.chronicle.modal.rewriting : dict.chronicle.modal.applyThisChange}
        </button>

        <div className="sky-change-actions">
          <button type="button" onClick={onClose}>
            {dict.chronicle.modal.cancel}
          </button>
        </div>

        <p className="sky-change-quote">{dict.chronicle.modal.rippleQuote}</p>

        <details className="sky-change-why" open={showNumbers} onToggle={(e) => setShowNumbers((e.target as HTMLDetailsElement).open)}>
          <summary>{whyQuestion(turn, personSex, dict)}</summary>
          <p>{turn.whyPhrase}</p>
          {showNumbers && turn.probabilities && (
            <ul style={{ marginTop: 8, display: "grid", gap: 4, fontSize: 12, color: "var(--ll-ink-soft)" }}>
              {[turn.chosen, ...turn.alternatives].map((o) => (
                <li key={o.optionId} style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>{o.label}</span>
                  <span style={{ fontVariantNumeric: "tabular-nums" }}>{Math.round((turn.probabilities?.[o.optionId] ?? 0) * 100)}%</span>
                </li>
              ))}
            </ul>
          )}
        </details>
      </motion.div>
    </div>
  );
}

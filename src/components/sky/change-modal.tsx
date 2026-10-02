"use client";

import { motion } from "motion/react";
import { useState } from "react";
import type { ChronicleEntry } from "@/contracts/life";
import type { Dictionary } from "@/i18n/dictionary";
import { CheckCircleIcon, ChevronRightIcon, LeafGlyph, SprigDivider, VineCorner } from "@/components/ornaments";
import { TurnstileWidget } from "@/components/turnstile-widget";

/**
 * The question in "Why did she choose this?"/"Why did Tomas Vell choose this?"/"Why did this
 * happen?" — derived from who actually decided (`turn.deciderId`), never assumed. `decidedBy` is
 * already a ready-made phrase ("Tomas Vell's choice") per the contract; stripping the trailing
 * "'s choice" recovers the name for an NPC decider without guessing a pronoun for them.
 */
function whyQuestion(turn: NonNullable<ChronicleEntry["turn"]>, protagonistSex: "f" | "m", dict: Dictionary): string {
  if (turn.deciderId === "chance") return dict.chronicle.modal.whyChance;
  if (turn.deciderId === "self") return dict.chronicle.modal.whySelf(protagonistSex);
  const name = turn.decidedBy.replace(/'s choice$/i, "");
  return dict.chronicle.modal.whyOther(name);
}

/**
 * The change sheet (design-system.md §6): a bottom sheet on mobile, a centered card ≥640px
 * (`.cw-sheet-on-mobile` picks the breakpoint). The current history is always the first option,
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
  entry: ChronicleEntry & { turn: NonNullable<ChronicleEntry["turn"]> };
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

  return (
    <div className="cw-modal-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <motion.div initial={{ opacity: 0, scale: 0.97, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ duration: 0.2, ease: "easeOut" }} className="cw-modal-card cw-sheet-on-mobile" onClick={(e) => e.stopPropagation()}>
        <VineCorner className="cw-vine-corner cw-vine-left h-7 w-7" />
        <VineCorner className="cw-vine-corner cw-vine-right h-7 w-7" />
        <div className="cw-sheet-grabber" aria-hidden="true" />

        <div className="cw-modal-kicker">{entry.year}</div>
        <h2>{entry.title}</h2>
        <p>{dict.chronicle.modal.willBeRewritten}</p>

        <SprigDivider className="cw-sprig" />

        <p className="cw-sheet-prompt">{dict.chronicle.modal.howDoesThisUnfold}</p>
        <div className="cw-options">
          <div className="cw-option-btn cw-current" aria-current="true">
            <LeafGlyph className="cw-option-leaf" />
            <span className="cw-option-label">
              {turn.chosen.label}
              <span className="cw-option-sub">{dict.chronicle.modal.currentHistory}</span>
            </span>
            <CheckCircleIcon className="cw-option-chevron" />
          </div>
          {turn.alternatives.map((o) => (
            <button key={o.optionId} type="button" disabled={busy} onClick={() => setSelected(o.optionId)} className={`cw-option-btn${selected === o.optionId ? " cw-selected" : ""}`}>
              <LeafGlyph className="cw-option-leaf" />
              <span className="cw-option-label">{o.label}</span>
              {selected === o.optionId ? <CheckCircleIcon className="cw-option-chevron" /> : <ChevronRightIcon className="cw-option-chevron" />}
            </button>
          ))}
        </div>

        {turnstileSiteKey && (
          <div className="cw-turnstile" style={{ display: "flex", justifyContent: "center", margin: "12px 0" }}>
            <TurnstileWidget siteKey={turnstileSiteKey} onToken={onTurnstileToken} />
          </div>
        )}

        <button type="button" className="cw-primary-btn" disabled={!selected || busy || (!!turnstileSiteKey && !turnstileToken)} onClick={() => selected && onChoose(selected)}>
          {busy ? dict.chronicle.modal.rewriting : dict.chronicle.modal.applyThisChange}
        </button>

        <div className="cw-modal-actions">
          <button type="button" onClick={onClose}>
            {dict.chronicle.modal.cancel}
          </button>
        </div>

        <p className="cw-sheet-quote">{dict.chronicle.modal.rippleQuote}</p>

        <details className="cw-why" open={showNumbers} onToggle={(e) => setShowNumbers((e.target as HTMLDetailsElement).open)}>
          <summary>{whyQuestion(turn, personSex, dict)}</summary>
          <p>{turn.whyPhrase}</p>
          {showNumbers && turn.probabilities && (
            <ul style={{ marginTop: 8, display: "grid", gap: 4, fontSize: 12, color: "var(--cw-muted)" }}>
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

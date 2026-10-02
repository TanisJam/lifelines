import type { ChronicleEntry } from "@/contracts/life";
import type { Dictionary } from "@/i18n/dictionary";

/** The turn of an entry that has one (a level-3 decision point). */
export type TurnEntry = ChronicleEntry & { turn: NonNullable<ChronicleEntry["turn"]> };

/**
 * The question in "Why did she choose this?"/"Why did Tomas Vell choose this?"/"Why did this
 * happen?" — derived from who actually decided (`turn.deciderId`), never assumed. `decidedBy` is
 * already a ready-made phrase ("Tomas Vell's choice") per the contract; stripping the trailing
 * "'s choice" recovers the name for an NPC decider without guessing a pronoun for them.
 */
export function whyQuestion(turn: TurnEntry["turn"], protagonistSex: "f" | "m", dict: Dictionary): string {
  if (turn.deciderId === "chance") return dict.chronicle.modal.whyChance;
  if (turn.deciderId === "self") return dict.chronicle.modal.whySelf(protagonistSex);
  const name = turn.decidedBy.replace(/'s choice$/i, "");
  return dict.chronicle.modal.whyOther(name);
}

export interface ApplyGate {
  readonly selected: string | null;
  readonly busy: boolean;
  readonly turnstileSiteKey: string | null;
  readonly turnstileToken: string | null;
}

/** "Select first, then confirm": Apply needs an alternative, no rewrite already running, and (when Turnstile is on) a token. */
export function applyDisabled({ selected, busy, turnstileSiteKey, turnstileToken }: ApplyGate): boolean {
  return !selected || busy || (!!turnstileSiteKey && !turnstileToken);
}

/** The option id Apply submits, or null while it is disabled. */
export function chosenOption(gate: ApplyGate): string | null {
  return applyDisabled(gate) ? null : gate.selected;
}

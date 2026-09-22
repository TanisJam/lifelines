/**
 * Engine life course (decision-identity capability): persisted, per-person bookkeeping used to mint
 * stable, ordinal decision ids (see `decision-id.ts`). This is the PR1 slots-only slice — `slots`
 * tracks how many times each `(kind, subject)` decision has occurred, and how many times it's been
 * offered since its last occurrence. The full `LifeState` (marital/residence/vocation/situations) is
 * added in a later slice; this type is extended, not replaced, so already-persisted `slots` stay valid.
 */

/** One decision kind's history for one subject: how many times it has occurred, and how many
 * offers have gone by since the last occurrence (reset to 0 whenever it occurs again). */
export interface SlotEntry {
  readonly occurred: number;
  readonly attempts: number;
}

/** Keyed by `slotKey(kind, subject)`. */
export type SlotState = Readonly<Record<string, SlotEntry>>;

export const EMPTY_SLOTS: SlotState = {};

/** The PR1 slice of `Person.lifeState` — slots only. Extended (not replaced) by later slices. */
export interface LifeState {
  readonly slots: SlotState;
}

/** A slot's key: one bookkeeping entry per (decision kind, subject) pair. */
export function slotKey(kind: string, subject: string): string {
  return `${kind}:${subject}`;
}

/**
 * Advances one slot after a decision at it was minted (see `mintDecisionId`): when it actually
 * occurred, `occurred` goes up by one and `attempts` resets to 0 (a fresh count starts toward the
 * next occurrence); when it was only offered (not recorded), `attempts` goes up by one and
 * `occurred` is left as-is. Every other key in `slots` is untouched.
 */
export function advanceSlot(slots: SlotState, key: string, occurred: boolean): SlotState {
  const entry = slots[key] ?? { occurred: 0, attempts: 0 };
  const next: SlotEntry = occurred ? { occurred: entry.occurred + 1, attempts: 0 } : { occurred: entry.occurred, attempts: entry.attempts + 1 };
  return { ...slots, [key]: next };
}

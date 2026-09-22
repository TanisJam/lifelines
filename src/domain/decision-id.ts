/**
 * Decision-identity capability: content-derived, year-free decision ids. Replaces the old
 * `<kind>:<subject>:<year>` scheme (whose year suffix `decisionYear()` used to parse back out —
 * removed; every consumer now reads `DecisionRecord.year` directly) with `<kind>:<subject>#<ordinal>.<attempt>`,
 * minted from the subject's `slots` bookkeeping (`life-state.ts`).
 */
import { pairKey } from "./events";
import { type SlotState, slotKey } from "./life-state";

export interface MintedId {
  readonly id: string;
  /** The slot key (`slotKey(kind, subject)`) this id was minted against. */
  readonly key: string;
  readonly ordinal: number;
  readonly attempt: number;
}

/**
 * Mints a stable, year-free decision id. `subject === "world"` (the one world-level decision kind,
 * immigration) uses the year itself as the ordinal — one such decision exists per year by
 * construction, so no persisted slot bookkeeping is needed for it. Every other subject's
 * ordinal/attempt come from its `SlotEntry` in `slots` (see `life-state.ts#advanceSlot`):
 * `ordinal = occurred + 1`, `attempt = attempts + 1`.
 */
export function mintDecisionId(kind: string, subject: string, year: number, slots: SlotState): MintedId {
  const key = slotKey(kind, subject);
  if (subject === "world") {
    return { id: `${kind}:${subject}#${year}.1`, key, ordinal: year, attempt: 1 };
  }
  const entry = slots[key] ?? { occurred: 0, attempts: 0 };
  const ordinal = entry.occurred + 1;
  const attempt = entry.attempts + 1;
  return { id: `${kind}:${subject}#${ordinal}.${attempt}`, key, ordinal, attempt };
}

/**
 * Extracts `{ kind, subject }` from a decision id, in EITHER format: the new
 * `<kind>:<subject>#<ordinal>.<attempt>` or the legacy `<kind>:<subject>:<year>`. Used to match an
 * `Override` (which may reference a decision minted under either scheme — old stored lives keep
 * their legacy ids, see the decision-identity spec's backward-compatibility requirement) against a
 * candidate by identity, never by parsing out a year.
 */
export function decisionSubject(decisionId: string): { readonly kind: string; readonly subject: string } {
  const firstColon = decisionId.indexOf(":");
  if (firstColon === -1) return { kind: decisionId, subject: "" };
  const kind = decisionId.slice(0, firstColon);
  const rest = decisionId.slice(firstColon + 1);
  const hashIndex = rest.indexOf("#");
  if (hashIndex !== -1) return { kind, subject: rest.slice(0, hashIndex) };
  const lastColon = rest.lastIndexOf(":");
  const subject = lastColon !== -1 ? rest.slice(0, lastColon) : rest;
  return { kind, subject };
}

/**
 * Matches a parsed override subject against a candidate's own identity (fixed after review,
 * R3-001). The new ordinal scheme and a legacy id for a NON-paired kind both carry a bare
 * `personId` as `subject`, so `personId === subject` covers them directly. A legacy id for a
 * PAIRED social kind (e.g. `Y1`) instead embeds the two participants' `pairKey` as `subject` (the
 * pre-change persisted `DecisionRecord.id` shape) — never a bare personId — so a candidate with a
 * `partnerId` also matches when its own recomputed pair key equals `subject`. Design decision 7:
 * a legacy paired override matches by (kind, personId, partnerId), never by parsing the pair key
 * back apart.
 */
export function candidateMatchesSubject(subject: string, personId: string, partnerId: string | undefined): boolean {
  return personId === subject || (partnerId !== undefined && pairKey(personId, partnerId) === subject);
}

interface DecisionLike {
  readonly id: string;
  readonly year: number;
  readonly kind: string;
  readonly personId: string;
}

/**
 * Maps each decision's id to its causal slot position (`slotKey#N`, the Nth time this
 * `(kind, personId)` pair appears in year order) — an identity shared between an old (year-embedded)
 * and a new (ordinal) id scheme, independent of either one's literal string. Used to correlate a
 * base branch against a rewritten one for ghost annotations (see `buildGhostAnnotations`), since a
 * rewritten decision's id never shares a format — or even a year — with the one it replaced.
 */
export function causalPositions(decisions: readonly DecisionLike[]): ReadonlyMap<string, string> {
  const counts = new Map<string, number>();
  const positions = new Map<string, string>();
  for (const d of [...decisions].sort((a, b) => a.year - b.year)) {
    const key = slotKey(d.kind, d.personId);
    const n = (counts.get(key) ?? 0) + 1;
    counts.set(key, n);
    positions.set(d.id, `${key}#${n}`);
  }
  return positions;
}

interface DecisionOptionLike {
  readonly id: string;
  readonly label: string;
}

interface DecisionRecordLike extends DecisionLike {
  readonly chosen: string;
  readonly options: readonly DecisionOptionLike[];
}

interface ChronicleEntryLike {
  readonly id: string;
  readonly turn?: { readonly decisionId: string; readonly chosen: { readonly optionId: string } };
}

/**
 * Builds ghost annotations (round 9, decision 036) for a rewrite's new entries whose turn actually
 * diverged from the base branch — matched by causal position (see `causalPositions`), not by literal
 * decision id, so a rewrite that mints ids in a different format (or shifts a decision's year) still
 * finds its match.
 *
 * `forkYear`, when given (fixed after review, R3-002), numbers the base branch's occurrences ONLY
 * from the fork point on. `newDecisions` comes from a `simulate()` run started fresh at `forkYear`
 * (no prior decisions), so its own occurrence #1 means the fork's first post-fork decision, not the
 * base branch's first decision of that kind ever — a recurring kind (death, illness, D1, ...) must
 * count from the same origin on both sides, or a post-fork decision pairs against the wrong
 * pre-fork one. Defaults to "no filter" for callers (and existing tests) that don't fork.
 */
export function buildGhostAnnotations(
  baseDecisions: readonly DecisionRecordLike[],
  newDecisions: readonly DecisionRecordLike[],
  newEntries: readonly ChronicleEntryLike[],
  forkYear: number = Number.NEGATIVE_INFINITY,
): Record<string, string> {
  const baseFromFork = baseDecisions.filter((d) => d.year >= forkYear);
  const oldPositions = causalPositions(baseFromFork);
  const newPositions = causalPositions(newDecisions);
  const oldByPosition = new Map(baseFromFork.map((d) => [oldPositions.get(d.id), d] as const));

  const ghosts: Record<string, string> = {};
  for (const entry of newEntries) {
    if (!entry.turn) continue;
    const position = newPositions.get(entry.turn.decisionId);
    const oldDecision = position !== undefined ? oldByPosition.get(position) : undefined;
    if (!oldDecision || oldDecision.chosen === entry.turn.chosen.optionId) continue;
    const oldLabel = oldDecision.options.find((o) => o.id === oldDecision.chosen)?.label ?? oldDecision.chosen;
    ghosts[entry.id] = `In the original life, ${oldLabel.charAt(0).toLowerCase()}${oldLabel.slice(1)}.`;
  }
  return ghosts;
}

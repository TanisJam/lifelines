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
  readonly partnerId?: string;
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
 * Decision 082: how far apart (in years) two decisions may sit and still plausibly be "the same
 * life moment, shifted by the butterfly effect" for ghost-matching purposes. Measured (25 seeds,
 * `scripts/ghost-match-rate.ts`) shifts of 1-3 years are the common case for a downstream decision
 * whose timing itself depends on earlier state (courtship/marriage timing, the next D1 vignette
 * slot, ...); a much larger gap risks pairing two decisions that only coincidentally share a kind
 * and the same two people years apart (e.g. two unrelated Y5 friendship check-ins with the same
 * friend, a decade apart) — an "unrelated event", which a ghost must never annotate against. Not a
 * demography constant (no `provenance.ts` entry): an engine-mechanics matching threshold, not a
 * calibration target.
 */
const GHOST_MATCH_WINDOW_YEARS = 5;

/** Groups by "same actors/relationship" — kind + personId + partnerId (when either side has one) — so a Y5 friendship with Alice never pairs against an unrelated Y5 with Bob just because both are the person's Nth Y5 overall. */
function ghostGroupKey(d: DecisionLike): string {
  return `${slotKey(d.kind, d.personId)}~${d.partnerId ?? ""}`;
}

/**
 * Builds ghost annotations (round 9, decision 036) for a rewrite's new entries whose turn actually
 * diverged from the base branch.
 *
 * Matched by nearest-year, one-to-one pairing within the SAME (kind, personId, partnerId) group
 * (decision 082) — not by exact causal-position ordinal (`causalPositions`, decision 061), which
 * mispairs whenever the butterfly effect adds or removes an occurrence of that same group between
 * the fork and the target decision: every LATER ordinal in that group then shifts out of alignment,
 * either producing a ghost against the wrong decision or leaving a genuinely-shifted one with no
 * match at all (measured with `scripts/ghost-match-rate.ts`, 25 seeds, 52 genuine post-fork
 * divergences with a real counterpart: 4 came back empty before this fix, 1 after). Nearest-year matching, assigned
 * globally by ascending gap (never by processing order, which would let an unrelated NEW occurrence
 * greedily claim the one real counterpart before the actually-shifted one gets a look), fixes both:
 * a shifted occurrence still finds its counterpart regardless of how the group's occurrence COUNT
 * changed, and a genuinely new occurrence with nothing within `GHOST_MATCH_WINDOW_YEARS` of it
 * simply gets no match — never a fabricated one, keeping annotations truthful.
 *
 * `forkYear`, when given (fixed after review, R3-002), restricts the base branch's candidates to
 * ones at or after the fork point. `newDecisions` comes from a `simulate()` run started fresh at
 * `forkYear` (no prior decisions), so a post-fork decision is never paired against a pre-fork one
 * of the same recurring kind. Defaults to "no filter" for callers (and existing tests) that don't fork.
 */
export function buildGhostAnnotations(
  baseDecisions: readonly DecisionRecordLike[],
  newDecisions: readonly DecisionRecordLike[],
  newEntries: readonly ChronicleEntryLike[],
  forkYear: number = Number.NEGATIVE_INFINITY,
): Record<string, string> {
  const baseFromFork = baseDecisions.filter((d) => d.year >= forkYear);
  const newById = new Map(newDecisions.map((d) => [d.id, d] as const));

  const oldByGroup = new Map<string, DecisionRecordLike[]>();
  for (const d of baseFromFork) {
    const key = ghostGroupKey(d);
    const bucket = oldByGroup.get(key);
    if (bucket) bucket.push(d);
    else oldByGroup.set(key, [d]);
  }

  // Every candidate (new decision, old decision) pair in the same group, within the window —
  // assigned greedily by ascending year gap so the CLOSEST pair wins regardless of which one this
  // loop reaches first, and each side is consumed by at most one match.
  interface Candidate {
    readonly newDecision: DecisionRecordLike;
    readonly oldDecision: DecisionRecordLike;
    readonly gap: number;
  }
  const candidates: Candidate[] = [];
  for (const nd of newDecisions) {
    for (const od of oldByGroup.get(ghostGroupKey(nd)) ?? []) {
      const gap = Math.abs(od.year - nd.year);
      if (gap <= GHOST_MATCH_WINDOW_YEARS) candidates.push({ newDecision: nd, oldDecision: od, gap });
    }
  }
  candidates.sort((a, b) => a.gap - b.gap);

  const matchedOld = new Set<DecisionRecordLike>();
  const matchedNew = new Map<string, DecisionRecordLike>(); // new decision id -> its matched old decision
  for (const c of candidates) {
    if (matchedNew.has(c.newDecision.id) || matchedOld.has(c.oldDecision)) continue;
    matchedOld.add(c.oldDecision);
    matchedNew.set(c.newDecision.id, c.oldDecision);
  }

  const ghosts: Record<string, string> = {};
  for (const entry of newEntries) {
    if (!entry.turn) continue;
    const newDecision = newById.get(entry.turn.decisionId);
    const oldDecision = newDecision ? matchedNew.get(newDecision.id) : undefined;
    if (!oldDecision || oldDecision.chosen === entry.turn.chosen.optionId) continue;
    const oldLabel = oldDecision.options.find((o) => o.id === oldDecision.chosen)?.label ?? oldDecision.chosen;
    ghosts[entry.id] = `In the original life, ${oldLabel.charAt(0).toLowerCase()}${oldLabel.slice(1)}.`;
  }
  return ghosts;
}

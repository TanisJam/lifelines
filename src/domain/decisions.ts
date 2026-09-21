import type { JsonValue } from "./types";

/**
 * The situation codes (round 4, docs/mind-model.md) the engine asks a
 * DecisionMaker about — code decides WHICH situation a person faces and
 * WHEN (a trigger in `simulate.ts`); Jev decides how the person, played
 * through their `PersonMind`, responds. Physics/biology (aging, fertility
 * window, illness, death) is computed directly from actuarial curves and
 * never goes through this port. Round 4 implemented a prioritized subset
 * (decision 017): Y1, A1, A2, A3, Y3, Y4, A6, A8, A11 — the arc of
 * courtship through career, conflict, dreams and breakdowns. Round 5
 * (decision 025) adds C2 (losing a parent), A5 (town crisis) and O2/O4
 * (old grudge / facing death). Round 6 (decision 030) adds C3 (early
 * calling), filling in a childhood gap. Round 9 (decision 035, the single-life pivot) fills in
 * the rest of the mind-model.md catalog — C1, C4, Y2, Y5, A4, A7, A9, A10, O1, O3 — plus two
 * protagonist-only situations not in the original catalog: `AP1` (a parent's apprenticeship
 * choice) and `PIL1` (a pilgrimage). Every kind in this second batch is gated to the protagonist
 * alone (see `simulate.ts#gatherCandidatesForYear`'s `protagonistId` parameter) — NPCs keep the
 * original 14-kind catalog, so town-wide call volume is unaffected. `"levy"` (the lord's demand)
 * is a biology-style kind, like `"illness"`/`"death"` — code alone decides whether it happens; it
 * never reaches a `DecisionMaker`.
 */
export type DecisionKind =
  | "Y1"
  | "A1"
  | "A2"
  | "A3"
  | "Y3"
  | "Y4"
  | "A6"
  | "A8"
  | "A11"
  | "C2"
  | "O2"
  | "O4"
  | "A5"
  | "C3"
  | "C1"
  | "C4"
  | "Y2"
  | "Y5"
  | "A4"
  | "A7"
  | "A9"
  | "A10"
  | "O1"
  | "O3"
  | "AP1"
  | "PIL1";

/**
 * One question posed to a DecisionMaker. `id` is a stable, content-derived
 * identifier used both as the cache key and as the RNG key salt, so it must
 * be a pure function of the question's meaning (not of call order).
 */
export interface DecisionQuestion {
  readonly id: string;
  readonly kind: DecisionKind;
  /** The person whose decision this is. */
  readonly personId: string;
  readonly year: number;
  /** Rich, named state describing everyone and everything relevant to this call. */
  readonly state: Readonly<Record<string, JsonValue>>;
  /** The possible outcomes, in stable order. */
  readonly options: readonly string[];
}

/** Options mapped to probabilities. Should sum to ~1 but callers normalize defensively. */
export type Distribution<Option extends string = string> = Readonly<Record<Option, number>>;

/**
 * The port. The domain engine samples the returned distribution itself with
 * the keyed RNG (see `rng.ts`) — a DecisionMaker never rolls dice, it only
 * judges likelihoods. That split is what keeps re-simulation reproducible:
 * the same distribution + the same RNG key always yields the same outcome.
 */
export interface DecisionMaker {
  decide(question: DecisionQuestion): Promise<Distribution>;
  /**
   * Optional: score the narrative significance of an already-decided event,
   * in [0, 1]. Used for story sifting (highlighting key moments). Adapters
   * that don't support this can omit it; the caller falls back to a
   * heuristic.
   */
  significance?(input: { readonly summary: string; readonly state: Readonly<Record<string, JsonValue>> }): Promise<number>;
  /** Cumulative call/cache/latency counters since the adapter was created. Adapters that don't track this omit it. */
  getStats?(): DecisionMakerStats;
}

export interface DecisionMakerStats {
  calls: number;
  cacheHits: number;
  wallTimeMs: number;
  /** Cumulative input tokens across all real (non-cached) calls, if the adapter tracks it (round 4: "measure the input tokens per call if the SDK exposes usage"). */
  inputTokens?: number;
  outputTokens?: number;
}

/**
 * Every decision id ends with `:<year>` (see `simulate.ts#gatherCandidatesForYear`
 * and `resolveBiologyDecision`) — this pulls it back out, so an `Override`
 * (which per decision 008 carries only `decisionId` + `optionId`) still
 * lets a fork know which year's snapshot to restore.
 */
export function decisionYear(decisionId: string): number {
  const year = Number(decisionId.split(":").pop());
  if (!Number.isFinite(year)) throw new Error(`Malformed decision id (no trailing year): "${decisionId}"`);
  return year;
}

/** Where a decision's `final` distribution came from. */
export type DecisionSource = "jev" | "rules" | "biology" | "forced";

export interface DecisionOption {
  readonly id: string;
  /** Human-readable label for the UI (e.g. "Marry", "Survive"). */
  readonly label: string;
}

/**
 * A recorded choice point (decision 007). Every social decision, and every
 * "significant" biology roll (see `simulate.ts`'s recording threshold),
 * becomes one of these. Events reference the decision that produced them
 * via `resultingEventIds`; the UI's link inspector reads a `DecisionRecord`
 * directly to show the question, each option's odds, and what actually
 * happened.
 *
 * Per decision 016 (which fully supersedes 013's blend): when the engine
 * is Jev, `final` IS `jevRaw` — Jev's own judgment, unweighted by any
 * code-side prior. `prior` is only present when Jev was NOT asked (rules
 * engine, biology, or a forced override), in which case `final` is that
 * `prior`. The two are never mixed. `jevRaw` is still cached and reported
 * as-is either way, so it stays reusable and inspectable on its own terms
 * even in a future where `final` might diverge from it for some other
 * reason.
 */
export interface DecisionRecord {
  /** Content-derived, stable across forks: `<kind>:<personId-or-pairKey-or-"world">:<year>`. */
  readonly id: string;
  readonly personId: string;
  /**
   * Round 9 (decision 035): the other person involved, when there is one (a suitor, a rival, a
   * parent making a choice ABOUT someone else, etc). Lets a chronicle builder find every decision
   * that shaped a given person's life, not just the ones they made themselves — e.g. `AP1`
   * (a parent's apprenticeship choice) has `personId` = the parent and `partnerId` = the child it
   * was decided about.
   */
  readonly partnerId?: string;
  readonly year: number;
  /** A `DecisionKind`, or a biology kind: "illness" | "death" | "immigration" | "levy". */
  readonly kind: string;
  /** Human-readable, e.g. "Does Cressida start a romance with Garrick?". */
  readonly question: string;
  readonly options: readonly DecisionOption[];
  /** Jev's own distribution, cached and reported as-is. Present only when Jev was actually asked (`source: "jev"`). */
  readonly jevRaw?: Distribution;
  /** The code-side distribution, present only when Jev was NOT asked (`source: "rules" | "biology"`). Never blended with `jevRaw`. */
  readonly prior?: Distribution;
  /** What was actually sampled from: `jevRaw` when `source === "jev"`, `prior` otherwise, or a one-option certainty when `source === "forced"`. */
  readonly final: Distribution;
  /** Gumbel noise per option id, keyed by (seed, personId, year, kind, optionId). Empty for a forced decision (nothing was sampled). */
  readonly noise: Readonly<Record<string, number>>;
  readonly chosen: string;
  /**
   * The gap between the winning and runner-up GUMBEL SCORES (`log p + g`),
   * not probabilities — a small gap means a small change would have
   * flipped the outcome. This is "close call" (round 4 fix, decision 018;
   * supersedes round 3's probability-gap `margin`). `Infinity` for a
   * forced decision (nothing was sampled) or a single-option one.
   */
  readonly fragility: number;
  /** The chosen option had low probability (< 20% by default) — a long shot that won, independent of how fragile the call was. See `rng.ts#isSurprise`. */
  readonly surprise: boolean;
  readonly source: DecisionSource;
  /** Earlier event ids that causally influenced this decision (e.g. a recent breakup biasing a move). */
  readonly causes: readonly string[];
  /** Event ids this decision produced, if any (a "nothing happens" outcome produces none). */
  readonly resultingEventIds: readonly string[];
}

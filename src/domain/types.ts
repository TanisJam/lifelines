/** Pure domain types. No Next.js, no SDK, no I/O. */
import type { DecisionRecord } from "./decisions";
import type { LifeState } from "./life-state";
import type { PersonMind } from "./mind";

export type Sex = "f" | "m";

/** A small fixed vocabulary of personality traits, rendered as text for Jev's state. */
export const TRAIT_POOL = [
  "ambitious",
  "kind",
  "hot-tempered",
  "cautious",
  "reckless",
  "loyal",
  "restless",
  "reserved",
  "gregarious",
  "stubborn",
  "romantic",
  "practical",
  "envious",
  "generous",
  "melancholic",
  "cheerful",
] as const;
export type Trait = (typeof TRAIT_POOL)[number];

/**
 * Round 13 (decisions 048/049/056/057): jobs are class-bound (see
 * `worldgen.ts#JOB_POOL_BY_CLASS`) and period-appropriate for early Tudor England — `scholar` and
 * `guard` are removed (soldiering happens via the existing `levy` situation, not a standing job),
 * and the old flat, uniformly-random pool is replaced with trades actually attested for a c.
 * 1498-1558 English village (research.md, "Social structure, work and material life" §2).
 */
export const JOB_POOL = ["labourer", "shepherd", "farmer", "blacksmith", "carpenter", "weaver", "miller", "baker", "tanner", "healer", "merchant", "innkeeper", "priest", "landholder", "none"] as const;
export type Job = (typeof JOB_POOL)[number];

/**
 * Social class / estate, renamed 1:1 for the 1327-1361 period setting (decision 063,
 * engine-life-course PR4; supersedes decision 049's Tudor-era pool). `cottar` (was `labourer`) =
 * smallholder/landless wage labourer, `villein` (was `husbandman`) = unfree customary tenant,
 * `freeholder` (was `yeoman`) = wealthier free tenant, `clergy` = the parish priest (celibate,
 * `canMarry` in `simulate.ts` returns false for this class), `gentry` = knight/gentry households.
 * `artisan`/`merchant` are unchanged. A stored life from before this rename keeps its OLD literal
 * value on disk — `period/classes.ts#mapLegacyClass` maps it to this pool at read time only.
 */
export const SOCIAL_CLASS_POOL = ["villein", "cottar", "freeholder", "artisan", "merchant", "clergy", "gentry"] as const;
export type SocialClass = (typeof SOCIAL_CLASS_POOL)[number];

export interface Person {
  readonly id: string;
  readonly name: string;
  readonly sex: Sex;
  readonly birthYear: number;
  /** Set once the person dies; absent while alive. */
  deathYear?: number;
  readonly traits: readonly Trait[];
  job: Job;
  spouseId?: string;
  /** Parents, if known (founders have none). */
  readonly motherId?: string;
  readonly fatherId?: string;
  /** True for the initial cast generated at world creation. */
  readonly founder: boolean;
  /**
   * Decision 049: inherited from the father at birth (mother if father unknown — decision 056).
   * Optional so a hand-built `Person` fixture (tests, or data from before this field existed) stays
   * valid; every code path that reads it falls back to `"cottar"` (the mapped equivalent of the old
   * `"labourer"` default) via `person.socialClass ?? "cottar"` rather than assuming it's always present.
   */
  socialClass?: SocialClass;
  /**
   * Decision 057: whether this person can read, decided deterministically at birth by class and
   * sex (research.md, "Literacy by class and sex"). Optional for the same backward-compat reason as
   * `socialClass`; absent is treated as `false` everywhere it's read.
   */
  literate?: boolean;
  /**
   * True only for a lightweight newcomer met in the place the protagonist settled after leaving
   * home (decision 040) — a suitor, spouse, friend, or child born away. Excluded from the general
   * village's own illness/death/courtship pools (`gatherCandidatesForYear`) so they never marry or
   * die independently of the protagonist's own away-catalog situations.
   */
  readonly away?: true;
  /** The DF-inspired inner-life model (round 4, docs/mind-model.md). Every person has one; Jev reads it, code writes it. */
  mind: PersonMind;
  /**
   * Decision-identity + life-state capabilities: bookkeeping `simulate.ts` mutates in place as
   * decisions are minted (see `decision-id.ts#mintDecisionId`, `life-state.ts#advanceSlot`).
   * Optional for the same backward-compat reason as `socialClass`/`literate` — a life stored before
   * this field existed has none; every reader falls back to `EMPTY_SLOTS`, no migration needed.
   */
  lifeState?: LifeState;
}

export const EVENT_KINDS = [
  "birth",
  "school",
  "job",
  "move",
  "romance",
  "marriage",
  "breakup",
  "feud",
  "reconciliation",
  "illness",
  "death",
  "child",
  "breakdown",
  "dream",
  "town",
  "reflection",
  "levy",
  "vignette",
  /**
   * Decision 054: fired for the surviving spouse the same year their partner dies — actors
   * `[survivorId, deceasedId]`. Previously `spouseId` was never cleared on death at all (a bug:
   * widows/widowers could never remarry); this event is the durable record of the moment that
   * changed, so a chronicle can say "was widowed" instead of the marriage just silently vanishing.
   */
  "widowed",
  /**
   * Engine life course PR5: a pre-window backstory fact backfilled onto a founder or founder
   * child — `payload.marker` is `"great-famine"` (survived the 1315-22 famine as a child, or was
   * claimed by it before the sim window opens) or `"cattle-murrain"` (a villein/freeholder
   * household's 1319-21 livestock loss). Narrative-only; never affects in-sim mortality by itself.
   */
  "period-marker",
  /**
   * Engine life course PR5: a manorial due paid by (or on behalf of) an unfree person —
   * `payload.fine` is `"merchet"` (marriage), `"heriot"` (a tenant's death), `"chevage"` (a licence
   * to live away) or `"leyrwite"` (the courting-year presentment); `payload.payee` is always
   * `"lord"`, who stays off-stage (design decision 10) — never a `Person`.
   */
  "manorial-fine",
] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

/** JSON-safe payload value. */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/**
 * One entry in the event log — the single source of truth for everything
 * that happened. Prose is rendered FROM events by templates; nothing is
 * ever stored as free text.
 */
export interface Event {
  readonly id: string;
  readonly year: number;
  readonly kind: EventKind;
  /** People this event happened to / involves, in a stable, meaningful order. */
  readonly actors: readonly string[];
  readonly payload: Readonly<Record<string, JsonValue>>;
  /** IDs of earlier events that causally led to this one. */
  readonly causes: readonly string[];
  /** Narrative significance in [0, 1], filled in lazily for story sifting. */
  significance?: number;
}

export interface Town {
  readonly name: string;
}

export interface WorldConfig {
  readonly seed: string;
  readonly startYear: number;
  readonly endYear: number;
  readonly town: Town;
}

/** The full state produced by a simulation run: a config plus its outcome. */
export interface SimulationResult {
  readonly config: WorldConfig;
  readonly people: Readonly<Record<string, Person>>;
  readonly events: readonly Event[];
  readonly decisions: readonly DecisionRecord[];
}

/** A deep, structurally-cloned snapshot of simulation state at the end of a given year. */
export interface YearSnapshot {
  readonly year: number;
  readonly people: Readonly<Record<string, Person>>;
  readonly events: readonly Event[];
  readonly decisions: readonly DecisionRecord[];
}

// --- Overrides (edits) -----------------------------------------------------

/**
 * The generic override (decision 008): at decision `decisionId`, force
 * option `optionId` instead of sampling it. This replaced six hand-coded
 * edit kinds (force/prevent-marriage, force/prevent-move, change-job,
 * prevent-death) — every one of those is now just "choose a specific
 * option at a specific decision". A prevented death, for example, is
 * choosing "survive" at that person's `death:<personId>:<year>` decision.
 * Validation reduces to one rule: the decision must exist in the base
 * branch at the state the fork restores, and the option must be one of its
 * options (see `validate-override.ts`).
 */
export interface Override {
  readonly id: string;
  readonly decisionId: string;
  readonly optionId: string;
}

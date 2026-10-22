import { instantiateLifecycleGenesis, type LifecycleGenesis } from "./e-lifecycle-genesis";
import { createRulesYearSource } from "./e-year-source";
import { planAnnualFavorDraft, stableAnnualIdOrder } from "./e-annual-policy";
import { planAnnualHelpSlot } from "./e-annual-composition";
import { createFavorExecutor } from "./e-favor-executor";
import { inspectHelpOpportunities } from "./effects";
import { captureLegacyYear } from "./legacy-year";
import type { LegacyOwnedRunState } from "./simulate";
import type { GrantIntention, RequestIntention, ResourceOperation, RuntimeEntry, RuntimeOutput } from "./e-runtime";
import type { YearSnapshot } from "./types";

type Immutable<T> = T extends object ? { readonly [K in keyof T]: Immutable<T[K]> } : T;

/** Native state and economic view are cloned together: these are aliases, not mirrors. */
export interface LifecycleState {
  owned: LegacyOwnedRunState;
  favors: RuntimeOutput["state"];
}
export interface LifecycleHelpSlot {
  creditor: string;
  slot: 0 | 1;
  /** Current evidence immediately before planning, including legitimate ineligibility. */
  opportunities: ReturnType<typeof inspectHelpOpportunities>;
  /** null means only "no request planned"; the planner exposes no activation reason. */
  request: RequestIntention | null;
}
/**
 * Per-year audit evidence. `physicalSnapshot`, `economics` and `positions` are retained only in
 * `"audit"` mode: no production reader consumes them (the views read `final.owned`), and they are
 * 90%+ of a life's bytes. `economics.entries` alone embeds, per operation, a clone of the whole
 * obligations/ties ledgers plus every prior operation id, which is O(operations x history) per year
 * and quadratic over a life. See `odd/tasks/lifecycle-full-lifetime.md`.
 */
export interface LifecycleYearRecord {
  year: number;
  versions: LifecycleGenesis["versions"];
  /** Pre-economic people/events/decisions. The pre-economic favor ledger copy is NOT retained. */
  physicalSnapshot?: YearSnapshot;
  economics?: {
    resources: ResourceOperation[];
    grants: GrantIntention[];
    creditors: string[];
    slots: LifecycleHelpSlot[];
    requests: RequestIntention[];
    entries: RuntimeEntry[];
  };
  /** Life-log indices and economic positions are deliberately separate namespaces. */
  positions?: {
    life: { start: number; end: number };
    decisions: { start: number; end: number };
    economic: { start: number; end: number };
  };
  /** The year's actual post-economics state; the only full state copy retained per year. */
  final: LifecycleState;
}

/**
 * `"audit"` (default) retains every per-year field, including the planning evidence no reader uses.
 * `"compact"` retains only what the views consume, which is what makes a life longer than ~17 years
 * possible: the audit fields alone exceed V8's string limit at that point.
 */
export interface LifecycleRuntimeOptions {
  readonly journal?: "audit" | "compact";
}
export interface LifecycleOutput extends LifecycleState {
  versions: LifecycleGenesis["versions"];
  genesisDigest: string;
  protagonistId: string;
  frontier: number;
  status: "incomplete" | "complete";
  /** Complete actual final native state, including any favor-updated Mind. */
  canonicalYearSnapshot: YearSnapshot;
  journal: LifecycleYearRecord[];
}

function freeze<T>(value: T, seen = new Set<object>()): Immutable<T> {
  if (value !== null && typeof value === "object" && !seen.has(value)) {
    seen.add(value);
    for (const entry of Object.values(value)) freeze(entry, seen);
    Object.freeze(value);
  }
  return value as Immutable<T>;
}
function requireYear(year: number): void {
  if (!Number.isSafeInteger(year) || Object.is(year, -0)) throw new Error("Invalid lifecycle year frontier");
}

/** Closed, in-memory native annual owner. No checkpoint, authority, cancellation or
 * physical-plan port. A consumer may stop BETWEEN closed steps; execute is not interruptible.
 * Journal data supports later replay work but is not a replay certificate or durable codec.
 */
/**
 * Outputs a live runtime published. Module-private provenance: `publish` is the only producer, so a
 * branded object was produced by the engine from an admitted genesis rather than assembled by a caller.
 * It proves provenance, NOT alignment - the capsule layer still requires `output.genesisDigest` to
 * match the genesis being certified.
 */
const runtimeOutputs = new WeakSet<object>();
/**
 * Narrows a journal record to the audit shape. Audit fields are optional because compact mode omits
 * them, and they have no production reader; this exists so tests and tooling that DO inspect the
 * retained evidence cannot silently read an absent block.
 */
export function auditRecord(record: unknown): {
  physicalSnapshot: YearSnapshot;
  economics: NonNullable<LifecycleYearRecord["economics"]>;
  positions: NonNullable<LifecycleYearRecord["positions"]>;
} {
  const value = record as Partial<LifecycleYearRecord> | null;
  if (value === null || typeof value !== "object" || value.physicalSnapshot === undefined
    || value.economics === undefined || value.positions === undefined) {
    throw new Error("Expected an audit-mode journal record");
  }
  return value as {
    physicalSnapshot: YearSnapshot;
    economics: NonNullable<LifecycleYearRecord["economics"]>;
    positions: NonNullable<LifecycleYearRecord["positions"]>;
  };
}

export function isLifecycleRuntimeOutput(value: unknown): boolean {
  return typeof value === "object" && value !== null && runtimeOutputs.has(value);
}

export function createLifecycleRuntime(input: unknown, options: LifecycleRuntimeOptions = {}) {
  const journalMode = options.journal ?? "audit";
  if (journalMode !== "audit" && journalMode !== "compact") throw new Error("Invalid lifecycle journal mode");
  const { genesis, config, protagonistId, owned, favors } = instantiateLifecycleGenesis(input);
  const initialFrontier = config.startYear - 1;
  requireYear(initialFrontier);
  let advancing = false;

  // Provenance is lexical ownership, not Object.isFrozen on caller data. The only
  // records entering this prefix are detached/frozen below, before commit.
  type Journal = readonly Immutable<LifecycleYearRecord>[];
  function publish(state: LifecycleState, frontier: number, journal: Journal,
    publishedVersions?: Immutable<LifecycleGenesis["versions"]>): Immutable<LifecycleOutput> {
    const deathYear = state.owned.people[protagonistId].deathYear;
    // Clone native state and its snapshot together to retain their native aliases.
    // Deliberately exclude the journal: neither clone nor freeze walks its prefix.
    const frame = structuredClone({
      versions: genesis.versions, genesisDigest: genesis.digest, protagonistId, frontier,
      status: deathYear !== undefined && deathYear <= frontier ? "complete" as const : "incomplete" as const,
      ...state, canonicalYearSnapshot: captureLegacyYear(state.owned, frontier),
    });
    if (publishedVersions) frame.versions = publishedVersions;
    const frozenFrame = freeze(frame, new Set<object>(publishedVersions ? [publishedVersions] : []));
    const published = Object.freeze({ ...frozenFrame, journal });
    // Provenance brand for THIS module: the object came out of a live runtime, advanced by the engine.
    // Certifying such an output does not need to replay it against itself (see e-lifecycle-capsule).
    // Every output this module ever returns is branded, so the mark alone proves nothing about which
    // genesis produced it - callers must also match `genesisDigest`.
    runtimeOutputs.add(published);
    return published;
  }

  // One pointer owns the entire committed frontier/state/journal/publication boundary.
  const state = { owned, favors };
  const emptyJournal: Journal = Object.freeze([]);
  const initial = publish(state, initialFrontier, emptyJournal);
  const publishedVersions = initial.versions;
  let committed = { state, frontier: initialFrontier, journal: emptyJournal, output: initial };

  async function advance(year: number): Promise<Immutable<LifecycleOutput>> {
    if (advancing) throw new Error("Overlapping lifecycle advance");
    requireYear(year);
    if (committed.output.status === "complete") throw new Error("Lifecycle protagonist is dead");
    if (year !== committed.frontier + 1) throw new Error("Lifecycle years must be contiguous");
    advancing = true;
    try {
      // Never separately clone owned and favors: native phases and FE1 borrow ONE graph.
      const draft = structuredClone(committed.state);
      const lifeStart = draft.owned.events.length;
      const decisionStart = draft.owned.decisions.length;
      const economicStart = draft.favors.events.length;
      // A fresh trusted source/resolver on every attempt; origin endYear is metadata only.
      const source = createRulesYearSource(genesis.source, config, draft.owned, protagonistId, config.startYear);
      const physicalSnapshot = await source.execute(year);
      const allowances = planAnnualFavorDraft(draft.favors, config.seed, year);
      const entries: RuntimeEntry[] = [];
      const favor = createFavorExecutor(draft.favors, year, entries);
      allowances.resources.forEach(favor.executeResource);
      allowances.grants.forEach(favor.executeGrant);
      const creditors = [...new Set(inspectHelpOpportunities(draft.favors, year)
        .filter(candidate => candidate.reason === null).map(candidate => candidate.creditor))].sort(stableAnnualIdOrder);
      const slots: LifecycleHelpSlot[] = [];
      const requests: RequestIntention[] = [];
      for (const creditor of creditors) {
        for (const slot of [0, 1] as const) {
          const opportunities = inspectHelpOpportunities(draft.favors, year);
          const request = planAnnualHelpSlot(draft.favors, config.seed, year, creditor, slot);
          slots.push({ creditor, slot, opportunities, request });
          if (request !== null) {
            requests.push(request);
            favor.executeRequest(request, requests.length - 1);
          }
        }
      }
      // Compact mode omits ONLY fields no production reader consumes; `final` is what the chronicle,
      // the person sheets and the replay comparison all read, so it is never dropped.
      const record: LifecycleYearRecord = journalMode === "compact"
        ? { year, versions: genesis.versions, final: structuredClone(draft) }
        : {
          year, versions: genesis.versions, physicalSnapshot,
          economics: { resources: allowances.resources, grants: allowances.grants, creditors, slots, requests, entries },
          positions: {
            life: { start: lifeStart, end: draft.owned.events.length },
            decisions: { start: decisionStart, end: draft.owned.decisions.length },
            economic: { start: economicStart, end: draft.favors.events.length },
          },
          final: structuredClone(draft),
        };
      // Detach only the NEW annual record. Reuse the privately frozen version
      // tuple to preserve its aliases across annual evidence/publication frames.
      const newRecord = structuredClone(record);
      newRecord.versions = publishedVersions;
      const frozenRecord = freeze(newRecord, new Set<object>([publishedVersions]));
      const journal: Journal = Object.freeze([...committed.journal, frozenRecord]);
      // ALL potentially failing work, including complete detachment/deep freezing, precedes swap.
      const output = publish(draft, year, journal, publishedVersions);
      committed = { state: draft, frontier: year, journal, output };
      return output;
    } finally {
      advancing = false;
    }
  }
  return Object.freeze({ initial, advance, snapshot: () => committed.output });
}

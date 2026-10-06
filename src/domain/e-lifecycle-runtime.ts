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
export interface LifecycleYearRecord {
  year: number;
  versions: LifecycleGenesis["versions"];
  physicalSnapshot: YearSnapshot;
  postNative: LifecycleState;
  economics: {
    resources: ResourceOperation[];
    grants: GrantIntention[];
    creditors: string[];
    slots: LifecycleHelpSlot[];
    requests: RequestIntention[];
    entries: RuntimeEntry[];
  };
  /** Life-log indices and economic positions are deliberately separate namespaces. */
  positions: {
    life: { start: number; end: number };
    decisions: { start: number; end: number };
    economic: { start: number; end: number };
  };
  final: LifecycleState;
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
function detached<T>(value: T): Immutable<T> {
  return freeze(structuredClone(value));
}
function requireYear(year: number): void {
  if (!Number.isSafeInteger(year) || Object.is(year, -0)) throw new Error("Invalid lifecycle year frontier");
}

/** Closed, in-memory native annual owner. No checkpoint, authority, cancellation or
 * physical-plan port. A consumer may stop BETWEEN closed steps; execute is not interruptible.
 * Journal data supports later replay work but is not a replay certificate or durable codec.
 */
export function createLifecycleRuntime(input: unknown) {
  const { genesis, config, protagonistId, owned, favors } = instantiateLifecycleGenesis(input);
  const initialFrontier = config.startYear - 1;
  requireYear(initialFrontier);
  let advancing = false;

  function publish(state: LifecycleState, frontier: number, journal: LifecycleYearRecord[]): Immutable<LifecycleOutput> {
    const deathYear = state.owned.people[protagonistId].deathYear;
    return detached({
      versions: genesis.versions, genesisDigest: genesis.digest, protagonistId, frontier,
      status: deathYear !== undefined && deathYear <= frontier ? "complete" : "incomplete",
      ...state, canonicalYearSnapshot: captureLegacyYear(state.owned, frontier), journal,
    });
  }

  // One pointer owns the entire committed frontier/state/journal/publication boundary.
  const state = { owned, favors };
  const initial = publish(state, initialFrontier, []);
  let committed = { state, frontier: initialFrontier, journal: [] as LifecycleYearRecord[], output: initial };

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
      const postNative = structuredClone(draft);
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
      const record: LifecycleYearRecord = {
        year, versions: genesis.versions, physicalSnapshot, postNative,
        economics: { resources: allowances.resources, grants: allowances.grants, creditors, slots, requests, entries },
        positions: {
          life: { start: lifeStart, end: draft.owned.events.length },
          decisions: { start: decisionStart, end: draft.owned.decisions.length },
          economic: { start: economicStart, end: draft.favors.events.length },
        },
        final: structuredClone(draft),
      };
      const journal = [...committed.journal, record];
      // ALL potentially failing work, including complete detachment/deep freezing, precedes swap.
      const output = publish(draft, year, journal);
      committed = { state: draft, frontier: year, journal, output };
      return output;
    } finally {
      advancing = false;
    }
  }
  return Object.freeze({ initial, advance, snapshot: () => committed.output });
}

import { executeLifecycleAnnual } from "./e-lifecycle-annual";
import type { LifecycleChoiceAppliedEvidence, LifecycleChoiceDeclaration } from "./e-lifecycle-choice";
import { canonicalLifecycleDataEqual, instantiateLifecycleGenesis, lifecycleVersionsMatch } from "./e-lifecycle-genesis";
import {
  createLifecycleRuntime, type LifecycleJournalMode, type LifecycleState, type LifecycleYearRecord,
} from "./e-lifecycle-runtime";
import { createLifecycleChoiceYearSource, createRulesYearSource } from "./e-year-source";
import { requireFavorData } from "./effects";
import { captureLegacyYear } from "./legacy-year";
import { requireFields } from "./obligations";

export const LIFECYCLE_FORK_VERSION = "lifecycle-fork/v1";

export interface LifecycleForkOptions {
  /** Inclusive last year the suffix may execute; defaults to, and may not exceed, the origin endYear. */
  readonly lastYear?: number;
  /** Observed only at closed year boundaries, never inside an annual execution. */
  readonly signal?: AbortSignal;
}

export interface LifecycleForkLineage {
  readonly version: typeof LIFECYCLE_FORK_VERSION;
  readonly parentGenesisDigest: string;
  readonly forkYear: number;
  readonly choice: LifecycleChoiceDeclaration;
  readonly evidence: LifecycleChoiceAppliedEvidence;
}

/** Compare the entire replayed closed prefix, not just its final state.
 * This check is not parent admission or fork provenance; callers must establish both.
 */
export function assertLifecycleForkPrefix(
  parent: readonly LifecycleYearRecord[], replay: readonly LifecycleYearRecord[], forkYear: number,
): void {
  if (!Number.isSafeInteger(forkYear) || Object.is(forkYear, -0)) throw new Error("Invalid lifecycle fork year");
  const prefix = parent.filter(record => record.year < forkYear);
  if (prefix.length !== replay.length) throw new Error("Lifecycle fork prefix length mismatch");
  for (let index = 0; index < prefix.length; index++) {
    if (!canonicalLifecycleDataEqual(prefix[index], replay[index])) {
      throw new Error("Lifecycle fork prefix mismatch");
    }
  }
}

function record(value: unknown, what: string): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`Expected lifecycle fork ${what}`);
}

function deepFreeze<T>(value: T, seen = new Set<object>()): T {
  if (value !== null && typeof value === "object" && !seen.has(value)) {
    seen.add(value);
    for (const entry of Object.values(value)) deepFreeze(entry, seen);
    Object.freeze(value);
  }
  return value;
}

/**
 * Rewrite one exposed native decision of a closed parent life at its year F.
 * The parent's genesis is replayed for every year before F and each record must equal the
 * parent's exactly; F runs with the forced choice; the suffix runs on plain rules until the
 * protagonist dies or `lastYear`. The result is detached data with its own lineage: it is never
 * a branded runtime output, so certifying it requires replaying genesis plus lineage.
 */
export async function forkLifecycle(parent: unknown, choice: unknown, options: LifecycleForkOptions = {}) {
  requireFavorData(parent, true);
  record(parent, "parent");
  if ("lineage" in parent) throw new Error("Nested lifecycle fork not supported yet");
  requireFields(parent, ["genesis", "output"]);
  // Capture the parent before any await; later caller mutations cannot reach the fork.
  const candidate = structuredClone(parent);
  record(candidate.output, "parent output");
  const parentJournal = candidate.output.journal;
  if (!Array.isArray(parentJournal)) throw new Error("Expected lifecycle journal");
  record(choice, "choice");
  const forkYear = choice.year;
  if (typeof forkYear !== "number" || !Number.isSafeInteger(forkYear) || Object.is(forkYear, -0)) {
    throw new Error("Invalid lifecycle fork year");
  }

  const { genesis, config, protagonistId } = instantiateLifecycleGenesis(candidate.genesis);
  if (candidate.output.genesisDigest !== genesis.digest || !lifecycleVersionsMatch(candidate.output.versions, genesis.versions)) {
    throw new Error("Lifecycle fork parent genesis disagreement");
  }
  const lastYear = options.lastYear ?? config.endYear;
  if (!Number.isSafeInteger(lastYear) || lastYear > config.endYear || lastYear < forkYear) {
    throw new Error("Invalid lifecycle fork last year");
  }
  const forked = parentJournal.find((entry: { year?: unknown }) => entry?.year === forkYear) as LifecycleYearRecord | undefined;
  if (!forked) throw new Error("Lifecycle fork year is not a closed parent year");
  const target = forked.final.owned.decisions
    .find(decision => decision.year === forkYear && decision.id === choice.decisionId);
  if (!target) throw new Error("Lifecycle choice does not match target");
  // A parent journal is homogeneous: compact records carry no physical snapshot.
  const journalMode: LifecycleJournalMode = "physicalSnapshot" in forked ? "audit" : "compact";

  // Prefix: the runtime itself replays genesis, so its records are the authority being compared.
  const runtime = createLifecycleRuntime(candidate.genesis, { journal: journalMode });
  for (let year = config.startYear; year < forkYear; year++) {
    options.signal?.throwIfAborted();
    await runtime.advance(year);
  }
  const prefix = runtime.snapshot();
  assertLifecycleForkPrefix(parentJournal as LifecycleYearRecord[], prefix.journal as unknown as LifecycleYearRecord[], forkYear);

  // Native state and its economic view are cloned together inside the annual owner.
  let state = (prefix.threads
    ? { owned: prefix.owned, favors: prefix.favors, threads: prefix.threads }
    : { owned: prefix.owned, favors: prefix.favors }) as unknown as LifecycleState;
  const journal: LifecycleYearRecord[] = [...prefix.journal as unknown as LifecycleYearRecord[]];
  let evidence: LifecycleChoiceAppliedEvidence | undefined;
  let declaration: LifecycleChoiceDeclaration | undefined;
  let frontier = forkYear - 1;
  for (let year = forkYear; year <= lastYear; year++) {
    options.signal?.throwIfAborted();
    const { draft, record: annual } = await executeLifecycleAnnual(
      state, year, config, protagonistId, genesis.versions, journalMode,
      owned => {
        if (year !== forkYear) return createRulesYearSource(genesis.source, config, owned, protagonistId, config.startYear);
        const source = createLifecycleChoiceYearSource(choice, target, config, owned, protagonistId);
        declaration = source.declaration;
        return {
          async execute(executed: number) {
            const result = await source.execute(executed);
            evidence = result.evidence;
            return result.snapshot;
          },
        };
      },
    );
    journal.push(annual);
    state = draft;
    frontier = year;
    const deathYear = draft.owned.people[protagonistId].deathYear;
    if (deathYear !== undefined && deathYear <= year) break;
  }
  if (!evidence || !declaration) throw new Error("Lifecycle choice target not reached");

  const deathYear = state.owned.people[protagonistId].deathYear;
  const lineage: LifecycleForkLineage = {
    version: LIFECYCLE_FORK_VERSION, parentGenesisDigest: genesis.digest, forkYear, choice: declaration, evidence,
  };
  // One clone keeps the native/economic aliases of the final state and its snapshot together.
  return deepFreeze(structuredClone({
    genesis: candidate.genesis,
    output: {
      versions: genesis.versions, genesisDigest: genesis.digest, protagonistId, frontier,
      status: deathYear !== undefined && deathYear <= frontier ? "complete" as const : "incomplete" as const,
      ...state, canonicalYearSnapshot: captureLegacyYear(state.owned, frontier), journal,
    },
    lineage,
  }));
}

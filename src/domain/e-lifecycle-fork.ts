import { executeLifecycleAnnual } from "./e-lifecycle-annual";
import { LIFECYCLE_CHOICE_VERSION, type LifecycleChoiceAppliedEvidence, type LifecycleChoiceDeclaration } from "./e-lifecycle-choice";
import { canonicalLifecycleDataEqual, instantiateLifecycleGenesis, lifecycleVersionsMatch } from "./e-lifecycle-genesis";
import {
  createLifecycleRuntime, type LifecycleJournalMode, type LifecycleState, type LifecycleYearRecord,
} from "./e-lifecycle-runtime";
import { createLifecycleChoiceYearSource, createRulesYearSource } from "./e-year-source";
import { requireFavorData } from "./effects";
import { captureLegacyYear } from "./legacy-year";
import { requireFields } from "./obligations";

export const LIFECYCLE_FORK_VERSION = "lifecycle-fork/v2";

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
  readonly choices: LifecycleChoiceDeclaration[];
  readonly evidence: LifecycleChoiceAppliedEvidence[];
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
  requireFields(parent, "lineage" in parent ? ["genesis", "output", "lineage"] : ["genesis", "output"]);
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

  const inherited: LifecycleChoiceDeclaration[] = [];
  if ("lineage" in candidate) {
    const lineage = candidate.lineage as LifecycleForkLineage | null;
    if (!lineage || lineage.version !== LIFECYCLE_FORK_VERSION || lineage.parentGenesisDigest !== genesis.digest ||
        !Number.isSafeInteger(lineage.forkYear) || !Array.isArray(lineage.choices) || !lineage.choices.length ||
        !Array.isArray(lineage.evidence) || lineage.evidence.length !== lineage.choices.length ||
        lineage.choices.some((entry, index) => !entry || entry.version !== LIFECYCLE_CHOICE_VERSION || typeof entry.decisionId !== "string" || !entry.decisionId ||
          typeof entry.optionId !== "string" || !entry.optionId || !Number.isSafeInteger(entry.year) || Object.is(entry.year, -0) ||
          entry.year < config.startYear || entry.year > config.endYear ||
          !canonicalLifecycleDataEqual(lineage.evidence[index], { decisionId: entry.decisionId, optionId: entry.optionId, year: entry.year, appliedCount: 1 }) ||
          (index > 0 && lineage.choices[index - 1].year >= entry.year)) ||
        lineage.choices.at(-1)?.year !== lineage.forkYear) {
      throw new Error("Invalid lifecycle fork lineage");
    }
    inherited.push(...lineage.choices.filter(entry => entry.year < forkYear));
  }

  const initial = createLifecycleRuntime(candidate.genesis, { journal: journalMode }).initial;
  let state = (initial.threads
    ? { owned: initial.owned, favors: initial.favors, threads: initial.threads }
    : { owned: initial.owned, favors: initial.favors }) as unknown as LifecycleState;
  const journal: LifecycleYearRecord[] = [];
  const choices: LifecycleChoiceDeclaration[] = [];
  const evidence: LifecycleChoiceAppliedEvidence[] = [];
  let frontier = config.startYear - 1;

  async function runYears(start: number, end: number, select: (year: number) => unknown | undefined) {
    for (let year = start; year <= end; year++) {
      options.signal?.throwIfAborted();
      const selected = select(year);
      let applied: LifecycleChoiceAppliedEvidence | undefined;
      let declaration: LifecycleChoiceDeclaration | undefined;
      const { draft, record: annual } = await executeLifecycleAnnual(
        state, year, config, protagonistId, genesis.versions, journalMode,
        owned => {
          if (!selected) return createRulesYearSource(genesis.source, config, owned, protagonistId, config.startYear);
          const selectedChoice = selected as LifecycleChoiceDeclaration;
          const selectedTarget = year === forkYear ? target : (parentJournal as LifecycleYearRecord[])
            .find(entry => entry.year === year)?.final.owned.decisions
            .find(entry => entry.year === year && entry.id === selectedChoice.decisionId);
          if (!selectedTarget) throw new Error("Invalid lifecycle fork lineage");
          // The parent's exposed decision already contains the forced selection. Admission needs
          // an alternative prior selection; the replay and full-prefix comparison verify the result.
          const previous = year === forkYear ? selectedTarget : { ...selectedTarget,
            chosen: selectedTarget.options.find(option => option.id !== selectedChoice.optionId)?.id ?? "" };
          const source = createLifecycleChoiceYearSource(selected, previous, config, owned, protagonistId);
          declaration = source.declaration;
          return { async execute(executed: number) {
            const result = await source.execute(executed);
            applied = result.evidence;
            return result.snapshot;
          } };
        },
      );
      if (selected) {
        if (!applied || !declaration) throw new Error("Lifecycle choice target not reached");
        choices.push(declaration);
        evidence.push(applied);
      }
      journal.push(annual);
      state = draft;
      frontier = year;
      const deathYear = draft.owned.people[protagonistId].deathYear;
      if (deathYear !== undefined && deathYear <= year) break;
    }
  }
  await runYears(config.startYear, forkYear - 1, year => inherited.find(entry => entry.year === year));
  assertLifecycleForkPrefix(parentJournal as LifecycleYearRecord[], journal, forkYear);
  await runYears(forkYear, lastYear, year => year === forkYear ? choice : undefined);
  if (choices.length !== inherited.length + 1) throw new Error("Lifecycle choice target not reached");

  const deathYear = state.owned.people[protagonistId].deathYear;
  const lineage: LifecycleForkLineage = {
    version: LIFECYCLE_FORK_VERSION, parentGenesisDigest: genesis.digest, forkYear, choices, evidence,
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

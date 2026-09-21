import { decisionYear } from "./decisions";
import type { DecisionMaker } from "./decisions";
import { simulate, type SimulateReport } from "./simulate";
import type { Override, YearSnapshot } from "./types";

export class ForkError extends Error {}

/** The state a fork of `override` would restore and build from — exactly the year before its decision. */
export function getRestoreSnapshot(snapshots: ReadonlyMap<number, YearSnapshot>, override: Pick<Override, "decisionId">): YearSnapshot {
  const decisionYearValue = decisionYear(override.decisionId);
  const restoreYear = decisionYearValue - 1;
  const snapshot = snapshots.get(restoreYear);
  if (!snapshot) {
    throw new ForkError(`No snapshot available for year ${restoreYear}; cannot fork at decision "${override.decisionId}".`);
  }
  return snapshot;
}

/**
 * Forks a world at the override's decision: restores the snapshot from the
 * year immediately before it, forces that decision's option, and
 * re-simulates forward to the end. Everything before the fork year is
 * untouched (byte-identical to the base branch); everything from the fork
 * year on is recomputed with the edited state, which is exactly where the
 * butterfly effect enters.
 *
 * Callers should validate the override (see `validate-override.ts`)
 * against this same restored snapshot BEFORE calling this, so an edit
 * targeting a decision that doesn't exist (or an option it doesn't have)
 * fails with a clear 400 instead of silently producing a no-op fork.
 */
export async function forkWorld(
  snapshots: ReadonlyMap<number, YearSnapshot>,
  override: Override,
  decisionMaker: DecisionMaker,
  engineSource: "jev" | "rules",
  baseConfig: { readonly seed: string; readonly startYear: number; readonly endYear: number; readonly town: { readonly name: string } },
  concurrencyLimit?: number,
  protagonistId?: string,
): Promise<SimulateReport> {
  const snapshot = getRestoreSnapshot(snapshots, override);
  const fromYear = decisionYear(override.decisionId);
  return simulate(baseConfig, snapshot.people, snapshot.events, { decisionMaker, engineSource, overrides: [override], fromYear, concurrencyLimit, protagonistId });
}

import type { LifeScene } from "@/contracts/life";
import { deriveLifeScene, type SceneFriend } from "@/domain/scene";
import type { Event, Person, YearSnapshot } from "@/domain/types";
import { getLifeBranch, type LifeBranchRecord } from "@/server/life-store";

/**
 * Server-side scene tracking for the night sky. Friendship lives only in per-year snapshots (the
 * protagonist's `mind.relationships`), so a tracker watches each year's snapshot to learn when a
 * bond began and ended, and hands the result to the pure `deriveLifeScene`.
 */

const PROTAGONIST_ID = "protagonist";

export interface SceneTrackerOptions {
  readonly seed: string;
  readonly protagonistId?: string;
  /** Set for a rewrite branch: years up to `forkYear` are resolved through the parent chain, not from this branch's snapshots. */
  readonly fork?: { readonly forkYear: number; /** First-seen years from the parent chain; absent when that data is unavailable. */ readonly priorSeen?: ReadonlyMap<string, number> };
}

export interface SceneTracker {
  observe(snapshot: YearSnapshot): void;
  /** The scene so far, or — given the finished result — the final scene. */
  scene(source?: { readonly people: Readonly<Record<string, Person>>; readonly events: readonly Event[] }): LifeScene;
}

function friendIds(person: Person | undefined): string[] {
  return (person?.mind.relationships ?? []).filter((r) => r.bond === "friend").map((r) => r.personId);
}

export function createSceneTracker(options: SceneTrackerOptions): SceneTracker {
  const { seed, fork } = options;
  const protagonistId = options.protagonistId ?? PROTAGONIST_ID;
  const firstSeen = new Map<string, number | null>();
  const lastSeen = new Map<string, number>();
  let current: string[] = [];
  let latest: YearSnapshot | undefined;

  /** When a bond that predates the first observed year began: parent chain, else earliest shared event, else the later of the two births. */
  const resolveEarly = (id: string, snapshot: YearSnapshot): number | null => {
    const prior = fork?.priorSeen?.get(id);
    if (prior !== undefined) return prior;
    const shared = snapshot.events.filter((e) => e.actors.includes(protagonistId) && e.actors.includes(id)).map((e) => e.year);
    if (shared.length > 0) return shared.reduce((min, y) => Math.min(min, y), Infinity);
    const born = Math.max(snapshot.people[id]?.birthYear ?? -Infinity, snapshot.people[protagonistId]?.birthYear ?? -Infinity);
    return born > (snapshot.people[protagonistId]?.birthYear ?? Infinity) ? born : null;
  };

  return {
    observe(snapshot) {
      latest = snapshot;
      current = friendIds(snapshot.people[protagonistId]);
      for (const id of current) {
        if (!firstSeen.has(id)) firstSeen.set(id, fork && snapshot.year <= fork.forkYear ? resolveEarly(id, snapshot) : snapshot.year);
        lastSeen.set(id, snapshot.year);
      }
    },
    scene(source) {
      if (!latest) throw new Error("createSceneTracker: scene() before any snapshot was observed");
      // First-seen order, never re-sorted: the cap in deriveLifeScene keeps the earliest-shown friends,
      // so a person in an earlier tick's scene is never evicted from a later one.
      const live = new Set(current);
      const friends: SceneFriend[] = [...firstSeen.keys()].map((id) => (live.has(id) ? { id, fromAt: firstSeen.get(id) ?? null } : { id, fromAt: firstSeen.get(id) ?? null, untilAt: lastSeen.get(id)! + 1 }));
      return deriveLifeScene({ seed, people: source?.people ?? latest.people, events: source?.events ?? latest.events, protagonistId, friends, through: latest.year });
    },
  };
}

/** First year each friend bond held in the protagonist's snapshots before `beforeYear`, walking a branch and its ancestors; `undefined` when the branch is unknown. */
export function friendSeenBefore(lifeId: string, branchId: string, beforeYear: number, protagonistId = PROTAGONIST_ID): ReadonlyMap<string, number> | undefined {
  let branch = getLifeBranch(lifeId, branchId);
  if (!branch) return undefined;
  const seen = new Map<string, number>();
  const visited = new Set<string>();
  let limit = beforeYear;
  while (branch && !visited.has(branch.id)) {
    visited.add(branch.id);
    for (const [year, snapshot] of branch.snapshots) {
      if (year >= limit) continue;
      for (const id of friendIds(snapshot.people[protagonistId])) seen.set(id, Math.min(seen.get(id) ?? Infinity, year));
    }
    // An ancestor only speaks for the years before the fork of the child it was reached through.
    if (branch.forkYear !== undefined) limit = Math.min(limit, branch.forkYear);
    branch = branch.parentBranchId ? getLifeBranch(lifeId, branch.parentBranchId) : undefined;
  }
  return seen;
}

/** The final scene of a persisted branch, rebuilt from its snapshots (no migration: everything derives from stored state). */
export function sceneForBranch(branch: LifeBranchRecord): LifeScene {
  const fork = branch.forkYear !== undefined ? { forkYear: branch.forkYear, priorSeen: branch.parentBranchId ? friendSeenBefore(branch.lifeId, branch.parentBranchId, branch.forkYear) : undefined } : undefined;
  const tracker = createSceneTracker({ seed: branch.result.config.seed, fork });
  if (branch.snapshots.size === 0) return deriveLifeScene({ seed: branch.result.config.seed, people: branch.result.people, events: branch.result.events, protagonistId: PROTAGONIST_ID });
  for (const year of [...branch.snapshots.keys()].sort((a, b) => a - b)) tracker.observe(branch.snapshots.get(year)!);
  return tracker.scene(branch.result);
}

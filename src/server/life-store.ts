import type { LifeSex } from "@/contracts/life";
import type { Override, SimulationResult, WorldConfig, YearSnapshot } from "@/domain/types";

/**
 * Server-side state for the single-life product (round 9, decision 034). Deliberately its own
 * store, separate from `world-store.ts` — a "life" isn't a `Branch`/`WorldRecord` (different id
 * space, different default-branch rule: `GET /api/lives/:lifeId` defaults to the LATEST branch,
 * not the original one, per the contract) — but it follows the exact same pattern for the exact
 * same reason (decision 006): attached to `globalThis`, not a plain module-level variable, so
 * Next.js bundling Route Handlers and Server Components separately can never fork it into two
 * independent stores.
 */
export interface LifeBranchRecord {
  readonly id: string;
  readonly lifeId: string;
  /** "Original life" | "Changed in <year>" — never git terms (see the contract). */
  readonly label: string;
  readonly parentBranchId?: string;
  readonly forkYear?: number;
  readonly override?: Override;
  readonly result: SimulationResult;
  readonly snapshots: ReadonlyMap<number, YearSnapshot>;
  readonly createdAt: number;
}

export interface LifeRecord {
  readonly id: string;
  readonly config: WorldConfig;
  readonly protagonistName: string;
  readonly protagonistSex: LifeSex;
  readonly originalBranchId: string;
  latestBranchId: string;
  readonly branches: Map<string, LifeBranchRecord>;
  readonly createdAt: number;
}

interface LifelinesLivesStore {
  lives: Map<string, LifeRecord>;
  lifeCounter: number;
  lifeBranchCounter: number;
}

const globalStoreKey = "__lifelinesLivesStore__";
const globalWithStore = globalThis as typeof globalThis & { [globalStoreKey]?: LifelinesLivesStore };
globalWithStore[globalStoreKey] ??= { lives: new Map<string, LifeRecord>(), lifeCounter: 0, lifeBranchCounter: 0 };
const store = globalWithStore[globalStoreKey];

const lives = store.lives;

export function newLifeId(): string {
  store.lifeCounter += 1;
  return `life${store.lifeCounter}-${Date.now().toString(36)}`;
}

export function newLifeBranchId(): string {
  store.lifeBranchCounter += 1;
  return `lb${store.lifeBranchCounter}-${Date.now().toString(36)}`;
}

/**
 * Registers a newly-simulated life. Takes an already-minted `lifeId`/`branchId` rather than
 * generating them internally (unlike `world-store.ts#createWorld`) — the SSE contract's `start`
 * frame must carry the real `lifeId`/`branchId` BEFORE the simulation (and so the record) exists,
 * so the route handler mints both up front with `newLifeId`/`newLifeBranchId`, sends `start`, runs
 * the simulation, then calls this once it's done.
 */
export function registerLife(
  lifeId: string,
  branchId: string,
  config: WorldConfig,
  protagonistName: string,
  protagonistSex: LifeSex,
  result: SimulationResult,
  snapshots: ReadonlyMap<number, YearSnapshot>,
): LifeRecord {
  const branch: LifeBranchRecord = { id: branchId, lifeId, label: "Original life", result, snapshots, createdAt: Date.now() };
  const record: LifeRecord = {
    id: lifeId,
    config,
    protagonistName,
    protagonistSex,
    originalBranchId: branchId,
    latestBranchId: branchId,
    branches: new Map([[branchId, branch]]),
    createdAt: Date.now(),
  };
  lives.set(lifeId, record);
  return record;
}

/** Convenience wrapper over `registerLife` for callers (tests, scripts) that don't need to know the id ahead of time. */
export function createLife(config: WorldConfig, protagonistName: string, protagonistSex: LifeSex, result: SimulationResult, snapshots: ReadonlyMap<number, YearSnapshot>): LifeRecord {
  return registerLife(newLifeId(), newLifeBranchId(), config, protagonistName, protagonistSex, result, snapshots);
}

export function getLife(lifeId: string): LifeRecord | undefined {
  return lives.get(lifeId);
}

export function getLifeBranch(lifeId: string, branchId: string): LifeBranchRecord | undefined {
  return lives.get(lifeId)?.branches.get(branchId);
}

/** Per the contract, `GET /api/lives/:lifeId?branchId=` with no `branchId` returns the LATEST branch (the most recently created one), not the original life. */
export function getLatestBranch(lifeId: string): LifeBranchRecord | undefined {
  const life = lives.get(lifeId);
  if (!life) return undefined;
  return life.branches.get(life.latestBranchId);
}

/** Same "id minted up front" reasoning as `registerLife` — the rewrite route's `start`/`divergence` frames need the new branch id before the re-simulation finishes. */
export function registerLifeBranch(
  lifeId: string,
  branchId: string,
  parentBranchId: string,
  forkYear: number,
  override: Override,
  result: SimulationResult,
  snapshots: ReadonlyMap<number, YearSnapshot>,
  label: string,
): LifeBranchRecord | undefined {
  const life = lives.get(lifeId);
  if (!life) return undefined;
  const branch: LifeBranchRecord = { id: branchId, lifeId, label, parentBranchId, forkYear, override, result, snapshots, createdAt: Date.now() };
  life.branches.set(branchId, branch);
  life.latestBranchId = branchId;
  return branch;
}

export function addLifeBranch(
  lifeId: string,
  parentBranchId: string,
  forkYear: number,
  override: Override,
  result: SimulationResult,
  snapshots: ReadonlyMap<number, YearSnapshot>,
  label: string,
): LifeBranchRecord | undefined {
  return registerLifeBranch(lifeId, newLifeBranchId(), parentBranchId, forkYear, override, result, snapshots, label);
}

export function listLifeBranches(lifeId: string): LifeBranchRecord[] {
  return [...(lives.get(lifeId)?.branches.values() ?? [])];
}

export function listLives(): LifeRecord[] {
  return [...lives.values()];
}

/** Removes a life and all its branches/snapshots. Used by measurement scripts that register many short-lived lives and would otherwise hold every one's snapshots in memory for the whole run. */
export function deleteLife(lifeId: string): boolean {
  return lives.delete(lifeId);
}

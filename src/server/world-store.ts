import type { Branch, Override, SimulationResult, WorldConfig, YearSnapshot } from "@/domain/types";

export interface ServerBranch extends Branch {
  readonly snapshots: ReadonlyMap<number, YearSnapshot>;
}

export interface WorldRecord {
  readonly id: string;
  readonly config: WorldConfig;
  readonly originalBranchId: string;
  readonly branches: Map<string, ServerBranch>;
  readonly createdAt: number;
}

/**
 * Server-side world state, kept in memory for the MVP (a Map by worldId,
 * per the design brief). Lost on restart — acceptable for a demo.
 *
 * Deliberately attached to `globalThis` rather than a plain module-level
 * variable: Next.js compiles Route Handlers and Server Components into
 * separate bundles (especially under Turbopack in dev, with per-route
 * module graphs and HMR), so a plain `const worlds = new Map()` at module
 * scope can end up as two independent instances — one for `/api/worlds/*`
 * route handlers, another for the `/world/*` page renders — silently
 * breaking "create in one route, read in the other". `globalThis` is the
 * one thing guaranteed to be the same object across all bundles within a
 * single Node.js process.
 */
interface LifelinesGlobalStore {
  worlds: Map<string, WorldRecord>;
  worldCounter: number;
  branchCounter: number;
}

const globalStoreKey = "__lifelinesStore__";
const globalWithStore = globalThis as typeof globalThis & { [globalStoreKey]?: LifelinesGlobalStore };

globalWithStore[globalStoreKey] ??= { worlds: new Map<string, WorldRecord>(), worldCounter: 0, branchCounter: 0 };
const store = globalWithStore[globalStoreKey];

const worlds = store.worlds;

export function newWorldId(): string {
  store.worldCounter += 1;
  return `w${store.worldCounter}-${Date.now().toString(36)}`;
}

export function newBranchId(): string {
  store.branchCounter += 1;
  return `b${store.branchCounter}-${Date.now().toString(36)}`;
}

export function createWorld(config: WorldConfig, originalResult: SimulationResult, snapshots: ReadonlyMap<number, YearSnapshot>): WorldRecord {
  const worldId = newWorldId();
  const branchId = newBranchId();
  const branch: ServerBranch = { id: branchId, worldId, label: "Original timeline", result: originalResult, snapshots, createdAt: Date.now() };
  const record: WorldRecord = { id: worldId, config, originalBranchId: branchId, branches: new Map([[branchId, branch]]), createdAt: Date.now() };
  worlds.set(worldId, record);
  return record;
}

export function getWorld(worldId: string): WorldRecord | undefined {
  return worlds.get(worldId);
}

export function getBranch(worldId: string, branchId: string): ServerBranch | undefined {
  return worlds.get(worldId)?.branches.get(branchId);
}

export function addBranch(
  worldId: string,
  parentBranchId: string,
  forkYear: number,
  override: Override,
  result: SimulationResult,
  snapshots: ReadonlyMap<number, YearSnapshot>,
  label: string,
): ServerBranch | undefined {
  const world = worlds.get(worldId);
  if (!world) return undefined;
  const branchId = newBranchId();
  const branch: ServerBranch = { id: branchId, worldId, label, parentBranchId, forkYear, override, result, snapshots, createdAt: Date.now() };
  world.branches.set(branchId, branch);
  return branch;
}

export function listBranches(worldId: string): ServerBranch[] {
  return [...(worlds.get(worldId)?.branches.values() ?? [])];
}

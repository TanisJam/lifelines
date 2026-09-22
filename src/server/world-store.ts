import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { Branch, Override, SimulationResult, WorldConfig, YearSnapshot } from "@/domain/types";
import { compressJson, dataDir, decompressJson, nextCounter, openDb, storeCacheSize, withTransaction } from "./db";
import { LruCache } from "./lru-cache";

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
 * Server-side world state (legacy multi-town `/world` flow). Persisted to SQLite (`db.ts`) for the
 * self-hosted Docker deploy, same as `life-store.ts`: the in-memory cache is a write-through,
 * size-bounded `LruCache` (`STORE_CACHE_SIZE`, default 16 — see `db.ts#storeCacheSize`), lazily
 * (re)hydrated from the DB on a miss, so a restart/redeploy no longer loses every world, and an
 * eviction never drops a mutation that wasn't already persisted first.
 *
 * Deliberately attached to `globalThis` rather than a plain module-level variable: Next.js compiles
 * Route Handlers and Server Components into separate bundles (especially under Turbopack in dev,
 * with per-route module graphs and HMR), so a plain `const worlds = new Map()` at module scope can
 * end up as two independent instances — one for `/api/worlds/*` route handlers, another for the
 * `/world/*` page renders — silently breaking "create in one route, read in the other". `globalThis`
 * is the one thing guaranteed to be the same object across all bundles within a single Node.js
 * process.
 */

function snapshotsToJson(snapshots: ReadonlyMap<number, YearSnapshot>): Record<string, YearSnapshot> {
  const obj: Record<string, YearSnapshot> = {};
  for (const [year, snapshot] of snapshots) obj[String(year)] = snapshot;
  return obj;
}

function snapshotsFromJson(obj: Record<string, YearSnapshot>): Map<number, YearSnapshot> {
  const map = new Map<number, YearSnapshot>();
  for (const [year, snapshot] of Object.entries(obj)) map.set(Number(year), snapshot);
  return map;
}

interface WorldBranchRow {
  readonly id: string;
  readonly world_id: string;
  readonly label: string;
  readonly parent_branch_id: string | null;
  readonly fork_year: number | null;
  readonly override_json: string | null;
  readonly result_json: Uint8Array;
  readonly snapshots_blob: Uint8Array;
  readonly created_at: number;
}

function rowToBranch(row: WorldBranchRow): ServerBranch {
  return {
    id: row.id,
    worldId: row.world_id,
    label: row.label,
    parentBranchId: row.parent_branch_id ?? undefined,
    forkYear: row.fork_year ?? undefined,
    override: row.override_json ? (JSON.parse(row.override_json) as Override) : undefined,
    result: decompressJson<SimulationResult>(row.result_json),
    snapshots: snapshotsFromJson(decompressJson<Record<string, YearSnapshot>>(row.snapshots_blob)),
    createdAt: row.created_at,
  };
}

interface WorldRow {
  readonly id: string;
  readonly config_json: string;
  readonly original_branch_id: string;
  readonly created_at: number;
}

export interface WorldStore {
  newWorldId(): string;
  newBranchId(): string;
  createWorld(config: WorldConfig, originalResult: SimulationResult, snapshots: ReadonlyMap<number, YearSnapshot>): WorldRecord;
  getWorld(worldId: string): WorldRecord | undefined;
  getBranch(worldId: string, branchId: string): ServerBranch | undefined;
  addBranch(
    worldId: string,
    parentBranchId: string,
    forkYear: number,
    override: Override,
    result: SimulationResult,
    snapshots: ReadonlyMap<number, YearSnapshot>,
    label: string,
  ): ServerBranch | undefined;
  listBranches(worldId: string): ServerBranch[];
  /** Closes the underlying DB connection. Only needed by tests simulating a restart (open a fresh store on the same file). */
  close(): void;
}

/**
 * Builds an independent world store backed by its own SQLite connection at `dbPath` (defaults to
 * `${DATA_DIR}/lifelines.db` — the same file `life-store.ts` uses, in its own tables). `cacheSize`
 * bounds the in-memory `LruCache` (defaults to `storeCacheSize()`, i.e. `STORE_CACHE_SIZE` or 16)
 * — exposed as a parameter (not just the env var) so tests can exercise eviction deterministically
 * without touching process.env. Exported so tests can point a store at a temp file — the module
 * below wraps a single `globalThis`-cached instance of this for the app's own default DB.
 */
export function createWorldStore(dbPath?: string, cacheSize?: number): WorldStore {
  const db: DatabaseSync = openDb(dbPath ?? path.join(dataDir(), "lifelines.db"));
  const cache = new LruCache<string, WorldRecord>(cacheSize ?? storeCacheSize());

  function loadBranchesForWorld(worldId: string): Map<string, ServerBranch> {
    const rows = db.prepare("SELECT * FROM world_branches WHERE world_id = ?").all(worldId) as unknown as WorldBranchRow[];
    const branches = new Map<string, ServerBranch>();
    for (const row of rows) branches.set(row.id, rowToBranch(row));
    return branches;
  }

  function loadWorldFromDb(worldId: string): WorldRecord | undefined {
    const row = db.prepare("SELECT * FROM worlds WHERE id = ?").get(worldId) as WorldRow | undefined;
    if (!row) return undefined;
    return {
      id: row.id,
      config: JSON.parse(row.config_json) as WorldConfig,
      originalBranchId: row.original_branch_id,
      branches: loadBranchesForWorld(worldId),
      createdAt: row.created_at,
    };
  }

  /** Lazily (re)hydrates the cache from the DB on a miss — whether a true cold start or an LRU eviction. Returns the (now-cached) record, if any. */
  function ensureLoaded(worldId: string): WorldRecord | undefined {
    const cached = cache.get(worldId);
    if (cached) return cached;
    const record = loadWorldFromDb(worldId);
    if (!record) return undefined;
    cache.set(worldId, record);
    return record;
  }

  function persistWorld(world: WorldRecord): void {
    db.prepare(
      `INSERT INTO worlds (id, config_json, original_branch_id, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET config_json = excluded.config_json, original_branch_id = excluded.original_branch_id, created_at = excluded.created_at`,
    ).run(world.id, JSON.stringify(world.config), world.originalBranchId, world.createdAt);
  }

  function persistBranch(branch: ServerBranch): void {
    db.prepare(
      `INSERT INTO world_branches (id, world_id, label, parent_branch_id, fork_year, override_json, result_json, snapshots_blob, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET label = excluded.label, parent_branch_id = excluded.parent_branch_id,
         fork_year = excluded.fork_year, override_json = excluded.override_json, result_json = excluded.result_json,
         snapshots_blob = excluded.snapshots_blob, created_at = excluded.created_at`,
    ).run(
      branch.id,
      branch.worldId,
      branch.label,
      branch.parentBranchId ?? null,
      branch.forkYear ?? null,
      branch.override ? JSON.stringify(branch.override) : null,
      compressJson(branch.result),
      compressJson(snapshotsToJson(branch.snapshots)),
      branch.createdAt,
    );
  }

  function newWorldId(): string {
    return `w${nextCounter(db, "worldCounter")}-${Date.now().toString(36)}`;
  }

  function newBranchId(): string {
    return `b${nextCounter(db, "branchCounter")}-${Date.now().toString(36)}`;
  }

  function createWorld(config: WorldConfig, originalResult: SimulationResult, snapshots: ReadonlyMap<number, YearSnapshot>): WorldRecord {
    const worldId = newWorldId();
    const branchId = newBranchId();
    const branch: ServerBranch = { id: branchId, worldId, label: "Original timeline", result: originalResult, snapshots, createdAt: Date.now() };
    const record: WorldRecord = { id: worldId, config, originalBranchId: branchId, branches: new Map([[branchId, branch]]), createdAt: Date.now() };
    // Persist first (both rows in one transaction), then populate the cache only once the commit
    // succeeds — same reasoning as `life-store.ts#registerLife`.
    withTransaction(db, () => {
      persistWorld(record);
      persistBranch(branch);
    });
    cache.set(worldId, record);
    return record;
  }

  function getWorld(worldId: string): WorldRecord | undefined {
    return ensureLoaded(worldId);
  }

  function getBranch(worldId: string, branchId: string): ServerBranch | undefined {
    return ensureLoaded(worldId)?.branches.get(branchId);
  }

  function addBranch(
    worldId: string,
    parentBranchId: string,
    forkYear: number,
    override: Override,
    result: SimulationResult,
    snapshots: ReadonlyMap<number, YearSnapshot>,
    label: string,
  ): ServerBranch | undefined {
    const world = ensureLoaded(worldId);
    if (!world) return undefined;
    const branchId = newBranchId();
    const branch: ServerBranch = { id: branchId, worldId, label, parentBranchId, forkYear, override, result, snapshots, createdAt: Date.now() };
    // Persist first, then mutate the cached (shared) `world.branches` map only once the write has
    // actually landed — same reasoning as `life-store.ts#registerLifeBranch`. A single statement
    // here, but still wrapped for consistency with the rest of the store.
    withTransaction(db, () => {
      persistBranch(branch);
    });
    world.branches.set(branchId, branch);
    return branch;
  }

  function listBranches(worldId: string): ServerBranch[] {
    return [...(ensureLoaded(worldId)?.branches.values() ?? [])];
  }

  function close(): void {
    db.close();
  }

  return { newWorldId, newBranchId, createWorld, getWorld, getBranch, addBranch, listBranches, close };
}

const globalStoreKey = "__lifelinesStore__";
const globalWithStore = globalThis as typeof globalThis & { [globalStoreKey]?: WorldStore };

function defaultStore(): WorldStore {
  globalWithStore[globalStoreKey] ??= createWorldStore();
  return globalWithStore[globalStoreKey];
}

export function newWorldId(): string {
  return defaultStore().newWorldId();
}

export function newBranchId(): string {
  return defaultStore().newBranchId();
}

export function createWorld(config: WorldConfig, originalResult: SimulationResult, snapshots: ReadonlyMap<number, YearSnapshot>): WorldRecord {
  return defaultStore().createWorld(config, originalResult, snapshots);
}

export function getWorld(worldId: string): WorldRecord | undefined {
  return defaultStore().getWorld(worldId);
}

export function getBranch(worldId: string, branchId: string): ServerBranch | undefined {
  return defaultStore().getBranch(worldId, branchId);
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
  return defaultStore().addBranch(worldId, parentBranchId, forkYear, override, result, snapshots, label);
}

export function listBranches(worldId: string): ServerBranch[] {
  return defaultStore().listBranches(worldId);
}

import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { LifeSex } from "@/contracts/life";
import type { Override, SimulationResult, WorldConfig, YearSnapshot } from "@/domain/types";
import { compressJson, dataDir, decompressJson, nextCounter, openDb, storeCacheSize, withTransaction } from "./db";
import { LruCache } from "./lru-cache";

/**
 * Server-side state for the single-life product (round 9, decision 034). Originally deliberately
 * its own store, separate from the legacy `world-store.ts` (removed in decision 060) — a "life"
 * wasn't a `Branch`/`WorldRecord` (different id space, different default-branch rule: `GET
 * /api/lives/:lifeId` defaults to the LATEST branch, not the original one, per the contract) —
 * and now, with the legacy flow gone, this is simply the app's one store. It attaches to
 * `globalThis`, not a plain module-level variable, for the same reason (decision 006): so
 * Next.js bundling Route Handlers and Server Components separately can never fork it into two
 * independent stores.
 *
 * Self-hosted Docker deploy: persisted to SQLite (`db.ts`) so lives survive restarts/redeploys.
 * The in-memory cache is now a write-through, size-bounded `LruCache` (`STORE_CACHE_SIZE`, default
 * 16 — see `db.ts#storeCacheSize`) — every write (`registerLife`, `registerLifeBranch`, ...) is
 * applied to both the cache and the DB in the same call, synchronously, before the function
 * returns, so an eviction can never drop an unpersisted mutation; every read lazily rehydrates the
 * cache from the DB on a miss (whether that's a true cold start or just an LRU eviction). Callers
 * never see the difference: every exported function keeps its exact original signature and return
 * shape.
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

// --- JSON <-> Map conversion (snapshots need explicit conversion; everything else in a
// LifeRecord/LifeBranchRecord is already JSON-safe) -------------------------------------------

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

interface LifeBranchRow {
  readonly id: string;
  readonly life_id: string;
  readonly label: string;
  readonly parent_branch_id: string | null;
  readonly fork_year: number | null;
  readonly override_json: string | null;
  readonly result_json: Uint8Array;
  readonly snapshots_blob: Uint8Array;
  readonly created_at: number;
}

function rowToBranch(row: LifeBranchRow): LifeBranchRecord {
  return {
    id: row.id,
    lifeId: row.life_id,
    label: row.label,
    parentBranchId: row.parent_branch_id ?? undefined,
    forkYear: row.fork_year ?? undefined,
    override: row.override_json ? (JSON.parse(row.override_json) as Override) : undefined,
    result: decompressJson<SimulationResult>(row.result_json),
    snapshots: snapshotsFromJson(decompressJson<Record<string, YearSnapshot>>(row.snapshots_blob)),
    createdAt: row.created_at,
  };
}

interface LifeRow {
  readonly id: string;
  readonly protagonist_name: string;
  readonly protagonist_sex: string;
  readonly config_json: string;
  readonly original_branch_id: string;
  readonly latest_branch_id: string;
  readonly created_at: number;
}

/**
 * A lightweight per-life summary for list views (`GET /api/lives`) — everything that route needs
 * (protagonist name, config for birth/death year, the latest branch's `result` for the death event
 * and cause, and a branch count) without ever decompressing a `snapshots_blob` (the expensive part
 * — see `db.ts`'s doc comment on why those can be tens of MB) or touching the LRU cache. Built by
 * `listLifeSummaries()` from one SQL query per store, independent of `getLife`/`listLifeBranches`.
 */
export interface LifeSummary {
  readonly id: string;
  readonly protagonistName: string;
  readonly config: WorldConfig;
  readonly latestBranchId: string;
  readonly latestResult: SimulationResult;
  readonly branchCount: number;
}

interface LifeSummaryRow {
  readonly id: string;
  readonly protagonist_name: string;
  readonly config_json: string;
  readonly latest_branch_id: string;
  readonly result_json: Uint8Array;
  readonly branch_count: number;
}

export interface LifeStore {
  newLifeId(): string;
  newLifeBranchId(): string;
  registerLife(
    lifeId: string,
    branchId: string,
    config: WorldConfig,
    protagonistName: string,
    protagonistSex: LifeSex,
    result: SimulationResult,
    snapshots: ReadonlyMap<number, YearSnapshot>,
  ): LifeRecord;
  createLife(config: WorldConfig, protagonistName: string, protagonistSex: LifeSex, result: SimulationResult, snapshots: ReadonlyMap<number, YearSnapshot>): LifeRecord;
  getLife(lifeId: string): LifeRecord | undefined;
  getLifeBranch(lifeId: string, branchId: string): LifeBranchRecord | undefined;
  getLatestBranch(lifeId: string): LifeBranchRecord | undefined;
  registerLifeBranch(
    lifeId: string,
    branchId: string,
    parentBranchId: string,
    forkYear: number,
    override: Override,
    result: SimulationResult,
    snapshots: ReadonlyMap<number, YearSnapshot>,
    label: string,
  ): LifeBranchRecord | undefined;
  addLifeBranch(
    lifeId: string,
    parentBranchId: string,
    forkYear: number,
    override: Override,
    result: SimulationResult,
    snapshots: ReadonlyMap<number, YearSnapshot>,
    label: string,
  ): LifeBranchRecord | undefined;
  listLifeBranches(lifeId: string): LifeBranchRecord[];
  listLifeSummaries(): LifeSummary[];
  deleteLife(lifeId: string): boolean;
  /** Closes the underlying DB connection. Only needed by tests simulating a restart (open a fresh store on the same file). */
  close(): void;
}

/**
 * Builds an independent life store backed by its own SQLite connection at `dbPath` (defaults to
 * `${DATA_DIR}/lifelines.db`). `cacheSize` bounds the in-memory `LruCache` (defaults to
 * `storeCacheSize()`, i.e. `STORE_CACHE_SIZE` or 16) — exposed as a parameter (not just the env
 * var) so tests can exercise eviction deterministically without touching process.env. Exported so
 * tests can point a store at a temp file — the module below wraps a single `globalThis`-cached
 * instance of this for the app's own default DB.
 */
export function createLifeStore(dbPath?: string, cacheSize?: number): LifeStore {
  const db: DatabaseSync = openDb(dbPath ?? path.join(dataDir(), "lifelines.db"));
  const cache = new LruCache<string, LifeRecord>(cacheSize ?? storeCacheSize());

  function loadBranchesForLife(lifeId: string): Map<string, LifeBranchRecord> {
    const rows = db.prepare("SELECT * FROM life_branches WHERE life_id = ?").all(lifeId) as unknown as LifeBranchRow[];
    const branches = new Map<string, LifeBranchRecord>();
    for (const row of rows) branches.set(row.id, rowToBranch(row));
    return branches;
  }

  function loadLifeFromDb(lifeId: string): LifeRecord | undefined {
    const row = db.prepare("SELECT * FROM lives WHERE id = ?").get(lifeId) as LifeRow | undefined;
    if (!row) return undefined;
    return {
      id: row.id,
      config: JSON.parse(row.config_json) as WorldConfig,
      protagonistName: row.protagonist_name,
      protagonistSex: row.protagonist_sex as LifeSex,
      originalBranchId: row.original_branch_id,
      latestBranchId: row.latest_branch_id,
      branches: loadBranchesForLife(lifeId),
      createdAt: row.created_at,
    };
  }

  /** Lazily (re)hydrates the cache from the DB on a miss — whether a true cold start or an LRU eviction. Returns the (now-cached) record, if any. */
  function ensureLoaded(lifeId: string): LifeRecord | undefined {
    const cached = cache.get(lifeId);
    if (cached) return cached;
    const record = loadLifeFromDb(lifeId);
    if (!record) return undefined;
    cache.set(lifeId, record);
    return record;
  }

  function persistLife(life: LifeRecord): void {
    db.prepare(
      `INSERT INTO lives (id, protagonist_name, protagonist_sex, config_json, original_branch_id, latest_branch_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET protagonist_name = excluded.protagonist_name, protagonist_sex = excluded.protagonist_sex,
         config_json = excluded.config_json, original_branch_id = excluded.original_branch_id,
         latest_branch_id = excluded.latest_branch_id, created_at = excluded.created_at`,
    ).run(life.id, life.protagonistName, life.protagonistSex, JSON.stringify(life.config), life.originalBranchId, life.latestBranchId, life.createdAt);
  }

  function persistBranch(branch: LifeBranchRecord): void {
    db.prepare(
      `INSERT INTO life_branches (id, life_id, label, parent_branch_id, fork_year, override_json, result_json, snapshots_blob, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET label = excluded.label, parent_branch_id = excluded.parent_branch_id,
         fork_year = excluded.fork_year, override_json = excluded.override_json, result_json = excluded.result_json,
         snapshots_blob = excluded.snapshots_blob, created_at = excluded.created_at`,
    ).run(
      branch.id,
      branch.lifeId,
      branch.label,
      branch.parentBranchId ?? null,
      branch.forkYear ?? null,
      branch.override ? JSON.stringify(branch.override) : null,
      compressJson(branch.result),
      compressJson(snapshotsToJson(branch.snapshots)),
      branch.createdAt,
    );
  }

  function newLifeId(): string {
    return `life${nextCounter(db, "lifeCounter")}-${Date.now().toString(36)}`;
  }

  function newLifeBranchId(): string {
    return `lb${nextCounter(db, "lifeBranchCounter")}-${Date.now().toString(36)}`;
  }

  function registerLife(
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
    // Persist first (both rows in one transaction), then populate the cache only once the commit
    // succeeds — so a failed/partial write (e.g. a `life_branches` row without its `lives` row, or
    // vice versa) can never leave the cache holding a record the DB doesn't actually have yet.
    withTransaction(db, () => {
      persistLife(record);
      persistBranch(branch);
    });
    cache.set(lifeId, record);
    return record;
  }

  function createLife(config: WorldConfig, protagonistName: string, protagonistSex: LifeSex, result: SimulationResult, snapshots: ReadonlyMap<number, YearSnapshot>): LifeRecord {
    return registerLife(newLifeId(), newLifeBranchId(), config, protagonistName, protagonistSex, result, snapshots);
  }

  function getLife(lifeId: string): LifeRecord | undefined {
    return ensureLoaded(lifeId);
  }

  function getLifeBranch(lifeId: string, branchId: string): LifeBranchRecord | undefined {
    return ensureLoaded(lifeId)?.branches.get(branchId);
  }

  function getLatestBranch(lifeId: string): LifeBranchRecord | undefined {
    const life = ensureLoaded(lifeId);
    if (!life) return undefined;
    return life.branches.get(life.latestBranchId);
  }

  function registerLifeBranch(
    lifeId: string,
    branchId: string,
    parentBranchId: string,
    forkYear: number,
    override: Override,
    result: SimulationResult,
    snapshots: ReadonlyMap<number, YearSnapshot>,
    label: string,
  ): LifeBranchRecord | undefined {
    const life = ensureLoaded(lifeId);
    if (!life) return undefined;
    const branch: LifeBranchRecord = { id: branchId, lifeId, label, parentBranchId, forkYear, override, result, snapshots, createdAt: Date.now() };

    // Persist first — both the new branch row and the parent life's updated `latest_branch_id`, in
    // one transaction — and only mutate the cached `life` object (shared, possibly still referenced
    // elsewhere) once that commit has actually succeeded. `persistLife` is called with a shallow
    // copy carrying the new `latestBranchId` rather than mutating `life` itself first, so a failure
    // here leaves the cached record exactly as it was — never pointing at a branch the DB doesn't
    // have yet.
    withTransaction(db, () => {
      persistBranch(branch);
      persistLife({ ...life, latestBranchId: branchId });
    });
    life.branches.set(branchId, branch);
    life.latestBranchId = branchId;
    return branch;
  }

  function addLifeBranch(
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

  function listLifeBranches(lifeId: string): LifeBranchRecord[] {
    return [...(ensureLoaded(lifeId)?.branches.values() ?? [])];
  }

  /**
   * A pure SQL read for list views — one query joining each life to its latest branch (for
   * `result_json`, never `snapshots_blob`) plus a `COUNT(*)` per life for its branch count. Never
   * touches `cache`/`ensureLoaded`: a full life list can easily exceed `cacheSize`, and reading it
   * through the cache would both thrash it (evicting everything else) and decompress every
   * snapshot blob for every life just to throw the snapshots away — this reads (and decompresses)
   * only the ~hundreds-of-KB `result_json`, never the tens-of-MB `snapshots_blob`.
   */
  function listLifeSummaries(): LifeSummary[] {
    const rows = db
      .prepare(
        `SELECT l.id, l.protagonist_name, l.config_json, l.latest_branch_id, b.result_json,
                (SELECT COUNT(*) FROM life_branches WHERE life_id = l.id) AS branch_count
         FROM lives l
         JOIN life_branches b ON b.id = l.latest_branch_id
         ORDER BY l.created_at, l.rowid`,
      )
      .all() as unknown as LifeSummaryRow[];
    return rows.map((row) => ({
      id: row.id,
      protagonistName: row.protagonist_name,
      config: JSON.parse(row.config_json) as WorldConfig,
      latestBranchId: row.latest_branch_id,
      latestResult: decompressJson<SimulationResult>(row.result_json),
      branchCount: row.branch_count,
    }));
  }

  /**
   * Removes a life and all its branches/snapshots (one transaction). Used by measurement scripts
   * that register many short-lived lives and would otherwise hold every one's snapshots in memory
   * for the whole run. Never hydrates the life just to check whether it existed — that would
   * decompress its (possibly tens-of-MB) snapshots for no reason; existence is read straight off
   * `result.changes` from the `DELETE FROM lives` statement instead.
   */
  function deleteLife(lifeId: string): boolean {
    const wasCached = cache.delete(lifeId);
    const changes = withTransaction(db, () => {
      db.prepare("DELETE FROM life_branches WHERE life_id = ?").run(lifeId);
      return db.prepare("DELETE FROM lives WHERE id = ?").run(lifeId).changes;
    });
    return wasCached || changes > 0;
  }

  function close(): void {
    db.close();
  }

  return { newLifeId, newLifeBranchId, registerLife, createLife, getLife, getLifeBranch, getLatestBranch, registerLifeBranch, addLifeBranch, listLifeBranches, listLifeSummaries, deleteLife, close };
}

const globalStoreKey = "__lifelinesLivesStore__";
const globalWithStore = globalThis as typeof globalThis & { [globalStoreKey]?: LifeStore };

function defaultStore(): LifeStore {
  globalWithStore[globalStoreKey] ??= createLifeStore();
  return globalWithStore[globalStoreKey];
}

export function newLifeId(): string {
  return defaultStore().newLifeId();
}

export function newLifeBranchId(): string {
  return defaultStore().newLifeBranchId();
}

/**
 * Registers a newly-simulated life. Takes an already-minted `lifeId`/`branchId` rather than
 * generating them internally (unlike the legacy `world-store.ts#createWorld`, removed in decision
 * 060) — the SSE contract's `start`
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
  return defaultStore().registerLife(lifeId, branchId, config, protagonistName, protagonistSex, result, snapshots);
}

/** Convenience wrapper over `registerLife` for callers (tests, scripts) that don't need to know the id ahead of time. */
export function createLife(config: WorldConfig, protagonistName: string, protagonistSex: LifeSex, result: SimulationResult, snapshots: ReadonlyMap<number, YearSnapshot>): LifeRecord {
  return defaultStore().createLife(config, protagonistName, protagonistSex, result, snapshots);
}

export function getLife(lifeId: string): LifeRecord | undefined {
  return defaultStore().getLife(lifeId);
}

export function getLifeBranch(lifeId: string, branchId: string): LifeBranchRecord | undefined {
  return defaultStore().getLifeBranch(lifeId, branchId);
}

/** Per the contract, `GET /api/lives/:lifeId?branchId=` with no `branchId` returns the LATEST branch (the most recently created one), not the original life. */
export function getLatestBranch(lifeId: string): LifeBranchRecord | undefined {
  return defaultStore().getLatestBranch(lifeId);
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
  return defaultStore().registerLifeBranch(lifeId, branchId, parentBranchId, forkYear, override, result, snapshots, label);
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
  return defaultStore().addLifeBranch(lifeId, parentBranchId, forkYear, override, result, snapshots, label);
}

export function listLifeBranches(lifeId: string): LifeBranchRecord[] {
  return defaultStore().listLifeBranches(lifeId);
}

export function listLifeSummaries(): LifeSummary[] {
  return defaultStore().listLifeSummaries();
}

/** Removes a life and all its branches/snapshots. Used by measurement scripts that register many short-lived lives and would otherwise hold every one's snapshots in memory for the whole run. */
export function deleteLife(lifeId: string): boolean {
  return defaultStore().deleteLife(lifeId);
}

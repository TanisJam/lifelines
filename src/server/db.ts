import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { brotliCompressSync, brotliDecompressSync, constants as zlibConstants } from "node:zlib";

/**
 * SQLite persistence adapter (self-hosted Docker deploy, decision: persist lives so they survive
 * restarts and redeploys). Uses Node's built-in `node:sqlite` (`DatabaseSync`) rather than a
 * native npm module — keeps the Docker build simple (no node-gyp / prebuilt-binary matrix) and is
 * available unflagged on Node 22.5+ (verified locally on Node v26 and on the `node:24-bookworm-slim`
 * image used by `Dockerfile`). This module owns the raw DB connection, schema, and JSON<->BLOB
 * codec; `life-store.ts` owns the domain-shaped read/write logic on top of it. Kept out of
 * `src/domain` per the hexagonal layout — this is infrastructure, not domain logic.
 *
 * Decision 060: `worlds`/`world_branches` are no longer created here (the legacy `/world` flow
 * that owned them was removed) — `CREATE TABLE IF NOT EXISTS` never ran a `DROP`, so a prod DB
 * that already has those tables just keeps them, unused, rather than risking data loss.
 */

/** `DATA_DIR` is the single knob for where all persistent state lives — this DB, and (see `decision-engine.ts`) the Jev decision cache. Defaults to `.data` (gitignored) for local dev; the Docker image sets `DATA_DIR=/data`, a mounted volume. */
export function dataDir(): string {
  return process.env.DATA_DIR ?? ".data";
}

/**
 * How many lives `life-store.ts` keeps hydrated in its in-memory `LruCache` at once — bounds
 * process memory (a full-lifespan life alone is tens of MB of uncompressed snapshots once
 * loaded). Configurable via `STORE_CACHE_SIZE`; defaults to 16, which is generous for the homelab
 * single-instance deploy this app targets while still bounding growth. Falls back to the default
 * for anything that isn't a positive integer.
 */
export function storeCacheSize(): number {
  const raw = Number(process.env.STORE_CACHE_SIZE);
  return Number.isInteger(raw) && raw > 0 ? raw : 16;
}

function defaultDbPath(): string {
  return path.join(dataDir(), "lifelines.db");
}

/**
 * Creates the schema if it doesn't exist yet (idempotent — safe to call on every startup).
 * `result_json`/`snapshots_blob` are brotli-compressed JSON (see `compressJson`/`decompressJson`):
 * a full-lifespan life's snapshots serialize to tens of MB of near-duplicate JSON (each year's
 * snapshot repeats the whole cumulative state), which brotli shrinks by ~300-500x.
 */
function createSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS counters (
      name TEXT PRIMARY KEY,
      value INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS lives (
      id TEXT PRIMARY KEY,
      protagonist_name TEXT NOT NULL,
      protagonist_sex TEXT NOT NULL,
      config_json TEXT NOT NULL,
      original_branch_id TEXT NOT NULL,
      latest_branch_id TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS life_branches (
      id TEXT PRIMARY KEY,
      life_id TEXT NOT NULL REFERENCES lives(id),
      label TEXT NOT NULL,
      parent_branch_id TEXT,
      fork_year INTEGER,
      override_json TEXT,
      result_json BLOB NOT NULL,
      snapshots_blob BLOB NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_life_branches_life_id ON life_branches(life_id);

    -- External branch-qualified lineage; immutable even when two branches reuse event IDs.
    -- Capsules remain in favor_records_v1, owned exclusively by SqliteFavorRecords.
    CREATE TABLE IF NOT EXISTS canonical_branch_bindings (
      life_id TEXT NOT NULL REFERENCES lives(id),
      branch_id TEXT NOT NULL REFERENCES life_branches(id),
      binding_json TEXT NOT NULL,
      PRIMARY KEY (life_id, branch_id)
    );
    CREATE TRIGGER IF NOT EXISTS canonical_binding_no_update
      BEFORE UPDATE ON canonical_branch_bindings BEGIN
        SELECT RAISE(ABORT, 'Immutable canonical binding');
      END;
    CREATE TRIGGER IF NOT EXISTS canonical_binding_no_delete
      BEFORE DELETE ON canonical_branch_bindings BEGIN
        SELECT RAISE(ABORT, 'Canonical history cannot be deleted');
      END;

    -- Lifecycle engine persistence (RI1). Purely additive: the legacy lives, life_branches
    -- and canonical_branch_bindings tables above are untouched and no row is migrated. A
    -- new-engine life keeps its own metadata row and its own binding namespace, so a lifecycle
    -- binding and a legacy canonical-branch-rb1 binding can never be confused.
    CREATE TABLE IF NOT EXISTS lifecycle_lives (
      id TEXT PRIMARY KEY,
      protagonist_name TEXT NOT NULL,
      protagonist_sex TEXT NOT NULL,
      config_json TEXT NOT NULL,
      branch_id TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    -- Capsule payloads live in their own strict table, owned exclusively by LifecycleRepository
    -- (mirrors favor_records_v1's exact-schema guard, sqlite-favor-records.ts). The digest key and
    -- the wire are UTF-16LE BLOBs so NUL and unpaired surrogates survive byte-exact — the capsule
    -- digest is computed over those code units, so storage must not normalize them. The CREATE text
    -- is kept on one line so it byte-matches the repository's normalized exact-schema check.
    CREATE TABLE IF NOT EXISTS lifecycle_capsules_v1 (key BLOB NOT NULL PRIMARY KEY, wire BLOB NOT NULL) STRICT;

    -- External lifecycle lineage; immutable for the same reason as canonical_branch_bindings.
    CREATE TABLE IF NOT EXISTS lifecycle_bindings (
      life_id TEXT NOT NULL,
      branch_id TEXT NOT NULL,
      binding_json TEXT NOT NULL,
      PRIMARY KEY (life_id, branch_id)
    );
    CREATE TRIGGER IF NOT EXISTS lifecycle_binding_no_update
      BEFORE UPDATE ON lifecycle_bindings BEGIN
        SELECT RAISE(ABORT, 'Immutable lifecycle binding');
      END;
    CREATE TRIGGER IF NOT EXISTS lifecycle_binding_no_delete
      BEFORE DELETE ON lifecycle_bindings BEGIN
        SELECT RAISE(ABORT, 'Lifecycle history cannot be deleted');
      END;

    -- Chunked lifecycle format (CP1-B B2). Purely additive: the certified compact tables above are
    -- untouched and no row is migrated. One immutable row per (life, branch) carries that life's
    -- manifest JSON and the genesis JSON its chunks are corroborated against. Chunk payloads reuse
    -- lifecycle_capsules_v1, the generic strict digest-keyed key/wire table: a chunk is stored under
    -- its own domain-separated digest and both stored wire shapes declare disjoint exact key sets
    -- ({manifest,table,digest} vs {from,to,table,digest}), so a chunk can never be read as a capsule
    -- or the reverse. The manifest is an index, never authority: every load replays from genesis.
    CREATE TABLE IF NOT EXISTS lifecycle_chunked_manifests (
      life_id TEXT NOT NULL,
      branch_id TEXT NOT NULL,
      manifest_json TEXT NOT NULL,
      genesis_json TEXT NOT NULL,
      PRIMARY KEY (life_id, branch_id)
    );
    CREATE TRIGGER IF NOT EXISTS lifecycle_chunked_manifest_no_update
      BEFORE UPDATE ON lifecycle_chunked_manifests BEGIN
        SELECT RAISE(ABORT, 'Immutable lifecycle chunked manifest');
      END;
    CREATE TRIGGER IF NOT EXISTS lifecycle_chunked_manifest_no_delete
      BEFORE DELETE ON lifecycle_chunked_manifests BEGIN
        SELECT RAISE(ABORT, 'Lifecycle history cannot be deleted');
      END;

    -- Abuse protection (per-IP rate limiting on simulation-triggering endpoints): one row per
    -- allowed attempt, so a sliding window can be computed by counting/pruning rows younger than
    -- the window instead of maintaining separate hour/day counters that could drift out of sync.
    -- See src/server/ip-rate-limit.ts.
    CREATE TABLE IF NOT EXISTS ip_rate_limit_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ip TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ip_rate_limit_events_ip_created_at ON ip_rate_limit_events(ip, created_at);
  `);
}

/**
 * Parses an env var as a positive integer, falling back to `fallback` for anything unset,
 * non-numeric, or non-positive. Shared by every module that reads a configurable limit from the
 * environment (see `storeCacheSize` above, `ip-rate-limit.ts`, `turnstile.ts`).
 */
export function envInt(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isInteger(raw) && raw > 0 ? raw : fallback;
}

/** Opens (creating the directory and schema if needed) a SQLite DB at `filePath`, in WAL mode. Exported so tests can point it at a temp file — never the real `DATA_DIR`. */
export function openDb(filePath: string): DatabaseSync {
  if (filePath !== ":memory:") mkdirSync(path.dirname(filePath), { recursive: true });
  const db = new DatabaseSync(filePath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  // Lets a writer that hits a transient lock (WAL still allows concurrent readers, but a second
  // writer, or a reader colliding with a checkpoint) retry for up to 5s instead of throwing
  // SQLITE_BUSY immediately. Mostly matters for tests, where several vitest workers can end up
  // touching SQLite around the same moment; a single production instance rarely contends with
  // itself, but the timeout is harmless there too.
  db.exec("PRAGMA busy_timeout = 5000");
  createSchema(db);
  return db;
}

/**
 * Runs `fn` inside a `BEGIN`/`COMMIT` transaction, rolling back on throw. Used by callers that
 * perform more than one write that must land together (e.g. a branch row plus its parent life
 * row's updated `latest_branch_id`) — so a mid-write failure can never leave the DB (or, since
 * callers persist before touching their cache, the cache) with only half the change applied.
 */
export function withTransaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec("BEGIN");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // The BEGIN may never have taken effect, or the connection may already be in a bad state;
      // the original error is what matters and is rethrown below either way.
    }
    throw error;
  }
}

// Process-wide singleton, same `globalThis` reasoning as the other stores (decision-engine.ts,
// life-store.ts): Next.js can bundle Route Handlers and Server Components separately, so a plain
// module-level `let db` could fork into two independent connections.
const globalDbKey = "__lifelinesDb__";
const globalWithDb = globalThis as typeof globalThis & { [globalDbKey]?: DatabaseSync };

/** The shared DB connection for the whole process, opened at `${DATA_DIR}/lifelines.db` on first use. */
export function getDb(): DatabaseSync {
  globalWithDb[globalDbKey] ??= openDb(defaultDbPath());
  return globalWithDb[globalDbKey];
}

/**
 * Atomically returns the next value for a named counter, persisting it — so ids stay unique
 * across restarts without needing to warm an in-memory counter from a `MAX(id)` scan at startup.
 * Safe without an explicit transaction: `DatabaseSync` calls are synchronous, so nothing else in
 * this process can run between the read and the write.
 */
export function nextCounter(db: DatabaseSync, name: string): number {
  const row = db.prepare("SELECT value FROM counters WHERE name = ?").get(name) as { value: number } | undefined;
  const next = (row?.value ?? 0) + 1;
  db.prepare("INSERT INTO counters (name, value) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value").run(name, next);
  return next;
}

/**
 * Brotli quality 5, not the default (11): measured on a real 81-year rules-engine life, quality 11
 * compresses the ~32MB snapshots JSON to ~60KB in ~2.7s of synchronous (main-thread-blocking) CPU
 * time; quality 5 gets ~71KB — a negligible size difference — in ~80ms. Both are already far under
 * "a few MB", so the extra ~15% quality-11 would buy isn't worth blocking the event loop for.
 */
const COMPRESS_OPTIONS = { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 5 } };

export function compressJson(value: unknown): Buffer {
  return brotliCompressSync(Buffer.from(JSON.stringify(value)), COMPRESS_OPTIONS);
}

export function decompressJson<T>(blob: Uint8Array): T {
  return JSON.parse(brotliDecompressSync(blob).toString("utf8")) as T;
}

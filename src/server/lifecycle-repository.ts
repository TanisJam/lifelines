import type { DatabaseSync, StatementSync } from "node:sqlite";
import {
  admitLifecycleCompactCapsule,
  createLifecycleCompactCapsule,
  deserializeLifecycleCompactCapsule,
  LIFECYCLE_COMPACT_CAPSULE_MANIFEST,
  type LifecycleCompactCapsule,
} from "../domain/e-lifecycle-capsule";
import { deserializeCompactLifecycleDag, serializeCompactLifecycleDag } from "../domain/e-lifecycle-dag";
import { regenerateLifecycleOutput } from "../domain/e-lifecycle-run";
import { requireFavorData } from "../domain/effects";
import type { LifeSex } from "../contracts/life";
import type { WorldConfig } from "../domain/types";
import { withTransaction } from "./db";
import { LifecycleProjectionStore, type LifecycleProjectionWrite } from "./lifecycle-projection-store";

/**
 * Physical format v1 mirrors `favor_records_v1` (`sqlite-favor-records.ts`): the digest key and the
 * capsule wire are little-endian UTF-16 code units, not SQLite TEXT/UTF-8. Deliberate choice — a
 * lifecycle capsule is a lossless proof artifact and its digest is computed over those exact code
 * units, so the storage layer must preserve NUL and unpaired surrogates rather than normalize them.
 * Like that module, the repository accepts only this exact versioned physical schema and refuses
 * similar columns, alternate types, views or added triggers/indexes.
 */
const schema = "CREATE TABLE lifecycle_capsules_v1 (key BLOB NOT NULL PRIMARY KEY, wire BLOB NOT NULL) STRICT";
/**
 * v2 stores the INPUT, not the result. A capsule wire is ~55 MiB for a 15-year life because it embeds
 * every regenerated year; all of it is reproducible from the genesis, and P3 already made reads answer
 * from the projection index. v2 therefore stores the genesis alone plus the run budget, and `load`
 * regenerates the years under current authority - the same authority rule as before, at ~88 KB a life.
 *
 * `max_steps` is the number of years the original run committed. Re-running from the genesis with that
 * budget reproduces exactly those years (the run stops early on a death, never past it), so the digest
 * may be recomputed and compared with the binding.
 *
 * v1 stays readable: lives published before this change keep loading through the archived wire.
 */
const schemaV2 = `CREATE TABLE lifecycle_capsules_v2 (
  key BLOB NOT NULL PRIMARY KEY,
  genesis_table TEXT NOT NULL,
  max_steps INTEGER NOT NULL
) STRICT`;
const normalizeSql = (sql: string) => sql.replace(/\s+/g, " ").trim().toLowerCase();

/** The lifecycle binding's own recognized version, deliberately distinct from the legacy
 * `canonical-branch-rb1` and from the annual capsule schema. Recognized-version dispatch only:
 * an unknown/foreign version is refused, never coerced, translated or migrated. */
export const LIFECYCLE_BINDING_VERSION = "canonical-lifecycle-cb1-1" as const;

/** Frozen recognized key set. `genesisDigest` is present because `LifecycleGenesis` exposes its own
 * `digest`; the genesis and capsule schemas are what make a lifecycle binding self-describing. */
const BINDING_KEYS = ["branchId", "capsuleDigest", "capsuleSchema", "genesisDigest", "lifeId", "version"];

export interface LifecycleBranchBinding {
  readonly version: typeof LIFECYCLE_BINDING_VERSION;
  readonly lifeId: string;
  readonly branchId: string;
  readonly capsuleDigest: string;
  readonly capsuleSchema: string;
  readonly genesisDigest: string;
}

export interface LifecyclePublication {
  readonly lifeId: string;
  readonly branchId: string;
  readonly config: WorldConfig;
  readonly protagonistName: string;
  readonly protagonistSex: LifeSex;
  /** Compact lifecycle capsule `{ manifest, digest, genesis, output }` as produced by
   * `createLifecycleCompactCapsule`. Its digest is only an admission gate; the stored artifact is
   * regenerated and re-digested under current authority and the caller's digest is never trusted. */
  readonly capsule: unknown;
  /** Derived chronicle views to index alongside the capsule, one per locale. OPTIONAL: when absent,
   * nothing is indexed and reads of this life keep taking the full replay. Never authority — the rows
   * are keyed by the ADMITTED capsule digest computed here, not by anything the caller claims. */
  readonly projections?: readonly LifecycleProjectionWrite[];
}

export interface LoadedLifecycle {
  readonly binding: LifecycleBranchBinding;
  readonly capsule: LifecycleCompactCapsule;
}

/** Record order/prototypes are not meaning; array order, key presence and -0 are. */
function same(left: unknown, right: unknown): boolean {
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return Object.is(left, right);
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every(key => Object.hasOwn(right, key) && same(Reflect.get(left, key), Reflect.get(right, key)));
}
function key(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw new Error("Invalid binding digest");
}
function sqlText(value: unknown): asserts value is string {
  if (typeof value !== "string" || value.includes("\0") || Buffer.from(value, "utf8").toString("utf8") !== value) {
    throw new Error("Unsupported lifecycle SQLite TEXT value");
  }
}
function identifier(value: unknown): asserts value is string {
  sqlText(value);
  if (value.length === 0) throw new Error("Invalid branch identifier");
}
/** A stored view must describe the life it is being stored for: the view embeds the route identity. */
function requireProjectionIdentity(view: unknown, lifeId: string, branchId: string): void {
  const record = view as { readonly lifeId?: unknown; readonly branchId?: unknown } | null;
  if (record === null || typeof record !== "object"
    || record.lifeId !== lifeId || record.branchId !== branchId) {
    throw new Error("Lifecycle projection identity disagreement");
  }
}
function frozen<T>(value: T): T {
  if (value && typeof value === "object") { Object.values(value).forEach(frozen); Object.freeze(value); }
  return value;
}
function encode(value: string): Buffer { return Buffer.from(value, "utf16le"); }
function decode(value: unknown): string {
  if (!(value instanceof Uint8Array) || value.byteLength % 2 !== 0) {
    throw new Error("Invalid lifecycle_capsules_v1 UTF-16LE BLOB");
  }
  return Buffer.from(value).toString("utf16le");
}

/**
 * Persistence seam for new-engine lives. Injected trusted capability: the caller owns the
 * connection and its lifetime, and no database opening, migration or retry policy lives here.
 *
 * Authority rules are non-negotiable. `publish` FULL-regenerates the capsule under current
 * authority and records a digest recomputed from the admitted capsule, never the caller's.
 * `load` cold-admits and FULLY replays the capsule; a stored digest, binding or payload is never
 * authority and never short-circuits replay. The `lifecycle_lives` row is a listing projection —
 * no read path treats it as authority.
 */
export class LifecycleRepository {
  private readonly selectBinding: StatementSync;
  private readonly selectCapsule: StatementSync;
  private readonly selectGenesis: StatementSync;
  private readonly insertGenesis: StatementSync;
  private readonly projections: LifecycleProjectionStore;

  constructor(private readonly db: DatabaseSync) {
    const [selectBinding, selectCapsule, selectGenesis, insertGenesis] = this.transaction(() => {
      const existing = db.prepare("SELECT type, sql FROM main.sqlite_schema WHERE name = ?").get("lifecycle_capsules_v1");
      if (existing === undefined) db.exec(schema);
      else if (existing.type !== "table" || typeof existing.sql !== "string" || normalizeSql(existing.sql) !== normalizeSql(schema)) {
        // Intentionally conservative: accept only this exact versioned physical schema,
        // never silently accept constraints, alternate types or views with similar columns.
        throw new Error("Incompatible lifecycle_capsules_v1 schema");
      }
      const additions = db.prepare("SELECT name FROM main.sqlite_schema WHERE tbl_name = ? AND (type = 'trigger' OR (type = 'index' AND sql IS NOT NULL))").all("lifecycle_capsules_v1");
      if (additions.length !== 0) throw new Error("Incompatible lifecycle_capsules_v1 schema extensions");
      const existingV2 = db.prepare("SELECT type, sql FROM main.sqlite_schema WHERE name = ?").get("lifecycle_capsules_v2");
      if (existingV2 === undefined) db.exec(schemaV2);
      else if (existingV2.type !== "table" || typeof existingV2.sql !== "string"
        || normalizeSql(existingV2.sql) !== normalizeSql(schemaV2)) {
        throw new Error("Incompatible lifecycle_capsules_v2 schema");
      }
      const additionsV2 = db.prepare("SELECT name FROM main.sqlite_schema WHERE tbl_name = ? AND (type = 'trigger' OR (type = 'index' AND sql IS NOT NULL))").all("lifecycle_capsules_v2");
      if (additionsV2.length !== 0) throw new Error("Incompatible lifecycle_capsules_v2 schema extensions");
      return [
        db.prepare("SELECT binding_json FROM lifecycle_bindings WHERE life_id = ? AND branch_id = ?"),
        db.prepare("SELECT wire FROM main.lifecycle_capsules_v1 WHERE key = ?"),
        db.prepare("SELECT genesis_table, max_steps FROM main.lifecycle_capsules_v2 WHERE key = ?"),
        db.prepare("INSERT INTO main.lifecycle_capsules_v2 (key, genesis_table, max_steps) VALUES (?, ?, ?) ON CONFLICT(key) DO NOTHING"),
      ] as const;
    });
    this.selectBinding = selectBinding;
    this.selectCapsule = selectCapsule;
    this.selectGenesis = selectGenesis;
    this.insertGenesis = insertGenesis;
    this.projections = new LifecycleProjectionStore(db);
  }

  /** Reads and validates the binding row, enforcing the exact frozen key set and its recognized
   * version/schema. Returns undefined when there is no lifecycle binding for the pair. */
  binding(lifeId: string, branchId: string): LifecycleBranchBinding | undefined {
    identifier(lifeId); identifier(branchId);
    const row = this.selectBinding.get(lifeId, branchId);
    if (!row) return undefined;
    const binding = JSON.parse(row.binding_json as string) as LifecycleBranchBinding;
    requireFavorData(binding);
    if (!same(Object.keys(binding).sort(), [...BINDING_KEYS])
      || binding.version !== LIFECYCLE_BINDING_VERSION
      || binding.capsuleSchema !== LIFECYCLE_COMPACT_CAPSULE_MANIFEST.capsuleSchema
      || binding.lifeId !== lifeId || binding.branchId !== branchId) throw new Error("Corrupt lifecycle binding");
    key(binding.capsuleDigest); key(binding.genesisDigest);
    return frozen(binding);
  }

  /** Cold-regenerates the stored life under current authority. The stored digest, binding and genesis
   * are never authority: a reconstructed capsule that disagrees with the binding is a refusal, not a
   * repair. Returns undefined when there is no lifecycle binding.
   *
   * v2 stores only the genesis and its budget, so this re-runs the years. v1 lives keep loading from
   * their archived wire, which is decoded and then fully replayed exactly as before. */
  async load(lifeId: string, branchId: string): Promise<LoadedLifecycle | undefined> {
    const binding = this.binding(lifeId, branchId);
    if (!binding) return undefined;
    const stored = this.readGenesis(binding.capsuleDigest);
    if (stored !== undefined) {
      const genesis = deserializeCompactLifecycleDag(stored.genesisTable);
      const output = await regenerateLifecycleOutput(genesis, stored.maxSteps);
      const capsule = await createLifecycleCompactCapsule({ genesis, output });
      this.requireBindingAgreement(binding, capsule);
      return Object.freeze({ binding, capsule });
    }
    const row = this.selectCapsule.get(encode(binding.capsuleDigest));
    if (row === undefined) throw new Error("Missing lifecycle capsule");
    const capsule = await deserializeLifecycleCompactCapsule(decode(row.wire));
    this.requireBindingAgreement(binding, capsule);
    return Object.freeze({ binding, capsule });
  }

  private requireBindingAgreement(binding: LifecycleBranchBinding, capsule: LifecycleCompactCapsule): void {
    if (capsule.digest !== binding.capsuleDigest || capsule.manifest.capsuleSchema !== binding.capsuleSchema
      || capsule.genesis.digest !== binding.genesisDigest) throw new Error("Lifecycle binding/capsule disagreement");
  }

  private readGenesis(digest: string): { genesisTable: string; maxSteps: number } | undefined {
    const row = this.selectGenesis.get(encode(digest)) as
      { readonly genesis_table?: unknown; readonly max_steps?: unknown } | undefined;
    if (row === undefined) return undefined;
    if (typeof row.genesis_table !== "string" || typeof row.max_steps !== "number") {
      throw new Error("Corrupt lifecycle_capsules_v2 row");
    }
    return { genesisTable: row.genesis_table, maxSteps: row.max_steps };
  }

  /** Full current-authority regeneration, then one transaction for the life row, binding row and
   * capsule payload. The recorded digest is recomputed from the ADMITTED capsule, never taken from
   * the caller. An exact retry of the same bytes is idempotent; a different digest for the same
   * (lifeId, branchId) refuses. */
  async publish(input: LifecyclePublication): Promise<LifecycleBranchBinding> {
    identifier(input.lifeId); identifier(input.branchId);
    // Capture caller-owned data BEFORE the first await. The capsule is separately admitted, and
    // admission owns its graph synchronously before it can suspend — after the await only the
    // regenerated capsule is read.
    const data = { lifeId: input.lifeId, branchId: input.branchId, config: input.config,
      protagonistName: input.protagonistName, protagonistSex: input.protagonistSex };
    requireFavorData(data, true);
    const captured = structuredClone(data);
    const admitted = await admitLifecycleCompactCapsule(input.capsule);
    // Store the INPUT: the genesis and the budget that reproduced these years. Everything else in the
    // capsule is derivable, so the whole 55 MiB wire is dropped instead of persisted.
    const genesisTable = serializeCompactLifecycleDag(admitted.genesis);
    const maxSteps = admitted.output.journal.length;
    sqlText(captured.protagonistName); sqlText(captured.protagonistSex);
    const configJson = JSON.stringify(captured.config);
    sqlText(configJson);
    const binding: LifecycleBranchBinding = frozen({ version: LIFECYCLE_BINDING_VERSION,
      lifeId: captured.lifeId, branchId: captured.branchId, capsuleDigest: admitted.digest,
      capsuleSchema: admitted.manifest.capsuleSchema, genesisDigest: admitted.genesis.digest });
    return withTransaction(this.db, () => {
      const existing = this.binding(captured.lifeId, captured.branchId);
      if (existing && !same(existing, binding)) throw new Error("Conflicting immutable lifecycle binding");
      if (!existing) {
        this.insertGenesis.run(encode(admitted.digest), genesisTable, maxSteps);
        // The locked post-insert comparison, not a repository pre-read, protects retries.
        const stored = this.readGenesis(admitted.digest);
        if (stored === undefined || stored.genesisTable !== genesisTable || stored.maxSteps !== maxSteps) {
          throw new Error("Conflicting immutable record");
        }
        this.db.prepare("INSERT INTO lifecycle_lives (id, protagonist_name, protagonist_sex, config_json, branch_id, created_at) VALUES (?, ?, ?, ?, ?, ?)")
          .run(captured.lifeId, captured.protagonistName, captured.protagonistSex, configJson, captured.branchId, Date.now());
        this.db.prepare("INSERT INTO lifecycle_bindings (life_id, branch_id, binding_json) VALUES (?, ?, ?)")
          .run(captured.lifeId, captured.branchId, JSON.stringify(binding));
        // Same transaction as the capsule and binding: an indexed view can never outlive or precede
        // the content address it is keyed by.
        if (input.projections !== undefined && input.projections.length !== 0) {
          for (const projection of input.projections) {
            requireProjectionIdentity(projection.view, captured.lifeId, captured.branchId);
          }
          this.projections.write({ lifeId: captured.lifeId, branchId: captured.branchId,
            capsuleDigest: admitted.digest }, input.projections);
        }
      }
      return binding;
    });
  }

  private transaction<T>(body: () => T): T {
    // Outside the owned try: failed/nested BEGIN must never roll back caller work.
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = body();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      try { this.db.exec("ROLLBACK"); } catch { /* Preserve the original failure. */ }
      throw error;
    }
  }
}

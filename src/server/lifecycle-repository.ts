import { createHash } from "node:crypto";
import type { DatabaseSync, StatementSync } from "node:sqlite";
import {
  admitLifecycleCompactCapsule,
  deserializeLifecycleCompactCapsule,
  LIFECYCLE_COMPACT_CAPSULE_MANIFEST,
  serializeLifecycleCompactCapsule,
  type LifecycleCompactCapsule,
  type LifecycleCompactCapsuleManifest,
} from "../domain/e-lifecycle-capsule";
import {
  admitChunkedLifecycleCapsule,
  lifecycleChunkDigest,
  serializeLifecycleChunk,
  LIFECYCLE_CHUNKED_CAPSULE_SCHEMA,
  type LifecycleChunk,
  type LifecycleChunkedCapsule,
  type LifecycleChunkedManifest,
} from "../domain/e-lifecycle-chunked-capsule";
import type { LifecycleGenesis } from "../domain/e-lifecycle-genesis";
import { requireFavorData } from "../domain/effects";
import type { LifeSex } from "../contracts/life";
import type { WorldConfig } from "../domain/types";
import { withTransaction } from "./db";

/**
 * Physical format v1 mirrors `favor_records_v1` (`sqlite-favor-records.ts`): the digest key and the
 * capsule wire are little-endian UTF-16 code units, not SQLite TEXT/UTF-8. Deliberate choice — a
 * lifecycle capsule is a lossless proof artifact and its digest is computed over those exact code
 * units, so the storage layer must preserve NUL and unpaired surrogates rather than normalize them.
 * Like that module, the repository accepts only this exact versioned physical schema and refuses
 * similar columns, alternate types, views or added triggers/indexes.
 */
const schema = "CREATE TABLE lifecycle_capsules_v1 (key BLOB NOT NULL PRIMARY KEY, wire BLOB NOT NULL) STRICT";
const normalizeSql = (sql: string) => sql.replace(/\s+/g, " ").trim().toLowerCase();

/** The lifecycle binding's own recognized version, deliberately distinct from the legacy
 * `canonical-branch-rb1` and from the annual capsule schema. Recognized-version dispatch only:
 * an unknown/foreign version is refused, never coerced, translated or migrated. */
export const LIFECYCLE_BINDING_VERSION = "canonical-lifecycle-cb1-1" as const;

/** The exact capsule schemas this repository dispatches on: the certified compact format and the
 * additive chunked one. Anything else is refused by `binding()`, so `load` can never fall through
 * to a guess, a coercion or an implicit migration. */
const RECOGNIZED_CAPSULE_SCHEMAS: ReadonlySet<string> = new Set<string>([
  LIFECYCLE_COMPACT_CAPSULE_MANIFEST.capsuleSchema,
  LIFECYCLE_CHUNKED_CAPSULE_SCHEMA,
]);

/** Domain separation for the chunked life's own record digest, computed over the admitted
 * manifest (which commits to `genesisDigest` and every chunk digest). Distinct from the compact
 * capsule frame and from the per-chunk frame, so no stored digest can be replayed across formats. */
const CHUNKED_RECORD_DOMAIN = "lifecycle-chunked-capsule-record-cp1-1";

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
  /** The capsule admission input, dispatched by its recognized `manifest.capsuleSchema`:
   * the compact `{ manifest, digest, genesis, output }` produced by
   * `createLifecycleCompactCapsule`, or the chunked `{ manifest, chunks, genesis }` accepted by
   * `admitChunkedLifecycleCapsule` (NOT the `{ manifest, chunks, regenerated }` creation artifact).
   * Every digest is only an admission gate; the stored artifact is regenerated and re-digested
   * under current authority and the caller's digests are never trusted. */
  readonly capsule: unknown;
}

/** The loaded artifact, whichever recognized format stored it. `manifest` declares the schema;
 * `digest` is recomputed from the admitted artifact, never read from storage. */
export interface LoadedLifecycleCapsule {
  readonly manifest: LifecycleCompactCapsuleManifest | LifecycleChunkedManifest;
  readonly digest: string;
  readonly genesis: LifecycleGenesis;
  readonly output: LifecycleCompactCapsule["output"];
  /** Present only for the chunked format: the corroborated chunk chain in order, so a loaded
   * chunked artifact is itself a valid `admitChunkedLifecycleCapsule` input. Never authority. */
  readonly chunks?: readonly LifecycleChunk[];
}

export interface LoadedLifecycle {
  readonly binding: LifecycleBranchBinding;
  readonly capsule: LoadedLifecycleCapsule;
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
/** Recognized-schema read of a caller's publication payload. The whole borrowed graph is guarded
 * before the first field read, and anything unrecognized falls through to the compact path, which
 * refuses it with exactly the message it refuses today (no coercion, no migration). */
function capsuleSchemaOf(value: unknown): string | undefined {
  requireFavorData(value, true);
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const manifest = (value as { manifest?: unknown }).manifest;
  if (manifest === null || typeof manifest !== "object" || Array.isArray(manifest)) return undefined;
  const schema = (manifest as { capsuleSchema?: unknown }).capsuleSchema;
  return typeof schema === "string" ? schema : undefined;
}
/** Integrity for the whole chunked life: a domain-separated digest over the admitted manifest,
 * which commits to `genesisDigest` and every chunk digest. Recomputable by anyone and recomputed
 * on both save and load, so it can only ever be an admission gate, never authority. */
function chunkedCapsuleDigest(manifest: unknown): string {
  const hash = createHash("sha256");
  hash.update(`["${CHUNKED_RECORD_DOMAIN}",${JSON.stringify(manifest)}]`, "utf8");
  return hash.digest("hex");
}
/** The chunk digests of a stored manifest, used ONLY to locate rows. This is index reading, not
 * admission: every range, width, digest and journal value is validated by
 * `admitChunkedLifecycleCapsule` against the regenerated life. */
function chunkDigests(manifest: unknown): string[] {
  requireFavorData(manifest, true);
  if (manifest === null || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error("Corrupt lifecycle chunked manifest");
  }
  const chunks = (manifest as { chunks?: unknown }).chunks;
  if (!Array.isArray(chunks)) throw new Error("Corrupt lifecycle chunked manifest");
  return chunks.map(entry => {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error("Corrupt lifecycle chunked manifest");
    }
    const digest = (entry as { digest?: unknown }).digest;
    if (typeof digest !== "string" || !/^[a-f0-9]{64}$/.test(digest)) {
      throw new Error("Corrupt lifecycle chunked manifest");
    }
    return digest;
  });
}
/** Everything `publish` owns after the first await: plain, detached, already SQL-checked data. */
interface CapturedPublication {
  readonly lifeId: string;
  readonly branchId: string;
  readonly config: WorldConfig;
  readonly protagonistName: string;
  readonly protagonistSex: LifeSex;
}

/**
 * Persistence seam for new-engine lives. Injected trusted capability: the caller owns the
 * connection and its lifetime, and no database opening, migration or retry policy lives here.
 *
 * Authority rules are non-negotiable. `publish` FULL-regenerates the capsule under current
 * authority and records a digest recomputed from the admitted capsule, never the caller's.
 * `load` cold-admits and FULLY replays the capsule; a stored digest, binding, manifest or chunk is
 * never authority and never short-circuits replay. The `lifecycle_lives` row is a listing
 * projection — no read path treats it as authority.
 *
 * TWO RECOGNIZED FORMATS, ONE AUTHORITY. `publish`/`load` dispatch on the declared capsule schema:
 * the certified compact format keeps its exact previous behavior, and the additive chunked format
 * stores one manifest row plus one digest-keyed chunk row per chunk. Chunks corroborate the
 * regenerated journal; they never supply it.
 */
export class LifecycleRepository {
  private readonly selectBinding: StatementSync;
  private readonly selectCapsule: StatementSync;
  private readonly insertCapsule: StatementSync;
  private readonly selectManifest: StatementSync;
  private readonly insertManifest: StatementSync;

  constructor(private readonly db: DatabaseSync) {
    const [selectBinding, selectCapsule, insertCapsule, selectManifest, insertManifest] = this.transaction(() => {
      const existing = db.prepare("SELECT type, sql FROM main.sqlite_schema WHERE name = ?").get("lifecycle_capsules_v1");
      if (existing === undefined) db.exec(schema);
      else if (existing.type !== "table" || typeof existing.sql !== "string" || normalizeSql(existing.sql) !== normalizeSql(schema)) {
        // Intentionally conservative: accept only this exact versioned physical schema,
        // never silently accept constraints, alternate types or views with similar columns.
        throw new Error("Incompatible lifecycle_capsules_v1 schema");
      }
      const additions = db.prepare("SELECT name FROM main.sqlite_schema WHERE tbl_name = ? AND (type = 'trigger' OR (type = 'index' AND sql IS NOT NULL))").all("lifecycle_capsules_v1");
      if (additions.length !== 0) throw new Error("Incompatible lifecycle_capsules_v1 schema extensions");
      return [
        db.prepare("SELECT binding_json FROM lifecycle_bindings WHERE life_id = ? AND branch_id = ?"),
        db.prepare("SELECT wire FROM main.lifecycle_capsules_v1 WHERE key = ?"),
        db.prepare("INSERT INTO main.lifecycle_capsules_v1 (key, wire) VALUES (?, ?) ON CONFLICT(key) DO NOTHING"),
        db.prepare("SELECT manifest_json, genesis_json FROM lifecycle_chunked_manifests WHERE life_id = ? AND branch_id = ?"),
        db.prepare("INSERT INTO lifecycle_chunked_manifests (life_id, branch_id, manifest_json, genesis_json) VALUES (?, ?, ?, ?) ON CONFLICT(life_id, branch_id) DO NOTHING"),
      ] as const;
    });
    this.selectBinding = selectBinding;
    this.selectCapsule = selectCapsule;
    this.insertCapsule = insertCapsule;
    this.selectManifest = selectManifest;
    this.insertManifest = insertManifest;
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
      || !RECOGNIZED_CAPSULE_SCHEMAS.has(binding.capsuleSchema)
      || binding.lifeId !== lifeId || binding.branchId !== branchId) throw new Error("Corrupt lifecycle binding");
    key(binding.capsuleDigest); key(binding.genesisDigest);
    return frozen(binding);
  }

  /** Cold-admits and FULLY replays the stored capsule under current authority. The stored digest,
   * binding and payload are never authority: a payload that disagrees with the regenerated replay
   * is a refusal, not a repair. Returns undefined when there is no lifecycle binding. */
  async load(lifeId: string, branchId: string): Promise<LoadedLifecycle | undefined> {
    const binding = this.binding(lifeId, branchId);
    if (!binding) return undefined;
    // Recognized-schema dispatch. `binding()` already refused anything unrecognized, so this is a
    // two-way choice, never a fallback: each format refuses the other's storage.
    if (binding.capsuleSchema === LIFECYCLE_CHUNKED_CAPSULE_SCHEMA) return this.loadChunked(binding);
    const row = this.selectCapsule.get(encode(binding.capsuleDigest));
    if (row === undefined) throw new Error("Missing lifecycle capsule");
    const capsule = await deserializeLifecycleCompactCapsule(decode(row.wire));
    if (capsule.digest !== binding.capsuleDigest || capsule.manifest.capsuleSchema !== binding.capsuleSchema
      || capsule.genesis.digest !== binding.genesisDigest) throw new Error("Lifecycle binding/capsule disagreement");
    return Object.freeze({ binding, capsule });
  }

  /** Chunked load: read the immutable manifest row and its genesis, read every chunk it indexes,
   * then FULL-regenerate the whole life and require each chunk to corroborate its own regenerated
   * journal range. A missing row, a tampered row, a gap, an overlap, a foreign schema or any digest
   * disagreement is a refusal; nothing is repaired and no partial view is returned. */
  private async loadChunked(binding: LifecycleBranchBinding): Promise<LoadedLifecycle> {
    const row = this.selectManifest.get(binding.lifeId, binding.branchId);
    if (row === undefined) throw new Error("Missing lifecycle chunked manifest");
    const manifestJson = row.manifest_json;
    const genesisJson = row.genesis_json;
    if (typeof manifestJson !== "string" || typeof genesisJson !== "string") {
      throw new Error("Corrupt lifecycle chunked manifest");
    }
    let manifestInput: unknown;
    try { manifestInput = JSON.parse(manifestJson); } catch { throw new Error("Corrupt lifecycle chunked manifest"); }
    let genesis: unknown;
    try { genesis = JSON.parse(genesisJson); } catch { throw new Error("Corrupt lifecycle chunked genesis"); }
    // Locate the indexed rows first; the capsule admission then validates every one of them against
    // the regenerated life. Index bytes are never trusted for anything but which rows to read.
    const chunks = chunkDigests(manifestInput).map(digest => this.readChunk(digest));
    const admitted = await admitChunkedLifecycleCapsule({ manifest: manifestInput, chunks, genesis });
    // Recompute every digest from the admitted artifact, never from the stored manifest or binding.
    const indexes = Object.freeze(admitted.chunks.map(chunk => Object.freeze({ from: chunk.from,
      to: chunk.to, digest: lifecycleChunkDigest(chunk.from, chunk.to, chunk.table) })));
    const manifest: LifecycleChunkedManifest = Object.freeze({
      version: admitted.manifest.version,
      capsuleSchema: admitted.manifest.capsuleSchema,
      genesisDigest: admitted.regenerated.genesis.digest,
      chunkYears: admitted.manifest.chunkYears,
      frontier: admitted.manifest.frontier,
      status: admitted.manifest.status,
      chunks: indexes,
    });
    const digest = chunkedCapsuleDigest(manifest);
    if (digest !== binding.capsuleDigest || admitted.regenerated.genesis.digest !== binding.genesisDigest) {
      throw new Error("Lifecycle binding/capsule disagreement");
    }
    // No extra deep walk here: the admitted genesis/output/chunks are already frozen by the
    // format, so a long life's whole tree is never re-traversed just to publish this wrapper.
    return Object.freeze({ binding, capsule: Object.freeze({ manifest, digest,
      genesis: admitted.regenerated.genesis, output: admitted.regenerated.output,
      chunks: admitted.chunks }) });
  }

  /** One stored chunk, structurally validated by the chunk wire codec (exact key set, recomputed
   * digest, canonical bytes). Corroboration against regenerated journal values happens later, in
   * `admitChunkedLifecycleCapsule`. */
  private readChunk(digest: string): LifecycleChunk {
    const row = this.selectCapsule.get(encode(digest));
    if (row === undefined) throw new Error("Missing lifecycle chunk");
    const wire = decode(row.wire);
    let parsed: unknown;
    try { parsed = JSON.parse(wire); } catch { throw new Error("Noncanonical lifecycle chunk wire"); }
    // Refuses a row whose bytes are not the canonical chunk wire, including a digest disagreeing
    // with its own table, BEFORE any replay work starts.
    if (serializeLifecycleChunk(parsed) !== wire) throw new Error("Noncanonical lifecycle chunk wire");
    return parsed as LifecycleChunk;
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
    const captured: CapturedPublication = structuredClone(data);
    const schema = capsuleSchemaOf(input.capsule);
    if (schema === LIFECYCLE_CHUNKED_CAPSULE_SCHEMA) {
      const admitted = await admitChunkedLifecycleCapsule(input.capsule);
      return this.publishChunked(captured, admitted);
    }
    const admitted = await admitLifecycleCompactCapsule(input.capsule);
    const wire = await serializeLifecycleCompactCapsule(admitted);
    sqlText(captured.protagonistName); sqlText(captured.protagonistSex);
    const configJson = JSON.stringify(captured.config);
    sqlText(configJson);
    const binding: LifecycleBranchBinding = frozen({ version: LIFECYCLE_BINDING_VERSION,
      lifeId: captured.lifeId, branchId: captured.branchId, capsuleDigest: admitted.digest,
      capsuleSchema: admitted.manifest.capsuleSchema, genesisDigest: admitted.genesis.digest });
    return this.commit(captured, binding, configJson, () => {
      this.insertCapsule.run(encode(admitted.digest), encode(wire));
      // The locked post-insert comparison, not a repository pre-read, protects retries.
      if (this.readCapsule(admitted.digest) !== wire) throw new Error("Conflicting immutable record");
    });
  }

  /** Chunked publication: one transaction writes the life metadata, the binding (with the chunked
   * schema), the manifest, the genesis and every chunk. The chunk size is the admitted manifest's
   * own recorded `chunkYears`, which the format already limits to the documented measured default
   * (`LIFECYCLE_CHUNKED_DEFAULT_CHUNK_YEARS`) and may only lower — it can never be raised here. */
  private publishChunked(captured: CapturedPublication, admitted: LifecycleChunkedCapsule): LifecycleBranchBinding {
    // Digests are recomputed from the admitted artifact, never copied from the caller's manifest.
    const chunks = admitted.chunks.map(chunk => ({ from: chunk.from, to: chunk.to,
      digest: lifecycleChunkDigest(chunk.from, chunk.to, chunk.table) }));
    const manifest: LifecycleChunkedManifest = {
      version: admitted.manifest.version,
      capsuleSchema: admitted.manifest.capsuleSchema,
      genesisDigest: admitted.regenerated.genesis.digest,
      chunkYears: admitted.manifest.chunkYears,
      frontier: admitted.manifest.frontier,
      status: admitted.manifest.status,
      chunks,
    };
    const manifestJson = JSON.stringify(manifest);
    const genesisJson = JSON.stringify(admitted.regenerated.genesis);
    sqlText(captured.protagonistName); sqlText(captured.protagonistSex);
    sqlText(manifestJson); sqlText(genesisJson);
    const configJson = JSON.stringify(captured.config);
    sqlText(configJson);
    const digest = chunkedCapsuleDigest(manifest);
    const binding: LifecycleBranchBinding = frozen({ version: LIFECYCLE_BINDING_VERSION,
      lifeId: captured.lifeId, branchId: captured.branchId, capsuleDigest: digest,
      capsuleSchema: admitted.manifest.capsuleSchema, genesisDigest: admitted.regenerated.genesis.digest });
    return this.commit(captured, binding, configJson, () => {
      admitted.chunks.forEach((chunk, position) => {
        const chunkDigest = chunks[position].digest;
        const wire = serializeLifecycleChunk({ from: chunk.from, to: chunk.to, table: chunk.table, digest: chunkDigest });
        this.insertCapsule.run(encode(chunkDigest), encode(wire));
        if (this.readCapsule(chunkDigest) !== wire) throw new Error("Conflicting immutable record");
      });
      this.insertManifest.run(captured.lifeId, captured.branchId, manifestJson, genesisJson);
      const stored = this.selectManifest.get(captured.lifeId, captured.branchId);
      if (stored?.manifest_json !== manifestJson || stored?.genesis_json !== genesisJson) {
        throw new Error("Conflicting immutable record");
      }
    });
  }

  /** The shared commit of one publication: conflict check, then the format-specific payload, then
   * the life metadata row and the binding row, all in the caller's one transaction. */
  private commit(captured: CapturedPublication, binding: LifecycleBranchBinding, configJson: string,
    payload: () => void): LifecycleBranchBinding {
    return withTransaction(this.db, () => {
      const existing = this.binding(captured.lifeId, captured.branchId);
      if (existing && !same(existing, binding)) throw new Error("Conflicting immutable lifecycle binding");
      if (!existing) {
        payload();
        this.db.prepare("INSERT INTO lifecycle_lives (id, protagonist_name, protagonist_sex, config_json, branch_id, created_at) VALUES (?, ?, ?, ?, ?, ?)")
          .run(captured.lifeId, captured.protagonistName, captured.protagonistSex, configJson, captured.branchId, Date.now());
        this.db.prepare("INSERT INTO lifecycle_bindings (life_id, branch_id, binding_json) VALUES (?, ?, ?)")
          .run(captured.lifeId, captured.branchId, JSON.stringify(binding));
      }
      return binding;
    });
  }

  private readCapsule(digest: string): string | undefined {
    const row = this.selectCapsule.get(encode(digest));
    return row === undefined ? undefined : decode(row.wire);
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

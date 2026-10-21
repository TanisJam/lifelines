import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLifecycleCompactCapsule, LIFECYCLE_COMPACT_CAPSULE_MANIFEST, serializeLifecycleCompactCapsule } from "@/domain/e-lifecycle-capsule";
import { createChunkedLifecycleCapsule, lifecycleChunkDigest, LIFECYCLE_CHUNKED_CAPSULE_SCHEMA } from "@/domain/e-lifecycle-chunked-capsule";
import { canonicalLifecycleData, createLifecycleGenesis } from "@/domain/e-lifecycle-genesis";
import { createLifecycleRuntime } from "@/domain/e-lifecycle-runtime";
import { initializeWorld } from "@/domain/world-origin";
import { openDb } from "./db";
import { EBranchRepository } from "./e-branch-repository";
import { LIFECYCLE_BINDING_VERSION, LifecycleRepository, type LifecycleBranchBinding } from "./lifecycle-repository";

/**
 * Builds a compact lifecycle capsule from a real genesis + one replayed year, plus the life
 * metadata a create route would carry. The capsule is the same shape `createLifecycleCompactCapsule`
 * produces in production — the repository must regenerate it, never trust it.
 */
async function publication(seed: string, lifeId = "life-1", branchId = "branch-1") {
  const initialization = { seed, startYear: 1327, endYear: 1327, founderCount: 6, protagonist: { name: "Alice", sex: "random" } };
  const { world } = initializeWorld(initialization);
  const genesis = createLifecycleGenesis({
    initialization, protagonistId: "protagonist",
    resources: Object.fromEntries(Object.keys(world.people).map(id => [id, { grain: 2, effort: 3, need: 1 }])),
  });
  const runtime = createLifecycleRuntime(genesis);
  await runtime.advance(1327);
  const capsule = await createLifecycleCompactCapsule({ genesis, output: runtime.snapshot() });
  const protagonist = world.people.protagonist;
  return { lifeId, branchId, config: world.config, protagonistName: protagonist.name, protagonistSex: protagonist.sex, capsule };
}

/** A structurally valid lifecycle binding used to prove version/keyset dispatch on tampered rows. */
function binding(overrides: Partial<LifecycleBranchBinding> = {}): LifecycleBranchBinding {
  return {
    version: LIFECYCLE_BINDING_VERSION, lifeId: "life-1", branchId: "branch-1",
    capsuleDigest: "a".repeat(64), capsuleSchema: LIFECYCLE_COMPACT_CAPSULE_MANIFEST.capsuleSchema,
    genesisDigest: "b".repeat(64), ...overrides,
  };
}

function insertBinding(db: DatabaseSync, value: unknown, lifeId = "life-1", branchId = "branch-1"): void {
  db.prepare("INSERT INTO lifecycle_bindings (life_id, branch_id, binding_json) VALUES (?, ?, ?)")
    .run(lifeId, branchId, JSON.stringify(value));
}

/** Minimal FK-valid legacy rows so a foreign binding can be planted in the legacy table. */
function seedLegacyLife(db: DatabaseSync, lifeId = "life-1", branchId = "branch-1"): void {
  db.prepare("INSERT INTO lives (id, protagonist_name, protagonist_sex, config_json, original_branch_id, latest_branch_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(lifeId, "Alice", "f", "{}", branchId, branchId, 0);
  db.prepare("INSERT INTO life_branches (id, life_id, label, result_json, snapshots_blob, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(branchId, lifeId, "Original life", Buffer.from([0]), Buffer.from([0]), 0);
}

function count(db: DatabaseSync, table: string): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
}

describe("LifecycleRepository persistence (RI1a)", () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), "lifelines-lifecycle-repo-"));
    dbPath = path.join(dir, "lifelines.db");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("round-trips a published capsule through load with full current-authority regeneration", async () => {
    const input = await publication("lifecycle-rb-roundtrip");
    const db = openDb(dbPath);
    try {
      const repo = new LifecycleRepository(db);
      const written = await repo.publish(input);
      expect(written.version).toBe("canonical-lifecycle-cb1-1");
      expect(written.capsuleSchema).toBe(LIFECYCLE_COMPACT_CAPSULE_MANIFEST.capsuleSchema);
      expect(written.capsuleDigest).toBe(input.capsule.digest);
      expect(written.genesisDigest).toBe(input.capsule.genesis.digest);

      const loaded = await repo.load("life-1", "branch-1");
      expect(loaded).toBeDefined();
      expect(loaded!.binding).toEqual(written);
      // Regeneration fidelity: a cold admission of the stored wire re-serializes byte-for-byte
      // to a fresh admission of the caller's capsule, so replay reproduced the whole graph.
      expect(await serializeLifecycleCompactCapsule(loaded!.capsule)).toBe(await serializeLifecycleCompactCapsule(input.capsule));
      expect(loaded!.capsule.digest).toBe(written.capsuleDigest);
    } finally {
      db.close();
    }
  });

  it("returns undefined from load when no binding was published", async () => {
    const db = openDb(dbPath);
    try {
      expect(await new LifecycleRepository(db).load("life-1", "branch-1")).toBeUndefined();
    } finally {
      db.close();
    }
  });

  it("refuses a caller-supplied digest that disagrees with the admitted capsule", async () => {
    const input = await publication("lifecycle-rb-digest");
    const db = openDb(dbPath);
    try {
      const repo = new LifecycleRepository(db);
      const forged = { ...input.capsule, digest: "0".repeat(64) };
      await expect(repo.publish({ ...input, capsule: forged })).rejects.toThrow(/digest/i);
      // Authority rule: a rejected save leaves nothing behind.
      expect(repo.binding("life-1", "branch-1")).toBeUndefined();
      expect(count(db, "lifecycle_bindings")).toBe(0);
      expect(count(db, "lifecycle_capsules_v1")).toBe(0);
    } finally {
      db.close();
    }
  });

  it("is idempotent for an exact retry and refuses a different digest for the same life and branch", async () => {
    const first = await publication("lifecycle-rb-retry-1");
    const other = await publication("lifecycle-rb-retry-2");
    const db = openDb(dbPath);
    try {
      const repo = new LifecycleRepository(db);
      const written = await repo.publish(first);
      const retry = await repo.publish(first);
      expect(retry).toEqual(written);
      expect(count(db, "lifecycle_bindings")).toBe(1);
      expect(count(db, "lifecycle_capsules_v1")).toBe(1);
      await expect(repo.publish(other)).rejects.toThrow("Conflicting immutable lifecycle binding");
      expect(count(db, "lifecycle_bindings")).toBe(1);
    } finally {
      db.close();
    }
  });

  it("refuses an unknown binding version", async () => {
    const db = openDb(dbPath);
    try {
      insertBinding(db, { ...binding(), version: "canonical-branch-rb1" });
      await expect(new LifecycleRepository(db).load("life-1", "branch-1")).rejects.toThrow("Corrupt lifecycle binding");
    } finally {
      db.close();
    }
  });

  it("refuses a binding that declares a foreign capsule schema", async () => {
    const db = openDb(dbPath);
    try {
      insertBinding(db, { ...binding(), capsuleSchema: "lifecycle-capsule-lr2b-1" });
      await expect(new LifecycleRepository(db).load("life-1", "branch-1")).rejects.toThrow("Corrupt lifecycle binding");
    } finally {
      db.close();
    }
  });

  it("refuses a binding with an extra key", async () => {
    const db = openDb(dbPath);
    try {
      insertBinding(db, { ...binding(), provenance: null });
      await expect(new LifecycleRepository(db).load("life-1", "branch-1")).rejects.toThrow("Corrupt lifecycle binding");
    } finally {
      db.close();
    }
  });

  it("refuses a binding with a missing key", async () => {
    const db = openDb(dbPath);
    try {
      const missing: Record<string, unknown> = { ...binding() };
      delete missing.genesisDigest;
      insertBinding(db, missing);
      await expect(new LifecycleRepository(db).load("life-1", "branch-1")).rejects.toThrow("Corrupt lifecycle binding");
    } finally {
      db.close();
    }
  });

  it("refuses a tampered capsule payload before replay", async () => {
    const input = await publication("lifecycle-rb-tamper");
    const db = openDb(dbPath);
    try {
      const repo = new LifecycleRepository(db);
      const written = await repo.publish(input);
      const key = Buffer.from(written.capsuleDigest, "utf16le");
      const row = db.prepare("SELECT wire FROM lifecycle_capsules_v1 WHERE key = ?").get(key) as { wire: Uint8Array };
      const envelope = JSON.parse(Buffer.from(row.wire).toString("utf16le")) as { digest: string };
      envelope.digest = "0".repeat(64);
      db.prepare("UPDATE lifecycle_capsules_v1 SET wire = ? WHERE key = ?").run(Buffer.from(JSON.stringify(envelope), "utf16le"), key);
      await expect(repo.load("life-1", "branch-1")).rejects.toThrow(/digest/i);
    } finally {
      db.close();
    }
  });

  it("aborts binding update and delete through the immutability triggers", async () => {
    const input = await publication("lifecycle-rb-immutable");
    const db = openDb(dbPath);
    try {
      await new LifecycleRepository(db).publish(input);
      expect(() => db.prepare("UPDATE lifecycle_bindings SET binding_json = ? WHERE life_id = ? AND branch_id = ?").run("{}", "life-1", "branch-1")).toThrow(/Immutable lifecycle binding/);
      expect(() => db.prepare("DELETE FROM lifecycle_bindings WHERE life_id = ? AND branch_id = ?").run("life-1", "branch-1")).toThrow(/Lifecycle history cannot be deleted/);
      expect(count(db, "lifecycle_bindings")).toBe(1);
    } finally {
      db.close();
    }
  });

  it("refuses a pre-existing lifecycle_capsules_v1 with a different physical schema", () => {
    const raw = new DatabaseSync(dbPath);
    raw.exec("CREATE TABLE lifecycle_capsules_v1 (key TEXT PRIMARY KEY, wire TEXT NOT NULL)");
    raw.close();
    const db = openDb(dbPath);
    try {
      expect(() => new LifecycleRepository(db)).toThrow("Incompatible lifecycle_capsules_v1 schema");
    } finally {
      db.close();
    }
  });

  it("refuses schema extensions on an otherwise exact lifecycle_capsules_v1", () => {
    const raw = new DatabaseSync(dbPath);
    raw.exec("CREATE TABLE lifecycle_capsules_v1 (key BLOB NOT NULL PRIMARY KEY, wire BLOB NOT NULL) STRICT");
    raw.exec("CREATE INDEX lifecycle_capsules_v1_extra ON lifecycle_capsules_v1(key, wire)");
    raw.close();
    const db = openDb(dbPath);
    try {
      expect(() => new LifecycleRepository(db)).toThrow("Incompatible lifecycle_capsules_v1 schema extensions");
    } finally {
      db.close();
    }
  });

  it("refuses a lifecycle binding in the legacy canonical loader", async () => {
    const input = await publication("lifecycle-rb-legacy-see");
    const db = openDb(dbPath);
    try {
      const repo = new LifecycleRepository(db);
      await repo.publish(input);
      // Recognized-version dispatch: the legacy loader never serves a lifecycle life at all.
      expect(await new EBranchRepository(db).load("life-1", "branch-1")).toBeUndefined();
      // And if a lifecycle-shaped binding is planted in the legacy table, it is refused, not coerced.
      seedLegacyLife(db);
      db.prepare("INSERT INTO canonical_branch_bindings (life_id, branch_id, binding_json) VALUES (?, ?, ?)")
        .run("life-1", "branch-1", JSON.stringify(binding()));
      expect(() => new EBranchRepository(db).binding("life-1", "branch-1")).toThrow("Corrupt canonical binding");
    } finally {
      db.close();
    }
  });

  it("refuses an annual binding in the lifecycle loader", async () => {
    const db = openDb(dbPath);
    try {
      insertBinding(db, {
        version: "canonical-branch-rb1", lifeId: "life-1", branchId: "branch-1",
        capsuleDigest: "a".repeat(64), capsuleVersion: "annual-capsule-e3-1", runtimeVersion: "annual-runtime-e2-1",
        originDigest: "b".repeat(64), genesisDigest: "c".repeat(64), provenance: null,
      });
      await expect(new LifecycleRepository(db).load("life-1", "branch-1")).rejects.toThrow("Corrupt lifecycle binding");
    } finally {
      db.close();
    }
  });

  it("leaves the legacy tables untouched", async () => {
    const input = await publication("lifecycle-rb-isolation");
    const db = openDb(dbPath);
    try {
      seedLegacyLife(db, "legacy-1", "legacy-branch-1");
      const before = { lives: count(db, "lives"), branches: count(db, "life_branches"), bindings: count(db, "canonical_branch_bindings") };
      await new LifecycleRepository(db).publish(input);
      expect({ lives: count(db, "lives"), branches: count(db, "life_branches"), bindings: count(db, "canonical_branch_bindings") }).toEqual(before);
      expect(count(db, "lifecycle_lives")).toBe(1);
      expect(count(db, "lifecycle_bindings")).toBe(1);
      expect(count(db, "lifecycle_capsules_v1")).toBe(1);
    } finally {
      db.close();
    }
  });
});

/**
 * A real chunked publication: `years` replayed journal years, encoded ONCE by the format. The
 * repository receives the documented admission input `{ manifest, chunks, genesis }`, never the
 * `{ manifest, chunks, regenerated }` creation artifact.
 */
async function chunkedPublication(seed: string, years: number, lifeId = "life-chunked", branchId = "branch-chunked") {
  const initialization = { seed, startYear: 1327, endYear: 1327, founderCount: 6, protagonist: { name: "Alice", sex: "random" } };
  const { world } = initializeWorld(initialization);
  const genesis = createLifecycleGenesis({
    initialization, protagonistId: "protagonist",
    resources: Object.fromEntries(Object.keys(world.people).map(id => [id, { grain: 2, effort: 3, need: 1 }])),
  });
  const runtime = createLifecycleRuntime(genesis);
  for (let index = 0; index < years; index++) await runtime.advance(1327 + index);
  const capsule = await createChunkedLifecycleCapsule({ genesis, output: runtime.snapshot() });
  const protagonist = world.people.protagonist;
  return { lifeId, branchId, config: world.config, protagonistName: protagonist.name, protagonistSex: protagonist.sex,
    capsule: { manifest: capsule.manifest, chunks: capsule.chunks, genesis: capsule.regenerated.genesis } };
}

const CHUNKED_LIFE = "life-chunked";
const CHUNKED_BRANCH = "branch-chunked";

function manifestRow(db: DatabaseSync): { manifest_json: string; genesis_json: string } {
  return db.prepare("SELECT manifest_json, genesis_json FROM lifecycle_chunked_manifests WHERE life_id = ? AND branch_id = ?")
    .get(CHUNKED_LIFE, CHUNKED_BRANCH) as { manifest_json: string; genesis_json: string };
}

/** The triggers are the first line of defense. These tests drop the update trigger to prove the
 * loader still refuses a row that changed underneath it (a restored, edited or corrupted file). */
function tamperManifest(db: DatabaseSync, manifest: unknown): void {
  db.exec("DROP TRIGGER lifecycle_chunked_manifest_no_update");
  db.prepare("UPDATE lifecycle_chunked_manifests SET manifest_json = ? WHERE life_id = ? AND branch_id = ?")
    .run(JSON.stringify(manifest), CHUNKED_LIFE, CHUNKED_BRANCH);
}

function chunkRow(db: DatabaseSync, digest: string): { from: number; to: number; table: string; digest: string } {
  const row = db.prepare("SELECT wire FROM lifecycle_capsules_v1 WHERE key = ?").get(Buffer.from(digest, "utf16le")) as { wire: Uint8Array };
  return JSON.parse(Buffer.from(row.wire).toString("utf16le")) as { from: number; to: number; table: string; digest: string };
}

function storeChunk(db: DatabaseSync, chunk: { from: number; to: number; table: string; digest: string }): void {
  db.prepare("INSERT INTO lifecycle_capsules_v1 (key, wire) VALUES (?, ?)")
    .run(Buffer.from(chunk.digest, "utf16le"), Buffer.from(JSON.stringify(chunk), "utf16le"));
}

describe("LifecycleRepository chunked persistence (CP1-B B2)", () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), "lifelines-lifecycle-chunked-"));
    dbPath = path.join(dir, "lifelines.db");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("round-trips a chunked publication through a fresh reopen of the same database file", async () => {
    // A 5-year life at the format default (4) is two real chunks, so the chain is exercised.
    const input = await chunkedPublication("a", 5);
    expect(input.capsule.manifest.chunks).toHaveLength(2);

    const db = openDb(dbPath);
    let written: LifecycleBranchBinding;
    try {
      written = await new LifecycleRepository(db).publish(input);
    } finally {
      db.close();
    }
    expect(written!.capsuleSchema).toBe(LIFECYCLE_CHUNKED_CAPSULE_SCHEMA);
    expect(written!.genesisDigest).toBe(input.capsule.genesis.digest);
    expect(written!.capsuleDigest).toMatch(/^[a-f0-9]{64}$/);

    // A fresh repository on a reopened file: nothing survives in memory, only the stored bytes.
    const reopened = openDb(dbPath);
    try {
      const loaded = await new LifecycleRepository(reopened).load(CHUNKED_LIFE, CHUNKED_BRANCH);
      expect(loaded).toBeDefined();
      expect(loaded!.binding).toEqual(written!);
      expect(loaded!.capsule.manifest).toEqual(input.capsule.manifest);
      expect(loaded!.capsule.digest).toBe(written!.capsuleDigest);
      expect(loaded!.capsule.genesis.digest).toBe(input.capsule.genesis.digest);
      expect(loaded!.capsule.chunks).toHaveLength(2);
      // The output is the full regeneration from genesis, not a reassembly of stored chunks.
      expect(loaded!.capsule.output.journal.map(record => record.year)).toEqual([1327, 1328, 1329, 1330, 1331]);
    } finally {
      reopened.close();
    }
  });

  it("returns a loaded chunked capsule equal to a fresh full regeneration", async () => {
    const input = await chunkedPublication("a", 5);
    const db = openDb(dbPath);
    try {
      const repo = new LifecycleRepository(db);
      const written = await repo.publish(input);
      const loaded = await repo.load(CHUNKED_LIFE, CHUNKED_BRANCH);
      // Authoritative equality: a cold create from the loaded genesis/output must reproduce the
      // same manifest (same chunk ranges and digests) and the same regenerated output.
      const fresh = await createChunkedLifecycleCapsule({ genesis: loaded!.capsule.genesis, output: loaded!.capsule.output });
      expect(canonicalLifecycleData(loaded!.capsule.manifest)).toBe(canonicalLifecycleData(fresh.manifest));
      expect(canonicalLifecycleData(loaded!.capsule.output)).toBe(canonicalLifecycleData(fresh.regenerated.output));
      expect(loaded!.capsule.digest).toBe(written.capsuleDigest);
    } finally {
      db.close();
    }
  });

  it("keeps a compact capsule loading exactly as before and writes no chunked rows", async () => {
    const input = await publication("lifecycle-rb-compact-b2");
    const db = openDb(dbPath);
    try {
      const repo = new LifecycleRepository(db);
      const written = await repo.publish(input);
      expect(written.capsuleSchema).toBe(LIFECYCLE_COMPACT_CAPSULE_MANIFEST.capsuleSchema);
      const loaded = await repo.load("life-1", "branch-1");
      expect(loaded!.binding).toEqual(written);
      expect(loaded!.capsule.manifest.capsuleSchema).toBe(LIFECYCLE_COMPACT_CAPSULE_MANIFEST.capsuleSchema);
      expect(loaded!.capsule.digest).toBe(written.capsuleDigest);
      expect(loaded!.capsule.chunks).toBeUndefined();
      expect(await serializeLifecycleCompactCapsule(loaded!.capsule)).toBe(await serializeLifecycleCompactCapsule(input.capsule));
      expect(count(db, "lifecycle_chunked_manifests")).toBe(0);
      expect(count(db, "lifecycle_capsules_v1")).toBe(1);
    } finally {
      db.close();
    }
  });

  it("is idempotent for an exact chunked retry and refuses a different chunked life for the same pair", async () => {
    const first = await chunkedPublication("b2-probe", 1);
    const other = await chunkedPublication("seed-2", 1);
    const db = openDb(dbPath);
    try {
      const repo = new LifecycleRepository(db);
      const written = await repo.publish(first);
      expect(await repo.publish(first)).toEqual(written);
      expect(count(db, "lifecycle_chunked_manifests")).toBe(1);
      expect(count(db, "lifecycle_capsules_v1")).toBe(1);
      await expect(repo.publish(other)).rejects.toThrow("Conflicting immutable lifecycle binding");
      expect(count(db, "lifecycle_chunked_manifests")).toBe(1);
    } finally {
      db.close();
    }
  });

  it("aborts update and delete of a chunked manifest through the immutability triggers", async () => {
    const input = await chunkedPublication("b2-probe", 1);
    const db = openDb(dbPath);
    try {
      await new LifecycleRepository(db).publish(input);
      expect(() => db.prepare("UPDATE lifecycle_chunked_manifests SET manifest_json = ? WHERE life_id = ? AND branch_id = ?")
        .run("{}", CHUNKED_LIFE, CHUNKED_BRANCH)).toThrow(/Immutable lifecycle chunked manifest/);
      expect(() => db.prepare("DELETE FROM lifecycle_chunked_manifests WHERE life_id = ? AND branch_id = ?")
        .run(CHUNKED_LIFE, CHUNKED_BRANCH)).toThrow(/Lifecycle history cannot be deleted/);
      expect(count(db, "lifecycle_chunked_manifests")).toBe(1);
    } finally {
      db.close();
    }
  });

  it("refuses a deleted chunk row", async () => {
    const input = await chunkedPublication("b2-probe", 1);
    const db = openDb(dbPath);
    try {
      const repo = new LifecycleRepository(db);
      await repo.publish(input);
      db.prepare("DELETE FROM lifecycle_capsules_v1 WHERE key = ?")
        .run(Buffer.from(input.capsule.manifest.chunks[0].digest, "utf16le"));
      await expect(repo.load(CHUNKED_LIFE, CHUNKED_BRANCH)).rejects.toThrow("Missing lifecycle chunk");
    } finally {
      db.close();
    }
  });

  it("refuses a tampered chunk row", async () => {
    const input = await chunkedPublication("b2-probe", 1);
    const db = openDb(dbPath);
    try {
      const repo = new LifecycleRepository(db);
      await repo.publish(input);
      const key = Buffer.from(input.capsule.manifest.chunks[0].digest, "utf16le");
      const stored = chunkRow(db, input.capsule.manifest.chunks[0].digest);
      stored.table = `${stored.table}x`;
      db.prepare("UPDATE lifecycle_capsules_v1 SET wire = ? WHERE key = ?")
        .run(Buffer.from(JSON.stringify(stored), "utf16le"), key);
      await expect(repo.load(CHUNKED_LIFE, CHUNKED_BRANCH)).rejects.toThrow(/chunk digest disagreement/i);
    } finally {
      db.close();
    }
  });

  it("refuses a tampered manifest row", async () => {
    const input = await chunkedPublication("b2-probe", 1);
    const db = openDb(dbPath);
    try {
      const repo = new LifecycleRepository(db);
      await repo.publish(input);
      const manifest = JSON.parse(manifestRow(db).manifest_json) as { frontier: number };
      manifest.frontier += 1;
      tamperManifest(db, manifest);
      await expect(repo.load(CHUNKED_LIFE, CHUNKED_BRANCH)).rejects.toThrow("chunks do not reach the frontier");
    } finally {
      db.close();
    }
  });

  it("refuses a manifest whose recomputed digest disagrees with the binding", async () => {
    const input = await chunkedPublication("b2-probe", 1);
    const db = openDb(dbPath);
    try {
      const repo = new LifecycleRepository(db);
      await repo.publish(input);
      // A structurally valid lowering (4 -> 2) for a single one-year chunk: admission succeeds, so
      // only the recomputed whole-life digest can catch the edited index.
      const manifest = JSON.parse(manifestRow(db).manifest_json) as { chunkYears: number };
      manifest.chunkYears = 2;
      tamperManifest(db, manifest);
      await expect(repo.load(CHUNKED_LIFE, CHUNKED_BRANCH)).rejects.toThrow("Lifecycle binding/capsule disagreement");
    } finally {
      db.close();
    }
  });

  it("refuses a gap between chunk ranges", async () => {
    const input = await chunkedPublication("b2-probe", 1);
    const db = openDb(dbPath);
    try {
      const repo = new LifecycleRepository(db);
      await repo.publish(input);
      const real = chunkRow(db, input.capsule.manifest.chunks[0].digest);
      // A second, self-consistent chunk row that no regeneration could ever produce.
      const forged = { from: 1329, to: 1329, table: real.table, digest: lifecycleChunkDigest(1329, 1329, real.table) };
      storeChunk(db, forged);
      const manifest = JSON.parse(manifestRow(db).manifest_json) as { chunkYears: number; chunks: unknown[] };
      manifest.chunkYears = 1;
      manifest.chunks = [{ from: 1327, to: 1327, digest: real.digest }, { from: 1329, to: 1329, digest: forged.digest }];
      tamperManifest(db, manifest);
      await expect(repo.load(CHUNKED_LIFE, CHUNKED_BRANCH)).rejects.toThrow("chunks are not contiguous");
    } finally {
      db.close();
    }
  });

  it("refuses overlapping chunk ranges", async () => {
    const input = await chunkedPublication("b2-probe", 1);
    const db = openDb(dbPath);
    try {
      const repo = new LifecycleRepository(db);
      await repo.publish(input);
      const index = input.capsule.manifest.chunks[0];
      const manifest = JSON.parse(manifestRow(db).manifest_json) as { chunkYears: number; chunks: unknown[] };
      manifest.chunkYears = 1;
      manifest.chunks = [{ from: index.from, to: index.to, digest: index.digest }, { from: index.from, to: index.to, digest: index.digest }];
      tamperManifest(db, manifest);
      await expect(repo.load(CHUNKED_LIFE, CHUNKED_BRANCH)).rejects.toThrow("chunks overlap");
    } finally {
      db.close();
    }
  });

  it("refuses a foreign capsule schema instead of treating it as chunked", async () => {
    const db = openDb(dbPath);
    try {
      insertBinding(db, { ...binding(), capsuleSchema: "lifecycle-capsule-chunked-cp9-1" });
      await expect(new LifecycleRepository(db).load("life-1", "branch-1")).rejects.toThrow("Corrupt lifecycle binding");
    } finally {
      db.close();
    }
  });

  it("refuses a binding whose schema no longer matches the stored artifact", async () => {
    const input = await publication("lifecycle-rb-schema-drift");
    const db = openDb(dbPath);
    try {
      const repo = new LifecycleRepository(db);
      const written = await repo.publish(input);
      // Simulate a binding that claims the chunked format while only the compact payload exists.
      db.exec("DROP TRIGGER lifecycle_binding_no_update");
      db.prepare("UPDATE lifecycle_bindings SET binding_json = ? WHERE life_id = ? AND branch_id = ?")
        .run(JSON.stringify({ ...written, capsuleSchema: LIFECYCLE_CHUNKED_CAPSULE_SCHEMA }), "life-1", "branch-1");
      await expect(repo.load("life-1", "branch-1")).rejects.toThrow("Missing lifecycle chunked manifest");
      // The compact payload is still there, never partially served or repaired.
      expect(count(db, "lifecycle_capsules_v1")).toBe(1);
    } finally {
      db.close();
    }
  });
});

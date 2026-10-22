import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLifecycleCompactCapsule, LIFECYCLE_COMPACT_CAPSULE_MANIFEST, serializeLifecycleCompactCapsule } from "@/domain/e-lifecycle-capsule";
import { createLifecycleGenesis } from "@/domain/e-lifecycle-genesis";
import { deserializeCompactLifecycleDag, serializeCompactLifecycleDag } from "@/domain/e-lifecycle-dag";
import { canonicalLifecycleData } from "@/domain/e-lifecycle-genesis";
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
      expect(count(db, "lifecycle_capsules_v2")).toBe(0);
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
      expect(count(db, "lifecycle_capsules_v2")).toBe(1);
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

  it("refuses a stored genesis that does not reproduce the bound capsule", async () => {
    const input = await publication("lifecycle-rb-tamper");
    const db = openDb(dbPath);
    try {
      const repo = new LifecycleRepository(db);
      const written = await repo.publish(input);
      const key = Buffer.from(written.capsuleDigest, "utf16le");
      // v2 stores the INPUT, so a tampered payload is a genesis that regenerates a different life.
      const foreign = (await publication("lifecycle-rb-foreign")).capsule.genesis;
      db.prepare("UPDATE lifecycle_capsules_v2 SET genesis_table = ? WHERE key = ?")
        .run(serializeCompactLifecycleDag(foreign), key);
      await expect(repo.load("life-1", "branch-1")).rejects.toThrow(/binding\/capsule disagreement/i);
    } finally {
      db.close();
    }
  });

  it("stores the genesis input, not the regenerated years", async () => {
    const input = await publication("lifecycle-rb-storage");
    const db = openDb(dbPath);
    try {
      const written = await new LifecycleRepository(db).publish(input);
      const key = Buffer.from(written.capsuleDigest, "utf16le");
      const row = db.prepare("SELECT genesis_table, length(genesis_table) AS bytes, max_steps FROM lifecycle_capsules_v2 WHERE key = ?")
        .get(key) as { genesis_table: string; bytes: number; max_steps: number };
      expect(row.max_steps).toBe(1);
      // The stored payload IS the capsule's genesis, decoded - not merely "some small string".
      const stored = deserializeCompactLifecycleDag(row.genesis_table);
      expect(canonicalLifecycleData(stored)).toBe(canonicalLifecycleData(input.capsule.genesis));
      // It carries no years: the journal is regenerated, never persisted.
      expect(row.genesis_table).not.toContain("journal");
      expect(row.genesis_table).not.toContain("physicalSnapshot");
      // And it is far smaller than the wire it replaces.
      const wire = await serializeLifecycleCompactCapsule(input.capsule);
      expect(row.bytes).toBeLessThan(Buffer.byteLength(wire, "utf8") / 2);
      // Nothing is archived into v1 any more.
      expect(count(db, "lifecycle_capsules_v1")).toBe(0);
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
      expect(count(db, "lifecycle_capsules_v2")).toBe(1);
    } finally {
      db.close();
    }
  });
});

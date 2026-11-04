import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { createLifecycleGenesis, LIFECYCLE_GENESIS_VERSIONS, LIFECYCLE_THREAD_VERSIONS } from "../domain/e-lifecycle-genesis";
import { createLifecycleRuntime } from "../domain/e-lifecycle-runtime";
import { createLifecycleCompactCapsule, serializeLifecycleCompactCapsule } from "../domain/e-lifecycle-capsule";
import { initializeWorld } from "../domain/world-origin";
import { openDb } from "./db";
import { LifecycleRepository } from "./lifecycle-repository";

async function publication(seed: string, journal: "audit" | "compact", thread = false) {
  const initialization = { seed, startYear: 1327, endYear: 1327, founderCount: 6, protagonist: { name: "Alice", sex: "random" as const } };
  const { world } = initializeWorld(initialization);
  const genesis = createLifecycleGenesis({ initialization, protagonistId: "protagonist",
    ...(thread ? { versions: LIFECYCLE_THREAD_VERSIONS } : {}),
    resources: Object.fromEntries(Object.keys(world.people).map(id => [id, { grain: 2, effort: 3, need: 1 }])) });
  const capsule = await createLifecycleCompactCapsule({ genesis, output: createLifecycleRuntime(genesis, { journal }).snapshot() }, journal);
  const person = world.people.protagonist;
  return { lifeId: seed, branchId: "branch", config: world.config, protagonistName: person.name, protagonistSex: person.sex, capsule };
}

function rows(db: DatabaseSync) {
  return Object.fromEntries(["lifecycle_lives", "lifecycle_bindings", "lifecycle_capsules_v1", "lifecycle_capsules_v2", "lifecycle_projections_v1", "lifecycle_person_sheets_v1", "lifecycle_person_sheet_sets_v1"]
    .map(table => [table, db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
}

it("reopens old audit and compact records from genesis and archived wire without changing rows", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lifelines-u2-reopen-"));
  const dbPath = join(dir, "db.sqlite");
  let db = openDb(dbPath);
  try {
    const inputs = [await publication("old-audit", "audit"), await publication("old-compact", "compact")];
    const bindings = [];
    for (const input of inputs) bindings.push(await new LifecycleRepository(db).publish(input));
    expect(bindings.map(binding => binding.capsuleSchema)).toEqual(["lifecycle-capsule-compact-cb1-1", "lifecycle-capsule-compact-cb2-1"]);
    const genesisRows = rows(db);
    db.close();
    db = openDb(dbPath);
    for (const [index, input] of inputs.entries()) {
      const loaded = await new LifecycleRepository(db).load(input.lifeId, input.branchId);
      expect(loaded?.binding).toEqual(bindings[index]);
      expect(loaded?.capsule.digest).toBe(input.capsule.digest);
      expect(loaded?.capsule.genesis.versions).toEqual(LIFECYCLE_GENESIS_VERSIONS);
    }
    expect(rows(db)).toEqual(genesisRows);
    for (const input of inputs) {
      const key = Buffer.from(input.capsule.digest, "utf16le");
      const wire = await serializeLifecycleCompactCapsule(input.capsule);
      db.prepare("DELETE FROM lifecycle_capsules_v2 WHERE key = ?").run(key);
      db.prepare("INSERT INTO lifecycle_capsules_v1 (key, wire) VALUES (?, ?)").run(key, Buffer.from(wire, "utf16le"));
    }
    const archivedRows = rows(db);
    db.close();
    db = openDb(dbPath);
    for (const [index, input] of inputs.entries()) {
      const loaded = await new LifecycleRepository(db).load(input.lifeId, input.branchId);
      expect(loaded?.binding).toEqual(bindings[index]);
      expect(loaded?.capsule.digest).toBe(input.capsule.digest);
      expect(loaded?.capsule.genesis.versions).toEqual(LIFECYCLE_GENESIS_VERSIONS);
    }
    expect(rows(db)).toEqual(archivedRows);
  } finally { if (db.isOpen) db.close(); rmSync(dir, { recursive: true, force: true }); }
});

it("rolls back all publication rows when projection identity fails after inserts", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lifelines-u2-rollback-"));
  const db = openDb(join(dir, "db.sqlite"));
  try {
    const existing = await publication("existing", "audit");
    const repo = new LifecycleRepository(db);
    const binding = await repo.publish(existing);
    const before = rows(db);
    const input = await publication("failed", "compact", true);
    await expect(repo.publish({ ...input, projections: [{ view: { lifeId: "other", branchId: "branch" } } as never] }))
      .rejects.toThrow(/identity/i);
    const after = rows(db);
    expect(Object.fromEntries(Object.entries(after).map(([table, values]) => [table, values.length])))
      .toEqual(Object.fromEntries(Object.entries(before).map(([table, values]) => [table, values.length])));
    expect(after).toEqual(before);
    expect(repo.binding(existing.lifeId, existing.branchId)).toEqual(binding);
    expect(repo.binding(input.lifeId, input.branchId)).toBeUndefined();
    expect(db.prepare("SELECT * FROM lifecycle_lives WHERE id = ?").get(input.lifeId)).toBeUndefined();
    expect(db.prepare("SELECT * FROM lifecycle_capsules_v2 WHERE key = ?").get(Buffer.from(input.capsule.digest, "utf16le"))).toBeUndefined();
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createLifecycleGenesis, LIFECYCLE_THREAD_VERSIONS } from "../domain/e-lifecycle-genesis";
import { createLifecycleRuntime } from "../domain/e-lifecycle-runtime";
import { createLifecycleCompactCapsule, serializeLifecycleCompactCapsule } from "../domain/e-lifecycle-capsule";
import { initializeWorld } from "../domain/world-origin";
import { openDb } from "./db";
import { LifecycleRepository } from "./lifecycle-repository";

it("reopens a thread-aware genesis-only binding without changing it", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lifelines-cb3-"));
  const dbPath = join(dir, "db.sqlite");
  const initialization = { seed: "repository-cb3", startYear: 1327, endYear: 1327, founderCount: 6, protagonist: { name: "Alice", sex: "random" as const } };
  const { world } = initializeWorld(initialization);
  const genesis = createLifecycleGenesis({ initialization, protagonistId: "protagonist", versions: LIFECYCLE_THREAD_VERSIONS,
    resources: Object.fromEntries(Object.keys(world.people).map(id => [id, { grain: 2, effort: 3, need: 1 }])) });
  const output = createLifecycleRuntime(genesis, { journal: "compact" }).snapshot();
  const capsule = await createLifecycleCompactCapsule({ genesis, output }, "compact");
  const person = world.people.protagonist;
  const db = openDb(dbPath);
  try {
    const binding = await new LifecycleRepository(db).publish({ lifeId: "life", branchId: "branch", config: world.config,
      protagonistName: person.name, protagonistSex: person.sex, capsule });
    const oldGenesis = createLifecycleGenesis({ initialization, protagonistId: "protagonist",
      resources: Object.fromEntries(Object.keys(world.people).map(id => [id, { grain: 2, effort: 3, need: 1 }])) });
    const oldCapsule = await createLifecycleCompactCapsule({ genesis: oldGenesis, output: createLifecycleRuntime(oldGenesis).snapshot() });
    const before = db.prepare("SELECT count(*) AS n FROM lifecycle_capsules_v2").get();
    await expect(new LifecycleRepository(db).publish({ lifeId: "life", branchId: "branch", config: world.config,
      protagonistName: person.name, protagonistSex: person.sex, capsule: oldCapsule })).rejects.toThrow(/Conflicting immutable/);
    expect(db.prepare("SELECT count(*) AS n FROM lifecycle_capsules_v2").get()).toEqual(before);
    expect(new LifecycleRepository(db).binding("life", "branch")).toEqual(binding);
    db.close();
    const reopened = openDb(dbPath);
    try {
      const loaded = await new LifecycleRepository(reopened).load("life", "branch");
      expect(loaded?.binding).toEqual(binding);
      expect(loaded?.capsule.digest).toBe(capsule.digest);
      const wire = await serializeLifecycleCompactCapsule(capsule);
      reopened.prepare("DELETE FROM lifecycle_capsules_v2 WHERE key = ?").run(Buffer.from(capsule.digest, "utf16le"));
      reopened.prepare("INSERT INTO lifecycle_capsules_v1 (key, wire) VALUES (?, ?)")
        .run(Buffer.from(capsule.digest, "utf16le"), Buffer.from(wire, "utf16le"));
      const archived = await new LifecycleRepository(reopened).load("life", "branch");
      expect(archived?.binding).toEqual(binding);
      expect(archived?.capsule.digest).toBe(capsule.digest);
    } finally { reopened.close(); }
  } finally { if (db.isOpen) db.close(); rmSync(dir, { recursive: true, force: true }); }
});

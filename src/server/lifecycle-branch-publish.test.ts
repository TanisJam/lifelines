import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { openDb } from "./db";
import { LifecycleRepository } from "./lifecycle-repository";
import { LifecycleBranchStore } from "./lifecycle-branch-store";
import { createLifecycleGenesis, LIFECYCLE_THREAD_VERSIONS } from "../domain/e-lifecycle-genesis";
import { createLifecycleRuntime } from "../domain/e-lifecycle-runtime";
import { createLifecycleCompactCapsule } from "../domain/e-lifecycle-capsule";
import { createLifecycleForkCapsule } from "../domain/e-lifecycle-fork-capsule";
import { forkLifecycle } from "../domain/e-lifecycle-fork";
import { LIFECYCLE_CHOICE_VERSION } from "../domain/e-lifecycle-choice";
import { initializeWorld } from "../domain/world-origin";

it("publishes an atomic fork, retries without changes, and rolls back each stage", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lifelines-u4b-"));
  const path = join(dir, "db.sqlite"), db = openDb(path);
  try {
    const initialization = { seed: "fork-a", startYear: 1327, endYear: 1329, founderCount: 6, protagonist: { name: "Alice", sex: "random" as const } };
    const { world } = initializeWorld(initialization);
    const genesis = createLifecycleGenesis({ initialization, protagonistId: "protagonist", resources: Object.fromEntries(Object.keys(world.people).map(id => [id, { grain: 2, effort: 3, need: 1 }])) });
    const runtime = createLifecycleRuntime(genesis, { journal: "compact" });
    for (let year = 1327; year <= 1329; year++) await runtime.advance(year);
    const root = { genesis, output: runtime.snapshot() };
    const capsule = await createLifecycleCompactCapsule(root, "compact");
    const person = world.people.protagonist;
    await new LifecycleRepository(db).publish({ lifeId: "life", branchId: "root", config: world.config, protagonistName: person.name, protagonistSex: person.sex, capsule });
    db.prepare("INSERT INTO lives VALUES (?, ?, ?, ?, ?, ?, ?)").run("legacy", "Old", "f", "{}", "old", "old", 1);
    db.prepare("INSERT INTO life_branches VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run("old", "legacy", "Original", null, null, null, Buffer.from([0, 255]), Buffer.from([1, 254]), 1);
    const snapshot = () => JSON.stringify(["lives", "life_branches", "canonical_branch_bindings", "lifecycle_lives", "lifecycle_bindings", "lifecycle_capsules_v1", "lifecycle_capsules_v2"].map(table => db.prepare(`SELECT * FROM ${table}`).all()));
    const beforeRoot = snapshot();
    const target = root.output.owned.decisions.find(d => d.id === "immigration:world#1327.1")!;
    const fork = await createLifecycleForkCapsule(await forkLifecycle(root, { version: LIFECYCLE_CHOICE_VERSION, year: 1327, decisionId: target.id, optionId: target.options.find(o => o.id !== target.chosen)!.id }));
    const store = new LifecycleBranchStore(db);
    const input = { lifeId: "life", branchId: "child", capsule: fork };
    for (const stage of ["fork-row", "views", "sheets"] as const) {
      await expect(store.publishFork(input, { onStage: value => { if (value === stage) throw new Error(stage); } })).rejects.toThrow(stage);
      for (const table of ["lifecycle_forks_v1", "lifecycle_projections_v1", "lifecycle_person_sheets_v1", "lifecycle_person_sheet_sets_v1"]) expect(db.prepare(`SELECT count(*) AS n FROM ${table} WHERE branch_id = 'child'`).get()?.n).toBe(0);
    }
    // A fork may not take the root's branch id, or it would shadow the root binding.
    await expect(store.publishFork({ ...input, branchId: "root" })).rejects.toThrow("Conflicting immutable fork binding");
    expect(db.prepare("SELECT count(*) AS n FROM lifecycle_forks_v1").get()?.n).toBe(0);
    const binding = await store.publishFork(input);
    const counts = () => ["lifecycle_forks_v1", "lifecycle_projections_v1", "lifecycle_person_sheets_v1", "lifecycle_person_sheet_sets_v1"].map(table => db.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n);
    const beforeCounts = counts();
    const before = store.children("life", genesis.digest);
    expect(await store.publishFork(input)).toEqual(binding);
    expect(store.children("life", genesis.digest)).toEqual(before);
    expect(counts()).toEqual(beforeCounts);
    await expect(store.publishFork({ ...input, branchId: "other" })).rejects.toThrow();
    expect(db.prepare("SELECT count(*) AS n FROM lifecycle_person_sheet_sets_v1 WHERE branch_id = 'child'").get()?.n).toBe(2);
    const secondTarget = root.output.owned.decisions.find(d => d.id === "immigration:world#1328.1")!;
    const sibling = await createLifecycleForkCapsule(await forkLifecycle(root, { version: LIFECYCLE_CHOICE_VERSION, year: 1328, decisionId: secondTarget.id, optionId: secondTarget.options.find(o => o.id !== secondTarget.chosen)!.id }));
    await expect(store.publishFork({ ...input, capsule: sibling })).rejects.toThrow("Conflicting");
    await store.publishFork({ ...input, branchId: "sibling", capsule: sibling });
    const first = await forkLifecycle(root, { version: LIFECYCLE_CHOICE_VERSION, year: 1327, decisionId: target.id, optionId: target.options.find(o => o.id !== target.chosen)!.id });
    const nestedTarget = first.output.owned.decisions.find(d => d.id === "immigration:world#1328.1")!;
    const nested = await createLifecycleForkCapsule(await forkLifecycle(first, { version: LIFECYCLE_CHOICE_VERSION, year: 1328, decisionId: nestedTarget.id, optionId: nestedTarget.options.find(o => o.id !== nestedTarget.chosen)!.id }), { parent: fork });
    await store.publishFork({ ...input, branchId: "nested", capsule: nested });
    expect(snapshot()).toBe(beforeRoot);
    const other = new LifecycleBranchStore(db);
    other.resolve = async () => ({ lifeId: "absent", capsule });
    await expect(other.publishFork({ lifeId: "absent", branchId: "child", capsule: fork })).rejects.toThrow("Missing or cross-life");
    const threadGenesis = createLifecycleGenesis({ initialization, protagonistId: "protagonist", versions: LIFECYCLE_THREAD_VERSIONS, resources: Object.fromEntries(Object.keys(world.people).map(id => [id, { grain: 2, effort: 3, need: 1 }])) });
    const threadRuntime = createLifecycleRuntime(threadGenesis, { journal: "compact" });
    for (let year = 1327; year <= 1329; year++) await threadRuntime.advance(year);
    const threadRoot = { genesis: threadGenesis, output: threadRuntime.snapshot() };
    const threadCapsule = await createLifecycleCompactCapsule(threadRoot, "compact");
    await new LifecycleRepository(db).publish({ lifeId: "thread", branchId: "root", config: world.config, protagonistName: person.name, protagonistSex: person.sex, capsule: threadCapsule });
    const td = threadRoot.output.owned.decisions.find(d => d.id === "immigration:world#1327.1")!;
    const threadFirst = await forkLifecycle(threadRoot, { version: LIFECYCLE_CHOICE_VERSION, year: 1327, decisionId: td.id, optionId: td.options.find(o => o.id !== td.chosen)!.id });
    const threadFork = await createLifecycleForkCapsule(threadFirst);
    await store.publishFork({ lifeId: "thread", branchId: "child", capsule: threadFork });
    const td2 = threadRoot.output.owned.decisions.find(d => d.id === "immigration:world#1328.1")!;
    const threadSibling = await createLifecycleForkCapsule(await forkLifecycle(threadRoot, { version: LIFECYCLE_CHOICE_VERSION, year: 1328, decisionId: td2.id, optionId: td2.options.find(o => o.id !== td2.chosen)!.id }));
    await store.publishFork({ lifeId: "thread", branchId: "sibling", capsule: threadSibling });
    const nd = threadFirst.output.owned.decisions.find(d => d.id === "immigration:world#1328.1")!;
    const threadNested = await createLifecycleForkCapsule(await forkLifecycle(threadFirst, { version: LIFECYCLE_CHOICE_VERSION, year: 1328, decisionId: nd.id, optionId: nd.options.find(o => o.id !== nd.chosen)!.id }), { parent: threadFork });
    await store.publishFork({ lifeId: "thread", branchId: "nested", capsule: threadNested });
    const cross = new LifecycleBranchStore(db);
    cross.resolve = async () => ({ lifeId: "legacy", capsule });
    await expect(cross.publishFork({ lifeId: "legacy", branchId: "child", capsule: fork })).rejects.toThrow("Missing or cross-life");
    db.close();
    const reopened = openDb(path);
    try { const read = new LifecycleBranchStore(reopened); for (const item of [fork, sibling, nested]) expect((await read.resolve("life", item.digest))?.lifeId).toBe("life"); for (const item of [threadFork, threadSibling, threadNested]) expect((await read.resolve("thread", item.digest))?.lifeId).toBe("thread"); } finally { reopened.close(); }
  } finally { try { db.close(); } catch {} rmSync(dir, { recursive: true, force: true }); }
}, 180000);

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { forkAnnualRuntime } from "../domain/e-fork";
import { createAnnualRuntime, type AnnualPlan, type Newcomer } from "../domain/e-runtime";
import { createAnnualRuntimeCapsule, serializeAnnualRuntimeCapsule, type AnnualRuntimeCapsule } from "../domain/e-capsule";
import { initializeWorld } from "../domain/world-initialization";
import type { SimulationResult } from "../domain/types";
import { EBranchRepository, type CanonicalPublication } from "./e-branch-repository";
import { AnnualRuntimeRepository } from "./e-repository";
import { SqliteFavorRecords } from "./sqlite-favor-records";
import { compressJson, openDb } from "./db";
import { createLifeStore, type LifeStore } from "./life-store";

const directories: string[] = [];
const stores: LifeStore[] = [];
const handles: DatabaseSync[] = [];
function inspect(file: string) {
  const db = openDb(file);
  handles.push(db);
  return db;
}
function open(file?: string, factory?: (db: DatabaseSync) => AnnualRuntimeRepository) {
  if (!file) {
    const dir = mkdtempSync(join(tmpdir(), "lifelines-binding-test-"));
    directories.push(dir);
    file = join(dir, "lives.db");
  }
  const store = createLifeStore(file, 1, factory);
  stores.push(store);
  return { store, file };
}
function close(store: LifeStore) {
  store.close();
  stores.splice(stores.indexOf(store), 1);
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const store of stores.splice(0)) store.close();
  for (const db of handles.splice(0)) if (db.isOpen) db.close();
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true });
});
function quiet(year: number): AnnualPlan {
  return { year, physical: [], resources: [], grants: [], requests: [] };
}
function death(year: number): AnnualPlan {
  return { ...quiet(year), physical: [{ id: "death", kind: "death", actor: "protagonist", causes: [] }] };
}
function fixture(seed = "binding", deathYear = 1328) {
  const options = { seed, startYear: 1327, endYear: 1335, founderCount: 6, protagonist: { name: "Ada", sex: "f" as const } };
  const { world } = initializeWorld(options);
  const runtime = createAnnualRuntime(options, Object.fromEntries(Object.keys(world.people).map(id => [id, { grain: 2, effort: 1, need: 1 }])));
  for (let year = 1327; year < deathYear; year++) runtime.advance(quiet(year));
  runtime.advance(death(deathYear));
  return createAnnualRuntimeCapsule(runtime.final());
}
function publication(capsule = fixture(), branchId = "root"): CanonicalPublication {
  const result = JSON.parse(JSON.stringify({ config: capsule.output.origin.initial.config,
    people: capsule.output.state.people, events: capsule.output.state.legacyEvents, decisions: [] })) as SimulationResult;
  return {
    lifeId: "life", branchId, capsule, config: result.config,
    protagonistName: "Ada", protagonistSex: "f",
    branch: { label: "Original life", result, snapshots: new Map() },
  };
}
function fork(parent: AnnualRuntimeCapsule, parentBranchId = "root", branchId = "child", frontier = 1327, deathYear = 1329): CanonicalPublication {
  const suffix = Array.from({ length: deathYear - frontier - 1 }, (_, i) => quiet(frontier + 1 + i));
  const output = forkAnnualRuntime(parent, frontier, [...suffix, death(deathYear)]);
  const input = publication(output.finalCapsule, branchId);
  return { ...input, branch: { ...input.branch, label: `Changed in ${frontier + 1}`, parentBranchId, forkYear: frontier + 1 },
    provenance: { parentBranchId, parentDigest: output.parentDigest, frontier: output.frontier, prefixLength: output.prefixLength } };
}
const blob = (value: string) => Buffer.from(value, "utf16le");
function counts(db: DatabaseSync) {
  return ["lives", "life_branches", "canonical_branch_bindings", "favor_records_v1"].map(table => Number(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()!.n));
}

it("publishes a completed canonical branch, retries exactly and restores by digest after close/reopen", async () => {
  const { store, file } = open();
  const input = publication();
  const branch = await store.publishCanonicalBranch(input);
  expect(branch.id).toBe("root");
  expect(await store.publishCanonicalBranch(input)).toEqual(branch);
  expect(store.getLatestBranch("life")?.id).toBe("root");
  expect(() => store.deleteLife("life")).toThrow("Canonical");
  expect(store.getLatestBranch("life")?.id).toBe("root");
  close(store);
  const reader = open(file).store;
  const loaded = await reader.loadCanonicalBranch("life", "root");
  expect(loaded?.capsule).toEqual(input.capsule);
  expect(loaded?.binding.capsuleDigest).toBe((input.capsule as AnnualRuntimeCapsule).digest);
  expect(Object.isFrozen(loaded?.capsule.output)).toBe(true);
  expect(Object.isFrozen(loaded?.binding)).toBe(true);
  expect(counts(inspect(file))).toEqual([1, 1, 1, 1]);
});

it("cold nested loads retain full prefixes and external branch-qualified provenance, not discarded futures", async () => {
  const { store, file } = open();
  const root = fixture();
  const child = fork(root);
  const nested = fork(child.capsule as AnnualRuntimeCapsule, "child", "nested", 1328, 1330);
  for (const input of [publication(root), child, nested]) await store.publishCanonicalBranch(input);
  const cached = store.getLife("life")!;
  const retry = await store.publishCanonicalBranch(child);
  expect(retry.id).toBe("child");
  expect(cached.latestBranchId).toBe("nested");
  close(store);
  const reader = open(file).store;
  for (const input of [publication(root), child, nested]) {
    const loaded = (await reader.loadCanonicalBranch("life", input.branchId))!;
    expect(loaded.capsule).toEqual(input.capsule);
    expect(loaded.binding.provenance).toEqual(input.provenance ?? null);
  }
  const loaded = (await reader.loadCanonicalBranch("life", "nested"))!;
  expect(loaded.capsule.output.journal.map(record => record.plan.year)).toEqual([1327, 1328, 1329, 1330]);
  // Same runtime ID in discarded futures is qualified by the immutable branch binding.
  expect(root.output.state.legacyEvents.find(event => event.id === "death")?.year).toBe(1328);
  expect(loaded.capsule.output.state.legacyEvents.find(event => event.id === "death")?.year).toBe(1330);
  expect(reader.getLatestBranch("life")?.id).toBe("nested");
  expect(counts(inspect(file))).toEqual([1, 3, 3, 3]);
});

it("publishes concurrent exact retries once and rejects a different digest without moving latest", async () => {
  const { store, file } = open();
  const root = publication();
  const results = await Promise.all([store.publishCanonicalBranch(root), store.publishCanonicalBranch(root)]);
  expect(results[0]).toEqual(results[1]);
  const child = fork(root.capsule as AnnualRuntimeCapsule);
  await store.publishCanonicalBranch(child);
  const competing = { ...fork(root.capsule as AnnualRuntimeCapsule, "root", "child", 1327, 1330) };
  await expect(store.publishCanonicalBranch(competing)).rejects.toThrow("Conflicting immutable canonical binding");
  const cache = store.getLife("life")!;
  await expect(store.publishCanonicalBranch({ ...child, branch: { ...child.branch, label: "Different retry" } })).rejects.toThrow("retry representation");
  expect(cache.latestBranchId).toBe("child");
  expect(cache.branches.size).toBe(2);
  expect(counts(inspect(file))).toEqual([1, 2, 2, 3]); // Unreferenced immutable contender is retained.
});

it.each(["digest", "frontier", "prefix", "origin", "other-life", "forkYear"])("rejects parent/provenance disagreement: %s", async mode => {
  const { store, file } = open();
  const root = fixture();
  await store.publishCanonicalBranch(publication(root));
  let child = fork(root);
  if (mode === "digest") child = { ...child, provenance: { ...child.provenance!, parentDigest: "0".repeat(64) } };
  if (mode === "frontier") child = { ...child, provenance: { ...child.provenance!, frontier: 1328 } };
  if (mode === "prefix") child = { ...child, provenance: { ...child.provenance!, prefixLength: 2 } };
  if (mode === "origin") child = fork(fixture("different"));
  if (mode === "other-life") child = { ...child, lifeId: "other" };
  if (mode === "forkYear") child = { ...child, branch: { ...child.branch, forkYear: 1330 } };
  await expect(store.publishCanonicalBranch(child)).rejects.toThrow();
  expect(store.getLatestBranch("life")?.id).toBe("root");
  expect(counts(inspect(file))).toEqual([1, 1, 1, 1]);
});

it.each(["alive", "initial", "post-death", "skipped", "people", "events", "config", "snapshots", "decisions", "human"])("fails closed before capsule save for unsupported/incomplete publication: %s", async mode => {
  const { store, file } = open();
  const root = fixture();
  let input = publication(root);
  if (["alive", "initial", "post-death", "skipped"].includes(mode)) {
    const retained = forkAnnualRuntime(root, mode === "initial" ? null : 1327, mode === "post-death" ? [death(1328), quiet(1329)] : mode === "skipped" ? [death(1330)] : []);
    input = publication(retained.finalCapsule);
  }
  if (mode === "people") input = { ...input, branch: { ...input.branch, result: { ...input.branch.result, people: {} } } };
  if (mode === "events") input = { ...input, branch: { ...input.branch, result: { ...input.branch.result, events: [] } } };
  if (mode === "config") input = { ...input, config: { ...input.config, seed: "tampered" } };
  if (mode === "snapshots") input = { ...input, branch: { ...input.branch, snapshots: new Map([[1327, {} as never]]) } };
  if (mode === "decisions") input = { ...input, branch: { ...input.branch, result: { ...input.branch.result, decisions: [{} as never] } } };
  if (mode === "human") {
    const capsule = structuredClone(root);
    Reflect.set(capsule.output.journal[0].entries[0] ?? capsule.output.journal[0], "authority", { source: "human" });
    input = { ...input, capsule };
  }
  await expect(store.publishCanonicalBranch({ ...input, fullRun: true } as CanonicalPublication)).rejects.toThrow();
  expect(store.getLife("life")).toBeUndefined();
  expect(counts(inspect(file))).toEqual([0, 0, 0, 0]);
});

it("legacy views/deletion work without binding; canonical rewrite and legacy overwrites fail closed", async () => {
  const { store } = open();
  const root = publication();
  store.registerLife("legacy", "legacy-root", root.config, "Ada", "f", root.branch.result, root.branch.snapshots);
  expect(store.getLife("legacy")?.originalBranchId).toBe("legacy-root");
  expect(await store.loadCanonicalBranch("legacy", "legacy-root")).toBeUndefined();
  const child = fork(root.capsule as AnnualRuntimeCapsule, "legacy-root");
  await expect(store.publishCanonicalBranch({ ...child, lifeId: "legacy" })).rejects.toThrow("legacy rewrite unsupported");
  expect(store.deleteLife("legacy")).toBe(true);
  await store.publishCanonicalBranch(root);
  expect(() => store.registerLife("life", "new", root.config, "Ada", "f", root.branch.result, root.branch.snapshots)).toThrow("Canonical");
  expect(() => store.registerLifeBranch("life", "new", "root", 1327, { id: "o", decisionId: "d", optionId: "x" }, root.branch.result, root.branch.snapshots, "new")).toThrow("Canonical");
  expect(() => store.registerLife("other", "root", root.config, "Ada", "f", root.branch.result, root.branch.snapshots)).toThrow("Canonical");
});

it.each(["missing", "corrupt", "wrong-key", "public"])("cold loads fail closed on %s records without snapshot fallback", async mode => {
  const { store, file } = open();
  const root = fixture();
  await store.publishCanonicalBranch(publication(root));
  close(store);
  const db = inspect(file);
  if (mode === "missing") db.prepare("DELETE FROM favor_records_v1 WHERE key = ?").run(blob(root.digest));
  if (mode === "corrupt") db.prepare("UPDATE favor_records_v1 SET wire = ? WHERE key = ?").run(blob("broken"), blob(root.digest));
  if (mode === "wrong-key") db.prepare("UPDATE favor_records_v1 SET wire = ? WHERE key = ?").run(blob(serializeAnnualRuntimeCapsule(fixture("different"))), blob(root.digest));
  if (mode === "public") db.prepare("UPDATE life_branches SET result_json = ? WHERE id = ?").run(compressJson({ ...publication(root).branch.result, events: [] }), "root");
  const reader = open(file).store;
  await expect(reader.loadCanonicalBranch("life", "root")).rejects.toThrow();
});

it("save is awaited outside BEGIN; cancellation leaves no visible publication and retains the capsule", async () => {
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const saved = new Promise<void>(resolve => { entered = resolve; });
  const controller = new AbortController();
  const { store, file } = open(undefined, db => {
    const repo = new AnnualRuntimeRepository(new SqliteFavorRecords(db));
    const save = repo.save.bind(repo);
    vi.spyOn(repo, "save").mockImplementation(async capsule => {
      const key = await save(capsule); // Real adapter BEGIN, on exactly the store connection.
      entered();
      await gate;
      return key;
    });
    return repo;
  });
  const pending = store.publishCanonicalBranch({ ...publication(), signal: controller.signal });
  await saved;
  expect(store.getLife("life")).toBeUndefined();
  expect(counts(inspect(file))).toEqual([0, 0, 0, 1]);
  controller.abort(new Error("cancelled"));
  release();
  await expect(pending).rejects.toThrow("cancelled");
  expect(counts(inspect(file))).toEqual([0, 0, 0, 1]);
});

it("cancellation before save has no capsule side effect", async () => {
  const { store, file } = open();
  const controller = new AbortController();
  controller.abort(new Error("cancelled early"));
  await expect(store.publishCanonicalBranch({ ...publication(), signal: controller.signal })).rejects.toThrow("cancelled early");
  expect(counts(inspect(file))).toEqual([0, 0, 0, 0]);
});

it("rechecks parent representation after asynchronous save before opening publication", async () => {
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const saved = new Promise<void>(resolve => { entered = resolve; });
  let pause = false;
  const { store, file } = open(undefined, db => {
    const repo = new AnnualRuntimeRepository(new SqliteFavorRecords(db));
    const save = repo.save.bind(repo);
    vi.spyOn(repo, "save").mockImplementation(async capsule => {
      const key = await save(capsule);
      if (pause) { entered(); await gate; }
      return key;
    });
    return repo;
  });
  const root = fixture();
  await store.publishCanonicalBranch(publication(root));
  const cached = store.getLife("life")!;
  pause = true;
  const pending = store.publishCanonicalBranch(fork(root));
  await saved;
  inspect(file).prepare("UPDATE life_branches SET result_json = ? WHERE id = ?").run(compressJson({ ...publication(root).branch.result, events: [] }), "root");
  release();
  await expect(pending).rejects.toThrow("representation disagreement");
  expect(cached.latestBranchId).toBe("root");
  expect(cached.branches.size).toBe(1);
  expect(counts(inspect(file))).toEqual([1, 1, 1, 2]);
});

it.each(["insert", "commit"])("publication %s failure rolls back branch/binding/latest, preserving cache and capsule", async mode => {
  let connection!: DatabaseSync;
  const { store, file } = open(undefined, db => {
    connection = db;
    return new AnnualRuntimeRepository(new SqliteFavorRecords(db));
  });
  const root = fixture();
  await store.publishCanonicalBranch(publication(root));
  const cached = store.getLife("life")!;
  if (mode === "insert") connection.exec("CREATE TRIGGER reject_child BEFORE INSERT ON canonical_branch_bindings WHEN NEW.branch_id = 'child' BEGIN SELECT RAISE(ABORT, 'binding insert failure'); END");
  else {
    const exec = connection.exec.bind(connection);
    vi.spyOn(connection, "exec").mockImplementation(sql => {
      if (sql === "COMMIT" && connection.prepare("SELECT 1 FROM canonical_branch_bindings WHERE branch_id = 'child'").get()) throw new Error("commit failure");
      return exec(sql);
    });
  }
  await expect(store.publishCanonicalBranch(fork(root))).rejects.toThrow("failure");
  expect(cached.latestBranchId).toBe("root");
  expect(cached.branches.size).toBe(1);
  expect(store.getLatestBranch("life")?.id).toBe("root");
  expect(counts(inspect(file))).toEqual([1, 1, 1, 2]);
  expect(inspect(file).prepare("SELECT latest_branch_id FROM lives WHERE id = 'life'").get()!.latest_branch_id).toBe("root");
});

it.each(["\ud800", "bad\0id"])("rejects lossy SQLite TEXT branch identity %j before publication", async branchId => {
  const { store, file } = open();
  await expect(store.publishCanonicalBranch(publication(fixture(), branchId))).rejects.toThrow("SQLite TEXT");
  expect(store.getLife("life")).toBeUndefined();
  expect(counts(inspect(file))).toEqual([0, 0, 0, 0]);
});

it("cold file replay preserves exact UTF-16 actors and BLOB wire without a legacy snapshot", async () => {
  const { store, file } = open();
  const root = fixture();
  const base = root.output.state.people.protagonist;
  const id = "new\ud800\0\udfff";
  const person: Newcomer = { id, name: id, sex: "f", birthYear: 1327,
    traits: [...base.traits], job: base.job, mind: structuredClone(base.mind) as Newcomer["mind"] };
  const capsule = forkAnnualRuntime(root, null, [
    { ...quiet(1327), physical: [{ id: "create", kind: "create", person, causes: [] }] }, death(1328),
  ]).finalCapsule;
  await store.publishCanonicalBranch(publication(capsule));
  const row = inspect(file).prepare("SELECT wire, typeof(wire) AS type FROM favor_records_v1 WHERE key = ?").get(blob(capsule.digest))!;
  expect(row.type).toBe("blob");
  expect(Buffer.from(row.wire as Uint8Array)).toEqual(blob(serializeAnnualRuntimeCapsule(capsule)));
  close(store);
  const cold = (await open(file).store.loadCanonicalBranch("life", "root"))!.capsule;
  expect(cold.output.state.people[id].name).toBe(id);
  expect(cold).toEqual(capsule);
  expect(cold).not.toBe(capsule);
  expect(Object.isFrozen(cold.output.state.people[id].mind)).toBe(true);
});

it.each(["read-sync", "read-async", "insert-sync", "insert-async"])("propagates %s failures without false publication", async mode => {
  const failure = new Error("record port failure");
  const fail = () => { if (mode.endsWith("async")) return Promise.reject(failure); throw failure; };
  const { store, file } = open(undefined, db => {
    const records = new SqliteFavorRecords(db);
    return new AnnualRuntimeRepository({
      read: mode.startsWith("read") ? fail : records.read.bind(records),
      insert: mode.startsWith("insert") ? fail : records.insert.bind(records),
    });
  });
  await expect(store.publishCanonicalBranch(publication())).rejects.toBe(failure);
  expect(store.getLife("life")).toBeUndefined();
  expect(counts(inspect(file))).toEqual([0, 0, 0, 0]);
});

it("two independent stores race different digests for one identity without replacing the winner", async () => {
  const { store, file } = open();
  const second = open(file).store;
  const contenders = [publication(), publication(fixture("other"))];
  const results = await Promise.allSettled([store.publishCanonicalBranch(contenders[0]), second.publishCanonicalBranch(contenders[1])]);
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
  expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
  close(store); close(second);
  const cold = open(file).store;
  const loaded = (await cold.loadCanonicalBranch("life", "root"))!;
  const winner = results.findIndex(result => result.status === "fulfilled");
  expect(loaded.capsule).toEqual(contenders[winner].capsule);
  expect(counts(inspect(file))).toEqual([1, 1, 1, 2]);
});

it("cold nested load detects a missing ancestor capsule and cannot publish over its missing history", async () => {
  const { store, file } = open();
  const root = fixture();
  const child = fork(root);
  await store.publishCanonicalBranch(publication(root));
  await store.publishCanonicalBranch(child);
  close(store);
  inspect(file).prepare("DELETE FROM favor_records_v1 WHERE key = ?").run(blob(root.digest));
  const reader = open(file).store;
  await expect(reader.loadCanonicalBranch("life", "child")).rejects.toThrow("Missing canonical capsule");
  await expect(reader.publishCanonicalBranch(fork(child.capsule as AnnualRuntimeCapsule, "child", "nested", 1328, 1330))).rejects.toThrow("Missing canonical capsule");
  expect(reader.getLatestBranch("life")?.id).toBe("child");
});

it("malformed/unsupported binding digests and versions fail before any record read", async () => {
  const { store, file } = open();
  const input = publication();
  store.registerLife("life", "root", input.config, "Ada", "f", input.branch.result, input.branch.snapshots);
  const db = inspect(file);
  const records = new SqliteFavorRecords(db);
  const read = vi.spyOn(records, "read");
  const repo = new EBranchRepository(db, new AnnualRuntimeRepository(records));
  db.prepare("INSERT INTO canonical_branch_bindings VALUES (?, ?, ?)").run("life", "root", JSON.stringify({
    version: "canonical-branch-rb1", lifeId: "life", branchId: "root", capsuleDigest: "A".repeat(64),
    capsuleVersion: "annual-runtime-capsule-e3-1", runtimeVersion: "explicit-resources-e2a-1",
    originDigest: "0".repeat(64), genesisDigest: "0".repeat(64), provenance: null,
  }));
  await expect(repo.load("life", "root")).rejects.toThrow("Invalid binding digest");
  expect(read).not.toHaveBeenCalled();
  // Unknown schema version is also rejected without interpreting arbitrary stored data.
  store.registerLife("other", "other-root", input.config, "Ada", "f", input.branch.result, input.branch.snapshots);
  db.prepare("INSERT INTO canonical_branch_bindings VALUES (?, ?, ?)").run("other", "other-root", JSON.stringify({
    version: "canonical-branch-rb1", lifeId: "other", branchId: "other-root", capsuleDigest: "0".repeat(64),
    capsuleVersion: "unsupported", runtimeVersion: "explicit-resources-e2a-1",
    originDigest: "0".repeat(64), genesisDigest: "0".repeat(64), provenance: null,
  }));
  await expect(repo.load("other", "other-root")).rejects.toThrow("Corrupt canonical binding");
  expect(read).not.toHaveBeenCalled();
});

it("binding rows cannot be replaced or deleted and missing bindings cannot reach records", async () => {
  const { store, file } = open();
  await store.publishCanonicalBranch(publication());
  const db = inspect(file);
  expect(() => db.exec("UPDATE canonical_branch_bindings SET binding_json = '{}'")).toThrow("Immutable");
  expect(() => db.exec("DELETE FROM canonical_branch_bindings")).toThrow("cannot be deleted");
  const records = new SqliteFavorRecords(db);
  const read = vi.spyOn(records, "read");
  const repo = new EBranchRepository(db, new AnnualRuntimeRepository(records));
  await expect(repo.load("life", "root")).resolves.toBeDefined();
  expect(read).toHaveBeenCalledOnce();
  expect(await repo.load("missing", "root")).toBeUndefined();
  expect(read).toHaveBeenCalledOnce();
});

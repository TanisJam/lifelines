import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { openDb } from "./db";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function pathForTest() { const dir = mkdtempSync(join(tmpdir(), "lifelines-u4a-")); dirs.push(dir); return join(dir, "db.sqlite"); }

it("creates fork storage additively and reopens without altering existing rows or blobs", async () => {
  const { LifecycleRepository } = await import("./lifecycle-repository");
  const { createLifecycleGenesis, LIFECYCLE_THREAD_VERSIONS } = await import("../domain/e-lifecycle-genesis");
  const { createLifecycleRuntime } = await import("../domain/e-lifecycle-runtime");
  const { createLifecycleCompactCapsule, serializeLifecycleCompactCapsule } = await import("../domain/e-lifecycle-capsule");
  const { initializeWorld } = await import("../domain/world-origin");
  const path = pathForTest(), db = openDb(path), repo = new LifecycleRepository(db);
  for (const [life, seed, thread] of [["old", "fork-a", false], ["cb3", "fork-b", true]] as const) {
    const initialization = { seed, startYear: 1327, endYear: 1329, founderCount: 6, protagonist: { name: "Alice", sex: "random" as const } };
    const { world } = initializeWorld(initialization);
    const genesis = createLifecycleGenesis({ initialization, protagonistId: "protagonist", ...(thread ? { versions: LIFECYCLE_THREAD_VERSIONS } : {}), resources: Object.fromEntries(Object.keys(world.people).map(id => [id, { grain: 2, effort: 3, need: 1 }])) });
    const capsule = await createLifecycleCompactCapsule({ genesis, output: createLifecycleRuntime(genesis, { journal: "compact" }).snapshot() }, "compact");
    const person = world.people.protagonist;
    await repo.publish({ lifeId: life, branchId: "root", config: world.config, protagonistName: person.name, protagonistSex: person.sex, capsule });
    db.prepare("INSERT INTO lifecycle_capsules_v1 VALUES (?, ?)").run(Buffer.from(capsule.digest, "utf16le"), Buffer.from(await serializeLifecycleCompactCapsule(capsule), "utf16le"));
  }
  // Construct a pre-U4 fixture only; no existing root object is changed.
  db.exec("DROP TABLE lifecycle_fork_decision_sets_v1; DROP TABLE lifecycle_forks_v1");
  const snapshot = (connection: typeof db) => JSON.stringify([connection.prepare("SELECT * FROM lifecycle_lives ORDER BY id").all(), connection.prepare("SELECT * FROM lifecycle_bindings ORDER BY life_id").all(), connection.prepare("SELECT hex(key) AS key, hex(wire) AS wire FROM lifecycle_capsules_v1 ORDER BY key").all(), connection.prepare("SELECT hex(key) AS key, genesis_table, max_steps FROM lifecycle_capsules_v2 ORDER BY key").all()]);
  const before = snapshot(db);
  db.close();
  const migrated = openDb(path);
  const names = (connection: typeof db) => connection.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name LIKE 'lifecycle_fork%'").all().map(row => row.name).sort();
  try {
    expect(names(migrated)).toEqual(["lifecycle_fork_decision_sets_v1", "lifecycle_forks_v1"]);
    expect(snapshot(migrated)).toBe(before);
  } finally { migrated.close(); }
  const reopened = openDb(path);
  try { expect(names(reopened)).toEqual(["lifecycle_fork_decision_sets_v1", "lifecycle_forks_v1"]); expect(snapshot(reopened)).toBe(before); }
  finally { reopened.close(); }
});

it("refuses cross-life ancestry and returns same-life children and binding", async () => {
  const { LifecycleBranchStore } = await import("./lifecycle-branch-store");
  const db = openDb(pathForTest());
  try {
    const digest = "a".repeat(64), parent = "b".repeat(64);
    const binding = { version: "canonical-lifecycle-fork-binding-v1", lifeId: "one", branchId: "child", capsuleDigest: digest, capsuleSchema: "lifecycle-fork-capsule-v1", genesisDigest: "c".repeat(64) };
    db.prepare("INSERT INTO lifecycle_forks_v1 (life_id, branch_id, digest, parent_digest, fork_year, decision_id, option_id, binding_json, wire) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run("one", "child", digest, parent, 1327, "decision", "option", JSON.stringify(binding), Buffer.from("wire", "utf16le"));
    const store = new LifecycleBranchStore(db);
    expect(await store.resolve("other", digest)).toBeUndefined();
    expect(store.children("other", parent)).toEqual([]);
    expect(store.children("one", parent)).toHaveLength(1);
    expect(store.binding("one", "child")).toEqual(binding);
  } finally { db.close(); }
});

it("refuses absent, incomplete, sibling and stale digest decision summaries", async () => {
  const { LifecycleBranchStore } = await import("./lifecycle-branch-store");
  const db = openDb(pathForTest());
  try {
    const store = new LifecycleBranchStore(db), digest = "a".repeat(64);
    db.prepare("INSERT INTO lifecycle_lives VALUES (?, ?, ?, ?, ?, ?)").run("life", "A", "female", "{}", "branch", 1);
    db.prepare("INSERT INTO lifecycle_bindings VALUES (?, ?, ?)").run("life", "branch", JSON.stringify({ version: "canonical-lifecycle-cb1-1", lifeId: "life", branchId: "branch", capsuleDigest: digest, capsuleSchema: "lifecycle-capsule-compact-cb2-1", genesisDigest: "c".repeat(64) }));
    const decisions = [{ id: "d", year: 1327, kind: "immigration", personId: "world", chosen: "yes", options: [{ id: "yes" }, { id: "no" }] }];
    expect(store.decision("life", "branch", digest, "d", 1327)).toBeUndefined();
    db.prepare("INSERT INTO lifecycle_fork_decision_sets_v1 VALUES (?, ?, ?, ?, ?)").run("life", "branch", digest, 2, JSON.stringify(decisions));
    expect(store.decision("life", "branch", digest, "d", 1327)).toBeUndefined();
    db.prepare("DELETE FROM lifecycle_fork_decision_sets_v1").run();
    db.prepare("INSERT INTO lifecycle_fork_decision_sets_v1 VALUES (?, ?, ?, ?, ?)").run("life", "branch", digest, 1, JSON.stringify(decisions));
    expect(store.decision("life", "branch", "b".repeat(64), "d", 1327)).toBeUndefined();
    expect(store.decision("life", "sibling", digest, "d", 1327)).toBeUndefined();
    expect(store.decision("life", "branch", digest, "d", 1327)).toEqual(decisions[0]);
    db.prepare("INSERT INTO lifecycle_fork_decision_sets_v1 VALUES (?, ?, ?, ?, ?)").run("life", "branch", "b".repeat(64), 1, JSON.stringify(decisions));
    expect(store.decision("life", "branch", "b".repeat(64), "d", 1327)).toBeUndefined();
  } finally { db.close(); }
});

it.each([["default", false], ["cb3 thread", true]] as const)("prepares a complete digest-bound index from an admitted %s root outside lookup", async (_name, thread) => {
  const { LifecycleBranchStore } = await import("./lifecycle-branch-store");
  const { LifecycleRepository } = await import("./lifecycle-repository");
  const { createLifecycleGenesis, LIFECYCLE_THREAD_VERSIONS } = await import("../domain/e-lifecycle-genesis");
  const { createLifecycleRuntime } = await import("../domain/e-lifecycle-runtime");
  const { createLifecycleCompactCapsule } = await import("../domain/e-lifecycle-capsule");
  const { initializeWorld } = await import("../domain/world-origin");
  const initialization = { seed: "fork-a", startYear: 1327, endYear: 1329, founderCount: 6, protagonist: { name: "Alice", sex: "random" as const } };
  const { world } = initializeWorld(initialization);
  const genesis = createLifecycleGenesis({ initialization, protagonistId: "protagonist", ...(thread ? { versions: LIFECYCLE_THREAD_VERSIONS } : {}), resources: Object.fromEntries(Object.keys(world.people).map(id => [id, { grain: 2, effort: 3, need: 1 }])) });
  const runtime = createLifecycleRuntime(genesis, { journal: "compact" });
  await runtime.advance(1327);
  const capsule = await createLifecycleCompactCapsule({ genesis, output: runtime.snapshot() }, "compact");
  const db = openDb(pathForTest());
  try {
    const person = world.people.protagonist;
    await new LifecycleRepository(db).publish({ lifeId: "life", branchId: "root", config: world.config, protagonistName: person.name, protagonistSex: person.sex, capsule });
    const store = new LifecycleBranchStore(db);
    await store.prepareDecisions("life", "root", capsule.digest);
    if (thread) expect(capsule.manifest.capsuleSchema).toBe("lifecycle-capsule-compact-cb3-1");
    const target = capsule.output.owned.decisions[0];
    expect(target).toBeDefined();
    expect(store.decision("life", "root", capsule.digest, target.id, target.year)?.chosen).toBe(target.chosen);
    expect(store.decision("life", "root", "b".repeat(64), target.id, target.year)).toBeUndefined();
  } finally { db.close(); }
});

it("refuses preparation when admitted capsule digest differs from the binding", async () => {
  const { LifecycleBranchStore } = await import("./lifecycle-branch-store");
  const db = openDb(pathForTest());
  try {
    const digest = "a".repeat(64);
    db.prepare("INSERT INTO lifecycle_lives VALUES (?, ?, ?, ?, ?, ?)").run("life", "A", "female", "{}", "branch", 1);
    db.prepare("INSERT INTO lifecycle_bindings VALUES (?, ?, ?)").run("life", "branch", JSON.stringify({ version: "canonical-lifecycle-cb1-1", lifeId: "life", branchId: "branch", capsuleDigest: digest, capsuleSchema: "lifecycle-capsule-compact-cb2-1", genesisDigest: "c".repeat(64) }));
    const loaded = { binding: { lifeId: "life", branchId: "branch", capsuleDigest: digest }, capsule: { digest: "b".repeat(64), output: { owned: { decisions: [] } } } };
    expect(() => new LifecycleBranchStore(db).prepareDecisionsFromLoaded("life", "branch", digest, loaded)).toThrow("Decision index binding disagreement");
    expect(db.prepare("SELECT count(*) AS n FROM lifecycle_fork_decision_sets_v1").get()?.n).toBe(0);
  } finally { db.close(); }
});

it.each(["absent", "unknown", "found"] as const)("looks up a decision by ID with %s outcome without replay", async (outcome) => {
  const { LifecycleBranchStore } = await import("./lifecycle-branch-store");
  const { LifecycleRepository } = await import("./lifecycle-repository");
  const { vi } = await import("vitest");
  const db = openDb(pathForTest()), digest = "a".repeat(64);
  try {
    db.prepare("INSERT INTO lifecycle_lives VALUES (?, ?, ?, ?, ?, ?)").run("life", "A", "female", "{}", "branch", 1);
    db.prepare("INSERT INTO lifecycle_bindings VALUES (?, ?, ?)").run("life", "branch", JSON.stringify({ version: "canonical-lifecycle-cb1-1", lifeId: "life", branchId: "branch", capsuleDigest: digest, capsuleSchema: "lifecycle-capsule-compact-cb2-1", genesisDigest: "c".repeat(64) }));
    const target = { id: "d", year: 1327, kind: "immigration", personId: "world", chosen: "yes", options: [{ id: "yes" }, { id: "no" }] };
    if (outcome !== "absent") db.prepare("INSERT INTO lifecycle_fork_decision_sets_v1 VALUES (?, ?, ?, ?, ?)").run("life", "branch", digest, 1, JSON.stringify([target]));
    const load = vi.spyOn(LifecycleRepository.prototype, "load");
    const result = new LifecycleBranchStore(db).decisionById("life", "branch", digest, outcome === "unknown" ? "missing" : "d");
    expect(result).toEqual(outcome === "found" ? { kind: "found", target } : { kind: outcome });
    expect(load).not.toHaveBeenCalled();
    load.mockRestore();
  } finally { db.close(); }
});

it("refuses corrupt, stale and ambiguous decision-ID summaries without replay", async () => {
  const { LifecycleBranchStore } = await import("./lifecycle-branch-store");
  const db = openDb(pathForTest()), digest = "a".repeat(64), store = new LifecycleBranchStore(db);
  try {
    db.prepare("INSERT INTO lifecycle_lives VALUES (?, ?, ?, ?, ?, ?)").run("life", "A", "female", "{}", "branch", 1);
    db.prepare("INSERT INTO lifecycle_bindings VALUES (?, ?, ?)").run("life", "branch", JSON.stringify({ version: "canonical-lifecycle-cb1-1", lifeId: "life", branchId: "branch", capsuleDigest: digest, capsuleSchema: "lifecycle-capsule-compact-cb2-1", genesisDigest: "c".repeat(64) }));
    const target = { id: "d", year: 1327, kind: "immigration", personId: "world", chosen: "yes", options: [{ id: "yes" }, { id: "no" }] };
    db.prepare("INSERT INTO lifecycle_fork_decision_sets_v1 VALUES (?, ?, ?, ?, ?)").run("life", "branch", digest, 2, JSON.stringify([target]));
    expect(store.decisionById("life", "branch", digest, "d")).toEqual({ kind: "absent" });
    db.prepare("UPDATE lifecycle_fork_decision_sets_v1 SET decisions_json = ?").run(JSON.stringify([target, { ...target, year: 1328 }]));
    expect(store.decisionById("life", "branch", digest, "d")).toEqual({ kind: "absent" });
    expect(store.decisionById("life", "branch", "b".repeat(64), "d")).toEqual({ kind: "absent" });
  } finally { db.close(); }
});

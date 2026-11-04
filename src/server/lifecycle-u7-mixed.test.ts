import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { promisify } from "node:util";
import { expect, it, vi } from "vitest";
import { RuleDecisionMaker } from "@/adapters/decision/rule-decision-maker";
import { generateWorld } from "@/domain/worldgen";
import { simulate } from "@/domain/simulate";
import { initializeWorld } from "@/domain/world-origin";
import { createLifecycleGenesis } from "@/domain/e-lifecycle-genesis";
import { createLifecycleRuntime } from "@/domain/e-lifecycle-runtime";
import { createLifecycleCompactCapsule, serializeLifecycleCompactCapsule } from "@/domain/e-lifecycle-capsule";
import { createLifecycleForkCapsule } from "@/domain/e-lifecycle-fork-capsule";
import { forkLifecycle } from "@/domain/e-lifecycle-fork";
import { LIFECYCLE_CHOICE_VERSION } from "@/domain/e-lifecycle-choice";
import * as database from "./db";
import { createLifeStore } from "./life-store";
import { LifecycleRepository } from "./lifecycle-repository";
import { LifecycleBranchStore } from "./lifecycle-branch-store";

function canonicalRows(db: DatabaseSync) {
  const tables = ["lives", "life_branches", "canonical_branch_bindings", "lifecycle_lives", "lifecycle_bindings", "lifecycle_capsules_v1", "lifecycle_capsules_v2", "lifecycle_forks_v1"];
  // Include every content-addressed DAG/blob table, including its manifest, without derived caches.
  const names = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[];
  for (const { name } of names) if (/^(lifecycle_dag_|favor_records_)/.test(name)) tables.push(name);
  return JSON.stringify(Object.fromEntries(tables.map(name => [name, db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()])));
}

it.skipIf(!process.env.U7_MIXED_DB)("child mixed public route reads", async () => {
  process.env.DATA_DIR = process.env.U7_MIXED_DIR!;
  const db = database.openDb(process.env.U7_MIXED_DB!);
  vi.spyOn(database, "getDb").mockReturnValue(db);
  try {
    const { GET } = await import("@/app/api/lives/[lifeId]/route");
    const statuses: number[] = [];
    for (const [lifeId, branchId] of [["legacy", "legacy-root"], ["archived", "root"], ["physical-v2", "root"], ["cb2", "root"], ["cb2", "fork"]]) {
      const response = await GET(new Request(`http://local/api/lives/${lifeId}?branchId=${branchId}`), { params: Promise.resolve({ lifeId }) });
      statuses.push(response.status);
      if (response.status !== 200) throw new Error(`${lifeId}/${branchId}: ${response.status} ${await response.text()}`);
      await response.json();
    }
    writeFileSync(process.env.U7_MIXED_RESULT!, JSON.stringify({ pid: process.pid, statuses, rows: canonicalRows(db) }));
  } finally { vi.restoreAllMocks(); db.close(); }
}, 120_000);

it.skipIf(!!process.env.U7_MIXED_DB)("reopens mixed canonical records through public chronicles without changing bytes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lifelines-u7-mixed-"));
  const path = join(dir, "lifelines.db"), resultPath = join(dir, "child.json");
  const db = database.openDb(path);
  try {
    const legacyWorld = generateWorld({ seed: "mixed-legacy", startYear: 1327, endYear: 1329, founderCount: 6, protagonist: { name: "Alice", sex: "random" } });
    const legacyRun = await simulate(legacyWorld.config, legacyWorld.people, legacyWorld.events, { decisionMaker: new RuleDecisionMaker(), engineSource: "rules", protagonistId: "protagonist" });
    const legacyStore = createLifeStore(path);
    legacyStore.registerLife("legacy", "legacy-root", legacyWorld.config, legacyRun.result.people.protagonist.name, legacyRun.result.people.protagonist.sex, legacyRun.result, legacyRun.snapshots);
    legacyStore.close();

    for (const [lifeId, journal] of [["archived", "audit"], ["physical-v2", "audit"], ["cb2", "compact"]] as const) {
      const initialization = { seed: lifeId === "cb2" ? "fork-a" : lifeId, startYear: 1327, endYear: 1329, founderCount: 6, protagonist: { name: "Alice", sex: "random" as const } };
      const { world } = initializeWorld(initialization);
      const genesis = createLifecycleGenesis({ initialization, protagonistId: "protagonist", resources: Object.fromEntries(Object.keys(world.people).map(id => [id, { grain: 2, effort: 3, need: 1 }])) });
      const runtime = createLifecycleRuntime(genesis, { journal });
      for (let year = 1327; year <= 1329; year++) await runtime.advance(year);
      const root = { genesis, output: runtime.snapshot() };
      const capsule = await createLifecycleCompactCapsule(root, journal);
      const person = world.people.protagonist;
      const binding = await new LifecycleRepository(db).publish({ lifeId, branchId: "root", config: world.config, protagonistName: person.name, protagonistSex: person.sex, capsule });
      expect(binding.capsuleSchema).toBe(journal === "audit" ? "lifecycle-capsule-compact-cb1-1" : "lifecycle-capsule-compact-cb2-1");
      if (lifeId === "archived") {
        const key = Buffer.from(capsule.digest, "utf16le");
        const wire = await serializeLifecycleCompactCapsule(capsule);
        db.prepare("DELETE FROM lifecycle_capsules_v2 WHERE key = ?").run(key);
        db.prepare("INSERT INTO lifecycle_capsules_v1 (key, wire) VALUES (?, ?)").run(key, Buffer.from(wire, "utf16le"));
      }
      if (lifeId === "cb2") {
        const target = root.output.owned.decisions.find(d => d.id === "immigration:world#1328.1")!;
        const fork = await forkLifecycle(root, { version: LIFECYCLE_CHOICE_VERSION, year: 1328, decisionId: target.id, optionId: target.options.find(o => o.id !== target.chosen)!.id });
        await new LifecycleBranchStore(db).publishFork({ lifeId, branchId: "fork", capsule: await createLifecycleForkCapsule(fork) });
      }
    }
    const before = canonicalRows(db);
    db.close();
    await promisify(execFile)("pnpm", ["--config.verify-deps-before-run=ignore", "exec", "vitest", "run", "src/server/lifecycle-u7-mixed.test.ts", "--maxWorkers=1", "-t", "child mixed public route reads"], { env: { ...process.env, DATA_DIR: dir, U7_MIXED_DIR: dir, U7_MIXED_DB: path, U7_MIXED_RESULT: resultPath }, timeout: 120_000 }).catch(error => { throw new Error(`Child failed: ${error.message} ${error.signal} ${error.code} ${error.stdout} ${error.stderr}`); });
    const child = JSON.parse(readFileSync(resultPath, "utf8"));
    expect(child.pid).not.toBe(process.pid);
    expect(child.statuses).toEqual([200, 200, 200, 200, 200]);
    expect(child.rows).toBe(before);
  } finally { if (db.isOpen) db.close(); rmSync(dir, { recursive: true, force: true }); }
}, 240_000);

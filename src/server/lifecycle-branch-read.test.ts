import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ db: undefined as DatabaseSync | undefined }));
vi.mock("./db", async (importOriginal) => {
  const original = await importOriginal<typeof import("./db")>();
  return { ...original, getDb: () => state.db! };
});
import { openDb } from "./db";
import { LifecycleRepository } from "./lifecycle-repository";
import { LifecycleBranchStore } from "./lifecycle-branch-store";
import { buildLifecycleChronicle, buildLifecyclePersonSheet, listLifecycleSummaries, resolveLifecycleBranch } from "./lifecycle-read";
import { createLifecycleGenesis } from "../domain/e-lifecycle-genesis";
import { createLifecycleRuntime } from "../domain/e-lifecycle-runtime";
import { createLifecycleCompactCapsule } from "../domain/e-lifecycle-capsule";
import { createLifecycleForkCapsule } from "../domain/e-lifecycle-fork-capsule";
import { forkLifecycle } from "../domain/e-lifecycle-fork";
import { LIFECYCLE_CHOICE_VERSION } from "../domain/e-lifecycle-choice";
import { initializeWorld } from "../domain/world-origin";

const dir = mkdtempSync(join(tmpdir(), "lifelines-u5a-"));
const path = join(dir, "db.sqlite");

beforeAll(async () => {
  const db = state.db = openDb(path);
  const initialization = { seed: "fork-a", startYear: 1327, endYear: 1329, founderCount: 6, protagonist: { name: "Alice", sex: "random" as const } };
  const { world } = initializeWorld(initialization);
  const genesis = createLifecycleGenesis({ initialization, protagonistId: "protagonist", resources: Object.fromEntries(Object.keys(world.people).map(id => [id, { grain: 2, effort: 3, need: 1 }])) });
  const runtime = createLifecycleRuntime(genesis, { journal: "compact" });
  for (let year = 1327; year <= 1329; year++) await runtime.advance(year);
  const root = { genesis, output: runtime.snapshot() };
  const capsule = await createLifecycleCompactCapsule(root, "compact");
  const person = world.people.protagonist;
  await new LifecycleRepository(db).publish({ lifeId: "life", branchId: "root", config: world.config, protagonistName: person.name, protagonistSex: person.sex, capsule });
  expect((await buildLifecycleChronicle("life")).data?.branchId).toBe("root");
  expect((await listLifecycleSummaries())[0].branchCount).toBe(1);
  const store = new LifecycleBranchStore(db);
  const target = root.output.owned.decisions.find(d => d.id === "immigration:world#1327.1")!;
  const first = await forkLifecycle(root, { version: LIFECYCLE_CHOICE_VERSION, year: 1327, decisionId: target.id, optionId: target.options.find(o => o.id !== target.chosen)!.id });
  const fork = await createLifecycleForkCapsule(first);
  await store.publishFork({ lifeId: "life", branchId: "child", capsule: fork });
  const target2 = root.output.owned.decisions.find(d => d.id === "immigration:world#1328.1")!;
  const sibling = await createLifecycleForkCapsule(await forkLifecycle(root, { version: LIFECYCLE_CHOICE_VERSION, year: 1328, decisionId: target2.id, optionId: target2.options.find(o => o.id !== target2.chosen)!.id }));
  await store.publishFork({ lifeId: "life", branchId: "sibling", capsule: sibling });
  const target3 = first.output.owned.decisions.find(d => d.id === "immigration:world#1328.1")!;
  const nested = await createLifecycleForkCapsule(await forkLifecycle(first, { version: LIFECYCLE_CHOICE_VERSION, year: 1328, decisionId: target3.id, optionId: target3.options.find(o => o.id !== target3.chosen)!.id }), { parent: fork });
  await store.publishFork({ lifeId: "life", branchId: "nested", capsule: nested });
  db.close();
  state.db = openDb(path);
}, 180000);

afterAll(() => { state.db?.close(); rmSync(dir, { recursive: true, force: true }); });

describe("branch-aware lifecycle reads", () => {
  it("selects explicit and latest branches in both locales after reopen", async () => {
    for (const locale of ["en", "es"] as const) {
      for (const branch of ["root", "child", "sibling", "nested"]) {
        const result = await buildLifecycleChronicle("life", branch, locale);
        expect(result.data?.branchId).toBe(branch);
      }
      expect((await buildLifecycleChronicle("life", undefined, locale)).data?.branchId).toBe("nested");
      const latest = await buildLifecyclePersonSheet("life", "protagonist", "nested", locale);
      expect(latest.data).toBeDefined();
      expect(await buildLifecyclePersonSheet("life", "protagonist", undefined, locale)).toEqual(latest);
      const resolution = resolveLifecycleBranch("life");
      expect(resolution.kind).toBe("found");
      if (resolution.kind === "found") expect(resolution.branches.map(branch => branch.branchId)).toEqual(["root", "child", "sibling", "nested"]);
      const item = (await listLifecycleSummaries(locale))[0];
      const view = (await buildLifecycleChronicle("life", "nested", locale)).data!;
      expect(item.branchCount).toBe(4);
      expect(item.causeOfDeath).toBe(view.protagonist.causeOfDeath);
      expect(item.deathYear).toBe(view.protagonist.deathYear);
    }
  }, 180000);

  it("cold-admits a fork and rebuilds unchanged chronicle and sheet indexes", async () => {
    const view = await buildLifecycleChronicle("life", "child", "es");
    const sheet = await buildLifecyclePersonSheet("life", "protagonist", "child", "es");
    state.db!.prepare("DELETE FROM lifecycle_projections_v1 WHERE branch_id = ?").run("child");
    state.db!.prepare("DELETE FROM lifecycle_person_sheet_sets_v1 WHERE branch_id = ?").run("child");
    expect(await buildLifecycleChronicle("life", "child", "es")).toEqual(view);
    expect(await buildLifecyclePersonSheet("life", "protagonist", "child", "es")).toEqual(sheet);
  }, 180000);

  it("distinguishes missing life, branch and person", async () => {
    expect(await buildLifecycleChronicle("missing")).toEqual({ error: "Life not found.", status: 404 });
    expect(await buildLifecycleChronicle("life", "missing")).toEqual({ error: "Branch not found.", status: 404 });
    expect(await buildLifecyclePersonSheet("life", "protagonist", "missing")).toEqual({ error: "Branch not found.", status: 404 });
    expect(await buildLifecyclePersonSheet("life", "missing", "child")).toEqual({ error: "Person not found.", status: 404 });
  });

  it("refuses corrupt canonical fork wire even with cached projections and sheets", async () => {
    state.db!.exec("DROP TRIGGER lifecycle_forks_no_update");
    state.db!.prepare("UPDATE lifecycle_forks_v1 SET wire = ? WHERE branch_id = ?").run(Buffer.from([0]), "nested");
    expect((await buildLifecycleChronicle("life", "nested")).status).toBe(500);
    expect((await buildLifecyclePersonSheet("life", "protagonist", "nested")).status).toBe(500);
  });
});

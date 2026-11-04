// Heavy: replays a 23-year world per fork. Coordinator-run only (RAM rule D16), never by workers.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterAll, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ db: undefined as DatabaseSync | undefined }));
vi.mock("./db", async importOriginal => {
  const original = await importOriginal<typeof import("./db")>();
  return { ...original, getDb: () => state.db! };
});
import { openDb } from "./db";
import { LifecycleRepository } from "./lifecycle-repository";
import { LifecycleBranchStore } from "./lifecycle-branch-store";
import { buildLifecycleChronicle } from "./lifecycle-read";
import { createLifecycleGenesis, LIFECYCLE_GENESIS_VERSIONS, LIFECYCLE_THREAD_VERSIONS } from "../domain/e-lifecycle-genesis";
import { createLifecycleRuntime, type LifecycleJournalMode } from "../domain/e-lifecycle-runtime";
import { createLifecycleCompactCapsule } from "../domain/e-lifecycle-capsule";
import { createLifecycleForkCapsule } from "../domain/e-lifecycle-fork-capsule";
import { forkLifecycle } from "../domain/e-lifecycle-fork";
import { LIFECYCLE_CHOICE_VERSION } from "../domain/e-lifecycle-choice";
import { initializeWorld } from "../domain/world-origin";

const dir = mkdtempSync(join(tmpdir(), "lifelines-u5b-thread-"));
const path = join(dir, "db.sqlite");
afterAll(() => { state.db?.close(); rmSync(dir, { recursive: true, force: true }); });

describe("lifecycle branch thread reads", () => {
  it("retains the open cb3 prefix setup across the fork in warm and cold EN/ES chronicles", async () => {
    const db = state.db = openDb(path);
    const initialization = { seed: "thread-long-3", startYear: 1327, endYear: 1349, founderCount: 6, protagonist: { name: "Alice", sex: "random" as const } };
    const { world } = initializeWorld(initialization);
    const genesis = createLifecycleGenesis({ initialization, protagonistId: "protagonist", versions: LIFECYCLE_THREAD_VERSIONS,
      resources: Object.fromEntries(Object.keys(world.people).map(id => [id, { grain: 2, effort: 3, need: 1 }])) });
    const runtime = createLifecycleRuntime(genesis, { journal: "compact" });
    for (let year = 1327; year <= 1349; year++) if ((await runtime.advance(year)).status === "complete") break;
    const parent = { genesis, output: runtime.snapshot() };
    expect(parent.output.frontier).toBe(1349);
    const prefix = parent.output.journal.find(record => record.year === 1347)!;
    const opened = prefix.final.threads!.threads.filter(thread => thread.status === "open");
    expect(opened).toHaveLength(1);
    const thread = opened[0];
    const setup = prefix.threadBeats!.beats.find(beat => beat.kind === "setup" && beat.thread === thread.id)!;
    expect(setup).toMatchObject({ kind: "setup", thread: thread.id, source: thread.setup, year: 1347, actors: thread.actors });
    expect(setup.effects).toContainEqual(expect.objectContaining({ kind: "obligation", id: thread.obligation, origin: thread.setup }));
    expect(prefix.final.favors.events.find(event => event.id === setup.source)).toMatchObject({ id: thread.setup, kind: "grain-grant", actors: thread.actors });
    const root = await createLifecycleCompactCapsule(parent, "compact");
    expect(root.manifest.capsuleSchema).toBe("lifecycle-capsule-compact-cb3-1");
    const person = world.people.protagonist;
    await new LifecycleRepository(db).publish({ lifeId: "thread-life", branchId: "root", config: world.config, protagonistName: person.name, protagonistSex: person.sex, capsule: root });
    const target = parent.output.owned.decisions.find(entry => entry.year === 1348 && entry.id.startsWith("immigration:world#"))
      ?? parent.output.owned.decisions.find(entry => entry.year === 1348 && !entry.personId?.startsWith("protagonist") && entry.options.length > 1)!;
    const child = await forkLifecycle(parent, { version: LIFECYCLE_CHOICE_VERSION, decisionId: target.id, optionId: target.options.find(option => option.id !== target.chosen)!.id, year: 1348 });
    const inherited = child.output.journal.find(record => record.year === 1347)!;
    expect(inherited.threadBeats!.beats.find(beat => beat.thread === thread.id)).toEqual(setup);
    expect(child.output.journal.find(record => record.year === 1348)!.final.threads!.threads.find(item => item.id === thread.id))
      .toMatchObject({ status: "open", setup: thread.setup, obligation: thread.obligation, openedYear: 1347, eligibleYear: 1350 });
    const fork = await createLifecycleForkCapsule(child);
    await new LifecycleBranchStore(db).publishFork({ lifeId: "thread-life", branchId: "child", capsule: fork });
    db.close(); state.db = openDb(path);
    for (const locale of ["en", "es"] as const) {
      const warm = await buildLifecycleChronicle("thread-life", "child", locale);
      expect(warm.status).toBeUndefined();
      const setupEntry = warm.data!.entries.find(entry => entry.id === setup.source);
      expect(setupEntry).toMatchObject({ id: thread.setup, year: 1347, kind: "thread-setup" });
      expect(setupEntry!.who.every(id => thread.actors.includes(id))).toBe(true);
      expect(warm.data!.entries.filter(entry => entry.kind === "thread-payoff" && entry.cause?.entryId === thread.setup)).toEqual([]);
      state.db!.prepare("DELETE FROM lifecycle_projections_v1 WHERE life_id = ? AND branch_id = ? AND locale = ?").run("thread-life", "child", locale);
      const cold = await buildLifecycleChronicle("thread-life", "child", locale);
      expect(cold).toEqual(warm);
      expect(cold.data!.entries.find(entry => entry.id === setup.source)).toEqual(setupEntry);
    }
  }, 1_200_000);

  it.each([["cb1", "audit"], ["cb2", "compact"]] as const)("does not synthesize thread prose for %s warm or cold", async (profile, journal: LifecycleJournalMode) => {
    const db = state.db ?? (state.db = openDb(path));
    const initialization = { seed: "fork-a", startYear: 1327, endYear: 1329, founderCount: 6, protagonist: { name: "Alice", sex: "random" as const } };
    const { world } = initializeWorld(initialization);
    const genesis = createLifecycleGenesis({ initialization, protagonistId: "protagonist", versions: LIFECYCLE_GENESIS_VERSIONS,
      resources: Object.fromEntries(Object.keys(world.people).map(id => [id, { grain: 2, effort: 3, need: 1 }])) });
    const runtime = createLifecycleRuntime(genesis, { journal });
    for (let year = 1327; year <= 1329; year++) await runtime.advance(year);
    const parent = { genesis, output: runtime.snapshot() };
    const root = await createLifecycleCompactCapsule(parent, journal);
    expect(root.manifest.capsuleSchema).toBe(`lifecycle-capsule-compact-${profile}-1`);
    const person = world.people.protagonist;
    await new LifecycleRepository(db).publish({ lifeId: profile, branchId: "root", config: world.config, protagonistName: person.name, protagonistSex: person.sex, capsule: root });
    const target = parent.output.owned.decisions.find(item => item.id === "immigration:world#1328.1")!;
    const fork = await createLifecycleForkCapsule(await forkLifecycle(parent, { version: LIFECYCLE_CHOICE_VERSION, year: 1328, decisionId: target.id, optionId: target.options.find(option => option.id !== target.chosen)!.id }));
    await new LifecycleBranchStore(db).publishFork({ lifeId: profile, branchId: "child", capsule: fork });
    for (const locale of ["en", "es"] as const) {
      const warm = await buildLifecycleChronicle(profile, "child", locale);
      expect(warm.status).toBeUndefined();
      expect(warm.data!.entries.filter(entry => entry.kind.startsWith("thread-"))).toEqual([]);
      db.prepare("DELETE FROM lifecycle_projections_v1 WHERE life_id = ? AND branch_id = ? AND locale = ?").run(profile, "child", locale);
      const cold = await buildLifecycleChronicle(profile, "child", locale);
      expect(cold).toEqual(warm);
      expect(cold.data!.entries.filter(entry => entry.kind.startsWith("thread-"))).toEqual([]);
    }
  }, 180_000);
});

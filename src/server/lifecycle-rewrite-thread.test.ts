// Heavy: replays a 23-year world per fork. Coordinator-run only (RAM rule D16), never by workers.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { expect, it, vi } from "vitest";
import type { LifeStreamEvent } from "@/contracts/life";

const state = vi.hoisted(() => ({ db: undefined as DatabaseSync | undefined }));
vi.mock("./db", async importOriginal => ({ ...await importOriginal<typeof import("./db")>(), getDb: () => state.db! }));
import { openDb } from "./db";
import { LifecycleRepository } from "./lifecycle-repository";
import { LifecycleBranchStore } from "./lifecycle-branch-store";
import * as projection from "./lifecycle-projection";
import { streamLifecycleRewrite } from "./lifecycle-rewrite";
import { createLifecycleGenesis, LIFECYCLE_THREAD_VERSIONS } from "../domain/e-lifecycle-genesis";
import { createLifecycleRuntime } from "../domain/e-lifecycle-runtime";
import { createLifecycleCompactCapsule } from "../domain/e-lifecycle-capsule";
import { LIFECYCLE_CHOICE_VERSION } from "../domain/e-lifecycle-choice";
import { initializeWorld } from "../domain/world-origin";

it("keeps the prefix setup resolvable while projecting suffix ticks and the chronicle", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lifelines-u6a-thread-"));
  const db = state.db = openDb(join(dir, "db.sqlite"));
  const tick = vi.spyOn(projection, "projectLifecycleTick");
  try {
    const initialization = { seed: "thread-long-3", startYear: 1327, endYear: 1349, founderCount: 6, protagonist: { name: "Alice", sex: "random" as const } };
    const { world } = initializeWorld(initialization);
    const genesis = createLifecycleGenesis({ initialization, protagonistId: "protagonist", versions: LIFECYCLE_THREAD_VERSIONS, resources: Object.fromEntries(Object.keys(world.people).map(id => [id, { grain: 2, effort: 3, need: 1 }])) });
    const runtime = createLifecycleRuntime(genesis, { journal: "compact" });
    for (let year = 1327; year <= 1349; year++) if ((await runtime.advance(year)).status === "complete") break;
    const parent = { genesis, output: runtime.snapshot() };
    const prefix = parent.output.journal.find(record => record.year === 1347)!;
    const thread = prefix.final.threads!.threads.find(item => item.status === "open")!;
    const setup = prefix.threadBeats!.beats.find(beat => beat.kind === "setup" && beat.thread === thread.id)!;
    expect(thread).toMatchObject({ setup: setup.source, openedYear: 1347, eligibleYear: 1350 });
    const person = world.people.protagonist;
    await new LifecycleRepository(db).publish({ lifeId: "thread", branchId: "root", config: world.config, protagonistName: person.name, protagonistSex: person.sex, capsule: await createLifecycleCompactCapsule(parent, "compact") });
    const target = parent.output.owned.decisions.find(entry => entry.year === 1348 && entry.id.startsWith("immigration:world#"))
      ?? parent.output.owned.decisions.find(entry => entry.year === 1348 && !entry.personId?.startsWith("protagonist") && entry.options.length > 1)!;
    const events: LifeStreamEvent[] = [];
    await streamLifecycleRewrite({ lifeId: "thread", branchId: "child", parent, choice: { version: LIFECYCLE_CHOICE_VERSION, year: 1348, decisionId: target.id, optionId: target.options.find(option => option.id !== target.chosen)!.id }, locale: "en", signal: new AbortController().signal, store: new LifecycleBranchStore(db), send: event => { events.push(event); } });
    expect(tick).toHaveBeenCalled();
    for (const [input] of tick.mock.calls) {
      const sourcePrefix = input.source.output.journal.find(record => record.year === 1347)!;
      expect(sourcePrefix.threadBeats!.beats.find(beat => beat.thread === thread.id)).toEqual(setup);
      expect(sourcePrefix.final.threads!.threads.find(item => item.id === thread.id)).toEqual(thread);
      const suffix = input.source.output.journal.find(record => record.year === 1348)!;
      expect(suffix.final.threads!.threads.find(item => item.id === thread.id)).toMatchObject({ status: "open", setup: thread.setup, obligation: thread.obligation });
      expect(sourcePrefix.final.favors.events.find(event => event.id === setup.source)).toMatchObject({ id: thread.setup, kind: "grain-grant", actors: thread.actors });
    }
    const done = events.find(event => event.type === "done");
    expect(done?.type === "done" && done.chronicle.entries.find(entry => entry.id === setup.source)).toMatchObject({ id: thread.setup, year: 1347, kind: "thread-setup" });
    expect(events.filter(event => event.type === "tick").map(event => event.year)).toEqual([1348, 1349]);
  } finally { tick.mockRestore(); db.close(); rmSync(dir, { recursive: true, force: true }); }
}, 1200000);

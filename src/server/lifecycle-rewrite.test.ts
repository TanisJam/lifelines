import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import type { LifeStreamEvent } from "@/contracts/life";

const state = vi.hoisted(() => ({ db: undefined as DatabaseSync | undefined }));
vi.mock("./db", async importOriginal => ({ ...await importOriginal<typeof import("./db")>(), getDb: () => state.db! }));
const chronicleRead = vi.hoisted(() => ({ calls: 0, afterRead: undefined as (() => void) | undefined }));
vi.mock("./lifecycle-read", async importOriginal => {
  const original = await importOriginal<typeof import("./lifecycle-read")>();
  return { ...original, buildLifecycleChronicle: vi.fn(async (...args: Parameters<typeof original.buildLifecycleChronicle>) => {
    chronicleRead.calls++;
    const result = await original.buildLifecycleChronicle(...args);
    chronicleRead.afterRead?.();
    return result;
  }) };
});
vi.mock("@/domain/decision-id", async importOriginal => {
  const original = await importOriginal<typeof import("@/domain/decision-id")>();
  return { ...original, buildGhostAnnotations: vi.fn(original.buildGhostAnnotations) };
});
import { openDb } from "./db";
import { LifecycleRepository } from "./lifecycle-repository";
import { LifecycleBranchStore } from "./lifecycle-branch-store";
import { buildLifecycleChronicle } from "./lifecycle-read";
import { streamLifecycleRewrite } from "./lifecycle-rewrite";
import { createLifecycleGenesis } from "../domain/e-lifecycle-genesis";
import { createLifecycleRuntime } from "../domain/e-lifecycle-runtime";
import { createLifecycleCompactCapsule } from "../domain/e-lifecycle-capsule";
import { LIFECYCLE_CHOICE_VERSION } from "../domain/e-lifecycle-choice";
import { initializeWorld } from "../domain/world-origin";
import { forkLifecycle } from "../domain/e-lifecycle-fork";
import { buildGhostAnnotations } from "@/domain/decision-id";
import { projectLifecycleTick, type LifecycleProjectionSource } from "./lifecycle-projection";

const dir = mkdtempSync(join(tmpdir(), "lifelines-u6a-"));
let parent: { genesis: ReturnType<typeof createLifecycleGenesis>; output: ReturnType<ReturnType<typeof createLifecycleRuntime>["snapshot"]> };
let choice: { version: typeof LIFECYCLE_CHOICE_VERSION; year: number; decisionId: string; optionId: string };
beforeAll(async () => {
  const db = state.db = openDb(join(dir, "db.sqlite"));
  const initialization = { seed: "fork-a", startYear: 1327, endYear: 1329, founderCount: 6, protagonist: { name: "Alice", sex: "random" as const } };
  const { world } = initializeWorld(initialization);
  const genesis = createLifecycleGenesis({ initialization, protagonistId: "protagonist", resources: Object.fromEntries(Object.keys(world.people).map(id => [id, { grain: 2, effort: 3, need: 1 }])) });
  const runtime = createLifecycleRuntime(genesis, { journal: "compact" });
  for (let year = 1327; year <= 1329; year++) await runtime.advance(year);
  parent = { genesis, output: runtime.snapshot() };
  const target = parent.output.owned.decisions.find(d => d.id === "immigration:world#1328.1")!;
  choice = { version: LIFECYCLE_CHOICE_VERSION, year: target.year, decisionId: target.id, optionId: target.options.find(o => o.id !== target.chosen)!.id };
  const person = world.people.protagonist;
  await new LifecycleRepository(db).publish({ lifeId: "life", branchId: "root", config: world.config, protagonistName: person.name, protagonistSex: person.sex, capsule: await createLifecycleCompactCapsule(parent, "compact") });
}, 180000);
afterAll(() => { state.db?.close(); rmSync(dir, { recursive: true, force: true }); });

it.each(["en", "es"] as const)("streams suffix and fresh GET in %s", async locale => {
  const events: LifeStreamEvent[] = [];
  const branchId = "child";
  await streamLifecycleRewrite({ lifeId: "life", branchId, parent, choice, locale, signal: new AbortController().signal, store: new LifecycleBranchStore(state.db!), send: e => { events.push(e); } });
  expect(events.map(e => e.type)).toEqual(["start", "divergence", "tick", "tick", "done"]);
  expect(events.filter(e => e.type === "tick").map(e => e.year)).toEqual([1328, 1329]);
  expect(events[1]).toMatchObject({ type: "divergence", year: 1328 });
  const done = events.find(e => e.type === "done");
  expect(done?.type === "done" && done.chronicle).toEqual((await buildLifecycleChronicle("life", branchId, locale)).data);
  if (done?.type !== "done") throw new Error("Missing done");
  const child = await forkLifecycle(parent, choice);
  const source = { genesis: child.genesis, output: child.output } as unknown as LifecycleProjectionSource;
  for (const event of events) if (event.type === "tick") {
    expect(event).toEqual({ type: "tick", ...(await projectLifecycleTick({ source, year: event.year, locale })).view });
  }
  expect(done.ghosts).toEqual(buildGhostAnnotations(parent.output.owned.decisions,
    child.output.owned.decisions.filter(d => d.year >= 1328), done.chronicle.entries.filter(e => (e.endYear ?? e.year) >= 1328), 1328));
}, 180000);

it("does not publish when aborted before publication", async () => {
  const controller = new AbortController(), events: LifeStreamEvent[] = [];
  await streamLifecycleRewrite({ lifeId: "life", branchId: "aborted", parent, choice, locale: "en", signal: controller.signal,
    store: new LifecycleBranchStore(state.db!), send: e => { events.push(e); if (e.type === "tick") controller.abort(); } });
  expect(events.some(e => e.type === "done")).toBe(false);
  expect(new LifecycleBranchStore(state.db!).binding("life", "aborted")).toBeUndefined();
}, 180000);

it("leaves a committed child loadable but suppresses done when publication aborts", async () => {
  const controller = new AbortController(), events: LifeStreamEvent[] = [];
  chronicleRead.calls = 0;
  chronicleRead.afterRead = undefined;
  const store = new LifecycleBranchStore(state.db!);
  const publish = store.publishFork.bind(store);
  vi.spyOn(store, "publishFork").mockImplementation(async (input, options) => {
    const result = await publish(input, options); controller.abort(); return result;
  });
  const target = parent.output.owned.decisions.find(d => d.id === "immigration:world#1327.1")!;
  const otherChoice = { ...choice, year: target.year, decisionId: target.id, optionId: target.options.find(o => o.id !== target.chosen)!.id };
  await streamLifecycleRewrite({ lifeId: "life", branchId: "during-publish", parent, choice: otherChoice, locale: "en", signal: controller.signal, store, send: e => { events.push(e); } });
  expect(events.some(e => e.type === "done")).toBe(false);
  expect(chronicleRead.calls).toBe(0);
  expect((await buildLifecycleChronicle("life", "during-publish", "en")).data).toBeDefined();
}, 180000);

it("suppresses done when abort occurs during the final chronicle read", async () => {
  const controller = new AbortController(), events: LifeStreamEvent[] = [];
  const store = new LifecycleBranchStore(state.db!);
  const target = parent.output.owned.decisions.find(d => d.id !== "immigration:world#1327.1" && d.options.some(o => o.id !== d.chosen))!;
  const otherChoice = { ...choice, year: target.year, decisionId: target.id, optionId: target.options.find(o => o.id !== target.chosen)!.id };
  chronicleRead.calls = 0;
  chronicleRead.afterRead = () => controller.abort();
  try {
    await streamLifecycleRewrite({ lifeId: "life", branchId: "during-chronicle", parent, choice: otherChoice, locale: "en", signal: controller.signal, store, send: e => { events.push(e); } });
    expect(chronicleRead.calls).toBe(1);
    expect(events.some(e => e.type === "done")).toBe(false);
    expect(store.binding("life", "during-chronicle")).toBeDefined();
  } finally { chronicleRead.afterRead = undefined; }
}, 180000);

it("does not publish when cancellation arrives while preparing the capsule", async () => {
  const capsule = await import("../domain/e-lifecycle-fork-capsule");
  const original = capsule.createLifecycleForkCapsule;
  const controller = new AbortController(), events: LifeStreamEvent[] = [];
  const store = new LifecycleBranchStore(state.db!);
  const root = await new LifecycleRepository(state.db!).load("life", "root");
  const person = parent.output.owned.people.protagonist;
  await new LifecycleRepository(state.db!).publish({ lifeId: "abort-capsule-life", branchId: "root", config: parent.genesis.initial.config, protagonistName: person.name, protagonistSex: person.sex, capsule: root!.capsule });
  const spy = vi.spyOn(capsule, "createLifecycleForkCapsule").mockImplementation(async (...args) => {
    const result = await original(...args);
    controller.abort();
    return result;
  });
  try {
    await streamLifecycleRewrite({ lifeId: "abort-capsule-life", branchId: "abort-capsule", parent, choice, locale: "en", signal: controller.signal, store, send: e => { events.push(e); } });
    expect(events.filter(e => e.type === "tick")).toHaveLength(2);
    expect(store.binding("abort-capsule-life", "abort-capsule")).toBeUndefined();
    expect(events.some(e => e.type === "done")).toBe(false);
  } finally { spy.mockRestore(); }
}, 180000);

it("rolls back a thrown transaction fault and emits no done", async () => {
  const store = new LifecycleBranchStore(state.db!), events: LifeStreamEvent[] = [];
  const publish = store.publishFork.bind(store);
  vi.spyOn(store, "publishFork").mockImplementation((input) => publish(input, { onStage: () => { throw new Error("fault"); } }));
  // A distinct life allows the same fork digest to exercise insertion, not the retry path.
  const root = await new LifecycleRepository(state.db!).load("life", "root");
  const person = parent.output.owned.people.protagonist;
  await new LifecycleRepository(state.db!).publish({ lifeId: "fault-life", branchId: "root", config: parent.genesis.initial.config, protagonistName: person.name, protagonistSex: person.sex, capsule: root!.capsule });
  await expect(streamLifecycleRewrite({ lifeId: "fault-life", branchId: "fault", parent, choice, locale: "en", signal: new AbortController().signal, store, send: e => { events.push(e); } })).rejects.toThrow("fault");
  expect(store.binding("fault-life", "fault")).toBeUndefined();
  expect(events.some(e => e.type === "done")).toBe(false);
}, 180000);

it("rejects replay failure without publication or done", async () => {
  const events: LifeStreamEvent[] = [];
  await expect(streamLifecycleRewrite({ lifeId: "life", branchId: "bad", parent, choice: { ...choice, year: 1327 }, locale: "en", signal: new AbortController().signal,
    store: new LifecycleBranchStore(state.db!), send: e => { events.push(e); } })).rejects.toThrow();
  expect(events[1]).toMatchObject({ type: "divergence", year: 1328 });
  expect(events.some(e => e.type === "done")).toBe(false);
  expect(new LifecycleBranchStore(state.db!).binding("life", "bad")).toBeUndefined();
}, 180000);

it("does not publish when tick projection refuses", async () => {
  const projection = await import("./lifecycle-projection");
  const spy = vi.spyOn(projection, "projectLifecycleTick").mockRejectedValueOnce(new Error("projection refused"));
  const events: LifeStreamEvent[] = [];
  try {
    await expect(streamLifecycleRewrite({ lifeId: "life", branchId: "refused", parent, choice, locale: "en", signal: new AbortController().signal,
      store: new LifecycleBranchStore(state.db!), send: e => { events.push(e); } })).rejects.toThrow("projection refused");
    expect(new LifecycleBranchStore(state.db!).binding("life", "refused")).toBeUndefined();
    expect(events.some(e => e.type === "done")).toBe(false);
  } finally { spy.mockRestore(); }
}, 180000);

it("rewrites an admitted child with its lineage and capsule ancestry", async () => {
  const { createLifecycleForkCapsule } = await import("../domain/e-lifecycle-fork-capsule");
  const first = await forkLifecycle(parent, choice);
  const parentCapsule = await createLifecycleForkCapsule(first);
  const target = first.output.owned.decisions.find(d => d.id === "immigration:world#1329.1")!;
  const nestedChoice = { version: LIFECYCLE_CHOICE_VERSION as typeof LIFECYCLE_CHOICE_VERSION, year: target.year, decisionId: target.id, optionId: target.options.find(o => o.id !== target.chosen)!.id };
  const events: LifeStreamEvent[] = [];
  await streamLifecycleRewrite({ lifeId: "life", branchId: "nested", parent: first as unknown as LifecycleProjectionSource & { lineage: typeof first.lineage }, parentCapsule,
    choice: nestedChoice, locale: "en", signal: new AbortController().signal, store: new LifecycleBranchStore(state.db!), send: event => { events.push(event); } });
  expect(events.map(event => event.type)).toEqual(["start", "divergence", "tick", "done"]);
  expect((await buildLifecycleChronicle("life", "nested", "en")).data).toBeDefined();
}, 180000);

it("never offers prefix decisions to ghost matching", async () => {
  const spy = vi.mocked(buildGhostAnnotations);
  spy.mockClear();
  await streamLifecycleRewrite({ lifeId: "life", branchId: "child", parent, choice, locale: "en", signal: new AbortController().signal, store: new LifecycleBranchStore(state.db!), send: () => {} });
  expect(spy).toHaveBeenCalledTimes(1);
  const [, rewritten, entries, forkYear] = spy.mock.calls[0];
  expect(forkYear).toBe(1328);
  expect(rewritten.length).toBeGreaterThan(0);
  expect(rewritten.every(decision => decision.year >= 1328)).toBe(true);
  expect((entries as unknown as { endYear?: number; year: number }[]).every(entry => (entry.endYear ?? entry.year) >= 1328)).toBe(true);
}, 180000);

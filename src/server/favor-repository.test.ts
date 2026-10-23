import { expect, it, vi } from "vitest";
import { createHelpFavorState, grantHelpFavor } from "../domain/effects";
import { createMind } from "../domain/mind";
import type { Person } from "../domain/types";
import { createFavorScheduler, runFavorYear } from "../domain/scheduler";
import { createFavorCapsule, serializeFavorCapsule } from "../domain/favor-capsule";
import { FavorRepository, MemoryFavorRecords } from "./favor-repository";

vi.mock("./db", () => { throw new Error("Production database imported"); });
vi.mock("./life-store", () => { throw new Error("Legacy storage imported"); });
vi.mock("./decision-engine", () => { throw new Error("Production provider imported"); });
function fixture() {
  const people: Record<string, Person> = {};
  for (const id of ["b", "a"]) people[id] = { id, name: id, sex: "f", birthYear: 1300, founder: true, job: "none", traits: [], mind: createMind("repo", id, 1300) };
  let state = createHelpFavorState(people, [], { a: 2, b: 0 }, { b: 2 }, { a: 2 });
  for (let i = 0; i < 2; i++) state = grantHelpFavor(state, { key: `g${i}`, year: 1336, creditor: "a", debtor: "b", causes: [], ties: [], appraisals: [] });
  return createFavorCapsule(runFavorYear(createFavorScheduler(state, "c2-1", 1336), 1337));
}

it("cold-loads persisted strings through a fresh repository and idempotent save", async () => {
  const backing = new Map<string, string>();
  const capsule = createFavorCapsule(createFavorScheduler(createHelpFavorState({}, [], {}, {}, {}), "empty", 1336));
  const repo = new FavorRepository(new MemoryFavorRecords(backing));
  const key = await repo.save(capsule);
  expect(await repo.save(capsule)).toBe(key);
  expect(backing.size).toBe(1);
  expect(typeof backing.get(key)).toBe("string");
  expect(await new FavorRepository(new MemoryFavorRecords(backing)).load(key)).toEqual(capsule);
});

it("detaches save/load aliases and retries without repeating grants, effects or events", async () => {
  const records = new Map<string, string>();
  const repo = new FavorRepository(new MemoryFavorRecords(records));
  const original = fixture();
  const input = structuredClone(original);
  const key = await repo.save(input);
  const wire = records.get(key)!;
  input.scheduler.state.grain.a = 100;
  input.scheduler.years.length = 0;
  input.registryOrder.reverse();
  const first = (await repo.load(key))!;
  expect(first).toEqual(original);
  first.scheduler.state.events.length = 0;
  first.scheduler.state.people.a!.job = "farmer";
  expect(await repo.load(key)).toEqual(original);
  expect(await repo.save(original)).toBe(key);
  expect(records.size).toBe(1);
  expect(records.get(key)).toBe(wire);
  const cold = (await new FavorRepository(new MemoryFavorRecords(records)).load(key))!;
  expect(Object.keys(cold.scheduler.state.people)).toEqual(["b", "a"]);
  expect(cold.scheduler.state.events).toEqual(original.scheduler.state.events);
  expect(cold.scheduler.state.obligations).toEqual(original.scheduler.state.obligations);
  expect(cold.scheduler.years).toEqual(original.scheduler.years);
  expect(serializeFavorCapsule(cold)).toBe(wire);
  expect(runFavorYear(cold.scheduler, 1338)).toEqual(runFavorYear(original.scheduler, 1338));
});

it("rejects corrupted records and valid records stored under a wrong hash key without overwrite", async () => {
  const capsule = fixture();
  for (const wire of ["broken-json", "null", serializeFavorCapsule(capsule).replace(capsule.digest, "0".repeat(64))]) {
    const map = new Map([[capsule.digest, wire]]);
    const repo = new FavorRepository(new MemoryFavorRecords(map));
    await expect(repo.load(capsule.digest)).rejects.toThrow();
    await expect(repo.save(capsule)).rejects.toThrow();
    expect(map.get(capsule.digest)).toBe(wire);
  }
  const other = createFavorCapsule(createFavorScheduler(createHelpFavorState({}, [], {}, {}, {}), "other", 1336));
  const map = new Map([[capsule.digest, serializeFavorCapsule(other)]]);
  const repo = new FavorRepository(new MemoryFavorRecords(map));
  await expect(repo.load(capsule.digest)).rejects.toThrow("key/hash disagreement");
  await expect(repo.save(capsule)).rejects.toThrow();
  expect(map.get(capsule.digest)).toBe(serializeFavorCapsule(other));
});

it("validates before storage access and propagates atomic insert failure without publication", async () => {
  const map = new Map<string, string>();
  const read = vi.fn((key: string) => map.get(key));
  const insert = vi.fn(() => { throw new Error("atomic insert failed before publication"); });
  const repo = new FavorRepository({ read, insert });
  const bad = fixture();
  bad.scheduler.completedYear++;
  await expect(repo.save(bad)).rejects.toThrow();
  expect(read).not.toHaveBeenCalled();
  expect(insert).not.toHaveBeenCalled();
  const valid = fixture();
  await expect(repo.save(valid)).rejects.toThrow("atomic insert failed");
  expect(insert).toHaveBeenCalledExactlyOnceWith(valid.digest, serializeFavorCapsule(valid));
  expect(map.size).toBe(0);
  expect(await repo.load(valid.digest)).toBeUndefined();
});

it("uses immutable adapter writes and supports concurrent identical retries", async () => {
  const map = new Map<string, string>();
  const adapter = new MemoryFavorRecords(map);
  const capsule = fixture();
  const repo = new FavorRepository(adapter);
  expect(await Promise.all([repo.save(capsule), repo.save(capsule)])).toEqual([capsule.digest, capsule.digest]);
  const before = map.get(capsule.digest);
  expect(() => adapter.insert(capsule.digest, "conflict")).toThrow();
  expect(map.get(capsule.digest)).toBe(before);
  expect(map.size).toBe(1);
});

it("checks primitive keys and stored primitive strings without executing hooks", async () => {
  let executions = 0;
  const hooks = { toString() { executions++; return "x"; }, toJSON() { executions++; return "x"; } };
  const read = vi.fn(() => hooks as unknown as string);
  const repo = new FavorRepository({ read, insert() {} });
  await expect(repo.load(hooks)).rejects.toThrow();
  expect(read).not.toHaveBeenCalled();
  await expect(repo.load("0".repeat(64))).rejects.toThrow();
  expect(executions).toBe(0);
});

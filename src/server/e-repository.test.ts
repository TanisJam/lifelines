import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import { createAnnualRuntime, type Newcomer } from "../domain/e-runtime";
import { createAnnualRuntimeCapsule, serializeAnnualRuntimeCapsule } from "../domain/e-capsule";
import { initializeWorld } from "../domain/world-initialization";
import { MemoryFavorRecords, type FavorRecords } from "./favor-repository";
import { AnnualRuntimeRepository } from "./e-repository";

vi.mock("./db", () => { throw new Error("Production database imported"); });
vi.mock("./life-store", () => { throw new Error("Legacy storage imported"); });
vi.mock("./decision-engine", () => { throw new Error("Production provider imported"); });
const initialization = { seed: "verify-1", startYear: 1327, endYear: 1335, founderCount: 6 };
function runtime() {
  const { world } = initializeWorld(initialization);
  const resources = Object.fromEntries(Object.keys(world.people).map(id => [id, { grain: 2, effort: 1, need: 1 }]));
  return createAnnualRuntime(initialization, resources);
}
function fixture() {
  return createAnnualRuntimeCapsule(runtime().advance({ year: 1327, physical: [], resources: [], grants: [], requests: [] }));
}
function detachedFrozen(actual: unknown, expected: unknown) {
  if (expected !== null && typeof expected === "object") {
    expect(actual).not.toBe(expected);
    expect(Object.isFrozen(actual)).toBe(true);
    expect(Object.keys(actual as object)).toEqual(Object.keys(expected));
    expect(Array.isArray(actual)).toBe(Array.isArray(expected));
    for (const key of Object.keys(expected)) detachedFrozen(Reflect.get(actual as object, key), Reflect.get(expected, key));
  } else expect(Object.is(actual, expected)).toBe(true);
}
// Test-only wire surgery does not reuse the production encoder or admission.
type Node = [string, unknown?];
type Envelope = { manifest: unknown[]; payload: Node; digest: string };
function field(node: Node, key: string): Node {
  const pair = (node[1] as [string, Node][]).find(([name]) => name === key);
  if (!pair) throw new Error(`Missing fixture field ${key}`);
  return pair[1];
}
function rehash(envelope: Envelope) {
  envelope.digest = createHash("sha256").update(JSON.stringify([envelope.manifest, envelope.payload]), "utf8").digest("hex");
  return JSON.stringify(envelope);
}

it("saves one complete initial or annual capsule, with async ports, retries and cold loads", async () => {
  for (const capsule of [createAnnualRuntimeCapsule(runtime().initial), fixture()]) {
    const backing = new Map<string, string>();
    const memory = new MemoryFavorRecords(backing);
    const records: FavorRecords = { async read(key) { return memory.read(key); }, async insert(key, wire) { memory.insert(key, wire); } };
    const repo = new AnnualRuntimeRepository(records);
    expect(await repo.save(capsule)).toBe(capsule.digest);
    expect(await repo.save(capsule)).toBe(capsule.digest);
    expect(backing.size).toBe(1);
    expect(backing.get(capsule.digest)).toBe(serializeAnnualRuntimeCapsule(capsule));
    const cold = (await new AnnualRuntimeRepository(records).load(capsule.digest))!;
    expect(cold).toEqual(capsule);
    expect(cold).not.toBe(capsule);
    expect(Object.isFrozen(cold)).toBe(true);
    expect(Object.isFrozen(cold.manifest)).toBe(true);
    detachedFrozen(cold.output, capsule.output);
    expect(await repo.load("0".repeat(64))).toBeUndefined();
  }
});

it.each(["__proto__", "constructor", "toString", "7", "\ud800", "\udfff"])("preserves exact IDs, own names, order and numeric data for %s", async id => {
  const engine = runtime();
  const base = Object.values(engine.initial.state.people)[0];
  const mind = structuredClone(base.mind) as Newcomer["mind"];
  mind.stress = -0;
  mind.needs = [{ name: "tiny", met: Number.MIN_VALUE }];
  const person: Newcomer = { id, name: id, sex: base.sex, birthYear: 1327, traits: [...base.traits], job: base.job, mind };
  const output = engine.advance({ year: 1327, physical: [{ id: "create", kind: "create", person, causes: [] }], resources: [], grants: [], requests: [] });
  const input = structuredClone(createAnnualRuntimeCapsule(output));
  const ids = Object.keys(input.output.state.people).reverse();
  Reflect.set(input.output.state, "people", Object.fromEntries(ids.map(key => [key, input.output.state.people[key]])));
  const original = createAnnualRuntimeCapsule(input.output);
  const borrowed = structuredClone(original);
  const before = structuredClone(borrowed);
  const records = new MemoryFavorRecords();
  const repo = new AnnualRuntimeRepository(records);
  const key = await repo.save(borrowed);
  expect(borrowed).toEqual(before);
  expect(Object.isFrozen(borrowed.output.state.people)).toBe(false);
  Reflect.set(borrowed.output.state.people[id], "name", "caller mutation");
  const first = (await repo.load(key))!;
  const second = (await new AnnualRuntimeRepository(records).load(key))!;
  detachedFrozen(first.output, original.output);
  detachedFrozen(second.output, first.output);
  expect(Object.hasOwn(first.output.state.people, id)).toBe(true);
  expect(first.output.state.people[id].name).toBe(id);
  expect(Reflect.set(first.output.state.people[id], "name", "load mutation")).toBe(false);
  expect(serializeAnnualRuntimeCapsule(second)).toBe(serializeAnnualRuntimeCapsule(original));
});

it("admits unknown input before any storage hook without executing getters", async () => {
  const hook = vi.fn(() => { throw new Error("getter executed"); });
  const read = vi.fn(() => undefined);
  const insert = vi.fn();
  const repo = new AnnualRuntimeRepository({ read, insert });
  const getter = structuredClone(fixture());
  Object.defineProperty(getter.output.state.people, "getter", { enumerable: true, get: hook });
  const top = structuredClone(fixture());
  Object.defineProperty(top, "output", { enumerable: true, get: hook });
  const wrongDigest = { ...fixture(), digest: "0".repeat(64) };
  for (const input of [undefined, null, [], {}, runtime().initial, getter, top, wrongDigest]) {
    await expect(repo.save(input)).rejects.toThrow();
  }
  expect(hook).not.toHaveBeenCalled();
  expect(read).not.toHaveBeenCalled();
  expect(insert).not.toHaveBeenCalled();
});

it("rejects invalid unknown keys before read and non-string records without coercion", async () => {
  const hook = vi.fn(() => "0".repeat(64));
  const hooks = { toString: hook, toJSON: hook, valueOf: hook };
  const read = vi.fn(() => hooks as unknown as string);
  const insert = vi.fn();
  const repo = new AnnualRuntimeRepository({ read, insert });
  for (const key of [undefined, null, 0, hooks, [], "", "a".repeat(63), "a".repeat(65), "A".repeat(64), "g".repeat(64), "a".repeat(64) + "\n"]) {
    await expect(repo.load(key)).rejects.toThrow("Invalid capsule key");
  }
  expect(read).not.toHaveBeenCalled();
  for (const value of [hooks, null, 42, []]) {
    read.mockReturnValueOnce(value as unknown as string);
    await expect(repo.load("0".repeat(64))).rejects.toThrow("wire string");
    read.mockReturnValueOnce(value as unknown as string);
    await expect(repo.save(fixture())).rejects.toThrow("wire string");
  }
  expect(insert).not.toHaveBeenCalled();
  expect(hook).not.toHaveBeenCalled();
});

it("rejects corrupt, unsupported, noncanonical and key-disagreeing records without overwrite", async () => {
  const capsule = fixture();
  const wire = serializeAnnualRuntimeCapsule(capsule);
  const unsupported: Envelope = JSON.parse(wire);
  unsupported.manifest[0] = "unknown";
  const semantic: Envelope = JSON.parse(wire);
  field(semantic.payload, "frontier")[1] = "1328";
  const forged = rehash(semantic);
  const cases = ["broken-json", "null", wire.replace(capsule.digest, "0".repeat(64)), " " + wire,
    wire.replace('{"manifest":', '{"digest":"discarded","manifest":'), rehash(unsupported),
    serializeAnnualRuntimeCapsule(createAnnualRuntimeCapsule(runtime().initial)), forged];
  for (const stored of cases) {
    const map = new Map([[capsule.digest, stored]]);
    const insert = vi.fn();
    const repo = new AnnualRuntimeRepository({ read: key => map.get(key), insert });
    await expect(repo.load(capsule.digest)).rejects.toThrow();
    await expect(repo.save(capsule)).rejects.toThrow();
    expect(insert).not.toHaveBeenCalled();
    expect(map.get(capsule.digest)).toBe(stored);
  }
  // Correct digest and matching key still cannot certify a fabricated annual output.
  const repo = new AnnualRuntimeRepository(new MemoryFavorRecords(new Map([[semantic.digest, forged]])));
  await expect(repo.load(semantic.digest)).rejects.toThrow();
  const fabricated = structuredClone(capsule);
  Reflect.set(fabricated.output, "frontier", 1328);
  Reflect.set(fabricated, "digest", semantic.digest);
  const read = vi.fn(() => undefined);
  const insert = vi.fn();
  await expect(new AnnualRuntimeRepository({ read, insert }).save(fabricated)).rejects.toThrow();
  expect(read).not.toHaveBeenCalled();
  expect(insert).not.toHaveBeenCalled();
});

it.each([false, true])("propagates synchronous/asynchronous port errors (async=%s) without false publication", async asynchronous => {
  const capsule = fixture();
  const map = new Map<string, string>();
  const memory = new MemoryFavorRecords(map);
  const failure = new Error("storage failure");
  const fail = () => { if (asynchronous) return Promise.reject(failure); throw failure; };
  const read = vi.fn<FavorRecords["read"]>(fail);
  const insert = vi.fn<FavorRecords["insert"]>(fail);
  const repo = new AnnualRuntimeRepository({ read, insert });
  await expect(repo.save(capsule)).rejects.toBe(failure);
  await expect(repo.load(capsule.digest)).rejects.toBe(failure);
  expect(insert).not.toHaveBeenCalled();
  read.mockImplementation(key => memory.read(key));
  await expect(repo.save(capsule)).rejects.toBe(failure);
  expect(map.size).toBe(0);
  expect(await repo.load(capsule.digest)).toBeUndefined();
  insert.mockImplementation((key, wire) => memory.insert(key, wire));
  expect(await repo.save(capsule)).toBe(capsule.digest);
  expect(await repo.save(capsule)).toBe(capsule.digest);
  expect(map.size).toBe(1);
});

it("supports concurrent identical inserts and propagates an immutable conflicting race winner", async () => {
  const capsule = fixture();
  const map = new Map<string, string>();
  const memory = new MemoryFavorRecords(map);
  const repo = new AnnualRuntimeRepository({ async read(key) { return memory.read(key); }, async insert(key, wire) { memory.insert(key, wire); } });
  expect(await Promise.all([repo.save(capsule), repo.save(capsule)])).toEqual([capsule.digest, capsule.digest]);
  expect(map.size).toBe(1);
  const raced = new Map<string, string>();
  const atomic = new MemoryFavorRecords(raced);
  const insert = vi.fn((key: string, wire: string) => { atomic.insert(key, "conflicting winner"); atomic.insert(key, wire); });
  const contender = new AnnualRuntimeRepository({ async read(key) { return atomic.read(key); }, insert });
  await expect(contender.save(capsule)).rejects.toThrow("Conflicting immutable record");
  expect(raced.get(capsule.digest)).toBe("conflicting winner");
  await expect(contender.save(capsule)).rejects.toThrow();
  await expect(contender.load(capsule.digest)).rejects.toThrow();
  expect(insert).toHaveBeenCalledTimes(1);
});

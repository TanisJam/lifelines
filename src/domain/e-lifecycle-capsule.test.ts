import { createHash } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { canonicalLifecycleData, createLifecycleGenesis, LIFECYCLE_GENESIS_VERSIONS } from "./e-lifecycle-genesis";
import { createLifecycleRuntime } from "./e-lifecycle-runtime";
import { initializeWorld } from "./world-origin";
import * as sourceModule from "./e-year-source";
import { admitLifecycleCapsule, createLifecycleCapsule, deserializeLifecycleCapsule,
  LIFECYCLE_CAPSULE_MANIFEST, serializeLifecycleCapsule, type LifecycleCapsule } from "./e-lifecycle-capsule";

type Mutable<T> = T extends object ? { -readonly [K in keyof T]: Mutable<T[K]> } : T;
type Evidence = Pick<LifecycleCapsule, "genesis" | "output">;
type Candidate = Mutable<LifecycleCapsule>;
const defaults = { seed: "baseline-1327-1", startYear: 1327, endYear: 1327, founderCount: 6,
  protagonist: { name: "Alice", sex: "f" } };
async function fixture(seed = defaults.seed, annual = true, name = defaults.protagonist.name): Promise<Evidence> {
  const initialization = { ...defaults, seed, protagonist: { name, sex: "random" } };
  const { world } = initializeWorld(initialization);
  const genesis = createLifecycleGenesis({ initialization, protagonistId: "protagonist",
    resources: Object.fromEntries(Object.keys(world.people).map(id => [id, { grain: 2, effort: 3, need: 1 }])) });
  const runtime = createLifecycleRuntime(genesis);
  if (annual) await runtime.advance(1327);
  return { genesis, output: runtime.snapshot() };
}
function define(target: object, key: PropertyKey, value: unknown): void {
  Object.defineProperty(target, key, { value, enumerable: true, configurable: true, writable: true });
}
function hash(manifest: unknown, encoded: string): string {
  return createHash("sha256").update(JSON.stringify([canonicalLifecycleData(manifest), encoded]), "utf8").digest("hex");
}
function rehash(candidate: Candidate): void {
  candidate.digest = hash(candidate.manifest, canonicalLifecycleData({ genesis: candidate.genesis, output: candidate.output }));
}
function encodedWire(encoded: string, manifest: unknown = LIFECYCLE_CAPSULE_MANIFEST): string {
  return JSON.stringify({ manifest, payload: encoded, digest: hash(manifest, encoded) });
}
function uncheckedWire(candidate: Candidate): string {
  return encodedWire(canonicalLifecycleData({ genesis: candidate.genesis, output: candidate.output }), candidate.manifest);
}
// Bounded diagnostics: never give a failed expectation an entire cumulative world.
function fidelity(actual: unknown, expected: unknown, path = "root"): void {
  if (expected === null || typeof expected !== "object") {
    if (!Object.is(actual, expected)) throw new Error(`Leaf disagreement at ${path}`);
    return;
  }
  if (actual === null || typeof actual !== "object" || Array.isArray(actual) !== Array.isArray(expected)) {
    throw new Error(`Container disagreement at ${path}`);
  }
  const a = actual as Record<string, unknown>;
  const e = expected as Record<string, unknown>;
  if (JSON.stringify(Object.keys(a).sort()) !== JSON.stringify(Object.keys(e).sort())) throw new Error(`Own keys disagree at ${path}`);
  for (const key of Object.keys(e)) fidelity(a[key], e[key], `${path}.${key}`);
}
function frozen(value: unknown, seen = new Set<object>()): void {
  if (value === null || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  expect(Object.isFrozen(value)).toBe(true);
  Object.values(value).forEach(item => frozen(item, seen));
}
function paths(value: unknown, leaf: unknown, path: string[] = []): string[][] {
  if (Object.is(value, leaf)) return [path];
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, item]) => paths(item, leaf, [...path, key]));
}
function parentAt(value: unknown, path: string[]): Record<string, unknown> {
  for (const key of path.slice(0, -1)) value = (value as Record<string, unknown>)[key];
  return value as Record<string, unknown>;
}
let evidence: Evidence;
let capsule: LifecycleCapsule;
let wire: string;
beforeAll(async () => {
  evidence = await fixture();
  capsule = await createLifecycleCapsule(evidence);
  wire = await serializeLifecycleCapsule(capsule);
});
afterEach(() => vi.restoreAllMocks());

describe("full trusted lifecycle capsule", () => {
  it("roundtrips full canon, restores generated order/aliases and returns frozen detached data", async () => {
    const candidate = structuredClone(capsule as unknown) as Candidate;
    const native = vi.spyOn(sourceModule, "createRulesYearSource");
    const admitted = await admitLifecycleCapsule(candidate);
    const serialized = await serializeLifecycleCapsule(candidate);
    const restored = await deserializeLifecycleCapsule(serialized);
    const created = await createLifecycleCapsule(evidence);
    expect(native).toHaveBeenCalledTimes(4); // every boundary replays, not a branded-object shortcut
    for (const result of [admitted, restored, created]) {
      fidelity(result, capsule);
      frozen(result);
      expect(result.output.owned.people).toBe(result.output.favors.people);
      expect(result.output.owned.events).toBe(result.output.favors.legacyEvents);
      expect(Object.keys(result.output.owned.people)).toEqual(Object.keys(evidence.output.owned.people));
      expect(result.output.owned.people).not.toBe(candidate.output.owned.people);
      expect(Object.keys(result.genesis.initial.people)).toEqual(result.genesis.initial.registryOrder);
      for (const entry of result.output.journal) {
        for (const state of [entry.postNative, entry.final]) {
          expect(state.owned.people).toBe(state.favors.people);
          expect(state.owned.events).toBe(state.favors.legacyEvents);
        }
      }
    }
    expect(serialized === wire).toBe(true);
    expect(Object.isFrozen(candidate.output.owned.people.protagonist.mind)).toBe(false);
    candidate.output.owned.people.protagonist.mind.stress = 999;
    expect(restored.output.owned.people.protagonist.mind.stress).not.toBe(999);
    const envelope = JSON.parse(serialized);
    expect(Object.keys(envelope)).toEqual(["manifest", "payload", "digest"]);
    expect(envelope.payload === canonicalLifecycleData(evidence)).toBe(true);
    expect(envelope.digest).toBe(hash(envelope.manifest, envelope.payload));
    expect(Object.keys(capsule)).toEqual(["manifest", "digest", "genesis", "output"]);
    expect(capsule.manifest).toEqual({ capsuleSchema: "lifecycle-capsule-lr2b-1", codec: "sorted-own-data-tuples-lr2b-1",
      ...LIFECYCLE_GENESIS_VERSIONS });
  });

  it.each([false, true])("admits zero-year/incomplete alive output (annual=%s)", async annual => {
    const input = await fixture(defaults.seed, annual);
    const result = await deserializeLifecycleCapsule(await serializeLifecycleCapsule(await createLifecycleCapsule(input)));
    fidelity(result.output, input.output);
    expect(result.output.status).toBe("incomplete");
    expect(result.output.journal.length).toBe(annual ? 1 : 0);
  });

  it("admits genuine unforced death without relabeling alive horizons as completion", async () => {
    const input = await fixture("baseline-1327-0");
    const result = await deserializeLifecycleCapsule(await serializeLifecycleCapsule(await createLifecycleCapsule(input)));
    expect(result.output.status).toBe("complete");
    expect(result.output.owned.people.protagonist.deathYear).toBe(result.output.frontier);
    fidelity(result.output, input.output);
  });

  it("retains UTF-16/NUL, own undefined, signed zero and ordered arrays exactly", async () => {
    const input = await fixture("verify-5", true, "__proto__\u0000\ud800x\udfff constructor");
    const result = await deserializeLifecycleCapsule(await serializeLifecycleCapsule(await createLifecycleCapsule(input)));
    fidelity(result, await createLifecycleCapsule(input));
    expect(result.output.owned.people.protagonist.name).toBe("__proto__\u0000\ud800x\udfff constructor");
    expect(paths(result.output, -0).length).toBeGreaterThan(0);
    expect(paths(result.output, undefined).length).toBeGreaterThan(0);
    const original = await createLifecycleCapsule(input);
    for (const leaf of [-0, undefined]) {
      const candidate = structuredClone(original as unknown) as Candidate;
      const path = paths(candidate.output, leaf)[0];
      if (leaf === undefined) Reflect.deleteProperty(parentAt(candidate.output, path), path.at(-1)!);
      else define(parentAt(candidate.output, path), path.at(-1)!, 0);
      rehash(candidate);
      await expect(admitLifecycleCapsule(candidate)).rejects.toThrow(/disagreement/);
    }
  });

  it.each(["create", "admit", "serialize"])("%s detaches all evidence before its first await", async kind => {
    const candidate = structuredClone(capsule as unknown) as Candidate;
    const real = sourceModule.createRulesYearSource;
    let changed = false;
    vi.spyOn(sourceModule, "createRulesYearSource").mockImplementation((...args) => {
      const source = real(...args);
      return { ...source, execute: async year => {
        const output = await source.execute(year);
        candidate.output.owned.people.protagonist.mind.stress = 999;
        candidate.output.journal[0].economics.resources.length = 0;
        candidate.genesis.initial.people.protagonist.name = "mutated during await";
        changed = true;
        return output;
      } };
    });
    if (kind === "serialize") expect(await serializeLifecycleCapsule(candidate) === wire).toBe(true);
    else fidelity(await (kind === "admit" ? admitLifecycleCapsule(candidate)
      : createLifecycleCapsule({ genesis: candidate.genesis, output: candidate.output })), capsule);
    expect(changed).toBe(true);
  });
});

describe("digest is not authority", () => {
  const mutations: [string, (c: Candidate) => void][] = [
    ["full Mind", c => { c.output.journal[0].postNative.owned.people.protagonist.mind.stress++; }],
    ["ordered life log", c => { c.output.journal[0].postNative.owned.events.reverse(); }],
    ["native decision", c => define(c.output.journal[0].postNative.owned.decisions[0], "chosen", "forged")],
    ["native counter", c => { c.output.journal[0].postNative.owned.counters.decisionCalls++; }],
    ["resource plan", c => { c.output.journal[0].economics.resources.pop(); }],
    ["slot evidence", c => define(c.output.journal[0].economics, "slots", [{ creditor: "p001", slot: 0, request: null }])],
    ["economic authority", c => define(c.output.journal[0].economics.entries[0], "authority", { source: "human" })],
    ["final ledger", c => { c.output.favors.grain.protagonist++; }],
    ["final unknown", c => define(c.output.owned.people.protagonist.mind, "unknown", undefined)],
    ["annual unknown", c => define(c.output.journal[0], "unknown", undefined)],
    ["genesis Mind", c => { c.genesis.initial.people.protagonist.mind.stress++; }],
  ];
  it.each(mutations)("rejects fully rehashed %s at object and wire boundaries", async (_name, mutate) => {
    const candidate = structuredClone(capsule as unknown) as Candidate;
    mutate(candidate);
    const genesisPayload = { ...candidate.genesis };
    Reflect.deleteProperty(genesisPayload, "digest");
    candidate.genesis.digest = createHash("sha256").update(canonicalLifecycleData(genesisPayload), "utf8").digest("hex");
    rehash(candidate);
    await expect(admitLifecycleCapsule(candidate)).rejects.toThrow(/disagreement/);
    await expect(deserializeLifecycleCapsule(uncheckedWire(candidate))).rejects.toThrow(/disagreement/);
  });

  it.each(["capsuleSchema", "codec", "schema", "runtime", "rulesYear", "annualPolicy", "annualComposition", "origin", "extra"])(
    "rejects unsupported manifest %s even with fresh digest", async key => {
      const candidate = structuredClone(capsule as unknown) as Candidate;
      define(candidate.manifest, key, "unknown");
      rehash(candidate);
      await expect(admitLifecycleCapsule(candidate)).rejects.toThrow(/manifest/);
      await expect(deserializeLifecycleCapsule(uncheckedWire(candidate))).rejects.toThrow(/manifest/);
    });

  it.each(["uppercase", "wrong", "missing", "top extension", "nested tuple extension"])("rejects %s", async kind => {
    const candidate = structuredClone(capsule as unknown) as Candidate;
    if (kind === "uppercase") candidate.digest = candidate.digest.toUpperCase();
    if (kind === "wrong") candidate.digest = "0".repeat(64);
    if (kind === "missing") Reflect.deleteProperty(candidate, "digest");
    if (kind === "top extension") define(candidate, "authority", undefined);
    if (kind === "nested tuple extension") define(candidate.manifest.origin, "unknown", undefined);
    await expect(admitLifecycleCapsule(candidate)).rejects.toThrow();
  });

  it("decodes hostile own keys safely but never admits invented nested data", async () => {
    const candidate = structuredClone(capsule as unknown) as Candidate;
    const extension = Object.create(null);
    for (const key of ["__proto__", "constructor", "prototype", "\ud800\u0000"]) define(extension, key, [undefined, -0]);
    define(candidate.output.owned.people.protagonist.mind, "extension", extension);
    rehash(candidate);
    await expect(deserializeLifecycleCapsule(uncheckedWire(candidate))).rejects.toThrow(/disagreement/);
    expect(Object.hasOwn(Object.prototype, "extension")).toBe(false);
  });
});

describe("descriptor-first whole graph", () => {
  const kinds = ["getter", "late constructor", "toJSON", "symbol", "hidden", "function", "bigint", "nonplain",
    "cycle", "sparse", "extended array", "array getter", "nonfinite", "top getter"];
  it.each(kinds)("rejects %s without hooks, cloning, hashing or native execution", async kind => {
    const candidate = structuredClone(capsule as unknown) as Candidate;
    let hooks = 0;
    const hook = () => { hooks++; throw new Error("Executed hook"); };
    const target = candidate.output.journal[0].final.owned.people.protagonist.mind;
    if (kind === "getter") Object.defineProperty(target, "stress", { enumerable: true, get: hook });
    if (kind === "late constructor") Object.defineProperty(target, "constructor", { enumerable: true, get: hook });
    if (kind === "top getter") Object.defineProperty(candidate, "manifest", { enumerable: true, get: hook });
    if (kind === "toJSON" || kind === "function") define(target, kind, hook);
    if (kind === "symbol") define(target, Symbol("extension"), 1);
    if (kind === "hidden") Object.defineProperty(target, "extension", { value: 1 });
    if (kind === "bigint") define(target, "extension", BigInt(1));
    if (kind === "nonplain") define(target, "extension", new Date(0));
    if (kind === "cycle") define(target, "extension", candidate);
    if (kind === "sparse") define(target, "extension", new Array(2));
    if (kind === "extended array") define(candidate.output.journal, "extension", 1);
    if (kind === "array getter") Object.defineProperty(candidate.output.journal, "0", { enumerable: true, get: hook });
    if (kind === "nonfinite") define(target, "extension", Infinity);
    candidate.genesis.digest = "invalid early digest";
    const native = vi.spyOn(sourceModule, "createRulesYearSource");
    const clone = vi.spyOn(globalThis, "structuredClone");
    for (const operation of [admitLifecycleCapsule, serializeLifecycleCapsule]) await expect(operation(candidate)).rejects.toThrow();
    await expect(createLifecycleCapsule(kind === "top getter" ? candidate
      : { genesis: candidate.genesis, output: candidate.output })).rejects.toThrow();
    expect(hooks).toBe(0);
    expect(native).not.toHaveBeenCalled();
    expect(clone).not.toHaveBeenCalled();
  });
});

describe("strict inverse and exact canonical wire", () => {
  const malformed = [
    '["unsupported",[]]', '["undefined",0]', '["null",0]', '["string",1]', '["boolean","true"]',
    '["number",1]', '["number","NaN"]', '["number","Infinity"]', '["number","01"]', '["number","1.0"]',
    '["number","1e0"]', '["number","-0.0"]', '["number",""]', '["array",{}]', '["array",[],0]',
    '["record",[["x",["null"]],["x",["null"]]]]', '["record",[[1,["null"]]]]', '["record",[["x"]]]',
    '["record",[["z",["null"]],["a",["null"]]]]', '[ "null" ]', '["string","\\u0061"]',
  ];
  it.each(malformed)("rejects malformed/noncanonical tagged payload %s", async encoded => {
    await expect(deserializeLifecycleCapsule(encodedWire(encoded))).rejects.toThrow();
  });

  it.each(["whitespace", "duplicate", "escape", "field order", "manifest order", "extra", "raw payload", "duplicate nested manifest"])(
    "rejects outer %s", async kind => {
      let alternate = wire;
      const envelope = JSON.parse(wire);
      if (kind === "whitespace") alternate = ` ${wire}`;
      if (kind === "duplicate") alternate = wire.replace('{"manifest":', `{"digest":${JSON.stringify(capsule.digest)},"manifest":`);
      if (kind === "escape") alternate = wire.replace("capsuleSchema", "\\u0063apsuleSchema");
      if (kind === "field order") alternate = JSON.stringify({ digest: envelope.digest, manifest: envelope.manifest, payload: envelope.payload });
      if (kind === "manifest order") alternate = JSON.stringify({ ...envelope, manifest: Object.fromEntries(Object.entries(envelope.manifest).reverse()) });
      if (kind === "extra") alternate = JSON.stringify({ ...envelope, extra: null });
      if (kind === "raw payload") alternate = JSON.stringify({ ...envelope, payload: JSON.parse(envelope.payload) });
      if (kind === "duplicate nested manifest") alternate = wire.replace('"codec":', `"codec":${JSON.stringify(capsule.manifest.codec)},"codec":`);
      expect(alternate !== wire).toBe(true);
      await expect(deserializeLifecycleCapsule(alternate)).rejects.toThrow();
    });

  it.each([null, {}, [], 1, undefined])("rejects non-string wire %s", async input => {
    await expect(deserializeLifecycleCapsule(input)).rejects.toThrow(/wire string/);
  });

  it("rejects root extensions/missing fields for creation and decoded payload", async () => {
    await expect(createLifecycleCapsule({ ...evidence, extra: undefined })).rejects.toThrow();
    await expect(createLifecycleCapsule({ genesis: evidence.genesis })).rejects.toThrow();
    await expect(deserializeLifecycleCapsule(encodedWire(canonicalLifecycleData({ ...evidence, extra: undefined })))).rejects.toThrow();
  });
});

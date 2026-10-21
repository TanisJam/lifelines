import { createHash } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { canonicalLifecycleData, createLifecycleGenesis, LIFECYCLE_GENESIS_VERSIONS } from "./e-lifecycle-genesis";
import { createLifecycleRuntime } from "./e-lifecycle-runtime";
import { deserializeCompactLifecycleDag, serializeCompactLifecycleDag } from "./e-lifecycle-dag";
import { initializeWorld } from "./world-origin";
import * as sourceModule from "./e-year-source";
import { admitLifecycleCapsule, admitLifecycleCompactCapsule, createLifecycleCapsule,
  createLifecycleCompactCapsule, deserializeLifecycleCapsule, deserializeLifecycleCompactCapsule,
  LIFECYCLE_CAPSULE_MANIFEST, LIFECYCLE_COMPACT_CAPSULE_MANIFEST, serializeLifecycleCapsule,
  serializeLifecycleCompactCapsule, type LifecycleCapsule, type LifecycleCompactCapsule } from "./e-lifecycle-capsule";

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

describe("streamed digest framing", () => {
  it.each(["create", "admit", "serialize", "deserialize"])("%s hashes the old tuple bytes without stringifying the whole frame", async kind => {
    const input = await fixture("verify-5", false, '\u0000\b\f\n\r\t"\\ / \u2028\u2029\ud800x\udfff');
    const original = await createLifecycleCapsule(input);
    const encoded = canonicalLifecycleData(input);
    const expectedDigest = hash(original.manifest, encoded);
    const expectedWire = encodedWire(encoded);
    const stringify = vi.spyOn(JSON, "stringify"); // native call-through, no crypto substitution
    const result = kind === "create" ? await createLifecycleCapsule(input)
      : kind === "admit" ? await admitLifecycleCapsule(original)
      : kind === "serialize" ? await serializeLifecycleCapsule(original)
      : await deserializeLifecycleCapsule(expectedWire);
    const wholeFrames = stringify.mock.calls.filter(([value]) => Array.isArray(value)
      && value.length === 2 && typeof value[0] === "string" && value[1] === encoded);
    expect(wholeFrames.length).toBe(0);
    if (typeof result === "string") expect(result === expectedWire).toBe(true);
    else {
      expect(result.digest).toBe(expectedDigest);
      fidelity(result, original);
    }
  });

  it("keeps a real canonical payload's boundary astral pair together and retains native escaping", async () => {
    const suffix = '\ud83d\ude80\ud800x\udfff\u0000\b\f\n\r\t"\\ / \u2028\u2029';
    const prefix = "RH1-name-";
    const calibration = canonicalLifecycleData(await fixture("verify-5", false, prefix + suffix));
    const firstPair = calibration.indexOf(suffix.slice(0, 2));
    expect(firstPair).toBeGreaterThan(0);
    // Name has no length bound in requestedOptions. Padding aligns bytes, not biology.
    const padding = (32767 - firstPair % 32768 + 32768) % 32768;
    const name = prefix + "a".repeat(padding) + suffix;
    const input = await fixture("verify-5", false, name);
    const encoded = canonicalLifecycleData(input);
    expect(encoded.slice(32767, 32769)).toBe(suffix.slice(0, 2));
    expect(encoded.indexOf(suffix.slice(0, 2))).toBe(32767);
    const expectedDigest = hash(LIFECYCLE_CAPSULE_MANIFEST, encoded);
    const expectedWire = encodedWire(encoded);
    const stringify = vi.spyOn(JSON, "stringify");
    const original = await createLifecycleCapsule(input);
    expect(original.digest).toBe(expectedDigest);
    const chunks = stringify.mock.calls.map(([value]) => value).filter((value): value is string =>
      typeof value === "string" && value.startsWith(encoded.slice(0, 80)));
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.every(chunk => chunk.length <= 32768 && !chunk.endsWith("\ud83d"))).toBe(true);
    expect(stringify.mock.calls.some(([value]) => typeof value === "string"
      && value.startsWith(suffix.slice(0, 2)) && value.length <= 32768)).toBe(true);
    stringify.mockRestore();
    expect(await serializeLifecycleCapsule(original) === expectedWire).toBe(true);
    const restored = await deserializeLifecycleCapsule(expectedWire);
    fidelity(restored, original);
    expect(restored.output.owned.people.protagonist.name).toBe(name);
  });
});

describe("full trusted lifecycle capsule", () => {
  it.each(["create", "admit"])("%s avoids outer capture but retains essential replay capture", async kind => {
    const input = structuredClone(kind === "create" ? evidence : capsule);
    const clone = vi.spyOn(globalThis, "structuredClone"); // call through, never replace ownership
    const result = await (kind === "create" ? createLifecycleCapsule(input) : admitLifecycleCapsule(input));
    const envelopes = clone.mock.calls.map(([value]) => value).filter(value => {
      if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
      const keys = Object.keys(value).sort().join(",");
      return keys === "genesis,output" || keys === "digest,genesis,manifest,output";
    });
    expect(clone.mock.calls.some(([value]) => value === input)).toBe(false);
    expect(envelopes).toHaveLength(1);
    expect(Object.keys(envelopes[0] as object).sort()).toEqual(["genesis", "output"]);
    expect((envelopes[0] as Evidence).output).toBe(input.output);
    fidelity(result, capsule);
    frozen(result);
  });

  it.each(["create", "admit", "serialize"])("%s isolates root replacements immediately after returning its promise", async kind => {
    const candidate = structuredClone(capsule as unknown) as Candidate;
    const originalGenesis = candidate.genesis;
    const input = { genesis: candidate.genesis, output: candidate.output };
    const pending = kind === "create" ? createLifecycleCapsule(input)
      : kind === "admit" ? admitLifecycleCapsule(candidate) : serializeLifecycleCapsule(candidate);
    candidate.genesis.initial.people.protagonist.name = "mutated after return";
    candidate.output.owned.people.protagonist.mind.stress = 999;
    candidate.output.journal[0].economics.resources.length = 0;
    define(candidate.manifest, "codec", "mutated after return");
    candidate.digest = "0".repeat(64);
    for (const root of [input, candidate]) {
      define(root, "genesis", null);
      define(root, "output", null);
    }
    define(candidate, "manifest", null);
    const result = await pending;
    if (typeof result === "string") expect(result === wire).toBe(true);
    else {
      fidelity(result, capsule);
      frozen(result);
      expect(result.genesis).not.toBe(originalGenesis);
      expect(result.output.owned.people).toBe(result.output.favors.people);
      expect(Object.keys(result.genesis.initial.people)).toEqual(capsule.genesis.initial.registryOrder);
      expect(await serializeLifecycleCapsule(result) === wire).toBe(true);
    }
  });

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
        expect(entry.final.owned.people).toBe(entry.final.favors.people);
        expect(entry.final.owned.events).toBe(entry.final.favors.legacyEvents);
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
  malformed.push(
    '', 'null', '{}', '[]', '["null"', '["null"]x', '["null"] ["null"]',
    '["null",]', '["string"]', '["boolean",true,false]', '["boolean",truex]',
    '["boolean",null]', '["boolean",0]', '["number","0x10"]', '["number",".1"]',
    '["number","1e21"]', '["number","+1"]', '["number"," 1"]', '["number","1 "]',
    '["number","-Infinity"]', '["number","nan"]', '["number","1e309"]',
    '["array"]', '["array",[null]]', '["array",[[]]]', '["array",[["null"],]]',
    '["array",[["null"]["null"]]]', '["array",[["null"]]', '["array",[,["null"]]]',
    '["record",{}]', '["record",[["x",["null"],0]]]', '["record",[["x"["null"]]]]',
    '["record",[["x",["null"]]["y",["null"]]]]', '["record",[["x",["null"]],]]',
    '["record",[["__proto__",["null"]],["__proto__",["null"]]]]',
    '["record",[["0",["null"]],["0",["null"]]]]',
    '["record",[["10",["null"]],["2",["null"]],["1",["null"]]]]',
    '["string","raw\ncontrol"]', '["string","raw\u0000control"]',
    '["string","\\x00"]', '["string","\\u12"]', '["string","\\uZZZZ"]',
    '["string","\\q"]', '["string","unterminated', '["string","dangling\\',
    '["string","escaped\\"]', '["string","ok",0]', '["null"]\n',
  );
  it.each(malformed)("rejects malformed/noncanonical tagged payload %s", async encoded => {
    await expect(deserializeLifecycleCapsule(encodedWire(encoded))).rejects.toThrow();
  });

  it("rejects every truncated boundary of a nested canonical payload", async () => {
    const encoded = canonicalLifecycleData({ a: [undefined, null, true, -0, 'quote"\\'], b: {} });
    for (let end = 0; end < encoded.length; end++) {
      await expect(deserializeLifecycleCapsule(encodedWire(encoded.slice(0, end)))).rejects.toThrow();
    }
  });

  it.each([
    'even\\\\" odd\\" end', 'astral \ud83d\ude80 and lone \ud800 / \udfff',
    '\u0000\b\f\n\r\t"\\ / \u2028\u2029',
  ])("preserves quoted UTF-16 data through full semantic regeneration %s", async name => {
    const input = await fixture("verify-5", false, name);
    const original = await createLifecycleCapsule(input);
    const originalWire = await serializeLifecycleCapsule(original);
    const restored = await deserializeLifecycleCapsule(originalWire);
    fidelity(restored, original);
    frozen(restored);
    expect(restored.output.owned.people.protagonist.name).toBe(name);
    expect(await serializeLifecycleCapsule(restored) === originalWire).toBe(true);
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

/** The compact capsule's own domain-separated digest frame, reimplemented here
 * so a test can attest an INVALID table and prove integrity is not authority. */
function compactHash(manifest: unknown, table: string): string {
  const hasher = createHash("sha256");
  hasher.update(`["lifecycle-compact-capsule-cb1-1",${JSON.stringify(canonicalLifecycleData(manifest))},"`, "utf8");
  hasher.update(JSON.stringify(table).slice(1, -1), "utf8");
  hasher.update('\"]', "utf8");
  return hasher.digest("hex");
}

describe("compact lifecycle capsule (CA1b)", () => {
  let compact: LifecycleCompactCapsule;
  let compactWire: string;
  beforeAll(async () => {
    compact = await createLifecycleCompactCapsule(evidence);
    compactWire = await serializeLifecycleCompactCapsule(compact);
  });

  it("declares its own recognized manifest and never reuses the legacy one", () => {
    expect(Object.isFrozen(LIFECYCLE_COMPACT_CAPSULE_MANIFEST)).toBe(true);
    expect(LIFECYCLE_COMPACT_CAPSULE_MANIFEST.capsuleSchema).toBe("lifecycle-capsule-compact-cb1-1");
    expect(LIFECYCLE_COMPACT_CAPSULE_MANIFEST.codec).toBe("canonical-dag-dictionary-cb1-1");
    expect(LIFECYCLE_COMPACT_CAPSULE_MANIFEST.capsuleSchema).not.toBe(LIFECYCLE_CAPSULE_MANIFEST.capsuleSchema);
    expect(LIFECYCLE_COMPACT_CAPSULE_MANIFEST.codec).not.toBe(LIFECYCLE_CAPSULE_MANIFEST.codec);
    for (const key of Object.keys(LIFECYCLE_GENESIS_VERSIONS) as (keyof typeof LIFECYCLE_GENESIS_VERSIONS)[]) {
      expect(LIFECYCLE_COMPACT_CAPSULE_MANIFEST[key]).toEqual(LIFECYCLE_GENESIS_VERSIONS[key]);
    }
  });

  it("round-trips through its own wire and fully regenerates on cold admission", async () => {
    expect(compact.manifest).toEqual(LIFECYCLE_COMPACT_CAPSULE_MANIFEST);
    fidelity(compact.genesis, evidence.genesis);
    const restored = await deserializeLifecycleCompactCapsule(compactWire);
    fidelity(restored, compact);
    frozen(restored);
    expect(await serializeLifecycleCompactCapsule(restored)).toBe(compactWire);
    expect(await serializeLifecycleCompactCapsule(compact)).toBe(compactWire);
  });

  it("stores the same evidence in materially fewer bytes than the legacy wire", () => {
    const legacyBytes = Buffer.byteLength(wire, "utf8");
    const compactBytes = Buffer.byteLength(compactWire, "utf8");
    expect(compactBytes).toBeGreaterThan(0);
    expect(compactBytes).toBeLessThan(legacyBytes);
  });

  it("leaves the legacy capsule manifest, digest and wire untouched", async () => {
    expect(await serializeLifecycleCapsule(capsule)).toBe(wire);
    expect(capsule.digest).toBe(hash(capsule.manifest, canonicalLifecycleData(evidence)));
  });

  it("rejects a correctly rehashed table that is not a valid closed dictionary", async () => {
    // Digest is integrity, never execution authority: a matching digest must not
    // buy admission for a self-referential or forward-referencing table.
    for (const nodes of [[["z"], ["a", [1]]], [["a", [2]], ["n", "1"]], [["a", [0]]]]) {
      const table = JSON.stringify({ root: 0, nodes });
      const envelope = JSON.stringify({ manifest: LIFECYCLE_COMPACT_CAPSULE_MANIFEST, table,
        digest: compactHash(LIFECYCLE_COMPACT_CAPSULE_MANIFEST, table) });
      await expect(deserializeLifecycleCompactCapsule(envelope)).rejects.toThrow();
    }
  });

  it("rejects a mutated table or digest", async () => {
    const envelope = JSON.parse(compactWire) as { manifest: unknown; table: string; digest: string };
    // Replace the first definition with a different valid one: the bytes differ,
    // so the retained digest must disagree regardless of which node is the root.
    const parsedTable = JSON.parse(envelope.table) as { root: number; nodes: unknown[] };
    const tamperedTable = JSON.stringify({ manifest: envelope.manifest, digest: envelope.digest,
      table: JSON.stringify({ ...parsedTable, nodes: [["b", true], ...parsedTable.nodes.slice(1)] }) });
    await expect(deserializeLifecycleCompactCapsule(tamperedTable)).rejects.toThrow();
    const tamperedDigest = JSON.stringify({ manifest: envelope.manifest, table: envelope.table,
      digest: `${envelope.digest.slice(0, -1)}${envelope.digest.endsWith("0") ? "1" : "0"}` });
    await expect(deserializeLifecycleCompactCapsule(tamperedDigest)).rejects.toThrow();
  });

  it("still replays when a matching digest covers a structurally valid forgery", async () => {
    // Digest is integrity, never authority: a self-consistent table and digest
    // that decode cleanly must still fail current-authority replay.
    const envelope = JSON.parse(compactWire) as { table: string };
    const decoded = deserializeCompactLifecycleDag(envelope.table) as Record<string, unknown>;
    const table = serializeCompactLifecycleDag({ genesis: decoded.genesis, output: { status: "complete" } });
    const forged = JSON.stringify({ manifest: LIFECYCLE_COMPACT_CAPSULE_MANIFEST, table,
      digest: compactHash(LIFECYCLE_COMPACT_CAPSULE_MANIFEST, table) });
    await expect(deserializeLifecycleCompactCapsule(forged)).rejects.toThrow();
  });

  it("never migrates implicitly between the two capsule formats", async () => {
    await expect(deserializeLifecycleCompactCapsule(wire)).rejects.toThrow();
    await expect(deserializeLifecycleCapsule(compactWire)).rejects.toThrow();
    await expect(admitLifecycleCompactCapsule(capsule)).rejects.toThrow(/manifest/);
    await expect(admitLifecycleCapsule(compact)).rejects.toThrow(/manifest/);
  });

  it.each(["whitespace", "field order", "extra", "raw table", "manifest order"])(
    "rejects outer %s", async kind => {
      const envelope = JSON.parse(compactWire) as Record<string, unknown>;
      let alternate = compactWire;
      if (kind === "whitespace") alternate = ` ${compactWire}`;
      if (kind === "field order") alternate = JSON.stringify({ digest: envelope.digest, manifest: envelope.manifest, table: envelope.table });
      if (kind === "extra") alternate = JSON.stringify({ ...envelope, extra: null });
      if (kind === "raw table") alternate = JSON.stringify({ ...envelope, table: JSON.parse(envelope.table as string) });
      if (kind === "manifest order") alternate = JSON.stringify({ ...envelope, manifest: Object.fromEntries(Object.entries(envelope.manifest as object).reverse()) });
      expect(alternate !== compactWire).toBe(true);
      await expect(deserializeLifecycleCompactCapsule(alternate)).rejects.toThrow();
    });

  it.each([null, {}, [], 1, undefined])("rejects non-string wire %s", async input => {
    await expect(deserializeLifecycleCompactCapsule(input)).rejects.toThrow(/wire string/);
  });

  it.each(["{", "null", "[]", "1", '"x"'])("rejects malformed or non-record wire %s", async input => {
    await expect(deserializeLifecycleCompactCapsule(input)).rejects.toThrow();
  });

  it("rejects root extensions and missing fields for creation and admission", async () => {
    await expect(createLifecycleCompactCapsule({ genesis: evidence.genesis })).rejects.toThrow();
    await expect(admitLifecycleCompactCapsule({ manifest: compact.manifest, digest: compact.digest,
      genesis: compact.genesis })).rejects.toThrow();
  });
});

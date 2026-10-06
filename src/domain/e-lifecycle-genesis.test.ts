import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { initializeWorld, WORLD_ORIGIN_VERSIONS } from "./world-origin";
import { createLifecycleGenesis, admitLifecycleGenesis, instantiateLifecycleGenesis, canonicalLifecycleData, LIFECYCLE_GENESIS_VERSIONS, type LifecycleGenesis } from "./e-lifecycle-genesis";
import { createRulesYearSource, RULES_YEAR_SOURCE_VERSION } from "./e-year-source";
import { createFavorExecutor } from "./e-favor-executor";
import { initializationJson } from "./world-initialization";
import { ANNUAL_FAVOR_POLICY_VERSION } from "./e-annual-policy";
import { ANNUAL_COMPOSITION_POLICY_VERSION } from "./e-annual-composition";
import type { GenerateWorldOptions } from "./worldgen";

type Mutable<T> = T extends object ? { -readonly [K in keyof T]: Mutable<T[K]> } : T;
type Candidate = Mutable<LifecycleGenesis>;
const initialization: GenerateWorldOptions = { seed: "lifecycle-genesis", startYear: 1327, endYear: 1327, founderCount: 6, protagonist: { name: "Alice", sex: "random" } };
function fixture(options: GenerateWorldOptions = initialization) {
  const { world } = initializeWorld(options);
  const resources = Object.fromEntries(Object.keys(world.people).map(id => [id, { grain: 2, effort: 3, need: 1 }]));
  return { initialization: options, protagonistId: "protagonist", resources };
}
function frame(): Candidate { return structuredClone(createLifecycleGenesis(fixture()) as unknown) as Candidate; }

// Independent specification of the private digest grammar, so attacks can pass
// integrity and exercise semantic admission rather than only stale-hash rejection.
function tagged(value: unknown): unknown {
  if (value === undefined) return ["undefined"];
  if (value === null) return ["null"];
  if (typeof value === "number") return ["number", Object.is(value, -0) ? "-0" : String(value)];
  if (typeof value === "string" || typeof value === "boolean") return [typeof value, value];
  if (Array.isArray(value)) return ["array", value.map(tagged)];
  return ["record", Object.keys(value as object).sort().map(key => [key, tagged((value as Record<string, unknown>)[key])])];
}
function rehash(candidate: Candidate): Candidate {
  const payload = { ...candidate };
  Reflect.deleteProperty(payload, "digest");
  candidate.digest = createHash("sha256").update(JSON.stringify(tagged(payload)), "utf8").digest("hex");
  return candidate;
}
function rehashOrigin(candidate: Candidate): void {
  const payload = { ...candidate.origin };
  Reflect.deleteProperty(payload, "digest");
  candidate.origin.digest = createHash("sha256").update(initializationJson(payload), "utf8").digest("hex");
}
function define(target: object, key: PropertyKey, value: unknown): void {
  Object.defineProperty(target, key, { value, enumerable: true, configurable: true, writable: true });
}
/** Compare own presence and Object.is leaves, not JSON's lossy normalization. */
function fidelity(actual: unknown, expected: unknown): void {
  if (expected === null || typeof expected !== "object") {
    expect(Object.is(actual, expected)).toBe(true);
    return;
  }
  expect(actual).not.toBeNull();
  expect(typeof actual).toBe("object");
  expect(Array.isArray(actual)).toBe(Array.isArray(expected));
  const a = actual as Record<string, unknown>;
  const e = expected as Record<string, unknown>;
  expect(Object.keys(a).sort()).toEqual(Object.keys(e).sort());
  for (const key of Object.keys(e)) fidelity(a[key], e[key]);
}
function fullyFrozen(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  expect(Object.isFrozen(value)).toBe(true);
  Object.values(value).forEach(fullyFrozen);
}

describe("closed lifecycle genesis", () => {
  it("reconstructs complete E1 state into independent owned registries and separate ledgers", () => {
    const genesis = createLifecycleGenesis(fixture());
    const admitted = admitLifecycleGenesis(structuredClone(genesis));
    const first = instantiateLifecycleGenesis(admitted);
    const second = instantiateLifecycleGenesis(admitted);
    const expected = initializeWorld(initialization).world;
    fidelity(first.owned.people, expected.people);
    fidelity(first.owned.events, expected.events);
    fidelity(first.config, expected.config);
    expect(first.protagonistId).toBe("protagonist");
    expect(first.owned.decisions).toEqual([]);
    expect(first.owned.counters).toEqual({ decisionCalls: 0 });
    expect(first.favors.people).toBe(first.owned.people);
    expect(first.favors.legacyEvents).toBe(first.owned.events);
    expect(first.owned.people).not.toBe(second.owned.people);
    expect(first.owned.events).not.toBe(second.owned.events);
    expect(first.owned.decisions).not.toBe(second.owned.decisions);
    expect(first.owned.counters).not.toBe(second.owned.counters);
    expect(first.favors.grain).not.toBe(second.favors.grain);
    for (const key of ["assistance", "need", "events", "obligations", "ties", "appraisals"] as const) {
      expect(first.favors[key]).not.toBe(second.favors[key]);
    }
    for (const id of Object.keys(expected.people)) {
      expect(first.owned.people[id].id).toBe(id);
      expect(first.owned.people[id].mind).not.toBe(second.owned.people[id].mind);
      expect(first.favors.grain[id]).toBe(2);
      expect(first.favors.assistance[id]).toBe(3);
      expect(first.favors.need[id]).toBe(1);
    }
    expect(Object.keys(first.owned.people)).toEqual(genesis.initial.registryOrder);
    first.owned.people.protagonist.mind.stress = 99;
    define(first.owned.events[0].payload, "changed", true);
    first.owned.counters.decisionCalls++;
    define(first.favors.grain, "protagonist", 0);
    fidelity(second.owned.people, expected.people);
    fidelity(second.owned.events, expected.events);
    fidelity(genesis.initial.people, expected.people);
    expect(second.owned.counters.decisionCalls).toBe(0);
    expect(second.favors.grain.protagonist).toBe(2);
  });

  it("pins the new closed tuple and trusted source independently of old E2 capsules", () => {
    const genesis = createLifecycleGenesis(fixture());
    expect(genesis.versions).toEqual({
      schema: "lifecycle-genesis-lr1a-1", runtime: "native-rules-lifecycle-lr1-1",
      rulesYear: RULES_YEAR_SOURCE_VERSION, annualPolicy: ANNUAL_FAVOR_POLICY_VERSION,
      annualComposition: ANNUAL_COMPOSITION_POLICY_VERSION, origin: WORLD_ORIGIN_VERSIONS,
    });
    expect(genesis.source).toEqual({ version: RULES_YEAR_SOURCE_VERSION });
    expect(genesis.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(rehash(structuredClone(genesis as unknown) as Candidate).digest).toBe(genesis.digest);
    expect(Object.keys(instantiateLifecycleGenesis(genesis)).sort()).toEqual(["config", "favors", "genesis", "owned", "protagonistId"]);
  });

  it.each(["f", "m", "random"] as const)("retains origin semantic parity for %s", sex => {
    const options = { ...initialization, protagonist: { name: "\u0000<literal>\ud800", sex }, townName: "__proto__" };
    const { world, origin } = initializeWorld(options);
    const genesis = createLifecycleGenesis(fixture(options));
    fidelity(genesis.origin, origin);
    fidelity(genesis.initial.people, world.people);
    fidelity(genesis.initial.events, world.events);
    fidelity(admitLifecycleGenesis(genesis), genesis);
  });

  it("requires an explicit own protagonist identity, not an inherited lookup", () => {
    for (const protagonistId of ["", "constructor", "__proto__", "toString", "\ud800", undefined, 1]) {
      expect(() => createLifecycleGenesis({ ...fixture(), protagonistId })).toThrow();
    }
    const input = fixture({ seed: "founder-subject", founderCount: 6 });
    input.protagonistId = Object.keys(input.resources)[0];
    expect(instantiateLifecycleGenesis(createLifecycleGenesis(input)).protagonistId).toBe(input.protagonistId);
  });

  it("does not alias or freeze any caller data on success or rejection", () => {
    const input = fixture();
    const before = structuredClone(input);
    const genesis = createLifecycleGenesis(input);
    fidelity(input, before);
    expect(Object.isFrozen(input)).toBe(false);
    expect(Object.isFrozen(input.initialization.protagonist)).toBe(false);
    fullyFrozen(genesis);
    const candidate = structuredClone(genesis as unknown) as Candidate;
    const admitted = admitLifecycleGenesis(candidate);
    const instance = instantiateLifecycleGenesis(candidate);
    fullyFrozen(admitted);
    fullyFrozen(instance.genesis);
    fullyFrozen(instance.config);
    expect(Object.isFrozen(instance.owned.people)).toBe(false);
    expect(Object.isFrozen(candidate.initial.people.protagonist.mind)).toBe(false);
    candidate.initial.people.protagonist.mind.stress = 97;
    input.resources.protagonist.grain = 100;
    expect(admitted.initial.people.protagonist.mind.stress).not.toBe(97);
    expect(instance.owned.people.protagonist.mind.stress).not.toBe(97);
    expect(genesis.resources.protagonist.grain).toBe(2);
    const badBefore = structuredClone(candidate);
    expect(() => instantiateLifecycleGenesis(candidate)).toThrow();
    fidelity(candidate, badBefore);
  });

  it("supports null records and record key reordering without losing hostile own keys", () => {
    const candidate = frame();
    const people = Object.create(null);
    for (const id of [...candidate.initial.registryOrder].reverse()) define(people, id, candidate.initial.people[id]);
    candidate.initial.people = people;
    const resources = Object.create(null);
    for (const id of Object.keys(candidate.resources).reverse()) define(resources, id, candidate.resources[id]);
    candidate.resources = resources;
    expect(admitLifecycleGenesis(candidate).digest).toBe(candidate.digest);
    const hostile = frame();
    define(hostile.initial.people, "__proto__", hostile.initial.people.protagonist);
    expect(Object.hasOwn(hostile.initial.people, "__proto__")).toBe(true);
    expect(() => admitLifecycleGenesis(rehash(hostile))).toThrow(/generation disagreement/);
    define(candidate.resources, "__proto__", { grain: 0, effort: 0, need: 0 });
    expect(() => admitLifecycleGenesis(rehash(candidate))).toThrow(/fields/);
  });

  it("shares the same actual people/logs with native source and favor executor beyond origin endYear", async () => {
    const instance = instantiateLifecycleGenesis(createLifecycleGenesis(fixture()));
    const { owned, favors, config, genesis, protagonistId } = instance;
    const registry = owned.people;
    const log = owned.events;
    const source = createRulesYearSource(genesis.source, config, owned, protagonistId);
    await source.execute(config.endYear + 1);
    expect(owned.people).toBe(registry);
    expect(favors.people).toBe(registry);
    expect(favors.legacyEvents).toBe(log);
    expect(owned.decisions.length).toBeGreaterThan(0);
    expect(owned.counters.decisionCalls).toBeGreaterThan(0);
    const executor = createFavorExecutor(favors, config.endYear + 1, []);
    expect(executor.known(protagonistId)).toBe(owned.people[protagonistId]);
    fidelity(executor.evidence([protagonistId]).people[0], owned.people[protagonistId]);
    expect(owned.events.length).toBeGreaterThan(genesis.initial.events.length);
    fidelity(executor.evidence([protagonistId]).lifeEvents,
      owned.events.filter(e => e.year <= config.endYear + 1 && e.actors.includes(protagonistId)));
    expect(favors.events).toEqual([]);
    expect(favors.grain.protagonist).toBe(2); // native simulation does not refill/spend favors
    expect(genesis.initial.config.endYear).toBe(config.endYear);
  });
});

describe("complete semantic regeneration, even after rehashing", () => {
  const mutations: [string, (candidate: Candidate) => void][] = [
    ["Person identity", c => { c.initial.people.protagonist.id = "other"; }],
    ["Person name", c => { c.initial.people.protagonist.name = "forged"; }],
    ["Person unknown", c => define(c.initial.people.protagonist, "extension", 1)],
    ["Person missing", c => { delete (c.initial.people.protagonist as Partial<typeof c.initial.people.protagonist>).job; }],
    ["Mind facet", c => { c.initial.people.protagonist.mind.facets.altruism = 101; }],
    ["Mind stress in range", c => { c.initial.people.protagonist.mind.stress += 1; }],
    ["Mind missing", c => { delete (c.initial.people.protagonist.mind as Partial<typeof c.initial.people.protagonist.mind>).memories; }],
    ["Mind extra undefined", c => define(c.initial.people.protagonist.mind, "extra", undefined)],
    ["Mind malformed array", c => define(c.initial.people.protagonist.mind, "needs", [undefined])],
    ["life state forged", c => define(c.initial.people.protagonist, "lifeState", { slots: [] })],
    ["config unknown", c => define(c.initial.config, "ceiling", 1400)],
    ["config endYear", c => { c.initial.config.endYear++; }],
    ["config town", c => { c.initial.config.town.name = "different"; }],
    ["event payload", c => define(c.initial.events[0].payload, "extra", undefined)],
    ["event identity", c => { c.initial.events[0].id = "forged"; }],
    ["event omitted", c => { c.initial.events.pop(); }],
    ["event reordered", c => { c.initial.events.reverse(); }],
    ["registry traversal", c => { c.initial.registryOrder.reverse(); }],
    ["registry missing", c => { delete c.initial.people.protagonist; }],
    ["registry key-ID mismatch", c => { define(c.initial.people, "other", c.initial.people.protagonist); delete c.initial.people.protagonist; }],
    ["initial extra", c => define(c.initial, "decisions", [])],
    ["origin world forged", c => { c.origin.initial.people.protagonist.mind.stress++; rehashOrigin(c); }],
    ["origin requested forged", c => { c.origin.requested.seed = "another"; rehashOrigin(c); }],
    ["origin sex forged", c => { define(c.origin.sex, "resolved", "other"); rehashOrigin(c); }],
    ["origin unknown undefined", c => define(c.origin, "extension", undefined)],
  ];
  it.each(mutations)("rejects %s with a valid outer digest", (_name, mutate) => {
    const candidate = frame();
    mutate(candidate);
    rehash(candidate);
    const before = structuredClone(candidate);
    expect(() => admitLifecycleGenesis(candidate)).toThrow();
    expect(() => instantiateLifecycleGenesis(candidate)).toThrow();
    fidelity(candidate, before);
  });

  it.each(Object.keys(LIFECYCLE_GENESIS_VERSIONS))("rejects unknown version axis %s", key => {
    const candidate = frame();
    define(candidate.versions, key, "unsupported");
    expect(() => admitLifecycleGenesis(rehash(candidate))).toThrow(/versions/);
  });
  it.each(["schema", "initialization", "content", "rng", "sexPolicy"])("rejects E1 axis %s", key => {
    const candidate = frame();
    define(candidate.versions.origin, key, "unsupported");
    expect(() => admitLifecycleGenesis(rehash(candidate))).toThrow(/versions/);
  });
  it.each(["unknown", "missing", "source", "source-extra", "old-runtime", "digest", "stale-digest"])("rejects closed genesis %s", kind => {
    const candidate = frame();
    if (kind === "unknown") define(candidate, "extension", undefined);
    if (kind === "missing") delete (candidate as Partial<Candidate>).initial;
    if (kind === "source") define(candidate.source, "version", "rules-other");
    if (kind === "source-extra") define(candidate.source, "overrides", []);
    if (kind === "old-runtime") define(candidate.versions, "runtime", "explicit-resources-e2a-1");
    if (kind === "digest") candidate.digest = "not-sha256";
    if (kind === "stale-digest") candidate.initial.people.protagonist.name = "changed";
    if (kind !== "digest" && kind !== "stale-digest") rehash(candidate);
    expect(() => admitLifecycleGenesis(candidate)).toThrow();
  });

  it("preserves generated optional presence and rejects invented own undefined", () => {
    const candidate = frame();
    const world = initializeWorld(initialization).world;
    // Current initialization creates no undefined leaf in this fixture. Legal
    // optional names alone do not authorize changing generated own presence.
    fidelity(admitLifecycleGenesis(candidate).initial.people, world.people);
    expect(Object.hasOwn(candidate.initial.people.protagonist, "deathYear")).toBe(false);
    const invented = frame();
    define(invented.initial.people.protagonist, "deathYear", undefined);
    expect(Object.hasOwn(world.people.protagonist, "deathYear")).toBe(false);
    expect(() => admitLifecycleGenesis(rehash(invented))).toThrow(/generation disagreement/);
    const originOptional = frame();
    define(originOptional.origin.initial.people.protagonist, "deathYear", undefined);
    // E1 normalizes this optional; LR1a's complete lossless comparison must not.
    expect(() => admitLifecycleGenesis(rehash(originOptional))).toThrow(/generation disagreement/);
  });

  it("retains signed zero and distinguishes a rehashed positive-zero replacement", () => {
    const input = fixture({ seed: "verify-5", founderCount: 6, startYear: 1327, endYear: 1332, protagonist: { name: "Mara", sex: "random" } });
    const genesis = createLifecycleGenesis(input);
    const zeros: string[][] = [];
    function collect(value: unknown, path: string[] = []): void {
      if (Object.is(value, -0)) zeros.push(path);
      if (value !== null && typeof value === "object") {
        for (const [key, entry] of Object.entries(value)) collect(entry, [...path, key]);
      }
    }
    collect(genesis.initial);
    expect(zeros.length).toBeGreaterThan(0);
    fidelity(admitLifecycleGenesis(genesis), genesis);
    fidelity(instantiateLifecycleGenesis(genesis).owned.people, genesis.initial.people);
    const candidate = structuredClone(genesis as unknown) as Candidate;
    let target: unknown = candidate.initial;
    const path = zeros[0];
    for (const key of path.slice(0, -1)) target = (target as Record<string, unknown>)[key];
    define(target as object, path.at(-1)!, 0);
    expect(() => admitLifecycleGenesis(rehash(candidate))).toThrow(/generation disagreement/);
  });
});

describe("explicit complete resources and creation shape", () => {
  it("covers all generated IDs including initially dead actors and explicit zeros", () => {
    const options = Array.from({ length: 20 }, (_, i) => ({
      ...initialization, seed: `famine-thinning-check-${i + 1}`, founderCount: 40,
    })).find(request => Object.values(initializeWorld(request).world.people).some(person => person.deathYear !== undefined));
    expect(options).toBeDefined();
    const input = fixture(options!);
    const world = initializeWorld(options!).world;
    const dead = Object.keys(world.people).find(id => world.people[id].deathYear !== undefined)!;
    expect(dead).toBeDefined();
    input.resources[dead] = { grain: 0, effort: 0, need: 0 };
    const instance = instantiateLifecycleGenesis(createLifecycleGenesis(input));
    expect(instance.favors.grain[dead]).toBe(0);
    expect(Object.keys(instance.favors.grain)).toEqual(Object.keys(world.people));
    delete input.resources[dead];
    expect(() => createLifecycleGenesis(input)).toThrow(/field/);
  });
  it.each(["grain", "effort", "need"] as const)("rejects malformed %s in creation and rehashed admission", resource => {
    for (const value of [-1, -0, 0.1, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, "0", null, undefined]) {
      const input = fixture();
      define(input.resources.protagonist, resource, value);
      expect(() => createLifecycleGenesis(input)).toThrow();
      const candidate = frame();
      define(candidate.resources.protagonist, resource, value);
      expect(() => admitLifecycleGenesis(rehash(candidate))).toThrow();
    }
  });
  it.each(["missing", "extra", "unknown-actor", "array", "undefined"])("rejects resource shape %s", kind => {
    const input = fixture();
    if (kind === "missing") Reflect.deleteProperty(input.resources.protagonist, "grain");
    if (kind === "extra") define(input.resources.protagonist, "wealth", 1);
    if (kind === "unknown-actor") define(input.resources, "constructor", { grain: 0, effort: 0, need: 0 });
    if (kind === "array") define(input.resources, "protagonist", [0, 0, 0]);
    if (kind === "undefined") define(input.resources, "protagonist", undefined);
    expect(() => createLifecycleGenesis(input)).toThrow();
    const candidate = frame();
    define(candidate, "resources", input.resources);
    expect(() => admitLifecycleGenesis(rehash(candidate))).toThrow();
  });
  it.each([null, [], {}, { initialization }, { ...fixture(), callback: undefined }, { ...fixture(), origin: {} }])("rejects incomplete or extended creation %#", input => {
    expect(() => createLifecycleGenesis(input)).toThrow();
  });
  it("allows only E1's documented request optional normalization", () => {
    const input = fixture({ ...initialization, townName: undefined });
    expect(Object.hasOwn(createLifecycleGenesis(input).origin.requested, "townName")).toBe(false);
    define(input.initialization, "provider", undefined);
    expect(() => createLifecycleGenesis(input)).toThrow();
  });
});

describe("descriptor-checked canonical comparison export", () => {
  it("reuses the existing digest bytes without claiming semantic admission", () => {
    const candidate = frame();
    const { digest, ...payload } = candidate;
    expect(canonicalLifecycleData(payload)).toBe(JSON.stringify(tagged(payload)));
    expect(createHash("sha256").update(canonicalLifecycleData(payload), "utf8").digest("hex")).toBe(digest);
    expect(canonicalLifecycleData({ b: -0, a: undefined })).toBe(canonicalLifecycleData({ a: undefined, b: -0 }));
    expect(canonicalLifecycleData({ a: undefined })).not.toBe(canonicalLifecycleData({}));
    expect(canonicalLifecycleData(-0)).not.toBe(canonicalLifecycleData(0));
    candidate.initial.people.protagonist.mind.stress++;
    rehash(candidate);
    expect(() => canonicalLifecycleData(candidate)).not.toThrow();
    expect(() => admitLifecycleGenesis(candidate)).toThrow(/generation disagreement/);
  });

  it("checks descriptors before the canonical encoder can invoke a hook", () => {
    let hooks = 0;
    const input = Object.defineProperty({}, "constructor", { enumerable: true, get() { hooks++; return Object; } });
    expect(() => canonicalLifecycleData(input)).toThrow(/own enumerable data/);
    expect(hooks).toBe(0);
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => canonicalLifecycleData(cyclic)).toThrow();
  });
});

describe("whole-tree descriptor safety before reads, hashing or cloning", () => {
  const kinds = ["getter", "toJSON", "iterator", "hidden", "symbol", "nonplain", "cycle", "sparse", "extended-array", "array-prototype", "function", "bigint", "nonfinite"];
  it.each(kinds)("rejects nested %s with zero hooks on every boundary", kind => {
    let hooks = 0;
    const hook = () => { hooks++; throw new Error("Executed hook"); };
    function corrupt(target: object): void {
      if (kind === "getter") Object.defineProperty(target, "bad", { enumerable: true, get: hook });
      if (kind === "toJSON") define(target, "toJSON", hook);
      if (kind === "iterator") define(target, Symbol.iterator, hook);
      if (kind === "hidden") Object.defineProperty(target, "bad", { value: 1 });
      if (kind === "symbol") define(target, Symbol("bad"), 1);
      if (kind === "nonplain") define(target, "bad", new Date(0));
      if (kind === "cycle") define(target, "bad", target);
      if (kind === "sparse") define(target, "bad", new Array(2));
      if (kind === "extended-array") { const list = [1]; define(list, "extra", 2); define(target, "bad", list); }
      if (kind === "array-prototype") { const list = [1]; Object.setPrototypeOf(list, null); define(target, "bad", list); }
      if (kind === "function") define(target, "bad", hook);
      if (kind === "bigint") define(target, "bad", BigInt(1));
      if (kind === "nonfinite") define(target, "bad", Infinity);
    }
    const creation = fixture();
    corrupt(creation.resources.protagonist);
    expect(() => createLifecycleGenesis(creation)).toThrow();
    const candidate = frame();
    corrupt(candidate.initial.people.protagonist.mind);
    expect(() => admitLifecycleGenesis(candidate)).toThrow();
    expect(() => instantiateLifecycleGenesis(candidate)).toThrow();
    expect(hooks).toBe(0);
  });
  it("rejects an existing-field getter before evaluating earlier semantically invalid data", () => {
    const candidate = frame();
    define(candidate.versions, "schema", "unsupported");
    let hooks = 0;
    Object.defineProperty(candidate.initial.people.protagonist.mind, "stress", { enumerable: true, get() { hooks++; return 0; } });
    expect(() => admitLifecycleGenesis(candidate)).toThrow(/own enumerable data/);
    expect(hooks).toBe(0);
    const input = fixture();
    Object.defineProperty(input, "initialization", { enumerable: true, get() { hooks++; return initialization; } });
    expect(() => createLifecycleGenesis(input)).toThrow(/own enumerable data/);
    expect(hooks).toBe(0);
  });
});

import { createHash } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { canonicalLifecycleData, createLifecycleGenesis } from "./e-lifecycle-genesis";
import { createLifecycleRuntime } from "./e-lifecycle-runtime";
import { initializeWorld } from "./world-origin";
import { replayLifecycleRuntime } from "./e-lifecycle-replay";
import * as genesisModule from "./e-lifecycle-genesis";
import * as sourceModule from "./e-year-source";
import * as executorModule from "./e-favor-executor";
import type { GenerateWorldOptions } from "./worldgen";

type Mutable<T> = T extends object ? { -readonly [K in keyof T]: Mutable<T[K]> } : T;
type Output = Awaited<ReturnType<typeof replayLifecycleRuntime>>;
type Envelope = { genesis: Mutable<ReturnType<typeof createLifecycleGenesis>>; output: Mutable<Output> };
const defaults: GenerateWorldOptions = { seed: "baseline-1327-1", startYear: 1327, endYear: 1327, founderCount: 6,
  protagonist: { name: "Alice", sex: "f" } };
function genesis(options = defaults, protagonistId = "protagonist") {
  const { world } = initializeWorld(options);
  return createLifecycleGenesis({ initialization: options, protagonistId,
    resources: Object.fromEntries(Object.keys(world.people).map(id => [id, { grain: 2, effort: 3, need: 1 }])) });
}
async function fixture(options = defaults, throughYear = 1327, protagonistId = "protagonist"): Promise<Envelope> {
  const input = genesis(options, protagonistId);
  const runtime = createLifecycleRuntime(input);
  for (let year = input.initial.config.startYear; year <= throughYear && runtime.snapshot().status !== "complete"; year++) {
    await runtime.advance(year);
  }
  return structuredClone({ genesis: input, output: runtime.snapshot() } as unknown) as Envelope;
}
function define(target: object, key: PropertyKey, value: unknown): void {
  Object.defineProperty(target, key, { value, enumerable: true, configurable: true, writable: true });
}
function rehash(input: Envelope): void {
  const payload = { ...input.genesis };
  Reflect.deleteProperty(payload, "digest");
  input.genesis.digest = createHash("sha256").update(canonicalLifecycleData(payload), "utf8").digest("hex");
}
// Compact equality diagnostics avoid Vitest attempting to print giant cumulative
// journals on failure. The independent walk compares own presence and Object.is,
// while record order/identity are deliberately tested separately from canon.
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
function fullyFrozen(value: unknown, seen = new Set<object>()): void {
  if (value === null || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  expect(Object.isFrozen(value)).toBe(true);
  Object.values(value).forEach(entry => fullyFrozen(entry, seen));
}
function leafPaths(value: unknown, wanted: unknown, path: string[] = []): string[][] {
  if (Object.is(value, wanted)) return [path];
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, item]) => leafPaths(item, wanted, [...path, key]));
}
function setPath(value: unknown, path: string[], leaf: unknown): void {
  for (const key of path.slice(0, -1)) value = (value as Record<string, unknown>)[key];
  define(value as object, path.at(-1)!, leaf);
}
let annual: Envelope;
let initial: Envelope;
beforeAll(async () => {
  initial = await fixture(defaults, 1326);
  annual = await fixture();
});
afterEach(() => vi.restoreAllMocks());

describe("cold native lifecycle replay", () => {
  it("compares full annual and final trees through the real pair helper without encoding strings", async () => {
    // Call-through observers only: neither equality nor regeneration is mocked.
    const pair = vi.spyOn(genesisModule, "canonicalLifecycleDataEqual");
    const encoder = vi.spyOn(genesisModule, "canonicalLifecycleData");
    const native = vi.spyOn(sourceModule, "createRulesYearSource");
    const favor = vi.spyOn(executorModule, "createFavorExecutor");
    for (const evidence of [initial, annual]) {
      pair.mockClear();
      encoder.mockClear();
      native.mockClear();
      favor.mockClear();
      const replayed = await replayLifecycleRuntime(evidence);
      fidelity(replayed, evidence.output);
      expect(pair).toHaveBeenCalledTimes(evidence.output.journal.length + 1);
      expect(encoder).not.toHaveBeenCalled();
      expect(native).toHaveBeenCalledTimes(evidence.output.journal.length);
      expect(favor).toHaveBeenCalledTimes(evidence.output.journal.length);
      for (let index = 0; index < evidence.output.journal.length; index++) {
        fidelity(pair.mock.calls[index][0], evidence.output.journal[index]);
        expect(pair.mock.calls[index][0]).not.toBe(evidence.output.journal[index]);
        expect(pair.mock.calls[index][1]).toBe(replayed.journal[index]);
      }
      fidelity(pair.mock.calls.at(-1)![0], evidence.output);
      expect(pair.mock.calls.at(-1)![1]).toBe(replayed);
      expect(pair.mock.results.every(result => result.type === "return" && result.value === true)).toBe(true);
      expect(replayed.owned.people).toBe(replayed.favors.people);
      expect(replayed.owned.events).toBe(replayed.favors.legacyEvents);
    }
    const forged = structuredClone(annual);
    forged.output.journal[0].final.owned.people.protagonist.mind.stress++;
    pair.mockClear();
    encoder.mockClear();
    await expect(replayLifecycleRuntime(forged)).rejects.toThrow("Lifecycle annual record disagreement");
    expect(pair.mock.results.at(-1)?.value).toBe(false);
    expect(encoder).not.toHaveBeenCalled();
    const forgedFinal = structuredClone(initial);
    forgedFinal.output.owned.people.protagonist.mind.stress++;
    pair.mockClear();
    await expect(replayLifecycleRuntime(forgedFinal)).rejects.toThrow("Lifecycle final output disagreement");
    expect(pair.mock.results.at(-1)?.value).toBe(false);
    expect(encoder).not.toHaveBeenCalled();
  });

  it("regenerates zero-year and incomplete alive output without borrowing caller aliases", async () => {
    for (const evidence of [initial, annual]) {
      const candidate = structuredClone(evidence);
      const before = canonicalLifecycleData(candidate);
      const replayed = await replayLifecycleRuntime(candidate);
      fidelity(replayed, evidence.output);
      expect(replayed.status).toBe("incomplete");
      expect(replayed.frontier).toBe(evidence.output.frontier);
      expect(replayed.owned.people).toBe(replayed.favors.people);
      expect(replayed.owned.events).toBe(replayed.favors.legacyEvents);
      expect(replayed.owned.people).not.toBe(candidate.output.owned.people);
      expect(replayed.owned.people.protagonist.mind).not.toBe(candidate.output.owned.people.protagonist.mind);
      for (const record of replayed.journal) {
        expect(record.final.owned.people).toBe(record.final.favors.people);
        expect(record.final.owned.events).toBe(record.final.favors.legacyEvents);
      }
      fullyFrozen(replayed);
      expect(canonicalLifecycleData(candidate)).toBe(before);
      expect(Object.isFrozen(candidate.output.owned.people.protagonist.mind)).toBe(false);
      candidate.output.owned.people.protagonist.mind.stress = 999;
      expect(replayed.owned.people.protagonist.mind.stress).not.toBe(999);
    }
  });

  it("uses only trusted years and regenerates physics plus economics beyond origin endYear", async () => {
    const candidate = await fixture(defaults, 1328);
    const native = vi.spyOn(sourceModule, "createRulesYearSource");
    const favor = vi.spyOn(executorModule, "createFavorExecutor");
    const replayed = await replayLifecycleRuntime(candidate);
    fidelity(replayed, candidate.output);
    expect(replayed.frontier).toBeGreaterThan(candidate.genesis.initial.config.endYear);
    expect(native).toHaveBeenCalledTimes(2);
    expect(favor).toHaveBeenCalledTimes(2);
    for (const call of favor.mock.calls) {
      expect(call[0]).not.toBe(candidate.output.favors);
      expect(call[2]).not.toBe(candidate.output.journal[0].economics.entries);
    }
  });

  it("accepts the complete genuine death year and rejects any continuation", async () => {
    const candidate = await fixture({ ...defaults, seed: "baseline-1327-0" }, 1330);
    const replayed = await replayLifecycleRuntime(candidate);
    expect(replayed.status).toBe("complete");
    expect(replayed.owned.people.protagonist.deathYear).toBe(replayed.frontier);
    expect(replayed.journal.at(-1)!.economics.resources.length).toBeGreaterThan(0);
    fidelity(replayed, candidate.output);
    const extra = structuredClone(candidate.output.journal.at(-1)!);
    extra.year = candidate.output.frontier + 1;
    candidate.output.journal.push(extra);
    candidate.output.frontier++;
    await expect(replayLifecycleRuntime(candidate)).rejects.toThrow(/dead/);
  });

  it("compares real maternal birth/death, genotype/class and survivor Mind without mock physics", async () => {
    const options = { seed: "maternal-check-37", founderCount: 24, startYear: 1498, endYear: 1498 };
    const candidate = await fixture(options, 1500, "p004");
    const replayed = await replayLifecycleRuntime(candidate);
    fidelity(replayed, candidate.output);
    const maternal = replayed.owned.events.find(event => event.kind === "death" && event.year >= 1498
      && (event.payload as unknown as Record<string, unknown>).cause === "childbirth");
    expect(maternal).toBeDefined();
    const born = Object.values(replayed.owned.people).find(person => person.birthYear >= 1498 && person.motherId !== undefined);
    expect(born).toBeDefined();
    expect(born!.mind.facets).toBeDefined();
    expect(born!.socialClass).toBeDefined();
    candidate.output.journal.at(-1)!.final.owned.people[born!.id].mind.facets.altruism++;
    await expect(replayLifecycleRuntime(candidate)).rejects.toThrow(/record disagreement/);
  });

  it("restores genesis traversal and ownership when caller records have sorted keys and no aliases", async () => {
    function reorder(value: unknown): unknown {
      if (value === null || typeof value !== "object") return value;
      if (Array.isArray(value)) return value.map(reorder);
      const result = Object.create(null);
      for (const key of Object.keys(value).sort().reverse()) define(result, key, reorder((value as Record<string, unknown>)[key]));
      return result;
    }
    const candidate = reorder(annual) as Envelope;
    expect(candidate.output.owned.people).not.toBe(candidate.output.favors.people);
    const replayed = await replayLifecycleRuntime(candidate);
    fidelity(replayed, annual.output);
    expect(Object.keys(replayed.owned.people)).toEqual(Object.keys(annual.output.owned.people));
    expect(Object.keys(replayed.owned.people).slice(0, annual.genesis.initial.registryOrder.length)).toEqual(annual.genesis.initial.registryOrder);
    expect(replayed.owned.people).toBe(replayed.favors.people);
    expect(replayed.owned.events).toBe(replayed.favors.legacyEvents);
    expect(canonicalLifecycleData(replayed)).toBe(canonicalLifecycleData(candidate.output));
  });

  it("captures the entire candidate before first await even when the caller mutates during native execution", async () => {
    const candidate = structuredClone(annual);
    const real = sourceModule.createRulesYearSource;
    let changed = false;
    vi.spyOn(sourceModule, "createRulesYearSource").mockImplementation((...args) => {
      const source = real(...args);
      return { ...source, execute: async year => {
        const result = await source.execute(year);
        candidate.output.owned.people.protagonist.mind.stress = 999;
        candidate.output.journal[0].economics.resources.length = 0;
        candidate.genesis.initial.people.protagonist.name = "changed during await";
        changed = true;
        return result;
      } };
    });
    const replayed = await replayLifecycleRuntime(candidate);
    expect(changed).toBe(true);
    fidelity(replayed, annual.output);
  });

  it("preserves own undefined and generated signed zero rather than normalizing the full state", async () => {
    const candidate = await fixture({ ...defaults, seed: "verify-5", protagonist: { name: "Mara", sex: "random" } });
    const zeros = leafPaths(candidate.output, -0);
    const undefineds = leafPaths(candidate.output, undefined);
    expect(zeros.length).toBeGreaterThan(0);
    expect(undefineds.length).toBeGreaterThan(0);
    fidelity(await replayLifecycleRuntime(candidate), candidate.output);
    const positiveZero = structuredClone(candidate);
    setPath(positiveZero.output, zeros[0], 0);
    await expect(replayLifecycleRuntime(positiveZero)).rejects.toThrow(/disagreement/);
    const absent = structuredClone(candidate);
    const path = undefineds[0];
    let parent: unknown = absent.output;
    for (const key of path.slice(0, -1)) parent = (parent as Record<string, unknown>)[key];
    Reflect.deleteProperty(parent as object, path.at(-1)!);
    await expect(replayLifecycleRuntime(absent)).rejects.toThrow(/disagreement/);
    const invented = structuredClone(candidate);
    define(invented.output.owned.people.protagonist.mind, "unknown", undefined);
    await expect(replayLifecycleRuntime(invented)).rejects.toThrow(/disagreement/);
  });
});

describe("complete evidence rejection without a duplicated Person/Mind schema", () => {
  const mutations: [string, (c: Envelope) => void][] = [
    ["annual versions", c => define(c.output.journal[0].versions, "runtime", "unknown")],
    ["physical snapshot", c => { c.output.journal[0].physicalSnapshot.people.protagonist.name = "forged"; }],
    ["physical snapshot extension", c => define(c.output.journal[0].physicalSnapshot, "extension", undefined)],
    ["economic resource plan", c => { c.output.journal[0].economics.resources.pop(); }],
    ["economic grant plan", c => { c.output.journal[0].economics.grants.push({ id: "forged", creditor: "p001", debtor: "p002", causes: [] }); }],
    ["creditor order", c => { c.output.journal[0].economics.creditors.push("protagonist"); }],
    ["slot observations", c => define(c.output.journal[0].economics, "slots", [{ creditor: "p001", slot: 0, opportunities: [], request: null }])],
    ["request plan", c => define(c.output.journal[0].economics, "requests", [{ id: "forged" }])],
    ["entry effects", c => define(c.output.journal[0].economics.entries[0], "effects", [])],
    ["entry authority", c => define(c.output.journal[0].economics.entries[0], "authority", { source: "human" })],
    ["entry reason", c => define(c.output.journal[0].economics.entries[0], "reason", "forged")],
    ["entry causes", c => { c.output.journal[0].economics.entries[0].causes.push("forged"); }],
    ["entry position", c => { c.output.journal[0].economics.entries[0].position++; }],
    ["life range", c => { c.output.journal[0].positions.life.end++; }],
    ["decision range", c => { c.output.journal[0].positions.decisions.start++; }],
    ["economic range", c => { c.output.journal[0].positions.economic.end++; }],
    ["annual final Mind", c => { c.output.journal[0].final.owned.people.protagonist.mind.stress++; }],
    ["annual final ledger", c => { c.output.journal[0].final.favors.need.protagonist++; }],
    ["annual unknown field", c => define(c.output.journal[0], "overrides", [])],
    ["output versions", c => define(c.output.versions, "annualPolicy", "unknown")],
    ["output digest", c => { c.output.genesisDigest = "0".repeat(64); }],
    ["output protagonist", c => { c.output.protagonistId = "p001"; }],
    ["output frontier", c => { c.output.frontier++; }],
    ["output status", c => { c.output.status = "complete"; }],
    ["output registry", c => { delete c.output.owned.people.protagonist; }],
    ["output entire Mind", c => define(c.output.owned.people.protagonist.mind, "unknown", undefined)],
    ["output native counters", c => { c.output.owned.counters.decisionCalls++; }],
    ["output ordered events", c => { c.output.owned.events.reverse(); }],
    ["output native decisions", c => { c.output.owned.decisions.pop(); }],
    ["output grain", c => { c.output.favors.grain.protagonist++; }],
    ["output assistance", c => { c.output.favors.assistance.protagonist++; }],
    ["output need", c => { c.output.favors.need.protagonist++; }],
    ["output obligations", c => define(c.output.favors, "obligations", [{ id: "forged" }])],
    ["output ties", c => define(c.output.favors, "ties", [{ from: "p001", to: "p002", trust: 1, resentment: 0 }])],
    ["output appraisals", c => define(c.output.favors, "appraisals", [{ id: "forged" }])],
    ["output economic history", c => { c.output.favors.events.pop(); }],
    ["output canonical snapshot", c => { c.output.canonicalYearSnapshot.year++; }],
    ["output extension", c => define(c.output, "resolver", undefined)],
  ];
  it.each(mutations)("rejects %s", async (_name, mutate) => {
    const candidate = structuredClone(annual);
    mutate(candidate);
    const before = canonicalLifecycleData(candidate);
    await expect(replayLifecycleRuntime(candidate)).rejects.toThrow(/disagreement/);
    expect(canonicalLifecycleData(candidate)).toBe(before);
  });

  it.each(["Person", "Mind", "counter", "resources"])("rejects rehashed genesis %s forgery", async kind => {
    const candidate = structuredClone(annual);
    if (kind === "Person") candidate.genesis.initial.people.protagonist.name = "forged";
    if (kind === "Mind") candidate.genesis.initial.people.protagonist.mind.stress++;
    if (kind === "counter") define(candidate.genesis.initial, "counters", { decisionCalls: 1 });
    if (kind === "resources") candidate.genesis.resources.protagonist.grain++;
    rehash(candidate);
    candidate.output.genesisDigest = candidate.genesis.digest;
    await expect(replayLifecycleRuntime(candidate)).rejects.toThrow(/disagreement/);
  });

  it.each(["versions", "source", "digest"])("rejects unknown genesis %s before execution", async kind => {
    const candidate = structuredClone(annual);
    if (kind === "versions") define(candidate.genesis.versions, "runtime", "other");
    if (kind === "source") define(candidate.genesis.source, "version", "other");
    rehash(candidate);
    if (kind === "digest") candidate.genesis.digest = "invalid";
    const native = vi.spyOn(sourceModule, "createRulesYearSource");
    await expect(replayLifecycleRuntime(candidate)).rejects.toThrow();
    expect(native).not.toHaveBeenCalled();
  });

  it.each(["gap", "repeat", "reorder", "fractional", "unsafe", "signed-zero"])("rejects %s journal years", async kind => {
    const candidate = await fixture(defaults, 1328);
    if (kind === "gap") candidate.output.journal[1].year++;
    if (kind === "repeat") candidate.output.journal[1].year--;
    if (kind === "reorder") candidate.output.journal.reverse();
    if (kind === "fractional") candidate.output.journal[0].year += 0.5;
    if (kind === "unsafe") candidate.output.journal[0].year = Number.MAX_SAFE_INTEGER + 1;
    if (kind === "signed-zero") candidate.output.journal[0].year = -0;
    const native = vi.spyOn(sourceModule, "createRulesYearSource");
    await expect(replayLifecycleRuntime(candidate)).rejects.toThrow(/contiguous safe integers/);
    expect(native).not.toHaveBeenCalled();
  });

  it.each(["missing year", "missing output", "extra root", "output not record", "journal not array"])("rejects %s", async kind => {
    const candidate = structuredClone(annual);
    if (kind === "missing year") candidate.output.journal.length = 0;
    if (kind === "missing output") Reflect.deleteProperty(candidate, "output");
    if (kind === "extra root") define(candidate, "authority", undefined);
    if (kind === "output not record") define(candidate, "output", []);
    if (kind === "journal not array") define(candidate.output, "journal", {});
    await expect(replayLifecycleRuntime(candidate)).rejects.toThrow();
  });
});

describe("real competing HELP evidence, not candidate execution instructions", () => {
  let competing: Envelope;
  beforeAll(async () => {
    competing = await fixture({ ...defaults, seed: "competition-0", founderCount: 12 }, 1332);
  });
  it("regenerates ordered creditors, both slots, null observations and complete ledgers", async () => {
    const replayed = await replayLifecycleRuntime(competing);
    fidelity(replayed, competing.output);
    const economics = replayed.journal.flatMap(record => record.economics.slots);
    expect(economics.some(slot => slot.request === null)).toBe(true);
    expect(economics.some(slot => slot.request !== null)).toBe(true);
    expect(replayed.favors.obligations.length).toBeGreaterThan(0);
    expect(replayed.favors.ties.length).toBeGreaterThan(0);
    expect(replayed.journal.some(record => record.economics.entries.some(entry => entry.kind === "help-response"))).toBe(true);
  });
  it.each(["grant", "creditors", "slots", "null", "opportunity", "request", "authority", "effects", "evidence",
    "debt", "tie", "native-human", "final-history"])("rejects forged %s in genuine economic history", async kind => {
    const candidate = structuredClone(competing);
    const record = candidate.output.journal.find(r => r.economics.entries.some(e => e.kind === "help-response"))!;
    const response = record.economics.entries.find(e => e.kind === "help-response")!;
    const request = record.economics.requests[0];
    const slot = record.economics.slots.find(s => s.request !== null)!;
    if (kind === "grant") candidate.output.journal.find(r => r.economics.grants.length)!.economics.grants[0].creditor = "forged";
    if (kind === "creditors") record.economics.creditors.unshift("forged");
    if (kind === "slots") record.economics.slots.reverse();
    if (kind === "null") candidate.output.journal.flatMap(r => r.economics.slots).find(s => s.request === null)!.request = request;
    if (kind === "opportunity") define(slot.opportunities[0], "reason", "forged");
    if (kind === "request") request.noise = 0.999;
    if (kind === "authority") define(response.authority!, "source", "human");
    if (kind === "effects") response.effects.length = 0;
    if (kind === "evidence") define(response, "evidence", { forged: true });
    if (kind === "debt") define(candidate.output.favors.obligations[0], "status", "forged");
    if (kind === "tie") candidate.output.favors.ties[0].trust++;
    if (kind === "native-human") define(record.final.owned.decisions[0], "source", "human");
    if (kind === "final-history") candidate.output.favors.events.at(-1)!.id += "/forged";
    const before = canonicalLifecycleData(candidate);
    // Reduce resolved values to a tiny diagnostic even if a mutation is a no-op.
    const failure = await replayLifecycleRuntime(candidate).then(() => null, error => error);
    expect(failure instanceof Error ? failure.message : "unexpected successful replay").toMatch(/disagreement/);
    expect(canonicalLifecycleData(candidate)).toBe(before);
  });
});

describe("whole-envelope descriptor preflight", () => {
  const kinds = ["getter", "constructor-accessor", "toJSON", "symbol", "hidden", "function", "bigint", "nonplain",
    "cycle", "sparse", "extended-array", "array-getter", "array-hidden", "array-symbol", "array-prototype", "nonfinite"];
  it.each(kinds)("rejects %s before any native source or executable hook", async kind => {
    const candidate = structuredClone(annual);
    let hooks = 0;
    const hook = () => { hooks++; throw new Error("Executed hook"); };
    const target = candidate.output.journal[0].final.owned.people.protagonist.mind;
    if (kind === "getter") Object.defineProperty(target, "stress", { enumerable: true, get: hook });
    if (kind === "constructor-accessor") Object.defineProperty(target, "constructor", { enumerable: true, get: hook });
    if (kind === "toJSON") define(target, "toJSON", hook);
    if (kind === "symbol") define(target, Symbol("extension"), 1);
    if (kind === "hidden") Object.defineProperty(target, "extension", { value: 1 });
    if (kind === "function") define(target, "extension", hook);
    if (kind === "bigint") define(target, "extension", BigInt(1));
    if (kind === "nonplain") define(target, "extension", new Date(0));
    if (kind === "cycle") define(target, "extension", candidate);
    if (kind === "sparse") define(target, "extension", new Array(2));
    if (kind === "nonfinite") define(target, "extension", Infinity);
    const list = candidate.output.journal;
    if (kind === "extended-array") define(list, "extension", 1);
    if (kind === "array-getter") Object.defineProperty(list, "0", { enumerable: true, get: hook });
    if (kind === "array-hidden") Object.defineProperty(list, "extension", { value: 1 });
    if (kind === "array-symbol") define(list, Symbol.iterator, hook);
    if (kind === "array-prototype") Object.setPrototypeOf(list, null);
    const native = vi.spyOn(sourceModule, "createRulesYearSource");
    const clone = vi.spyOn(globalThis, "structuredClone");
    await expect(replayLifecycleRuntime(candidate)).rejects.toThrow();
    expect(hooks).toBe(0);
    expect(native).not.toHaveBeenCalled();
    expect(clone).not.toHaveBeenCalled();
  });

  it.each(["genesis", "output"])("rejects top-level %s getter without reading it", async key => {
    let hooks = 0;
    const candidate = structuredClone(annual);
    Object.defineProperty(candidate, key, { enumerable: true, get() { hooks++; return annual[key as keyof Envelope]; } });
    await expect(replayLifecycleRuntime(candidate)).rejects.toThrow(/own enumerable data/);
    expect(hooks).toBe(0);
  });

  it("checks a late hostile descriptor before even hashing an invalid early genesis", async () => {
    const candidate = structuredClone(annual);
    candidate.genesis.digest = "invalid";
    let hooks = 0;
    Object.defineProperty(candidate.output.canonicalYearSnapshot, "constructor", { enumerable: true, get() { hooks++; return Object; } });
    await expect(replayLifecycleRuntime(candidate)).rejects.toThrow(/own enumerable data/);
    expect(hooks).toBe(0);
  });
});

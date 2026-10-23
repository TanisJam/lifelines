import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createMind } from "./mind";
import type { Person } from "./types";
import { createHelpFavorState, grantHelpFavor } from "./effects";
import { createFavorScheduler, runFavorYear } from "./scheduler";
import { createFavorCapsule } from "./favor-capsule";
import { createAuthorityFavorState } from "./favor-authority";
import { createFavorFork, declareForkGrant, declareForkChoice, runFavorForkYear, forkFavor, semanticResponseTarget, type FavorFork } from "./favor-fork";
import { forkOpportunityKey } from "./favor-scheduler";
import { FAVOR_FORK_CAPSULE_MANIFEST, createFavorForkCapsule, admitFavorForkCapsule, serializeFavorForkCapsule, deserializeFavorForkCapsule } from "./favor-fork-capsule";

function initial(ids = ["a", "b"]) {
  const people: Record<string, Person> = Object.create(null);
  for (const id of ids) {
    const mind = createMind("c2", id, 1300);
    mind.facets.altruism = 50; mind.facets.anxiety = 50; mind.values.wealth = 0;
    people[id] = { id, name: id, sex: "f", birthYear: 1300, founder: true, job: "none", traits: [], mind };
  }
  return createHelpFavorState(people, [], { a: 2, b: 0 }, { b: 2 }, { a: 2 });
}
const grant = (key = "g0", year = 1336) => ({ key, year, creditor: "a", debtor: "b", causes: [], ties: [], appraisals: [] });
function root() {
  let state = createFavorFork(createFavorScheduler(initial(), "c2-1", 1335), "root");
  state = declareForkGrant(declareForkGrant(state, grant()), grant("g1"));
  return runFavorForkYear(state, 1336);
}
function choice(selected: "help" | "refuse" = "refuse", year = 1337) {
  const debt = `${JSON.stringify(["favor-c1", "g0", 0])}/help`;
  const key = forkOpportunityKey({ creditor: "a", debtor: "b", obligation: "ignored", reason: null }, debt, year, 0, "request");
  return { target: semanticResponseTarget(key, ["a", "b"], year), actors: ["a", "b"] as [string, string], year, choice: selected };
}
function encode(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(encode).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${encode((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
function rehash<T extends { digest: string }>(capsule: T): T {
  const { digest: _digest, ...payload } = capsule;
  void _digest;
  capsule.digest = createHash("sha256").update(encode(payload), "utf8").digest("hex");
  return capsule;
}
const cold = (state: FavorFork) => deserializeFavorForkCapsule(serializeFavorForkCapsule(createFavorForkCapsule(state))).fork;

describe("D2b canonical cold capsule", () => {
  it("roundtrips complete detached canon with identical canonical bytes", () => {
    const state = runFavorForkYear(root(), 1337);
    const before = structuredClone(state);
    const capsule = createFavorForkCapsule(state);
    const wire = serializeFavorForkCapsule(capsule);
    const loaded = deserializeFavorForkCapsule(wire);
    expect(loaded.fork).toEqual(state);
    expect(serializeFavorForkCapsule(loaded)).toBe(wire);
    (loaded.fork.people.a as unknown as Record<string, unknown>).name = "detached";
    capsule.fork.history[0]!.command.year = 9999;
    expect(state).toEqual(before);
    expect(deserializeFavorForkCapsule(wire).fork).toEqual(before);
  });
  it("cold continues scheduler, human choices, superseded history and nested forks", () => {
    let state = declareForkChoice(root(), choice());
    state = runFavorForkYear(runFavorForkYear(state, 1337), 1340);
    const child = forkFavor(state, 1337, "child", [choice("help")]);
    expect(child.history.some(entry => entry.status === "superseded")).toBe(true);
    expect(forkFavor(cold(state), 1337, "child", [choice("help")])).toEqual(child);
    expect(forkFavor(cold(child), 1337, "nested", [choice()])).toEqual(forkFavor(child, 1337, "nested", [choice()]));
    expect(runFavorForkYear(cold(child), 1344)).toEqual(runFavorForkYear(child, 1344));
    expect(declareForkChoice(cold(root()), choice())).toEqual(declareForkChoice(root(), choice()));
  });
  it("retains actual C2 initial prefix, quiet/gapped chronology and future inactive commands", () => {
    const c = grantHelpFavor(initial(), grant());
    const prefix = runFavorYear(runFavorYear(createFavorScheduler(c, "c2-2", 1336), 1337), 1340);
    let state = createFavorFork(prefix, "prefix-root");
    state = declareForkGrant(state, grant("missed", 1341));
    state = runFavorForkYear(state, 1344);
    expect(state.history[0]!.status).toBe("inactive");
    expect(cold(state)).toEqual(state);
    expect(forkFavor(cold(state), 1340, "child")).toEqual(forkFavor(state, 1340, "child"));
    expect(cold(state).prefix).toEqual(state.prefix);
    expect(cold(state).events.slice(0, state.prefix.length)).toEqual(state.events.slice(0, state.prefix.length));
  });
  it("preserves nonlexical, integer, Unicode, lone-surrogate and own __proto__ traversal", () => {
    const ids = ["z", "b", "10", "2", "a", "\ud800", "\ud801", "é", "é", "__proto__"];
    const state = createFavorFork(createFavorScheduler(initial(ids), "seed", 1335), "order");
    const capsule = createFavorForkCapsule(state);
    expect(capsule.registryOrder).toEqual(Object.keys(state.people));
    expect(Object.keys(cold(state).people)).toEqual(Object.keys(state.people));
    expect(Object.hasOwn(cold(state).people, "__proto__")).toBe(true);
    expect(cold(state).people["\ud800"]!.id).not.toBe(cold(state).people["\ud801"]!.id);
    for (const order of [capsule.registryOrder.slice(1), [...capsule.registryOrder, "a"], capsule.registryOrder.map(id => id === "a" ? "foreign" : id), [...capsule.registryOrder].reverse()]) {
      expect(() => admitFavorForkCapsule(rehash({ ...structuredClone(capsule), registryOrder: order }))).toThrow();
    }
  });
  it("retains raw surrogate semantic ordering and physical references through annual cold resume", () => {
    const ids = ["z", "b", "10", "2", "a", "\ud800", "\ud801", "__proto__"];
    const base = initial(ids);
    const grain: Record<string, number> = Object.create(null);
    const need: Record<string, number> = Object.create(null);
    for (const id of ids) { grain[id] = 1; need[id] = 1; }
    let state = createFavorFork(createFavorScheduler(createHelpFavorState(base.people, [], grain, { b: 10 }, need), "c2-1", 1335), "raw-identity");
    for (const id of ids.filter(id => id !== "b")) state = declareForkGrant(state, { ...grant(id), creditor: id });
    state = runFavorForkYear(state, 1336);
    const warm = runFavorForkYear(runFavorForkYear(state, 1337), 1340);
    const loaded = runFavorForkYear(runFavorForkYear(cold(state), 1337), 1340);
    expect(loaded).toEqual(warm);
    expect(loaded.mapping).toEqual(warm.mapping);
    expect(loaded.events).toEqual(warm.events);
    expect(loaded.years).toEqual(warm.years);
    expect(cold(forkFavor(warm, 1337, "child"))).toEqual(forkFavor(warm, 1337, "child"));
    expect(Buffer.from("\ud800").equals(Buffer.from("\ud801"))).toBe(true);
    expect(loaded.mapping.some(entry => entry.semantic === JSON.stringify(["favor-c1", "\ud800", 0]))).toBe(true);
    expect(loaded.mapping.some(entry => entry.semantic === JSON.stringify(["favor-c1", "\ud801", 0]))).toBe(true);
  });
  it("normalizes only declared legacy optional omissions", () => {
    const state = root();
    state.people.a!.deathYear = undefined;
    state.people.a!.lifeState = undefined;
    state.people.a!.mind.thoughts.push({ emotion: "joy", cause: "thought", intensity: 1, yearsLeft: 1, year: 1335, personId: undefined });
    const capsule = createFavorForkCapsule(state);
    expect(Object.hasOwn(capsule.fork.people.a!, "deathYear")).toBe(false);
    expect(Object.hasOwn(capsule.fork.people.a!.mind.thoughts.at(-1)!, "personId")).toBe(false);
    for (const mutate of [
      (s: FavorFork) => { (s.people.a as unknown as Record<string, unknown>).extension = undefined; },
      (s: FavorFork) => { (s.grain as Record<string, unknown>).a = undefined; },
      (s: FavorFork) => { (s.actions as unknown[])[0] = undefined; },
    ]) {
      const bad = structuredClone(state); mutate(bad);
      expect(() => createFavorForkCapsule(bad)).toThrow();
    }
  });
  it("covers every declared nested optional, preserving all defined legacy values", () => {
    const state = createFavorFork(createFavorScheduler(initial(), "seed", 1335), "optional");
    const person = state.people.a as unknown as Record<string, unknown>;
    for (const key of ["deathYear", "spouseId", "motherId", "fatherId", "socialClass", "literate", "away"]) person[key] = undefined;
    person.lifeState = { slots: {}, situations: {}, marriageableSince: undefined, marital: { status: "single", partnerId: undefined }, residence: { status: "home", place: undefined }, vocation: { status: "none", masterId: undefined } };
    state.people.a!.mind.memories.push({ year: 1335, text: "identity \ud800", emotion: "joy", core: false, personId: undefined });
    state.people.a!.mind.thoughts.push({ emotion: "joy", cause: "cause", intensity: 1, yearsLeft: 1, year: 1335, personId: undefined });
    state.legacyEvents.push({ id: "legacy", kind: "birth", year: 1300, actors: ["a"], payload: {}, causes: [], significance: undefined });
    const capsule = createFavorForkCapsule(state);
    const fork = deserializeFavorForkCapsule(serializeFavorForkCapsule(capsule)).fork;
    expect(encode(fork.people)).toBe(encode(JSON.parse(JSON.stringify(state.people))));
    expect(fork.legacyEvents).toEqual([{ id: "legacy", kind: "birth", year: 1300, actors: ["a"], payload: {}, causes: [] }]);
    expect(state.people.a!.lifeState!.marital).toHaveProperty("partnerId");
    expect(fork.people.a!.mind.memories.at(-1)!.text).toBe("identity \ud800");
    const raw = structuredClone(capsule);
    (raw.fork.people.a as unknown as Record<string, unknown>).deathYear = undefined;
    expect(admitFavorForkCapsule(raw).digest).toBe(capsule.digest);
  });
  it("rejects late bad metadata and all undefined outside the legacy fork boundary", () => {
    const capsule = createFavorForkCapsule(root());
    for (const mutate of [
      (c: typeof capsule) => { (c.manifest.config as unknown as Record<string, unknown>).selection = undefined; },
      (c: typeof capsule) => { (c.registryOrder as unknown[])[0] = undefined; },
      (c: typeof capsule) => { (c.fork.prefix as unknown as Record<string, unknown>).extra = undefined; },
    ]) {
      const bad = structuredClone(capsule); mutate(bad);
      expect(() => admitFavorForkCapsule(bad)).toThrow();
    }
    let hooks = 0;
    Object.defineProperty(capsule.fork.years.at(-1)!, "hidden", { get() { hooks++; return 1; } });
    expect(() => admitFavorForkCapsule(capsule)).toThrow();
    expect(hooks).toBe(0);
  });
  it.each(["accessor", "hidden", "symbol", "function", "toJSON", "prototype", "sparse", "cycle"])("rejects %s anywhere before hooks execute", kind => {
    let hooks = 0;
    const state = root();
    const bad: Record<string, unknown> = {};
    if (kind === "accessor") Object.defineProperty(bad, "x", { enumerable: true, get() { hooks++; return 1; } });
    if (kind === "hidden") Object.defineProperty(bad, "x", { get() { hooks++; return 1; } });
    if (kind === "symbol") bad[Symbol("x") as unknown as string] = 1;
    if (kind === "function") bad.x = () => { hooks++; };
    if (kind === "toJSON") bad.toJSON = () => { hooks++; return {}; };
    if (kind === "prototype") Object.setPrototypeOf(bad, { toJSON() { hooks++; return {}; } });
    if (kind === "sparse") bad.x = new Array(2);
    if (kind === "cycle") bad.x = bad;
    (state.people.a as unknown as Record<string, unknown>).extension = bad;
    expect(() => createFavorForkCapsule(state)).toThrow();
    expect(() => admitFavorForkCapsule({ manifest: FAVOR_FORK_CAPSULE_MANIFEST, fork: state, registryOrder: ["a", "b"], digest: "0".repeat(64) })).toThrow();
    expect(hooks).toBe(0);
  });
  it.each(["hidden-data", "extended-array", "array-accessor", "array-prototype", "nonfinite", "bigint"])("rejects additional non-JSON %s trees without hooks", kind => {
    const capsule = createFavorForkCapsule(root());
    let hooks = 0;
    let bad: unknown = {};
    if (kind === "hidden-data") Object.defineProperty(bad, "x", { value: 1 });
    if (kind === "extended-array") bad = Object.assign([], { extra: 1 });
    if (kind === "array-accessor") { bad = [1]; Object.defineProperty(bad, "0", { enumerable: true, get() { hooks++; return 1; } }); }
    if (kind === "array-prototype") { bad = []; Object.setPrototypeOf(bad, { map() { hooks++; } }); }
    if (kind === "nonfinite") bad = Infinity;
    if (kind === "bigint") bad = BigInt(1);
    (capsule.fork.people.a as unknown as Record<string, unknown>).extension = bad;
    expect(() => admitFavorForkCapsule(capsule)).toThrow();
    expect(hooks).toBe(0);
  });
  it("guards envelope and config descriptors before reads", () => {
    let hooks = 0;
    const capsule = createFavorForkCapsule(root());
    Object.defineProperty(capsule, "digest", { get() { hooks++; return "0".repeat(64); }, enumerable: true });
    expect(() => admitFavorForkCapsule(capsule)).toThrow();
    expect(() => createFavorForkCapsule(root(), { get activation() { hooks++; return .25; } })).toThrow();
    expect(hooks).toBe(0);
  });
  it("rejects each manifest axis, effective config and mixed provenance", () => {
    const capsule = createFavorForkCapsule(root());
    for (const key of Object.keys(capsule.manifest)) {
      const bad = structuredClone(capsule);
      (bad.manifest as unknown as Record<string, unknown>)[key] = "unknown";
      expect(() => admitFavorForkCapsule(rehash(bad))).toThrow();
    }
    for (const key of Object.keys(capsule.fork.manifest)) {
      const bad = structuredClone(capsule);
      (bad.fork.manifest as unknown as Record<string, unknown>)[key] = "unknown";
      expect(() => admitFavorForkCapsule(rehash(bad))).toThrow();
    }
    expect(() => createFavorForkCapsule(root(), { ...capsule.fork.manifest.config, activation: .5 })).toThrow();
    expect(() => createFavorForkCapsule(createFavorScheduler(initial(), "seed", 1335) as unknown as FavorFork)).toThrow();
    expect(() => admitFavorForkCapsule(createFavorCapsule(createFavorScheduler(initial(), "seed", 1335)))).toThrow();
    expect(() => createFavorForkCapsule(createAuthorityFavorState(initial()) as unknown as FavorFork)).toThrow();
    expect(() => createFavorForkCapsule(initial().people.a as unknown as FavorFork)).toThrow();
    for (const key of Object.keys(capsule.manifest.config)) {
      const bad = structuredClone(capsule);
      (bad.manifest.config as unknown as Record<string, unknown>)[key] = "unknown";
      expect(() => admitFavorForkCapsule(rehash(bad))).toThrow();
      const badFork = structuredClone(capsule);
      (badFork.fork.manifest.config as unknown as Record<string, unknown>)[key] = "unknown";
      expect(() => admitFavorForkCapsule(rehash(badFork))).toThrow();
    }
    expect(() => admitFavorForkCapsule({ ...capsule, extra: 1 })).toThrow();
  });
  it.each(["grain", "history", "mapping", "lineage", "frontier", "years", "effects", "authority", "chronology"])("rejects stale AND recomputed digest for forged %s", field => {
    const capsule = createFavorForkCapsule(runFavorForkYear(declareForkChoice(root(), choice()), 1337));
    const s = capsule.fork;
    if (field === "grain") s.grain.a = 99;
    if (field === "history") s.history[0]!.status = "inactive";
    if (field === "mapping") s.mapping[0]!.physical = "forged";
    if (field === "lineage") s.lineage = "forged";
    if (field === "frontier") s.prefix.completedYear++;
    if (field === "years") s.years[0]!.year++;
    if (field === "effects") s.events[0]!.effects = [];
    if (field === "authority") {
      const response = s.events.find(event => event.version === "favor-fork-d2b" && event.kind === "help-response")!;
      (response.evidence as unknown as Record<string, unknown>).authority = { source: "seeded" };
    }
    if (field === "chronology") s.actions.reverse();
    expect(() => admitFavorForkCapsule(capsule)).toThrow();
    expect(() => admitFavorForkCapsule(rehash(capsule))).toThrow();
  });
  it("requires exact canonical wire and lowercase hash syntax", () => {
    const capsule = createFavorForkCapsule(root());
    const wire = serializeFavorForkCapsule(capsule);
    for (const bad of [` ${wire}`, `${wire}\n`, wire.replace('"digest":', '"digest":"duplicate","digest":'), wire.replace('"root"', '"\\u0072oot"'), wire.replace('0.25', '2.5e-1')]) {
      expect(() => deserializeFavorForkCapsule(bad)).toThrow();
    }
    for (const digest of [capsule.digest.toUpperCase(), "0".repeat(63), "g".repeat(64)]) expect(() => admitFavorForkCapsule({ ...capsule, digest })).toThrow();
    expect(() => deserializeFavorForkCapsule({ toString() { throw new Error("hook"); } })).toThrow();
  });
  it("has no production, legacy storage, simulation or provider imports", () => {
    const source = readFileSync(new URL("./favor-fork-capsule.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/(?:from\s+["'][^"']*(?:simulate|life-store|\/db|decision-engine|worldgen|replay|adapters)|require\()/);
  });
});

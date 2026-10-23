import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createMind } from "./mind";
import { createHelpFavorState, grantHelpFavor } from "./effects";
import { createFavorScheduler, runFavorYear } from "./scheduler";
import type { Person } from "./types";
import { admitFavorCapsule, createFavorCapsule, serializeFavorCapsule, deserializeFavorCapsule, FAVOR_CAPSULE_MANIFEST } from "./favor-capsule";

vi.mock("./replay", () => { throw new Error("Legacy replay imported"); });
vi.mock("./simulate", () => { throw new Error("Production simulation imported"); });
vi.mock("../server/db", () => { throw new Error("Production database imported"); });
vi.mock("../server/life-store", () => { throw new Error("Legacy storage imported"); });
const clone = <T>(value: T): T => structuredClone(value);
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
function resign(capsule: ReturnType<typeof createFavorCapsule>) {
  const { digest: _digest, ...payload } = capsule;
  void _digest;
  capsule.digest = createHash("sha256").update(canonical(payload)).digest("hex");
  return capsule;
}

function capsuleFixture(seed = "c2-2") {
  const people: Record<string, Person> = {};
  for (const id of ["b", "a"]) people[id] = { id, name: id, sex: "f", birthYear: 1300, founder: true, job: "none", traits: [], mind: createMind("capsule", id, 1300) };
  let state = createHelpFavorState(people, [], { a: 2, b: 0 }, { b: 2 }, { a: 2 });
  for (let i = 0; i < 2; i++) state = grantHelpFavor(state, { key: `g${i}`, year: 1336, creditor: "a", debtor: "b", causes: [], ties: [], appraisals: [] });
  return runFavorYear(createFavorScheduler(state, seed, 1336), 1337);
}

describe("D1 capsule", () => {
  it("cold-decodes the complete quiet frontier and registry order before continuing C2", () => {
    const scheduler = capsuleFixture();
    const capsule = createFavorCapsule(scheduler);
    const wire = serializeFavorCapsule(capsule);
    const cold = deserializeFavorCapsule(wire);
    expect(cold).toEqual(capsule);
    expect(Object.keys(cold.scheduler.state.people)).toEqual(["b", "a"]);
    expect(serializeFavorCapsule(cold)).toBe(wire);
    expect(runFavorYear(cold.scheduler, 1338)).toEqual(runFavorYear(scheduler, 1338));
    expect(cold.scheduler.seed).toBe("c2-2");
    expect(cold.scheduler.initialPrefixLength).toBe(2);
    expect(cold.scheduler.state.events).toHaveLength(2);
    expect(cold.scheduler.years[0]!.attempts.every((attempt) => attempt.kind === "inactive")).toBe(true);
    expect(Object.isFrozen(FAVOR_CAPSULE_MANIFEST)).toBe(true);
    expect(Object.isFrozen(FAVOR_CAPSULE_MANIFEST.config)).toBe(true);
  });

  it("hashes the exact canonical payload, annual effects and actual declared traversal", () => {
    const capsule = createFavorCapsule(capsuleFixture("c2-1"));
    expect(resign(clone(capsule)).digest).toBe(capsule.digest);
    expect(capsule.scheduler.state.events.length).toBeGreaterThan(2);
    const reordered = clone(capsule.scheduler);
    reordered.state.people = { a: reordered.state.people.a!, b: reordered.state.people.b! };
    const other = createFavorCapsule(reordered);
    expect(other.digest).not.toBe(capsule.digest);
    const cold = deserializeFavorCapsule(serializeFavorCapsule(capsule));
    expect(cold.scheduler).toEqual(capsule.scheduler);
    expect(Object.keys(cold.scheduler.state.people)).toEqual(["b", "a"]);
  });

  it("normalizes only declared own-undefined legacy optionals before hashing and admission", () => {
    const base = capsuleFixture();
    const candidate = clone(base);
    const person = candidate.state.people.b!;
    for (const key of ["deathYear", "spouseId", "motherId", "fatherId", "socialClass", "literate", "away", "lifeState"] as const) Object.defineProperty(person, key, { value: undefined, enumerable: true, configurable: true });
    person.mind.thoughts = [{ emotion: "joy", cause: "fixture", intensity: 1, yearsLeft: 1, year: 1336, personId: undefined }];
    person.mind.memories = [{ emotion: "joy", text: "fixture", year: 1336, core: false, personId: undefined }];
    base.state.people.b!.mind.thoughts = [{ emotion: "joy", cause: "fixture", intensity: 1, yearsLeft: 1, year: 1336 }];
    base.state.people.b!.mind.memories = [{ emotion: "joy", text: "fixture", year: 1336, core: false }];
    const expected = createFavorCapsule(base);
    expect(createFavorCapsule(candidate)).toEqual(expected);
    const capsule = clone(expected);
    Object.defineProperty(capsule.scheduler.state.people.b!, "spouseId", { value: undefined, enumerable: true });
    expect(admitFavorCapsule(capsule)).toEqual(expected);
  });

  it("normalizes declared nested life-state and legacy-event fields without pruning payloads", () => {
    const scheduler = capsuleFixture();
    scheduler.state.people.b!.lifeState = {
      marital: { status: "single", since: 1300, partnerId: undefined },
      residence: { status: "home", since: 1300, place: undefined },
      vocation: { status: "idle", since: 1300, masterId: undefined },
      marriageableSince: undefined, slots: {}, situations: [],
    };
    scheduler.state.legacyEvents = [{ id: "legacy", year: 1300, kind: "birth", actors: ["b"], causes: [], payload: {}, significance: undefined }];
    const normalized = createFavorCapsule(scheduler);
    const cold = deserializeFavorCapsule(serializeFavorCapsule(normalized));
    expect(Object.hasOwn(cold.scheduler.state.people.b!.lifeState!, "marriageableSince")).toBe(false);
    expect(Object.hasOwn(cold.scheduler.state.legacyEvents[0]!, "significance")).toBe(false);
    expect(Object.hasOwn(cold.scheduler.state.people.b!.lifeState!.residence, "place")).toBe(false);
    Object.defineProperty(scheduler.state.legacyEvents[0]!.payload, "unknown", { value: undefined, enumerable: true });
    expect(() => createFavorCapsule(scheduler)).toThrow();
  });

  it.each([
    ["unknown Person", (s: ReturnType<typeof capsuleFixture>) => Object.assign(s.state.people.b!, { unknown: undefined })],
    ["required Person", (s: ReturnType<typeof capsuleFixture>) => Object.assign(s.state.people.b!, { name: undefined })],
    ["unknown mind", (s: ReturnType<typeof capsuleFixture>) => Object.assign(s.state.people.b!.mind, { unknown: undefined })],
    ["array undefined", (s: ReturnType<typeof capsuleFixture>) => Object.assign(s.state.people.b!.traits, { 0: undefined })],
    ["resource undefined", (s: ReturnType<typeof capsuleFixture>) => Object.assign(s.state.need, { a: undefined })],
    ["sparse", (s: ReturnType<typeof capsuleFixture>) => { s.years.length = 2; }],
    ["extended array", (s: ReturnType<typeof capsuleFixture>) => Object.assign(s.years, { extra: 1 })],
    ["nonstandard array", (s: ReturnType<typeof capsuleFixture>) => Object.setPrototypeOf(s.years, null)],
    ["cycle", (s: ReturnType<typeof capsuleFixture>) => Object.assign(s, { self: s })],
    ["nonfinite", (s: ReturnType<typeof capsuleFixture>) => { s.state.need.a = Infinity; }],
    ["symbol", (s: ReturnType<typeof capsuleFixture>) => Object.assign(s, { [Symbol("x")]: 1 })],
    ["hidden", (s: ReturnType<typeof capsuleFixture>) => Object.defineProperty(s, "hidden", { value: 1 })],
    ["class container", (s: ReturnType<typeof capsuleFixture>) => Object.assign(s, { unknown: new Date() })],
  ])("rejects %s own-data violations", (_name, mutate) => {
    const scheduler = capsuleFixture();
    mutate(scheduler);
    expect(() => createFavorCapsule(scheduler)).toThrow();
  });

  it("rejects descriptors and object wire/seed/order primitives without executing any hooks", () => {
    let executions = 0;
    const hook = { toJSON() { executions++; return "x"; }, toString() { executions++; return "x"; } };
    const capsule = createFavorCapsule(capsuleFixture());
    Object.defineProperty(capsule.scheduler.state.people.b!, "name", { get() { executions++; return "b"; }, enumerable: true });
    expect(() => admitFavorCapsule(capsule)).toThrow();
    expect(() => deserializeFavorCapsule(hook)).toThrow();
    const seed = capsuleFixture();
    Object.assign(seed, { seed: hook });
    expect(() => createFavorCapsule(seed)).toThrow();
    const order = createFavorCapsule(capsuleFixture());
    Object.assign(order.registryOrder, { 0: hook });
    expect(() => admitFavorCapsule(order)).toThrow();
    expect(executions).toBe(0);
  });

  it.each([
    ["digest", (c: ReturnType<typeof createFavorCapsule>) => { c.digest = "0".repeat(64); }, false],
    ["tuple", (c: ReturnType<typeof createFavorCapsule>) => Object.assign(c.manifest, { engine: "unknown" }), true],
    ["extra manifest", (c: ReturnType<typeof createFavorCapsule>) => Object.assign(c.manifest, { extra: true }), true],
    ["config", (c: ReturnType<typeof createFavorCapsule>) => Object.assign(c.manifest.config, { activation: 1 }), true],
    ["missing config", (c: ReturnType<typeof createFavorCapsule>) => { Reflect.deleteProperty(c.manifest.config, "selection"); }, true],
    ["missing id", (c: ReturnType<typeof createFavorCapsule>) => { c.registryOrder = ["b"]; }, true],
    ["duplicate id", (c: ReturnType<typeof createFavorCapsule>) => { c.registryOrder = ["b", "b"]; }, true],
    ["unknown id", (c: ReturnType<typeof createFavorCapsule>) => { c.registryOrder = ["b", "unknown"]; }, true],
    ["frontier", (c: ReturnType<typeof createFavorCapsule>) => { c.scheduler.completedYear++; }, true],
    ["annual evidence", (c: ReturnType<typeof createFavorCapsule>) => { c.scheduler.years[0]!.attempts = []; }, true],
    ["resource checkpoint", (c: ReturnType<typeof createFavorCapsule>) => { c.scheduler.state.grain.a = 9; }, true],
    ["root seed", (c: ReturnType<typeof createFavorCapsule>) => { c.scheduler.seed = "forged-seed"; }, true],
    ["initial frontier", (c: ReturnType<typeof createFavorCapsule>) => { c.scheduler.initialPreviousYear = 1335; }, true],
    ["prefix boundary", (c: ReturnType<typeof createFavorCapsule>) => { c.scheduler.initialPrefixLength = 0; }, true],
    ["recorded effects", (c: ReturnType<typeof createFavorCapsule>) => { c.scheduler.state.events[0]!.effects = []; }, true],
    ["missing scheduler version", (c: ReturnType<typeof createFavorCapsule>) => { Reflect.deleteProperty(c.scheduler, "rngVersion"); }, true],
    ["extra capsule", (c: ReturnType<typeof createFavorCapsule>) => Object.assign(c, { extra: true }), true],
    ["event enum", (c: ReturnType<typeof createFavorCapsule>) => Object.assign(c.scheduler.state.events[0]!, { kind: "invented" }), true],
  ])("rejects %s even with a recomputed digest where applicable", (_name, mutate, rehash) => {
    const capsule = clone(createFavorCapsule(capsuleFixture()));
    mutate(capsule);
    if (rehash) resign(capsule);
    expect(() => admitFavorCapsule(capsule)).toThrow();
  });

  it.each(["capsuleSchema", "projection", "engine", "reducer", "scheduler", "rng"])("rejects unsupported manifest axis %s", (axis) => {
    const capsule = clone(createFavorCapsule(capsuleFixture()));
    Object.assign(capsule.manifest, { [axis]: "unsupported" });
    expect(() => admitFavorCapsule(resign(capsule))).toThrow();
  });

  it("fails closed on legacy/provenance-less import and nonactual caller config", () => {
    for (const value of [{ people: {}, events: [] }, { cards: [] }, {}, null]) expect(() => admitFavorCapsule(value)).toThrow();
    expect(() => createFavorCapsule({ people: {}, events: [] } as never)).toThrow();
    expect(() => createFavorCapsule(capsuleFixture(), { ...FAVOR_CAPSULE_MANIFEST.config, slotsPerCreditorYear: 3 })).toThrow();
  });

  it("requires canonical wire bytes, rejecting duplicate keys and alternative syntax", () => {
    const capsule = createFavorCapsule(capsuleFixture());
    const wire = serializeFavorCapsule(capsule);
    for (const bad of [" " + wire, JSON.stringify(capsule, null, 2), wire.replace("{", `{"digest":"${capsule.digest}",`), "null", "[]"]) expect(() => deserializeFavorCapsule(bad)).toThrow();
  });

  it("preserves own '__proto__', Unicode and lone-surrogate actor IDs without pollution", () => {
    const people: Record<string, Person> = Object.create(null);
    for (const id of ["__proto__", "é", "\\ud800"]) people[id] = { id, name: id, sex: "f", birthYear: 1300, founder: true, job: "none", traits: [], mind: createMind("own-keys", id, 1300) };
    let state = createHelpFavorState(people, [], { ["__proto__"]: 1, é: 0 }, { é: 1 }, { ["__proto__"]: 1 });
    state = grantHelpFavor(state, { key: "proto-grant", year: 1336, creditor: "__proto__", debtor: "é", causes: [], ties: [], appraisals: [] });
    const scheduler = runFavorYear(createFavorScheduler(state, "own-keys", 1336), 1337);
    const capsule = createFavorCapsule(scheduler);
    const cold = deserializeFavorCapsule(serializeFavorCapsule(capsule));
    expect(Object.keys(cold.scheduler.state.people)).toEqual(["__proto__", "é", "\\ud800"]);
    expect(Object.hasOwn(cold.scheduler.state.people, "__proto__")).toBe(true);
    expect(cold.scheduler.state.people["__proto__"]!.id).toBe("__proto__");
    expect(cold).toEqual(capsule);
    expect(Object.getPrototypeOf({})).toBe(Object.prototype);
  });
});

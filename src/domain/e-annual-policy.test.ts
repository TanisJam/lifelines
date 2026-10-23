import { describe, expect, it, vi } from "vitest";
import { ANNUAL_FAVOR_POLICY_VERSION, buildAnnualFavorPlan } from "./e-annual-policy";
import { createAnnualRuntime, replayAnnualRuntime, type AnnualPlan, type Newcomer, type ResourceAllocation, type ResponseAuthority } from "./e-runtime";
import { createAnnualRuntimeCapsule, deserializeAnnualRuntimeCapsule, serializeAnnualRuntimeCapsule } from "./e-capsule";
import { forkAnnualRuntime } from "./e-fork";
import { initializeWorld } from "./world-initialization";

type Mutable<T> = T extends object ? { -readonly [K in keyof T]: Mutable<T[K]> } : T;
function mutableClone<T>(value: T): Mutable<T> {
  return structuredClone(value) as Mutable<T>;
}

const VERSION = "annual-favor-policy-ap1-1";
const START = 1327;
const YEAR = 1328;
const hostileIds = ["__proto__", "constructor", "toString", "a::b", "a", "b::c", "é", "e\u0301", "😀", "\ud800", "\ud801", "�", "0", "10", "2", '[]",\\'];
function quiet(year: number): AnnualPlan {
  return { year, physical: [], resources: [], grants: [], requests: [] };
}

// Independent numeric oracle: copy the published legacy FNV/Mulberry algorithm,
// not the production planner or RNG. All variable data occupies ONE RNG argument.
function draw(seed: string, year: number, purpose: string, ...actors: string[]): number {
  const tuple = JSON.stringify([purpose, VERSION, seed, year, ...actors]);
  const legacyKey = `${tuple}::::0::::0`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < legacyKey.length; i++) {
    hash ^= legacyKey.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  const a = ((hash >>> 0) + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function order(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8")) || (a < b ? -1 : a > b ? 1 : 0);
}
function allowance(seed: string, year: number, actor: string): ResourceAllocation {
  return { grain: draw(seed, year, "grain", actor) < 0.5 ? 0 : 2, effort: 1, need: 1 };
}
function expectedGrants(seed: string, year: number, actors: string[], blocked: string[][] = []) {
  const balances = new Map(actors.map(id => [id, allowance(seed, year, id)]));
  const received = new Set<string>();
  const pairs = blocked.map(pair => [...pair]);
  const result: { creditor: string; debtor: string }[] = [];
  for (const creditor of [...actors].sort(order)) {
    const budget = balances.get(creditor)!;
    if (budget.grain < 2 || budget.need < 1 || draw(seed, year, "offer", creditor) >= 0.25) continue;
    const candidates = actors.filter(debtor => debtor !== creditor && !received.has(debtor)
      && balances.get(debtor)!.grain === 0 && balances.get(debtor)!.effort >= 1
      && !pairs.some(pair => pair.includes(creditor) && pair.includes(debtor)));
    candidates.sort((a, b) => draw(seed, year, "target", creditor, a) - draw(seed, year, "target", creditor, b) || order(a, b));
    if (!candidates.length) continue;
    const debtor = candidates[0];
    result.push({ creditor, debtor });
    budget.grain--;
    balances.get(debtor)!.grain++;
    received.add(debtor);
    pairs.push([creditor, debtor]);
  }
  return result;
}
function fixture(seed = "ap1-oracle-0", authority?: ResponseAuthority) {
  const initialization = { seed, startYear: START, endYear: 1400, founderCount: 6 };
  const { world } = initializeWorld(initialization);
  const resources = Object.fromEntries(Object.keys(world.people).map(id => [id, { grain: 5, effort: 4, need: 3 }]));
  const runtime = createAnnualRuntime(initialization, resources, authority);
  const template = Object.values(world.people)[0];
  function person(id: string, birthYear = YEAR - 20): Newcomer {
    return { id, name: "New", sex: "f", birthYear, traits: [...template.traits], job: "none", mind: structuredClone(template.mind) };
  }
  return { runtime, person, initialization };
}
function added(ids: string[] = hostileIds, seed = "ap1-oracle-0", allocated = false) {
  const f = fixture(seed);
  const plan = quiet(START);
  // Isolate newcomers: every living founder goes away, rather than editing a snapshot.
  for (const p of Object.values(f.runtime.initial.state.people)) {
    if (p.birthYear <= START && (p.deathYear === undefined || p.deathYear > START)) {
      plan.physical.push({ id: JSON.stringify(["away", p.id]), causes: [], kind: "residence", actor: p.id, status: "away" });
    }
  }
  ids.forEach(id => {
    plan.physical.push({ id: JSON.stringify(["create", id]), causes: [], kind: "create", person: f.person(id) });
    if (allocated) plan.resources.push({ id: JSON.stringify(["allocate", id]), causes: [], kind: "allocate", actor: id, allocation: { grain: 5, effort: 4, need: 3 } });
  });
  const input = f.runtime.advance(plan);
  return { ...f, input };
}
function grantsOnly(plan: AnnualPlan) {
  return plan.grants.map(({ creditor, debtor }) => ({ creditor, debtor }));
}
function reverseRecords(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseRecords);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).reverse().map(([key, entry]) => [key, reverseRecords(entry)]));
  }
  return value;
}

describe("inactive AP1 annual favor planner", () => {
  it("versions its explicit allowance and neutral offers without physical or request work", () => {
    expect(ANNUAL_FAVOR_POLICY_VERSION).toBe(VERSION);
    const { runtime } = fixture();
    const input = runtime.initial;
    const plan = buildAnnualFavorPlan(input, START);
    expect(plan.physical).toEqual([]);
    expect(plan.requests).toEqual([]);
    expect(plan.year).toBe(START);
    const adults = Object.values(input.state.people).filter(p => p.birthYear <= START - 16 && p.deathYear === undefined && !p.away && p.lifeState?.residence.status !== "away");
    expect(new Set(plan.resources.map(op => op.actor))).toEqual(new Set(adults.map(p => p.id)));
    for (const p of adults) {
      const ops = plan.resources.filter(op => op.actor === p.id);
      expect(ops).toEqual(["grain", "effort", "need"].map(resource => ({
        id: JSON.stringify(["reset", VERSION, START, p.id, resource]), causes: [], kind: "resource-change", actor: p.id, resource,
        amount: allowance("ap1-oracle-0", START, p.id)[resource as keyof ResourceAllocation] - (resource === "grain" ? 5 : resource === "effort" ? 4 : 3),
      })));
    }
    expect(grantsOnly(plan)).toEqual(expectedGrants("ap1-oracle-0", START, adults.map(p => p.id)));
    expect(runtime.advance(plan).journal.at(-1)!.entries.every(e => e.outcome === "committed")).toBe(true);
  });

  it.each([NaN, Infinity, -Infinity, 1327.5, Number.MAX_SAFE_INTEGER + 1, -0, 1326, 1401])("rejects invalid/out-of-origin year %s", year => {
    expect(() => buildAnnualFavorPlan(fixture().runtime.initial, year)).toThrow();
  });

  it("rejects same/past frontier, permits gaps and plans only the requested year", () => {
    const { input } = added();
    for (const year of [1326, START]) expect(() => buildAnnualFavorPlan(input, year)).toThrow();
    const plan = buildAnnualFavorPlan(input, 1335);
    expect(plan.year).toBe(1335);
    expect(plan.resources).toHaveLength(hostileIds.length);
    expect(plan.resources.every(op => op.kind === "allocate" && op.allocation.effort === 1)).toBe(true);
    expect(plan.physical).toEqual([]);
    expect(plan.requests).toEqual([]);
  });

  it.each([null, {}, [], "runtime", { version: "fake" }])("admits runtime before planning: rejects %j", input => {
    expect(() => buildAnnualFavorPlan(input, YEAR)).toThrow();
  });

  it("rejects tampering and descriptors before executing any getters or hooks", () => {
    const { input } = added();
    const tampered = mutableClone(input);
    Object.defineProperty(tampered.state.grain, "__proto__", { value: 9, enumerable: true });
    expect(() => buildAnnualFavorPlan(tampered, YEAR)).toThrow();
    const hook = vi.fn(() => { throw new Error("executed accessor"); });
    for (const path of ["frontier", "nested", "toJSON"]) {
      const candidate = structuredClone(input);
      if (path === "nested") Object.defineProperty(candidate.state.people.__proto__, "birthYear", { get: hook, enumerable: true });
      else Object.defineProperty(candidate, path, { get: hook, enumerable: true });
      expect(() => buildAnnualFavorPlan(candidate, YEAR)).toThrow();
    }
    expect(hook).not.toHaveBeenCalled();
  });

  it("uses actuarial age 16, never display age or an upper-age cap, and leaves dead/away/minors untouched", () => {
    const f = fixture();
    const people = [f.person("age15", YEAR - 15), f.person("age16", YEAR - 16), f.person("old", YEAR - 100), f.person("dead"), f.person("away"), f.person("newborn", START)];
    const prior = quiet(START);
    prior.physical = people.map(person => ({ id: `create-${person.id}`, kind: "create", person, causes: [] }));
    prior.physical.push({ id: "death", kind: "death", actor: "dead", causes: [] }, { id: "leave", kind: "residence", actor: "away", status: "away", causes: [] });
    const input = f.runtime.advance(prior);
    const plan = buildAnnualFavorPlan(input, YEAR);
    const selected = new Set(plan.resources.map(op => op.actor));
    expect(selected.has("age15")).toBe(false);
    expect(selected.has("age16")).toBe(true);
    expect(selected.has("old")).toBe(true);
    for (const id of ["dead", "away", "newborn"]) expect(selected.has(id)).toBe(false);
    const output = f.runtime.advance(plan);
    for (const id of ["dead", "away", "newborn", "age15"]) expect(Object.hasOwn(output.state.grain, id)).toBe(false);
    // A future birth cannot enter a genuine current runtime through creation.
    const future = mutableClone(input);
    future.state.people.newborn.birthYear = YEAR + 1;
    expect(() => buildAnnualFavorPlan(future, YEAR)).toThrow();
    const second = buildAnnualFavorPlan(output, YEAR + 1);
    expect(second.resources.filter(op => op.actor === "age15")).toHaveLength(1);
  });

  it("subtracts leftovers from all three resources, emits zero changes, and allocates all missing ledgers", () => {
    const { runtime, input } = added(hostileIds, "ap1-oracle-0", true);
    const plan = buildAnnualFavorPlan(input, YEAR);
    expect(plan.resources).toHaveLength(hostileIds.length * 3);
    for (const id of hostileIds) {
      expect(plan.resources.filter(op => op.actor === id).map(op => op.kind === "resource-change" ? op.amount : null))
        .toEqual([allowance("ap1-oracle-0", YEAR, id).grain - 5, -3, -2]);
    }
    const output = runtime.advance(plan);
    const next = buildAnnualFavorPlan(output, YEAR + 1);
    expect(next.resources.filter(op => op.kind === "resource-change" && op.resource !== "grain").map(op => op.kind === "resource-change" ? op.amount : null))
      .toEqual(Array(hostileIds.length * 2).fill(0));
    expect(next.resources.filter(op => op.kind === "resource-change").every(op => !Object.is(op.amount, -0))).toBe(true);
    const missing = added(["unallocated"]);
    expect(buildAnnualFavorPlan(missing.input, YEAR).resources).toEqual([{
      id: JSON.stringify(["allocate", VERSION, YEAR, "unallocated"]), causes: [], kind: "allocate", actor: "unallocated", allocation: allowance("ap1-oracle-0", YEAR, "unallocated"),
    }]);
  });

  it.each(["ap1-oracle-0", "ap1-oracle-1", "seed::actor", 'tuple[]"seed', "ap1-oracle-4"])("matches independent allowance/activation/target oracle for %s", seed => {
    const ids = [...hostileIds, ...Array.from({ length: 24 }, (_, i) => `actor-${i}`)];
    const { input, runtime } = added(ids, seed);
    for (const year of [YEAR, YEAR + 3]) {
      const plan = buildAnnualFavorPlan(input, year);
      expect(plan.resources.map(op => op.actor)).toEqual([...ids].sort(order));
      expect(plan.resources.map(op => op.kind === "allocate" ? op.allocation : null)).toEqual([...ids].sort(order).map(id => allowance(seed, year, id)));
      expect(grantsOnly(plan)).toEqual(expectedGrants(seed, year, ids));
      expect(new Set(plan.grants.map(op => op.creditor)).size).toBe(plan.grants.length);
      expect(new Set(plan.grants.map(op => op.debtor)).size).toBe(plan.grants.length);
      for (const op of plan.grants) {
        expect(op.causes).toEqual([]);
        expect(op.id).toBe(JSON.stringify(["grant", VERSION, year, op.creditor, op.debtor]));
        expect(allowance(seed, year, op.creditor).grain).toBe(2);
        expect(allowance(seed, year, op.debtor).grain).toBe(0);
        expect(draw(seed, year, "offer", op.creditor)).toBeLessThan(0.25);
      }
    }
    const plan = buildAnnualFavorPlan(input, YEAR);
    const output = runtime.advance(plan);
    for (const id of ids) {
      const expected = allowance(seed, YEAR, id).grain - Number(plan.grants.some(op => op.creditor === id)) + Number(plan.grants.some(op => op.debtor === id));
      expect(output.state.grain[id]).toBe(expected);
      expect(output.state.assistance[id]).toBe(1);
      expect(output.state.need[id]).toBe(1);
    }
    expect(output.state.obligations).toHaveLength(plan.grants.length);
    expect(output.state.ties).toEqual([]);
    expect(output.state.appraisals).toEqual([]);
  });

  it("blocks open HELP pairs in either direction while preserving prior debts", () => {
    const ids = Array.from({ length: 40 }, (_, i) => `actor-${i}`);
    const seed = "ap1-debts";
    const expected = expectedGrants(seed, YEAR + 1, ids);
    expect(expected.length).toBeGreaterThan(1);
    for (const reverse of [false, true]) {
      const { runtime } = added(ids, seed, true);
      const blocked = expected.map(({ creditor, debtor }) => [creditor, debtor]);
      const prior = quiet(YEAR);
      prior.grants = blocked.map(([a, b], i) => ({ id: `prior-${i}`, causes: [], creditor: reverse ? b : a, debtor: reverse ? a : b }));
      const input = runtime.advance(prior);
      const debts = structuredClone(input.state.obligations);
      const plan = buildAnnualFavorPlan(input, YEAR + 1);
      expect(grantsOnly(plan)).toEqual(expectedGrants(seed, YEAR + 1, ids, blocked));
      expect(plan.grants.some(op => blocked.some(pair => pair.includes(op.creditor) && pair.includes(op.debtor)))).toBe(false);
      const output = runtime.advance(plan);
      expect(output.state.obligations.slice(0, debts.length)).toEqual(debts);
      expect(input.state.obligations).toEqual(debts);
    }
  });

  it("reorders hostile records deterministically, breaks UTF-8 ties by raw IDs, and returns detached mutable plans", () => {
    const { input } = added();
    expect(Buffer.from("\ud800").equals(Buffer.from("\ud801"))).toBe(true);
    const before = structuredClone(input);
    const first = buildAnnualFavorPlan(input, YEAR);
    const second = buildAnnualFavorPlan(reverseRecords(input), YEAR);
    expect(second).toEqual(first);
    expect(first.resources.findIndex(op => op.actor === "\ud800")).toBeLessThan(first.resources.findIndex(op => op.actor === "\ud801"));
    expect(new Set(first.resources.map(op => op.id)).size).toBe(first.resources.length);
    expect(first).not.toBe(second);
    first.resources[0].causes.push("mutated");
    if (first.resources[0].kind === "allocate") first.resources[0].allocation.grain = 99;
    first.physical.push({ id: "new", causes: [], kind: "death", actor: "a" });
    expect(buildAnnualFavorPlan(input, YEAR)).toEqual(second);
    expect(input).toEqual(before);
  });

  it("resolves a genuine seeded target-score collision with the stable ID tie-break", () => {
    const seed = "ap1-target-tie";
    const creditor = Array.from({ length: 100 }, (_, i) => `creditor-${i}`).find(id =>
      allowance(seed, YEAR, id).grain === 2 && draw(seed, YEAR, "offer", id) < 0.25)!;
    expect(creditor).toBeDefined();
    const scores = new Map<number, string>();
    let pair: string[] | undefined;
    // A bounded deterministic oracle search supplies an actual 32-bit RNG tie;
    // no mocked draw or production test hook weakens this contract.
    for (let i = 0; i < 500_000 && !pair; i++) {
      const id = `recipient-${i}`;
      if (allowance(seed, YEAR, id).grain !== 0) continue;
      const score = draw(seed, YEAR, "target", creditor, id);
      const previous = scores.get(score);
      if (previous !== undefined) pair = [previous, id];
      else scores.set(score, id);
    }
    expect(pair).toBeDefined();
    const recipients = pair!.sort(order);
    expect(draw(seed, YEAR, "target", creditor, recipients[0])).toBe(draw(seed, YEAR, "target", creditor, recipients[1]));
    const { input } = added([creditor, ...[...recipients].reverse()], seed);
    expect(grantsOnly(buildAnnualFavorPlan(input, YEAR))).toEqual([{ creditor, debtor: recipients[0] }]);
    expect(buildAnnualFavorPlan(reverseRecords(input), YEAR)).toEqual(buildAnnualFavorPlan(input, YEAR));
  });

  it("keeps tuple identities injective despite legacy delimiter aliases and separates policy purposes", () => {
    expect(JSON.stringify(["grain", VERSION, "a::b", YEAR, "c"])).not.toBe(JSON.stringify(["grain", VERSION, "a", YEAR, "b::c"]));
    const left = added(["c"], "a::b");
    const right = added(["b::c"], "a");
    for (const [seed, actor, input] of [["a::b", "c", left.input], ["a", "b::c", right.input]] as const) {
      const op = buildAnnualFavorPlan(input, YEAR).resources[0];
      expect(op.kind === "allocate" && op.allocation).toEqual(allowance(seed, YEAR, actor));
    }
    const seed = "ap1-oracle-0";
    expect(new Set(["grain", "offer", "target"].map(purpose => draw(seed, YEAR, purpose, "a"))).size).toBe(3);
    expect(draw(seed, YEAR, "grain", "a")).not.toBe(draw(seed, YEAR + 1, "grain", "a"));
  });

  it("cold capsule replay and real fork suffix reproduce explicit advances without policy certification", () => {
    const { runtime, input } = added();
    const plan = buildAnnualFavorPlan(input, YEAR);
    const output = runtime.advance(plan);
    const cold = deserializeAnnualRuntimeCapsule(serializeAnnualRuntimeCapsule(createAnnualRuntimeCapsule(output)));
    expect(cold.output).toEqual(output);
    expect(replayAnnualRuntime(output)).toEqual(output);
    const suffixPlan = buildAnnualFavorPlan(cold.output, YEAR + 4);
    const fork = forkAnnualRuntime(cold, YEAR, [suffixPlan]);
    expect(fork.suffix[0]).toEqual(runtime.advance(suffixPlan));
    expect(fork.finalCapsule.output).toEqual(runtime.final());
    // Explicit callers can bypass AP1. Successful replay says nothing about provenance.
    const explicit = quiet(YEAR + 5);
    const bypass = runtime.advance(explicit);
    expect(replayAnnualRuntime(bypass)).toEqual(bypass);
    expect(bypass.journal.at(-1)!.plan.resources).toEqual([]);
  });

  it("does not claim same-year physical validity; runtime still rejects a planned grant after departure", () => {
    const { runtime, input } = added(Array.from({ length: 40 }, (_, i) => `actor-${i}`));
    const plan = buildAnnualFavorPlan(input, YEAR);
    expect(plan.grants.length).toBeGreaterThan(0);
    const actor = plan.grants[0].debtor;
    plan.physical.push({ id: "same-year-away", causes: [], kind: "residence", actor, status: "away" });
    const output = runtime.advance(plan);
    expect(output.journal.at(-1)!.entries.find(e => e.id === plan.grants[0].id)).toMatchObject({ outcome: "ineligible", reason: "absent" });
  });

  it("accepts positive-zero years under real origin bounds, but never negative-zero years", () => {
    const initialization = { seed: "minuszero", startYear: 0, endYear: 2, founderCount: 0 };
    const { world } = initializeWorld(initialization);
    const resources = Object.fromEntries(Object.keys(world.people).map(id => [id, { grain: 0, effort: 0, need: 0 }]));
    const runtime = createAnnualRuntime(initialization, resources);
    expect(() => buildAnnualFavorPlan(runtime.initial, -0)).toThrow();
    const plan = buildAnnualFavorPlan(runtime.initial, 0);
    expect(Object.is(plan.year, 0)).toBe(true);
    const output = runtime.advance(plan);
    expect(Object.is(output.frontier, 0)).toBe(true);
    expect(replayAnnualRuntime(output)).toEqual(output);
    expect(() => buildAnnualFavorPlan(output, 0)).toThrow();
    expect(buildAnnualFavorPlan(output, 2).year).toBe(2);
  });

  it("preserves admitted signed-zero Mind data and ineligible leftover balances", () => {
    const f = fixture("verify-1");
    expect(Object.is(f.runtime.initial.state.people.p002.mind.values.tradition, -0)).toBe(true);
    const person = f.person("signed-zero");
    person.mind.values.wealth = -0;
    const input = f.runtime.advance({ ...quiet(START), physical: [{ id: "create-signed-zero", kind: "create", person, causes: [] }] });
    const plan = buildAnnualFavorPlan(input, YEAR);
    const output = f.runtime.advance(plan);
    const cold = deserializeAnnualRuntimeCapsule(serializeAnnualRuntimeCapsule(createAnnualRuntimeCapsule(output)));
    expect(Object.is(input.state.people[person.id].mind.values.wealth, -0)).toBe(true);
    expect(Object.is(cold.output.state.people[person.id].mind.values.wealth, -0)).toBe(true);
    for (const op of plan.resources) {
      if (op.kind === "allocate") expect(Object.is(op.allocation.grain, -0)).toBe(false);
      else expect(Object.is(op.amount, -0)).toBe(false);
    }
    const away = added(["adult"]);
    const awayPlan = buildAnnualFavorPlan(away.input, YEAR);
    const after = away.runtime.advance(awayPlan);
    for (const id of Object.keys(away.runtime.initial.state.people)) {
      expect(after.state.grain[id]).toBe(away.input.state.grain[id]);
      expect(after.state.assistance[id]).toBe(away.input.state.assistance[id]);
      expect(after.state.need[id]).toBe(away.input.state.need[id]);
    }
  });

  it("emits positive additions when all eligible prior budgets are zero", () => {
    const { runtime, input } = added(hostileIds, "ap1-oracle-0", true);
    const zero = quiet(YEAR);
    zero.resources = hostileIds.flatMap(actor => (["grain", "effort", "need"] as const).map(resource => ({
      id: JSON.stringify(["zero", actor, resource]), kind: "resource-change" as const, actor, resource,
      amount: -(resource === "grain" ? 5 : resource === "effort" ? 4 : 3), causes: [],
    })));
    const resetInput = runtime.advance(zero);
    const plan = buildAnnualFavorPlan(resetInput, YEAR + 1);
    expect(plan.resources).toHaveLength(hostileIds.length * 3);
    for (const actor of hostileIds) {
      expect(plan.resources.filter(op => op.actor === actor).map(op => op.kind === "resource-change" ? op.amount : null))
        .toEqual(Object.values(allowance("ap1-oracle-0", YEAR + 1, actor)));
    }
    expect(input.frontier).toBe(START);
    expect(runtime.advance(plan).journal.at(-1)!.entries.every(entry => entry.outcome === "committed")).toBe(true);
  });

  it("rejects genuine human-authority output, without trying to invoke the authority", () => {
    const authority = vi.fn(() => ({ source: "human", selected: "help" }));
    const f = fixture("verify-1", authority);
    const [creditor, debtor] = Object.values(f.runtime.initial.state.people).filter(p => p.birthYear < START && p.deathYear === undefined && !p.away).map(p => p.id);
    f.runtime.advance({ ...quiet(START), grants: [{ id: "human-grant", creditor, debtor, causes: [] }] });
    const input = f.runtime.advance({ ...quiet(YEAR), requests: [{ id: "human-request", obligation: "human-grant/help", noise: 0 }] });
    expect(authority).toHaveBeenCalledTimes(1);
    expect(() => buildAnnualFavorPlan(input, YEAR + 1)).toThrow(/Human authority replay/);
    expect(authority).toHaveBeenCalledTimes(1);
  });
});

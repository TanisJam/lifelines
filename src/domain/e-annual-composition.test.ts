import { describe, expect, it, vi } from "vitest";
import { createAnnualRuntime, replayAnnualRuntime, type AnnualPlan, type Newcomer, type ResponseAuthority } from "./e-runtime";
import { ANNUAL_COMPOSITION_POLICY_VERSION, planAnnualHelpSlot } from "./e-annual-composition";
import { buildAnnualFavorPlan, planAnnualFavorDraft } from "./e-annual-policy";
import { initializeWorld } from "./world-initialization";
import { createAnnualRuntimeCapsule, deserializeAnnualRuntimeCapsule, serializeAnnualRuntimeCapsule } from "./e-capsule";

const START = 1327;
const YEAR = 1328;
const VERSION = "annual-composition-rc1-1";
const ids = ["__proto__", "constructor", "toString", "a::b", "é", "e\u0301", "\ud800", "\ud801", ...Array.from({ length: 24 }, (_, i) => `actor-${i}`)];
function quiet(year: number): AnnualPlan {
  return { year, physical: [], resources: [], grants: [], requests: [] };
}
// Independent FNV/Mulberry oracle for the published single-argument JSON tuple.
function draw(seed: string, year: number, purpose: string, ...parts: (string | number)[]) {
  const key = `${JSON.stringify([purpose, VERSION, seed, year, ...parts])}::::0::::0`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) { hash ^= key.charCodeAt(i); hash = Math.imul(hash, 0x01000193); }
  const a = ((hash >>> 0) + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function order(a: string, b: string) {
  return Buffer.compare(Buffer.from(a), Buffer.from(b)) || (a < b ? -1 : a > b ? 1 : 0);
}
function fixture(seed = "rc1-0", authority?: ResponseAuthority) {
  const initialization = { seed, startYear: START, endYear: 1400, founderCount: 6 };
  const { world } = initializeWorld(initialization);
  const resources = Object.fromEntries(Object.keys(world.people).map(id => [id, { grain: 5, effort: 4, need: 3 }]));
  const runtime = createAnnualRuntime(initialization, resources, authority);
  const template = Object.values(world.people)[0];
  function person(id: string, birthYear = START - 20): Newcomer {
    return { id, name: "New", sex: "f", birthYear, traits: [...template.traits], job: "none", mind: structuredClone(template.mind) };
  }
  const prior = quiet(START);
  for (const p of Object.values(runtime.initial.state.people)) {
    if (p.birthYear <= START && (p.deathYear === undefined || p.deathYear > START)) {
      prior.physical.push({ id: `leave-${p.id}`, causes: [], kind: "residence", actor: p.id, status: "away" });
    }
  }
  for (const id of ids) {
    prior.physical.push({ id: JSON.stringify(["create", id]), causes: [], kind: "create", person: person(id) });
    prior.resources.push({ id: JSON.stringify(["allocate", id]), causes: [], kind: "allocate", actor: id, allocation: { grain: 5, effort: 4, need: 3 } });
  }
  // Multiple earlier debts per creditor, without relying on policy activation.
  for (let i = 0; i < ids.length; i += 4) {
    for (let j = 1; j <= 3; j++) prior.grants.push({ id: `old-${i}-${j}`, causes: [], creditor: ids[i], debtor: ids[i + j] });
  }
  runtime.advance(prior);
  return { runtime, person, seed };
}

describe("RC1 atomic annual composition", () => {
  it("plans from the real post-physical draft, freezes once, and preserves explicit cold replay", () => {
    const { runtime, person } = fixture();
    const before = runtime.final();
    const input = { year: YEAR, physical: [
      { id: "death-now", kind: "death", actor: ids[0], causes: [] },
      { id: "away-now", kind: "residence", actor: ids[1], status: "away", causes: [] },
      { id: "create-now", kind: "create", person: person("new-adult", YEAR - 16), causes: [] },
      { id: "create-minor", kind: "create", person: person("minor", YEAR - 15), causes: [] },
    ] };
    const output = runtime.advanceWithAnnualPolicy(input);
    expect(ANNUAL_COMPOSITION_POLICY_VERSION).toBe(VERSION);
    const record = output.journal.at(-1)!;
    const allocated = new Set(record.plan.resources.map(op => op.actor));
    expect(allocated.has(ids[0])).toBe(false);
    expect(allocated.has(ids[1])).toBe(false);
    expect(allocated.has("new-adult")).toBe(true);
    expect(allocated.has("minor")).toBe(false);
    expect(record.entries.every(e => e.outcome === "committed")).toBe(true);
    expect(record.entries.map(e => ["physical", "resources", "grants", "help"].indexOf(e.phase)))
      .toEqual(record.entries.map(e => ["physical", "resources", "grants", "help"].indexOf(e.phase)).sort((a, b) => a - b));
    expect(output.journal).toHaveLength(before.journal.length + 1);
    expect(before.frontier).toBe(START);
    expect(output.state.grain[ids[0]]).toBe(before.state.grain[ids[0]]);
    expect(output.state.grain[ids[1]]).toBe(before.state.grain[ids[1]]);
    expect(replayAnnualRuntime(output)).toEqual(output);
    const cold = deserializeAnnualRuntimeCapsule(serializeAnnualRuntimeCapsule(createAnnualRuntimeCapsule(output)));
    expect(cold.output).toEqual(output);
    expect(Object.isFrozen(output.journal.at(-1)!.plan)).toBe(true);
    expect(Object.isFrozen(output.state.people["new-adult"].mind)).toBe(true);
    expect(input.physical).toHaveLength(4);
  });

  it.each(["rc1-0", "rc1-1", "rc1-2", "rc1-3", "tuple::seed"])("uses two independently activated slots and current revalidation: %s", seed => {
    const { runtime } = fixture(seed);
    const before = runtime.final();
    const output = runtime.advanceWithAnnualPolicy({ year: YEAR, physical: [] });
    const record = output.journal.at(-1)!;
    const requests = record.plan.requests;
    const need = new Map(ids.map(id => [id, 1]));
    const effort = new Map(ids.map(id => [id, 1]));
    const used = new Set<string>();
    const expected: typeof requests[number][] = [];
    for (const creditor of ids.filter((_, i) => i % 4 === 0).sort(order)) {
      for (const slot of [0, 1]) {
        if (draw(seed, YEAR, "help-activation", creditor, slot) >= 0.25) continue;
        const candidates = before.state.obligations.filter(o => o.creditor === creditor && !used.has(o.id)
          && need.get(creditor)! > 0 && effort.get(o.debtor)! > 0);
        candidates.sort((a, b) => draw(seed, YEAR, "help-selection", creditor, slot, a.id)
          - draw(seed, YEAR, "help-selection", creditor, slot, b.id) || order(a.id, b.id));
        const debt = candidates[0];
        if (!debt) continue;
        const request = { id: JSON.stringify(["request", VERSION, YEAR, creditor, slot, debt.id]), obligation: debt.id,
          noise: draw(seed, YEAR, "help-noise", creditor, slot, debt.id) };
        expected.push(request);
        used.add(debt.id);
        const response = record.entries.find(e => e.id === `${request.id}/response`)!;
        expect(response).toBeDefined();
        if (response.authority!.selected === "help") { need.set(creditor, need.get(creditor)! - 1); effort.set(debt.debtor, effort.get(debt.debtor)! - 1); }
      }
    }
    expect(requests).toEqual(expected);
    expect(requests.length).toBeGreaterThan(0);
    expect(record.entries.filter(e => e.kind === "request-ineligible")).toEqual([]);
    const counts = new Map<string, number>();
    for (const request of requests) {
      const debt = before.state.obligations.find(o => o.id === request.obligation)!;
      expect(debt).toBeDefined(); // Newly generated grants cannot be selected.
      counts.set(debt.creditor, (counts.get(debt.creditor) ?? 0) + 1);
    }
    expect([...counts.values()].every(count => count <= 2)).toBe(true);
    expect(output.state.obligations.slice(0, before.state.obligations.length).map(o => o.id)).toEqual(before.state.obligations.map(o => o.id));
    expect(replayAnnualRuntime(output)).toEqual(output);
  });

  it("preserves AP1 allowance and offer decisions without changing public admission", () => {
    const { runtime } = fixture();
    const ap1 = buildAnnualFavorPlan(runtime.final(), YEAR);
    const composed = runtime.advanceWithAnnualPolicy({ year: YEAR, physical: [] }).journal.at(-1)!.plan;
    expect(composed.resources).toEqual(ap1.resources);
    expect(composed.grants).toEqual(ap1.grants);
    expect(() => buildAnnualFavorPlan({ state: runtime.final().state }, YEAR + 1)).toThrow();
  });

  it("revalidates earlier debts after departure/death and never resets ineligible actors", () => {
    const { runtime } = fixture();
    const before = runtime.final();
    const physical = ids.filter((_, i) => i % 4 === 0).map((actor, i) => ({ id: `disable-${i}`, causes: [],
      ...(i % 2 ? { kind: "death" as const, actor } : { kind: "residence" as const, actor, status: "away" as const }) }));
    const output = runtime.advanceWithAnnualPolicy({ year: YEAR, physical });
    expect(output.journal.at(-1)!.plan.requests).toEqual([]);
    expect(output.state.obligations.slice(0, before.state.obligations.length)).toEqual(before.state.obligations);
  });

  it("rolls back every phase on authority failure, rejects reentrancy, and permits exact retry", () => {
    let bad = true;
    const authority = vi.fn(() => {
      expect(() => runtime.advanceWithAnnualPolicy({ year: YEAR + 1, physical: [] })).toThrow(/Reentrant/);
      return bad ? { source: "human", selected: "invalid" } : { source: "human", selected: "help" };
    });
    const runtime = fixture("rc1-0", authority).runtime;
    const before = runtime.final();
    const input = { year: YEAR, physical: [{ id: "staged-away", causes: [], kind: "residence", actor: ids[2], status: "away" }] };
    expect(() => runtime.advanceWithAnnualPolicy(input)).toThrow(/Invalid human/);
    expect(authority).toHaveBeenCalled();
    expect(runtime.final()).toEqual(before);
    bad = false;
    const output = runtime.advanceWithAnnualPolicy(input);
    expect(output.frontier).toBe(YEAR);
    expect(output.journal).toHaveLength(2);
    expect(() => replayAnnualRuntime(output)).toThrow(/Human authority/);
  });

  it("rejects malformed policy declarations before any getters; staging failure also leaves frontier unchanged", () => {
    const { runtime } = fixture();
    const before = runtime.final();
    const hook = vi.fn(() => []);
    const accessor = { year: YEAR };
    Object.defineProperty(accessor, "physical", { enumerable: true, get: hook });
    const inherited = Object.create({ year: YEAR, physical: [] });
    for (const input of [accessor, inherited, { year: YEAR, physical: [], resources: [] }, { year: YEAR, physical: [], policy: () => [] },
      { year: START, physical: [] }, { year: -0, physical: [] }, { year: 1401, physical: [] },
      { year: YEAR, physical: [{ id: "bad", kind: "death", actor: "missing", causes: [] }] }]) {
      expect(() => runtime.advanceWithAnnualPolicy(input)).toThrow();
      expect(runtime.final()).toEqual(before);
    }
    expect(hook).not.toHaveBeenCalled();
    expect(runtime.advanceWithAnnualPolicy({ year: YEAR, physical: [] }).frontier).toBe(YEAR);
  });

  it("runs both activated slots on refusal, but excludes previously requested debts next year", () => {
    const creditor = ids[0];
    const seed = Array.from({ length: 1000 }, (_, i) => `two-slots-${i}`).find(seed =>
      [0, 1].every(slot => draw(seed, YEAR, "help-activation", creditor, slot) < 0.25))!;
    expect(seed).toBeDefined();
    const authority = vi.fn(() => ({ source: "human", selected: "refuse" }));
    const { runtime } = fixture(seed, authority);
    const output = runtime.advanceWithAnnualPolicy({ year: YEAR, physical: [] });
    const debts = output.state.obligations.filter(o => o.creditor === creditor && o.origin.startsWith("old-"));
    const requests = output.journal.at(-1)!.plan.requests.filter(op => debts.some(o => o.id === op.obligation));
    expect(requests).toHaveLength(2);
    expect(new Set(requests.map(op => op.obligation)).size).toBe(2);
    const after = runtime.advanceWithAnnualPolicy({ year: YEAR + 1, physical: [] });
    expect(after.journal.at(-1)!.plan.requests.some(op => requests.some(prior => prior.obligation === op.obligation))).toBe(false);
  });

  it("returning home is eligible immediately and generated resource collisions roll back physical staging", () => {
    const f = fixture();
    const actor = ids[0];
    f.runtime.advance({ ...quiet(YEAR), physical: [{ id: "leave-temporarily", causes: [], kind: "residence", actor, status: "away" }] });
    const before = f.runtime.final();
    const resetId = JSON.stringify(["reset", "annual-favor-policy-ap1-1", YEAR + 1, actor, "grain"]);
    const physical = [{ id: resetId, causes: [], kind: "residence", actor, status: "home" }];
    expect(() => f.runtime.advanceWithAnnualPolicy({ year: YEAR + 1, physical })).toThrow(/Duplicate operation/);
    expect(f.runtime.final()).toEqual(before);
    const output = f.runtime.advanceWithAnnualPolicy({ year: YEAR + 1, physical: [{ ...physical[0], id: "return-home" }] });
    expect(output.journal.at(-1)!.plan.resources.filter(op => op.actor === actor)).toHaveLength(3);
    expect(output.state.people[actor].lifeState!.residence.status).toBe("home");
    expect(replayAnnualRuntime(output)).toEqual(output);
  });

  it("guarded draft helpers reject executable, missing and inherited fields without claiming output admission", () => {
    const { runtime } = fixture();
    const view = runtime.final().state;
    const hook = vi.fn(() => view.people);
    const accessor = structuredClone(view);
    Object.defineProperty(accessor, "people", { enumerable: true, get: hook });
    const missing = Object.fromEntries(Object.entries(view).filter(([key]) => key !== "need"));
    const inherited = Object.create(view);
    for (const bad of [accessor, missing, inherited, { ...view, callback: hook }]) {
      expect(() => planAnnualFavorDraft(bad, "seed", YEAR)).toThrow();
      expect(() => planAnnualHelpSlot(bad, "seed", YEAR, ids[0], 0)).toThrow();
    }
    expect(hook).not.toHaveBeenCalled();
    expect(() => buildAnnualFavorPlan(view, YEAR)).toThrow();
    expect(planAnnualFavorDraft(view, "rc1-0", YEAR)).toEqual(buildAnnualFavorPlan(runtime.final(), YEAR));
  });

  it("stable UTF-8/raw ordering survives registry insertion reversal, with detached plans", () => {
    const { runtime } = fixture();
    const view = runtime.final().state;
    const reversed = { ...structuredClone(view), people: Object.fromEntries(Object.entries(view.people).reverse()),
      obligations: [...view.obligations].reverse() };
    const left = planAnnualFavorDraft(view, "rc1-0", YEAR);
    const right = planAnnualFavorDraft(reversed, "rc1-0", YEAR);
    expect(right).toEqual(left);
    for (const creditor of ids.filter((_, i) => i % 4 === 0)) {
      for (const slot of [0, 1] as const) {
        expect(planAnnualHelpSlot(reversed, "rc1-0", YEAR, creditor, slot)).toEqual(planAnnualHelpSlot(view, "rc1-0", YEAR, creditor, slot));
      }
    }
    expect(left.resources.findIndex(op => op.actor === "\ud800")).toBeLessThan(left.resources.findIndex(op => op.actor === "\ud801"));
    left.resources[0].causes.push("external");
    expect(planAnnualFavorDraft(view, "rc1-0", YEAR)).toEqual(right);
    expect(new Set(right.resources.map(op => op.id)).size).toBe(right.resources.length);
    expect(Object.hasOwn(view.people, "__proto__")).toBe(true);
  });

  it("retains explicit bypass and year gaps; composition does not generate intervening plans", () => {
    const { runtime } = fixture();
    const bypass = runtime.advance(quiet(YEAR));
    expect(bypass.journal.at(-1)!.plan.resources).toEqual([]);
    const output = runtime.advanceWithAnnualPolicy({ year: YEAR + 5, physical: [] });
    expect(output.journal.map(record => record.plan.year)).toEqual([START, YEAR, YEAR + 5]);
    expect(replayAnnualRuntime(output)).toEqual(output);
  });
});

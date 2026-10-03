import { describe, expect, it, vi } from "vitest";
import { ANNUAL_RUNTIME_VERSION, createAnnualRuntime, replayAnnualRuntime, type AnnualPlan, type Newcomer, type ResponseAuthority, type RuntimeOutput } from "./e-runtime";
import { initializeWorld } from "./world-initialization";

type Mutable<T> = T extends object ? { -readonly [K in keyof T]: Mutable<T[K]> } : T;

const initialization = { seed: "verify-1", startYear: 1327, endYear: 1335, founderCount: 6 };
function fixture() {
  const { world } = initializeWorld(initialization);
  const actors = Object.values(world.people).filter(p => p.birthYear < 1327 && p.deathYear === undefined && !p.away).map(p => p.id);
  const [creditor, debtor, other] = actors;
  const resources = Object.fromEntries(Object.keys(world.people).map(id => [id, { grain: 2, effort: 1, need: 1 }]));
  return { creditor, debtor, other, resources, world };
}
function quiet(year: number): AnnualPlan { return { year, physical: [], resources: [], grants: [], requests: [] }; }
function grant(id = "grant", year = 1327): AnnualPlan {
  const { creditor, debtor } = fixture();
  return { ...quiet(year), grants: [{ id, creditor, debtor, causes: [] }] };
}
function request(noise = 0, year = 1328): AnnualPlan {
  return { ...quiet(year), requests: [{ id: "request", obligation: "grant/help", noise }] };
}
function setup(authority?: ResponseAuthority) {
  const f = fixture();
  return { ...f, runtime: createAnnualRuntime(initialization, f.resources, authority) };
}
function child(): Newcomer {
  const { world, debtor } = fixture();
  const p = world.people[debtor];
  return { id: "newborn", name: "New", sex: "f", birthYear: 1327, traits: [...p.traits], job: "none", mind: structuredClone(p.mind) };
}
function lastEntries(output: ReturnType<ReturnType<typeof createAnnualRuntime>["final"]>) { return output.journal.at(-1)!.entries; }
// Compare own data recursively: a valid own `constructor` is not a type marker.
function expectExactData(actual: unknown, expected: unknown) {
  if (expected !== null && typeof expected === "object") {
    expect(actual !== null && typeof actual === "object").toBe(true);
    expect(Reflect.ownKeys(actual as object)).toEqual(Reflect.ownKeys(expected));
    for (const key of Reflect.ownKeys(expected)) expectExactData(Reflect.get(actual as object, key), Reflect.get(expected, key));
  } else expect(Object.is(actual, expected)).toBe(true);
}

describe("E2a explicit annual runtime", () => {
  it("owns a two-year conserved favor, resource consumption, debt and supplemental tie", () => {
    const { creditor, debtor, runtime } = setup();
    const first = runtime.advance(grant());
    expect(first.state.grain[creditor]).toBe(1);
    expect(first.state.grain[debtor]).toBe(3);
    expect(Object.values(first.state.grain).reduce((a, b) => a + b, 0)).toBe(Object.values(runtime.initial.state.grain).reduce((a, b) => a + b, 0));
    const second = runtime.advance(request());
    expect(second.state.obligations[0]).toMatchObject({ status: "fulfilled", origin: "grant", creditor, debtor });
    expect(second.state.assistance[debtor]).toBe(0);
    expect(second.state.need[creditor]).toBe(0);
    expect(second.state.ties).toEqual([{ actor: creditor, counterpart: debtor, trust: 5, resentment: 0 }]);
    expect(second.state.appraisals).toEqual([]);
    expect(second.state.people[debtor].mind).toEqual(runtime.initial.state.people[debtor].mind);
    expect(second.origin).toEqual(first.origin);
    expect(second.genesis).toEqual(first.genesis);
    expect(second.version).toBe(ANNUAL_RUNTIME_VERSION);
    expect(second.genesis.originDigest).toBe(second.origin.digest);
    const [entry, response] = lastEntries(second);
    expect(entry.causes).toEqual(["grant"]);
    expect(response.causes).toEqual(["grant", "request"]);
    expect(response.authority).toMatchObject({ source: "rules", baseline: "help", selected: "help", noise: 0 });
    expect(response.consumed).toMatchObject({ evidence: { feasibility: { assistance: 1, need: 1 }, factors: { openDebt: true } } });
    expect(first.state.obligations[0].status).toBe("open");
  });

  it("permits an explicit human response opposing baseline without altering policy evidence", () => {
    const rules = setup(); rules.runtime.advance(grant());
    const expected = rules.runtime.advance(request());
    const questions: unknown[] = [];
    const human = setup(q => {
      questions.push(q);
      expect(Object.isFrozen(q)).toBe(true);
      expect(Object.isFrozen(q.evidence.factors)).toBe(true);
      expect(Object.keys(q).sort()).toEqual(["actors", "baseline", "evidence", "id", "noise", "obligation", "year"]);
      expect(() => { (q.evidence.factors as { altruism: number }).altruism = 0; }).toThrow();
      return { source: "human", selected: "refuse" };
    });
    human.runtime.advance(grant());
    const result = human.runtime.advance(request());
    const response = lastEntries(result).at(-1)!;
    expect(response.authority).toEqual({ source: "human", baseline: "help", selected: "refuse", noise: 0 });
    expect(response.consumed).toEqual(lastEntries(expected).at(-1)!.consumed);
    expect(result.state.obligations[0].status).toBe("broken");
    expect(result.state.assistance[human.debtor]).toBe(1);
    expect(result.state.need[human.creditor]).toBe(1);
    expect(result.state.ties[0]).toMatchObject({ trust: -5, resentment: 5 });
    expect(questions).toHaveLength(1);
    expect(() => replayAnnualRuntime(result)).toThrow(/Human authority replay/);
  });

  it("rules refusal is a response, not an ineligible attempt", () => {
    const { runtime, debtor, creditor } = setup(); runtime.advance(grant());
    const output = runtime.advance(request(0.999));
    expect(lastEntries(output).map(e => e.kind)).toEqual(["help-request", "help-response"]);
    expect(output.state.obligations[0].status).toBe("broken");
    expect(output.state.assistance[debtor]).toBe(1);
    expect(output.state.need[creditor]).toBe(1);
  });

  it("blocks same-year grant to help without calling authority or breaking debt", () => {
    const authority = vi.fn(() => ({ source: "human", selected: "help" }));
    const { runtime } = setup(authority);
    const output = runtime.advance({ ...grant(), requests: request().requests });
    expect(lastEntries(output).at(-1)).toMatchObject({ kind: "request-ineligible", reason: "grant-not-earlier", effects: [], outcome: "ineligible" });
    expect(output.state.obligations[0].status).toBe("open");
    expect(authority).not.toHaveBeenCalled();
  });

  it.each(["death", "residence"] as const)("same-year %s blocks grant and earlier help", kind => {
    const authority = vi.fn();
    const { runtime, debtor } = setup(authority); runtime.advance(grant());
    const physical = kind === "death"
      ? { id: "gone", causes: ["grant"], kind, actor: debtor }
      : { id: "gone", causes: ["grant"], kind, actor: debtor, status: "away" as const };
    const output = runtime.advance({ ...request(), physical: [physical], grants: grant("second", 1328).grants });
    expect(lastEntries(output).map(e => e.phase)).toEqual(["physical", "grants", "help"]);
    expect(lastEntries(output).slice(1).map(e => e.reason)).toEqual([kind === "death" ? "dead" : "absent", kind === "death" ? "dead" : "absent"]);
    expect(authority).not.toHaveBeenCalled();
    expect(output.state.obligations[0].status).toBe("open");
    expect(output.origin.initial.people[debtor].deathYear).toBeUndefined();
    expect(output.origin).toEqual(runtime.initial.origin);
    if (kind === "death") expect(output.state.people[debtor].deathYear).toBe(1328);
    else expect(output.state.people[debtor].lifeState!.residence.status).toBe("away");
  });

  it("explicit return restores presence without automatic annual reset", () => {
    const { runtime, debtor } = setup();
    runtime.advance({ ...quiet(1327), physical: [{ id: "leave", kind: "residence", actor: debtor, status: "away", causes: [] }] });
    const returned = runtime.advance({ ...grant("grant", 1328), physical: [{ id: "return", kind: "residence", actor: debtor, status: "home", causes: ["leave"] }] });
    expect(returned.state.obligations).toHaveLength(1);
    expect(returned.state.people[debtor].lifeState!.residence).toEqual({ status: "home", since: 1328, place: undefined });
    expect(replayAnnualRuntime(returned)).toEqual(returned);
  });

  it("a throwing authority publishes nothing and clears the guard for an explicit retry", () => {
    let fail = true;
    const { runtime } = setup(() => {
      if (fail) throw new Error("authority failed");
      return { source: "human", selected: "help" };
    });
    runtime.advance(grant());
    const before = runtime.final();
    expect(() => runtime.advance(request())).toThrow(/authority failed/);
    expect(runtime.final()).toEqual(before);
    fail = false;
    const output = runtime.advance(request());
    expect(output.state.obligations[0].status).toBe("fulfilled");
    expect(lastEntries(output).map(e => e.id)).toEqual(["request", "request/response"]);
  });

  it("recomputes after each grant and records caller order against current balances", () => {
    const { resources, creditor, debtor, other } = fixture(); resources[creditor].grain = 1;
    const runtime = createAnnualRuntime(initialization, resources);
    const output = runtime.advance({ ...quiet(1327), grants: [
      { id: "one", creditor, debtor, causes: [] },
      { id: "two", creditor, debtor: other, causes: ["one"] },
      { id: "three", creditor: debtor, debtor: other, causes: ["one"] },
    ] });
    expect(lastEntries(output).map(e => [e.id, e.declarationIndex, e.outcome])).toEqual([["one", 0, "committed"], ["two", 1, "ineligible"], ["three", 2, "committed"]]);
    expect(lastEntries(output)[1]).toMatchObject({ reason: "exhausted-grain", consumed: { grain: [0, 2], priorOperations: ["one"] } });
    expect(output.state.obligations.map(o => o.origin)).toEqual(["one", "three"]);
    expect(output.state.grain[debtor]).toBe(2);
  });

  it("recomputes competing requests after effort consumption, without treating exhaustion as refusal", () => {
    const { runtime, creditor, debtor, other } = setup();
    runtime.advance({ ...grant(), grants: [...grant().grants, { id: "other-grant", creditor: other, debtor, causes: [] }] });
    const output = runtime.advance({ ...request(), requests: [...request().requests, { id: "other-request", obligation: "other-grant/help", noise: 0 }] });
    expect(lastEntries(output).at(-1)).toMatchObject({ reason: "exhausted-assistance", outcome: "ineligible", effects: [] });
    expect(output.state.obligations.map(o => o.status)).toEqual(["fulfilled", "open"]);
    expect(output.state.need[creditor]).toBe(0);
    expect(output.state.need[other]).toBe(1);
    expect(runtime.advance(quiet(1330)).state.assistance[debtor]).toBe(0);
  });

  it.each(["effort", "need"] as const)("explicit %s depletion precedes eligibility", resource => {
    const authority = vi.fn();
    const { runtime, creditor, debtor } = setup(authority); runtime.advance(grant());
    const output = runtime.advance({ ...request(), resources: [{ id: "consume", kind: "resource-change", actor: resource === "effort" ? debtor : creditor, resource, amount: -1, causes: ["grant"] }] });
    expect(lastEntries(output).at(-1)?.reason).toBe(resource === "effort" ? "exhausted-assistance" : "no-need");
    expect(authority).not.toHaveBeenCalled();
    expect(output.state.obligations[0].status).toBe("open");
  });

  it("registers actual creation, gates participation until explicit allocation, then follows phase order", () => {
    const { runtime, creditor } = setup(); const person = child();
    const created = runtime.advance({ ...quiet(1327), physical: [{ id: "create", kind: "create", person, causes: [] }], grants: [{ id: "blocked", creditor, debtor: person.id, causes: ["create"] }] });
    expect(created.state.people[person.id].founder).toBe(false);
    expect(Object.hasOwn(created.state.grain, person.id)).toBe(false);
    expect(lastEntries(created).at(-1)?.reason).toBe("missing-allocation");
    expect(created.state.legacyEvents.at(-1)).toMatchObject({ id: "create", kind: "birth", year: 1327 });
    const output = runtime.advance({ ...quiet(1328), resources: [{ id: "allocation", kind: "allocate", actor: person.id, allocation: { grain: 0, effort: 1, need: 1 }, causes: ["create"] }], grants: [{ id: "new-grant", creditor, debtor: person.id, causes: ["allocation"] }] });
    expect(lastEntries(output).map(e => e.phase)).toEqual(["resources", "grants"]);
    expect(output.state.grain[person.id]).toBe(1);
    expect(output.genesis).toEqual(runtime.initial.genesis);
    expect(replayAnnualRuntime(output)).toEqual(output);
    const other = setup();
    const all = other.runtime.advance({ ...quiet(1327), physical: [{ id: "create", kind: "create", person, causes: [] }], resources: [{ id: "allocate", kind: "allocate", actor: person.id, allocation: { grain: 0, effort: 1, need: 1 }, causes: ["create"] }], grants: [{ id: "g", creditor, debtor: person.id, causes: ["allocate"] }], requests: [{ id: "r", obligation: "g/help", noise: 0 }] });
    expect(lastEntries(all).map(e => e.phase)).toEqual(["physical", "resources", "grants", "help"]);
    expect(lastEntries(all).map(e => e.position)).toEqual([0, 1, 2, 3]);
    expect(lastEntries(all)[2].consumed).toMatchObject({ priorOperations: ["create", "allocate"], grain: [2, 0] });
  });

  it.each(["constructor", "toString", "hasOwnProperty", "valueOf"].flatMap(id =>
    [1327, 1328].map(year => ({ id, year }))))("owns resource evidence for $id allocated in $year", ({ id, year }) => {
    const { runtime, creditor } = setup();
    const person = { ...child(), id };
    const creation: AnnualPlan["physical"] = [{ id: "create", kind: "create", person, causes: [] }];
    const allocation: AnnualPlan["resources"] = [{ id: "allocate", kind: "allocate", actor: id, allocation: { grain: 0, effort: 1, need: 1 }, causes: ["create"] }];
    if (year === 1328) {
      const created = runtime.advance({ ...quiet(1327), physical: creation,
        grants: [{ id: "blocked", creditor, debtor: id, causes: ["create"] }],
      });
      for (const ledger of [created.state.grain, created.state.assistance, created.state.need]) expect(Object.hasOwn(ledger, id)).toBe(false);
      expect(lastEntries(created).at(-1)).toMatchObject({ reason: "missing-allocation", consumed: { grain: [2, undefined], assistance: [1, undefined], need: [1, undefined] } });
      expectExactData(replayAnnualRuntime(created), created);
    }
    const output = runtime.advance({ ...quiet(year), physical: year === 1327 ? creation : [],
      resources: [...allocation, { id: "no-change", kind: "resource-change", actor: id, resource: "grain", amount: 0, causes: ["allocate"] }],
      grants: [{ id: "new-grant", creditor, debtor: id, causes: ["allocate"] }],
    });
    const entries = lastEntries(output);
    expect(entries.find(e => e.id === "allocate")).toMatchObject({ outcome: "committed", consumed: { grain: [undefined], assistance: [undefined], need: [undefined] } });
    expect(entries.find(e => e.id === "no-change")).toMatchObject({ consumed: { grain: [0], assistance: [1], need: [1] } });
    expect(entries.at(-1)).toMatchObject({ outcome: "committed", consumed: { grain: [2, 0], assistance: [1, 1], need: [1, 1] } });
    for (const [ledger, balance] of [[output.state.grain, 1], [output.state.assistance, 1], [output.state.need, 1]] as const) {
      expect(Object.hasOwn(ledger, id)).toBe(true);
      expect(ledger[id]).toBe(balance);
    }
    expect(output.state.obligations[0]).toMatchObject({ debtor: id, origin: "new-grant", status: "open" });
    expectExactData(replayAnnualRuntime(structuredClone(output)), output);
    const final = runtime.final();
    expectExactData(final, output);
    expect(final.state.grain).not.toBe(output.state.grain);
    expect(Object.isFrozen(output.state.grain)).toBe(true);
    expect(() => runtime.advance({ ...quiet(year + 1), resources: [{ ...allocation[0], id: "repeat-allocation" }] })).toThrow(/Already allocated/);
    expectExactData(runtime.final(), output);
    expectExactData(runtime.advance(quiet(year + 1)).state, output.state);
  });

  it.each(["newborn", "__proto__", "new\ud800actor"])("replays later help using the evolving registry for %j", id => {
    const { runtime, creditor } = setup();
    const person = { ...child(), id };
    runtime.advance({ ...quiet(1327),
      physical: [{ id: "creation", kind: "create", person, causes: [] }],
      resources: [{ id: "allocation", kind: "allocate", actor: id, allocation: { grain: 0, effort: 1, need: 1 }, causes: ["creation"] }],
      grants: [{ id: "new-grant", creditor, debtor: id, causes: ["allocation"] }],
    });
    const output = runtime.advance({ ...quiet(1328), requests: [{ id: "new-request", obligation: "new-grant/help", noise: 0 }] });
    expect(output.state.obligations[0]).toMatchObject({ debtor: id, status: "fulfilled" });
    expect(output.state.assistance[id]).toBe(0);
    expect(output.state.ties).toEqual([{ actor: creditor, counterpart: id, trust: 5, resentment: 0 }]);
    expect(Object.hasOwn(output.state.people, id)).toBe(true);
    expect(Object.hasOwn(runtime.initial.state.people, id)).toBe(false);
    expect(replayAnnualRuntime(output)).toEqual(output);
  });

  it("closed debt attempts stay ineligible even after explicit resource restoration", () => {
    const authority = vi.fn(() => ({ source: "human", selected: "help" }));
    const { runtime, creditor, debtor } = setup(authority);
    runtime.advance(grant()); runtime.advance(request());
    const output = runtime.advance({ ...quiet(1329), resources: [
      { id: "restore-effort", kind: "resource-change", actor: debtor, resource: "effort", amount: 1, causes: ["request/response"] },
      { id: "restore-need", kind: "resource-change", actor: creditor, resource: "need", amount: 1, causes: ["request/response"] },
    ], requests: [{ id: "repeat", obligation: "grant/help", noise: 0 }] });
    expect(lastEntries(output).at(-1)).toMatchObject({ reason: "closed", outcome: "ineligible", effects: [] });
    expect(output.state.assistance[debtor]).toBe(1);
    expect(output.state.need[creditor]).toBe(1);
    expect(output.state.obligations[0].status).toBe("fulfilled");
    expect(authority).toHaveBeenCalledTimes(1);
  });

  it("records adult arrival as registration, not a retroactively invented birth", () => {
    const { runtime } = setup(); const person = { ...child(), birthYear: 1300 };
    const output = runtime.advance({ ...quiet(1327), physical: [{ id: "arrival", kind: "create", person, causes: [] }] });
    expect(output.state.legacyEvents.at(-1)).toMatchObject({ kind: "town", year: 1327, payload: { birthYear: 1300, registration: "explicit-e2a" } });
    expect(lastEntries(output)[0].effects).toEqual([{ kind: "creation", person: { ...person, founder: false } }]);
  });

  it("stages failed years atomically and can retry the same frontier", () => {
    const { runtime, creditor, debtor } = setup(); const before = runtime.final();
    expect(() => runtime.advance({ ...grant(), resources: [{ id: "underflow", kind: "resource-change", actor: debtor, resource: "effort", amount: -2, causes: [] }] })).toThrow();
    expect(runtime.final()).toEqual(before);
    expect(() => runtime.advance({ ...grant(), grants: [...grant().grants, { id: "bad", creditor, debtor: "unknown", causes: [] }] })).toThrow(/Unknown actor/);
    expect(runtime.final()).toEqual(before);
    expect(runtime.advance(grant()).state.obligations).toHaveLength(1);
  });

  it.each(["unknown", "forward", "duplicate", "initial-collision"])("fails closed on %s causal identities", test => {
    const { runtime } = setup(); const plan = grant();
    if (test === "unknown") plan.grants[0].causes = ["missing"];
    if (test === "forward") { plan.grants[0].causes = ["later"]; plan.grants.push({ ...plan.grants[0], id: "later", causes: [] }); }
    if (test === "duplicate") plan.grants.push({ ...plan.grants[0] });
    if (test === "initial-collision") plan.grants[0].id = runtime.initial.state.legacyEvents[0].id;
    expect(() => runtime.advance(plan)).toThrow();
    expect(runtime.final()).toEqual(runtime.initial);
  });

  it("accepts explicit initial-history causes and records them unchanged", () => {
    const { runtime } = setup(); const plan = grant();
    const cause = runtime.initial.state.legacyEvents.find(e => e.year <= plan.year)!.id;
    plan.grants[0].causes = [cause];
    const output = runtime.advance(plan);
    expect(lastEntries(output)[0].causes).toEqual([cause]);
    expect(replayAnnualRuntime(output)).toEqual(output);
  });

  it("isolate caller declarations and detached immutable initial/year/final outputs", () => {
    const f = fixture(); const input = { ...initialization };
    const runtime = createAnnualRuntime(input, f.resources);
    input.seed = "changed"; f.resources[f.creditor].grain = 999;
    const plan = grant(); const output = runtime.advance(plan);
    plan.grants[0].id = "changed"; plan.year = 1330;
    expect(output.journal[0].plan.grants[0].id).toBe("grant");
    expect(output.genesis.resources[f.creditor].grain).toBe(2);
    expect(() => { (output.state.people[f.creditor] as { deathYear?: number }).deathYear = 1327; }).toThrow();
    expect(Object.isFrozen(runtime.initial.origin.initial.people[f.creditor].mind)).toBe(true);
    const final = runtime.final();
    expect(final).toEqual(output); expect(final).not.toBe(output); expect(final.state.people).not.toBe(output.state.people);
    runtime.advance(quiet(1330));
    expect(output.frontier).toBe(1327); expect(final.frontier).toBe(1327); expect(runtime.initial.frontier).toBeNull();
    const person = child(); const newborn = setup();
    newborn.runtime.advance({ ...quiet(1327), physical: [{ id: "create", kind: "create", person, causes: [] }] });
    person.mind.stress = 100;
    expect(newborn.runtime.final().state.people.newborn.mind.stress).not.toBe(100);
  });

  it("quiet/gapped frontiers run no hidden simulation or resource refill and replay independently", () => {
    const { runtime } = setup(); const before = runtime.initial;
    runtime.advance(quiet(1327)); const output = runtime.advance(quiet(1334));
    expect(output.state).toEqual(before.state);
    expect(output.journal.map(r => r.plan.year)).toEqual([1327, 1334]);
    expect(output.journal.map(r => r.entries)).toEqual([[], []]);
    expect(replayAnnualRuntime(output)).toEqual(output);
    expect(replayAnnualRuntime(structuredClone(output))).toEqual(output);
    for (const year of [1326, 1327, 1334, 1336]) expect(() => runtime.advance(quiet(year))).toThrow(/frontier/);
    expect(runtime.final()).toEqual(output);
  });

  it.each(["balances", "effects", "origin", "genesis", "order", "omission", "version", "frontier"])("reconstruction rejects tampered %s", kind => {
    const { runtime, debtor } = setup(); runtime.advance(grant()); const output = runtime.advance(request());
    const changed = structuredClone(output) as unknown as Mutable<RuntimeOutput>; // adversarial in-memory fixture
    if (kind === "balances") changed.state.assistance[debtor] = 1;
    if (kind === "effects") changed.journal[1].entries[1].effects = [];
    if (kind === "origin") changed.origin.digest = "0".repeat(64);
    if (kind === "genesis") changed.genesis.resources[debtor].effort = 2;
    if (kind === "order") changed.journal.reverse();
    if (kind === "omission") changed.journal.pop();
    if (kind === "version") changed.version = "future" as typeof ANNUAL_RUNTIME_VERSION;
    if (kind === "frontier") changed.frontier = 1330;
    expect(() => replayAnnualRuntime(changed)).toThrow();
  });

  it("initialization failure precedes resource and authority access", () => {
    let hooks = 0;
    const resources = Object.defineProperty({}, "bad", { enumerable: true, get() { hooks++; return 1; } });
    const authority = vi.fn();
    expect(() => createAnnualRuntime({ ...initialization, startYear: -0 }, resources, authority)).toThrow(/Negative zero/);
    expect(hooks).toBe(0); expect(authority).not.toHaveBeenCalled();
  });

  it.each(["grain", "effort", "need"] as const)("rejects -0 %s genesis input before authority, preserves +0", field => {
    const f = fixture(); f.resources[f.creditor][field] = -0;
    const authority = vi.fn();
    expect(() => createAnnualRuntime(initialization, f.resources, authority)).toThrow(/Negative zero/);
    expect(authority).not.toHaveBeenCalled();
    f.resources[f.creditor][field] = 0;
    const output = createAnnualRuntime(initialization, f.resources).initial;
    expect(Object.is(output.genesis.resources[f.creditor][field], 0)).toBe(true);
    expect(Object.is(replayAnnualRuntime(output).genesis.resources[f.creditor][field], 0)).toBe(true);
  });

  it.each(["year", "amount", "allocation", "noise", "birthYear"])("rejects new -0 %s journal input atomically before authority", field => {
    const authority = vi.fn(); const { runtime, debtor } = setup(authority);
    const plan = grant();
    if (field === "year") plan.year = -0;
    if (field === "amount") plan.resources = [{ id: "change", kind: "resource-change", actor: debtor, resource: "grain", amount: -0, causes: [] }];
    if (field === "allocation") plan.resources = [{ id: "allocate", kind: "allocate", actor: debtor, allocation: { grain: -0, effort: 1, need: 1 }, causes: [] }];
    if (field === "noise") plan.requests = [{ id: "r", obligation: "grant/help", noise: -0 }];
    if (field === "birthYear") plan.physical = [{ id: "create", kind: "create", person: { ...child(), birthYear: -0 }, causes: [] }];
    expect(() => runtime.advance(plan)).toThrow(/Negative zero|noise/);
    expect(runtime.final()).toEqual(runtime.initial); expect(authority).not.toHaveBeenCalled();
  });

  it("preserves generated Mind negative zero and distinguishes lossless newcomer Mind identity", () => {
    const { runtime } = setup();
    expect(Object.is(runtime.initial.state.people.p002.mind.values.tradition, -0)).toBe(true);
    const output = runtime.advance(quiet(1327));
    expect(Object.is(replayAnnualRuntime(output).state.people.p002.mind.values.tradition, -0)).toBe(true);
    const person = child(); person.mind.values.wealth = -0;
    const created = setup().runtime.advance({ ...quiet(1327), physical: [{ id: "create", kind: "create", person, causes: [] }] });
    expect(Object.is(replayAnnualRuntime(created).state.people.newborn.mind.values.wealth, -0)).toBe(true);
    const altered = structuredClone(created) as unknown as { state: { people: Record<string, Newcomer> } };
    altered.state.people.newborn.mind.values.wealth = 0;
    expect(() => replayAnnualRuntime(altered)).toThrow(/disagreement/);
  });

  it("accepts +0 annual year/noise/amount without changing E1 numeric fidelity", () => {
    const input = { seed: "minuszero", startYear: 0, endYear: 2, founderCount: 0 };
    const { world } = initializeWorld(input);
    const resources = Object.fromEntries(Object.keys(world.people).map(id => [id, { grain: 0, effort: 0, need: 0 }]));
    const runtime = createAnnualRuntime(input, resources);
    const actor = Object.values(world.people).find(p => p.deathYear === undefined)!.id;
    const output = runtime.advance({ ...quiet(0), resources: [{ id: "no-change", kind: "resource-change", actor, resource: "grain", amount: 0, causes: [] }] });
    expect(Object.is(output.frontier, 0)).toBe(true);
    expect(Object.is(replayAnnualRuntime(output).frontier, 0)).toBe(true);
    expect(Object.is(output.genesis.resources[actor].grain, 0)).toBe(true);
  });

  it.each(["missing-plan", "extra-actor", "negative", "fraction", "infinity", "overflow"])("fails closed on %s resource inputs", kind => {
    const f = fixture();
    if (kind === "missing-plan") delete f.resources[f.creditor];
    if (kind === "extra-actor") f.resources.unknown = { grain: 1, effort: 1, need: 1 };
    if (kind === "negative") f.resources[f.creditor].grain = -1;
    if (kind === "fraction") f.resources[f.creditor].grain = 0.5;
    if (kind === "infinity") f.resources[f.creditor].grain = Infinity;
    if (kind === "overflow") f.resources[f.creditor].grain = Number.MAX_SAFE_INTEGER + 1;
    expect(() => createAnnualRuntime(initialization, f.resources)).toThrow();
  });

  it.each(["unknown-op", "unknown-field", "unknown-obligation", "repeat-allocation", "overflow", "future-creation", "bad-mind", "duplicate-creation"])("rejects malformed %s operations and preserves owned state", kind => {
    const { runtime, debtor } = setup(); const plan = quiet(1327) as AnnualPlan & { extra?: boolean };
    if (kind === "unknown-op") plan.physical = [{ id: "p", kind: "simulate", causes: [] }] as unknown as AnnualPlan["physical"];
    if (kind === "unknown-field") plan.extra = true;
    if (kind === "unknown-obligation") plan.requests = [{ id: "r", obligation: "none", noise: 0 }];
    if (kind === "repeat-allocation") plan.resources = [{ id: "a", kind: "allocate", actor: debtor, allocation: { grain: 1, effort: 1, need: 1 }, causes: [] }];
    if (kind === "overflow") plan.resources = [{ id: "r", kind: "resource-change", actor: debtor, resource: "grain", amount: Number.MAX_SAFE_INTEGER, causes: [] }];
    if (kind === "future-creation") plan.physical = [{ id: "c", kind: "create", person: { ...child(), birthYear: 1328 }, causes: [] }];
    if (kind === "bad-mind") { const person = child(); person.mind.facets.anxiety = 101; plan.physical = [{ id: "c", kind: "create", person, causes: [] }]; }
    if (kind === "duplicate-creation") plan.physical = [{ id: "c", kind: "create", person: { ...child(), id: debtor }, causes: [] }];
    expect(() => runtime.advance(plan)).toThrow(); expect(runtime.final()).toEqual(runtime.initial);
  });

  it("descriptor-first guards reject accessors without executing hooks at all unknown boundaries", () => {
    let hooks = 0;
    const getter = { enumerable: true, get() { hooks++; return 1; } };
    const f = fixture(); Object.defineProperty(f.resources[f.creditor], "grain", getter);
    expect(() => createAnnualRuntime(initialization, f.resources)).toThrow();
    const { runtime } = setup(); const plan = grant(); Object.defineProperty(plan.grants[0], "creditor", getter);
    expect(() => runtime.advance(plan)).toThrow();
    const output = structuredClone(runtime.initial); Object.defineProperty(output, "version", getter);
    expect(() => replayAnnualRuntime(output)).toThrow();
    const human = setup(() => Object.defineProperty({ source: "human" }, "selected", getter)); human.runtime.advance(grant());
    expect(() => human.runtime.advance(request())).toThrow();
    expect(human.runtime.final().frontier).toBe(1327);
    expect(hooks).toBe(0);
  });

  it.each([null, { source: "provider", selected: "help" }, { source: "human", selected: "other" }, { source: "human", selected: "help", extra: true }])("rejects malformed authority result %# atomically", result => {
    const { runtime } = setup(() => result); runtime.advance(grant()); const before = runtime.final();
    expect(() => runtime.advance(request())).toThrow(); expect(runtime.final()).toEqual(before);
  });

  it("prevents authority reentrancy and publishes no partial current year", () => {
    const f = fixture();
    const runtime: ReturnType<typeof createAnnualRuntime> = createAnnualRuntime(initialization, f.resources, () => {
      expect(runtime.final().frontier).toBe(1327);
      expect(() => runtime.advance(quiet(1329))).toThrow(/Reentrant/);
      return { source: "human", selected: "help" };
    });
    runtime.advance(grant()); expect(runtime.advance(request()).frontier).toBe(1328);
  });
});

import { describe, expect, it } from "vitest";
import { createMind } from "./mind";
import type { Event, Person } from "./types";
import { applyFavorEvent, createFavorState, grantFavor, replayFavorEvents, createHelpFavorState, grantHelpFavor, requestHelp, respondHelp, applyHelpFavorEvent, replayHelpFavorEvents, type FavorCommand, type FavorEvent } from "./effects";

const person = (id: string): Person => ({ id, name: id, sex: "f", birthYear: 1300, traits: [], job: "none", founder: true, mind: createMind("favor", id, 1300) });
const people = () => ({ a: person("a"), b: person("b"), c: person("c") });
const state = () => createFavorState(people(), [], { a: 2, b: 0 });
const command = (key = "grant"): FavorCommand => ({ key, year: 1336, creditor: "a", debtor: "b", causes: [], ties: [], appraisals: [] });
const full = (): FavorCommand => ({ ...command(), ties: [{ actor: "b", trust: 10, resentment: 3 }], appraisals: [{ actor: "b", interpretation: "gratitude", intensity: 80 }, { actor: "a", interpretation: "resentment", intensity: 20 }] });
const event = (): FavorEvent => grantFavor(state(), full()).events[0]!;
const roundtrip = <T>(value: T): T => JSON.parse(JSON.stringify(value));

const helpState = () => {
  const registry = people();
  registry.b.mind.facets.altruism = 50;
  registry.b.mind.facets.anxiety = 50;
  registry.b.mind.values.wealth = 0;
  return createHelpFavorState(registry, [], { a: 3, b: 0 }, { b: 2 }, { a: 2 });
};
const requested = () => {
  const granted = grantHelpFavor(helpState(), command());
  return requestHelp(granted, { key: "request", year: 1337, obligation: granted.obligations[0]!.id });
};
const responded = (noise = 0.1) => {
  const input = requested();
  return respondHelp(input, { request: input.events[1]!.id, year: 1337, noise, appraisals: [] });
};

describe("C1 atomic later help", () => {
  it.each([0.1, 0.9])("settles from recorded noise %s with explicit resources and directed ties", (noise) => {
    const input = requested();
    const before = structuredClone(input);
    const next = respondHelp(input, { request: input.events[1]!.id, year: 1337, noise, appraisals: [] });
    const help = noise === 0.1;
    expect(next.schema).toBe("favor-c1");
    expect(next.obligations[0]!.status).toBe(help ? "fulfilled" : "broken");
    expect(next.assistance).toEqual({ b: help ? 1 : 2 });
    expect(next.need).toEqual({ a: help ? 1 : 2 });
    expect(next.grain).toEqual(input.grain);
    expect(next.ties).toEqual([{ actor: "a", counterpart: "b", trust: help ? 5 : -5, resentment: help ? 0 : 5 }]);
    expect(next.appraisals).toEqual([]);
    expect(next.people).toEqual(input.people);
    expect(input).toEqual(before);
    expect(replayHelpFavorEvents(helpState(), roundtrip(next.events))).toEqual(next);
    expect(replayHelpFavorEvents(roundtrip(next), [])).toEqual(next);
    expect(next.events.slice(0, 2)).toEqual(input.events);
  });
  it("recomputes latest factors after an intervening grant, rejecting stale imported evidence", () => {
    const input = requested();
    const stale = responded().events[2]!;
    const changed = grantHelpFavor(input, { ...command("competing"), year: 1337, ties: [{ actor: "b", trust: -100, resentment: 100 }] });
    const next = respondHelp(changed, { request: input.events[1]!.id, year: 1337, noise: 0.5, appraisals: [] });
    expect(next.events[3]).toMatchObject({ evidence: { factors: { trust: -100, resentment: 100 }, selected: "refuse" } });
    const bad = roundtrip(stale);
    bad.position = 3;
    expect(() => applyHelpFavorEvent(changed, bad)).toThrow();
    expect(next.events.slice(0, 2)).toEqual(input.events);
  });
  it("clamps actual creditor-directed deltas and leaves reverse/legacy relationships unchanged", () => {
    const initial = helpState();
    const granted = grantHelpFavor(initial, { ...command(), ties: [{ actor: "a", trust: 98, resentment: 99 }, { actor: "b", trust: 2, resentment: 0 }] });
    const input = requestHelp(granted, { key: "req", year: 1337, obligation: granted.obligations[0]!.id });
    const help = respondHelp(input, { request: input.events[1]!.id, year: 1337, noise: 0, appraisals: [] });
    expect(help.ties[0]).toMatchObject({ trust: 100, resentment: 99 });
    expect(help.ties[1]).toEqual(input.ties[1]);
    const refusal = respondHelp(input, { request: input.events[1]!.id, year: 1337, noise: 0.99, appraisals: [] });
    expect(refusal.ties[0]).toMatchObject({ trust: 93, resentment: 100 });
  });
  it.each(["missing-capacity", "exhausted", "missing-need", "no-need", "dead", "same-year-dead", "unborn", "away", "log-away"])("rejects ineligible request %s atomically", (kind) => {
    const registry = people();
    if (kind === "dead") registry.b.deathYear = 1337;
    if (kind === "same-year-dead") registry.a.deathYear = 1337;
    if (kind === "unborn") registry.b = { ...registry.b, birthYear: 1338 };
    if (kind === "away") registry.b = { ...registry.b, away: true };
    const log: Event[] = kind === "log-away" ? [{ id: "move", year: 1337, kind: "move", actors: ["b"], payload: { away: true }, causes: [] }] : [];
    const initial = createHelpFavorState(registry, log, { a: 2, b: 0 }, kind === "missing-capacity" ? {} : { b: kind === "exhausted" ? 0 : 2 }, kind === "missing-need" ? {} : { a: kind === "no-need" ? 0 : 1 });
    const before = structuredClone(initial);
    expect(() => {
      const grant = grantHelpFavor(initial, command());
      requestHelp(grant, { key: "req", year: 1337, obligation: grant.obligations[0]!.id });
    }).toThrow();
    expect(initial).toEqual(before);
  });
  it("rejects duplicate requests, duplicate responses, closed debts and arbitrary supplied outcomes", () => {
    const input = requested();
    expect(() => requestHelp(input, { key: "another", year: 1337, obligation: input.obligations[0]!.id })).toThrow();
    const closed = responded();
    expect(() => respondHelp(closed, { request: input.events[1]!.id, year: 1337, noise: 0, appraisals: [] })).toThrow();
    expect(() => requestHelp(closed, { key: "another", year: 1338, obligation: closed.obligations[0]!.id })).toThrow();
    expect(() => respondHelp(input, { request: input.events[1]!.id, year: 1337, noise: 0.9, appraisals: [], outcome: "help" } as never)).toThrow();
    expect(() => requestHelp(input, { key: "forward", year: 1336, obligation: input.obligations[0]!.id })).toThrow();
  });
  it.each(["version", "actors", "cause", "origin", "effect", "factor", "draw", "selected", "options", "distribution", "extra", "request"])("rejects forged response %s without publishing effects", (kind) => {
    const input = requested();
    const before = structuredClone(input);
    const bad = roundtrip(responded().events[2]!);
    if (kind === "version") Object.assign(bad, { version: "favor-b1" });
    if (kind === "actors") bad.actors.reverse();
    if (kind === "cause") bad.causes = [bad.id];
    if (kind === "origin") Object.assign(bad.effects[0]!, { origin: "wrong" });
    if (kind === "effect") Object.assign(bad.effects.at(-1)!, { trust: 6 });
    if (kind === "factor") Object.assign(bad.evidence!.factors, { altruism: 100 });
    if (kind === "draw") Object.assign(bad.evidence!, { noise: 1 });
    if (kind === "selected") Object.assign(bad.evidence!, { selected: "refuse" });
    if (kind === "options") bad.evidence!.options.reverse();
    if (kind === "distribution") bad.evidence!.distribution.reverse();
    if (kind === "extra") Object.assign(bad, { extra: 1 });
    if (kind === "request") Object.assign(bad, { request: "unknown" });
    expect(() => applyHelpFavorEvent(input, bad)).toThrow();
    expect(input).toEqual(before);
  });
  it.each([-1, 0.5, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN, "2"])("rejects invalid explicit C resources %s", (value) => {
    expect(() => createHelpFavorState(people(), [], { a: 2, b: 0 }, { b: value } as never, { a: 1 })).toThrow();
    expect(() => createHelpFavorState(people(), [], { a: 2, b: 0 }, { b: 2 }, { a: value } as never)).toThrow();
  });
  it("rejects unknown initial resource actors and invalid consumed mind factors", () => {
    expect(() => createHelpFavorState(people(), [], {}, { unknown: 2 }, {})).toThrow();
    const registry = people();
    registry.b.mind.values.wealth = 51;
    const grant = grantHelpFavor(createHelpFavorState(registry, [], { a: 2, b: 0 }, { b: 2 }, { a: 1 }), command());
    const before = structuredClone(grant);
    expect(() => requestHelp(grant, { key: "r", year: 1337, obligation: grant.obligations[0]!.id })).toThrow();
    expect(grant).toEqual(before);
  });
  it("rejects invented settled state, capacity, and mixed prefixes without upgrading B", () => {
    const next = responded();
    for (const patch of [{ assistance: { b: 9 } }, { initialAssistance: { b: -1 } }, { reducer: "favor-b1" }]) {
      expect(() => replayHelpFavorEvents({ ...next, ...patch } as never, [])).toThrow();
    }
    expect(() => replayHelpFavorEvents(helpState(), [event()] as never)).toThrow();
    expect(() => replayFavorEvents(state(), [next.events[0]!] as never)).toThrow();
    expect(() => createHelpFavorState(state() as never, [], {}, {}, {})).toThrow();
    expect(() => grantFavor(helpState() as never, command())).toThrow();
    expect(() => grantHelpFavor(state() as never, command())).toThrow();
    expect(() => replayFavorEvents(helpState() as never, [])).toThrow();
    expect(() => replayHelpFavorEvents(state() as never, [])).toThrow();
    const b = grantFavor(state(), full());
    expect(b.schema).toBe("favor-b1");
    expect(b.events[0]).toEqual(event());
    expect(Object.keys(b)).not.toContain("assistance");
    expect(JSON.stringify(replayFavorEvents(state(), b.events))).toBe(JSON.stringify(b));
  });
  it.each(["capacity", "need"])("revalidates competing response consumption of %s", (resource) => {
    const initial = createHelpFavorState(people(), [], { a: 2, b: 0 }, { b: resource === "capacity" ? 1 : 2 }, { a: resource === "need" ? 1 : 2 });
    const first = grantHelpFavor(initial, command("one"));
    const second = grantHelpFavor(first, command("two"));
    const r1 = requestHelp(second, { key: "r1", year: 1337, obligation: second.obligations[0]!.id });
    const r2 = requestHelp(r1, { key: "r2", year: 1337, obligation: second.obligations[1]!.id });
    const resolved = respondHelp(r2, { request: r1.events[2]!.id, year: 1337, noise: 0, appraisals: [] });
    const before = structuredClone(resolved);
    expect(() => respondHelp(resolved, { request: r2.events[3]!.id, year: 1337, noise: 0.99, appraisals: [] })).toThrow();
    expect(resolved).toEqual(before);
    expect(resolved.obligations[1]!.status).toBe("open");
  });
  it("revalidates response year liveness and legacy log location rather than request eligibility", () => {
    for (const kind of ["death", "move"] as const) {
      const registry = people();
      if (kind === "death") registry.b.deathYear = 1338;
      const log: Event[] = kind === "move" ? [{ id: "move", year: 1338, kind: "move", actors: ["b"], payload: { away: true }, causes: [] }] : [];
      const initial = createHelpFavorState(registry, log, { a: 2, b: 0 }, { b: 2 }, { a: 1 });
      const grant = grantHelpFavor(initial, command());
      const input = requestHelp(grant, { key: "r", year: 1337, obligation: grant.obligations[0]!.id });
      const before = structuredClone(input);
      expect(() => respondHelp(input, { request: input.events[1]!.id, year: 1338, noise: 0.99, appraisals: [] })).toThrow();
      expect(input).toEqual(before);
    }
  });
  it("stages explicit appraisals, rejecting late invalid evidence without earlier settlement", () => {
    const input = requested();
    const valid = respondHelp(input, { request: input.events[1]!.id, year: 1337, noise: 0, appraisals: [{ actor: "b", interpretation: "resentment", intensity: 20 }] });
    expect(valid.appraisals[0]).toMatchObject({ origin: valid.events[2]!.id, interpretation: "resentment" });
    const bad = roundtrip(valid.events[2]!);
    Object.assign(bad.effects.at(-1)!, { actor: "c" });
    const before = structuredClone(input);
    expect(() => applyHelpFavorEvent(input, bad)).toThrow();
    expect(input).toEqual(before);
  });
  it.each(["same-year", "forward", "self", "parties", "closed", "extra-effect", "origin", "version"])("rejects invalid request %s", (kind) => {
    const input = grantHelpFavor(helpState(), command());
    const bad = roundtrip(requested().events[1]!);
    if (kind === "same-year") bad.year = 1336;
    if (kind === "forward") bad.causes = [responded().events[2]!.id];
    if (kind === "self") bad.causes = [bad.id];
    if (kind === "parties") bad.actors = ["a", "a"];
    if (kind === "closed") bad.obligation = "invented";
    if (kind === "extra-effect") bad.effects.push(event().effects[0]!);
    if (kind === "origin") bad.causes = [];
    if (kind === "version") Object.assign(bad, { version: "unsupported" });
    const before = structuredClone(input);
    expect(() => applyHelpFavorEvent(input, bad)).toThrow();
    expect(input).toEqual(before);
  });
  it("B grant fixture retains its exact prior admission and JSON record", () => {
    const id = '["favor-b1","grant",0]';
    const expected: FavorEvent = {
      version: "favor-b1", id, key: "grant", ordinal: 0, kind: "grain-grant", year: 1336, position: 0, actors: ["a", "b"], causes: [], effects: [
        { kind: "grain", from: "a", to: "b", amount: 1 },
        { kind: "obligation", id: `${id}/help`, debtor: "b", creditor: "a", origin: id, status: "open" },
        { kind: "tie", origin: id, counterpart: "a", actor: "b", trust: 10, resentment: 3 },
        { kind: "appraisal", id: `${id}/appraisal/3`, origin: id, actor: "b", interpretation: "gratitude", intensity: 80 },
        { kind: "appraisal", id: `${id}/appraisal/4`, origin: id, actor: "a", interpretation: "resentment", intensity: 20 },
      ],
    };
    expect(JSON.stringify(event())).toBe(JSON.stringify(expected));
    expect(applyFavorEvent(state(), expected)).toEqual(grantFavor(state(), full()));
  });
  it("keeps consumed policy evidence independent of future suffix and does not mutate command inputs", () => {
    const input = requested();
    const cmd = { request: input.events[1]!.id, year: 1337, noise: 0.1, appraisals: [] };
    const before = structuredClone(cmd);
    const response = respondHelp(input, cmd);
    const snapshot = structuredClone(response.events);
    const suffix = grantHelpFavor(response, { ...command("future"), year: 1338, ties: [{ actor: "b", trust: 20, resentment: 2 }] });
    expect(suffix.events.slice(0, 3)).toEqual(snapshot);
    expect(response.events).toEqual(snapshot);
    expect(cmd).toEqual(before);
  });
  it("rejects C array hooks before any execution", () => {
    let calls = 0;
    const bad = responded().events[2]!;
    Object.setPrototypeOf(bad.evidence!.distribution, Object.create(Array.prototype, { toJSON: { value() { calls++; return []; } } }));
    expect(() => applyHelpFavorEvent(requested(), bad)).toThrow();
    expect(calls).toBe(0);
  });
});

describe("standalone atomic favor", () => {
  it("conserves explicit grain, opens exactly one HELP and records supplied conflicting interpretations", () => {
    const input = state();
    const before = structuredClone(input);
    const next = grantFavor(input, full());
    expect(next.grain).toEqual({ a: 1, b: 1 });
    expect(next.obligations).toHaveLength(1);
    expect(next.obligations[0]).toMatchObject({ debtor: "b", creditor: "a", kind: "HELP", status: "open", origin: next.events[0]!.id });
    expect(next.appraisals.map((a) => a.interpretation)).toEqual(["gratitude", "resentment"]);
    expect(next.ties).toEqual([{ actor: "b", counterpart: "a", trust: 10, resentment: 3 }]);
    expect(input).toEqual(before);
    expect(next.people).toEqual(input.people);
    expect(next.people).not.toBe(input.people);
    expect(next.people.a!.mind).toEqual(input.people.a!.mind);
  });
  it.each([0, -1, 0.5, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN])("rejects unavailable/invalid balance %s", (balance) => {
    expect(() => grantFavor(createFavorState(people(), [], { a: balance, b: 0 }), command())).toThrow();
  });
  it("rejects recipient overflow and missing allocations; never infers wealth", () => {
    expect(() => grantFavor(createFavorState(people(), [], { a: 1, b: Number.MAX_SAFE_INTEGER }), command())).toThrow();
    const empty = createFavorState(people(), [], {});
    expect(empty.grain).toEqual({});
    expect(() => grantFavor(empty, command())).toThrow();
    expect(() => createFavorState(people(), [], { missing: 3 })).toThrow();
  });
  it.each(["self", "unknown", "dead", "earlier-dead", "unborn", "away", "life-away", "log-away"])("rejects %s actors without changing legacy fixtures", (kind) => {
    const registry = people();
    let cmd = command();
    const log: Event[] = [];
    if (kind === "self") cmd = { ...cmd, debtor: "a" };
    if (kind === "unknown") cmd = { ...cmd, debtor: "missing" };
    if (kind === "dead") registry.b.deathYear = 1336;
    if (kind === "earlier-dead") registry.b.deathYear = 1335;
    if (kind === "unborn") registry.b = { ...registry.b, birthYear: 1337 };
    if (kind === "away") registry.b = { ...registry.b, away: true };
    if (kind === "life-away") registry.b.lifeState = { marital: { status: "single", since: 1300 }, residence: { status: "away", since: 1330 }, vocation: { status: "child", since: 1300 }, situations: [], slots: {} };
    if (kind === "log-away") log.push({ id: "move", year: 1330, kind: "move", actors: ["b"], payload: { away: true }, causes: [] });
    const input = createFavorState(registry, log, { a: 2, b: 0 });
    const before = structuredClone(input);
    expect(() => grantFavor(input, cmd)).toThrow();
    expect(input).toEqual(before);
    expect(registry.b.lifeState).toEqual(before.people.b!.lifeState);
  });
  it("validates a late effect before publishing any transfer", () => {
    const input = state();
    const before = structuredClone(input);
    const recorded = event();
    recorded.effects.push({ kind: "tie", origin: recorded.id, actor: "b", counterpart: "a", trust: 101, resentment: 0 });
    expect(() => applyFavorEvent(input, recorded)).toThrow();
    expect(input).toEqual(before);
  });
  it("rejects retries, duplicate event/obligation/appraisal identities and tampered checkpoint state", () => {
    const next = grantFavor(state(), full());
    expect(() => grantFavor(next, full())).toThrow();
    expect(() => replayFavorEvents(state(), [next.events[0]!, next.events[0]!])).toThrow();
    for (const field of ["grain", "obligations", "appraisals", "ties"] as const) {
      const bad = roundtrip(next);
      if (field === "grain") bad.grain.a = 9;
      else bad[field].push(bad[field][0]! as never);
      expect(() => grantFavor(bad, command("second"))).toThrow();
    }
    const bad = event();
    bad.effects.push(bad.effects[3]!);
    expect(() => applyFavorEvent(state(), bad)).toThrow();
  });
  it("supports prior same-year causes and deterministic source IDs, independent of commit count", () => {
    const first = grantFavor(state(), command("first"));
    const second = grantFavor(first, { ...command("second"), causes: [first.events[0]!.id] });
    expect(second.events[1]!.position).toBe(1);
    expect(second.events[1]!.id).toBe(grantFavor(state(), command("second")).events[0]!.id);
  });
  it.each(["missing", "self", "forward", "future", "cycle"])("rejects %s imported causes", (kind) => {
    const first = grantFavor(state(), command("first")).events[0]!;
    const second = grantFavor(grantFavor(state(), command("first")), command("second")).events[1]!;
    if (kind === "missing") first.causes = ["missing"];
    if (kind === "self") first.causes = [first.id];
    if (kind === "forward") first.causes = [second.id];
    if (kind === "future") { first.year = 1337; second.causes = [first.id]; }
    if (kind === "cycle") { first.causes = [second.id]; second.causes = [first.id]; }
    expect(() => replayFavorEvents(state(), [first, second])).toThrow();
  });
  it.each(["actors", "origin", "discriminator", "amount", "obligation", "version", "position", "extra", "type"])("rejects inconsistent recorded %s", (kind) => {
    const bad = roundtrip(event());
    if (kind === "actors") bad.actors.reverse();
    if (kind === "origin") Object.assign(bad.effects[3]!, { origin: "other" });
    if (kind === "discriminator") Object.assign(bad.effects[3]!, { kind: "patch" });
    if (kind === "amount") Object.assign(bad.effects[0]!, { amount: 2 });
    if (kind === "obligation") Object.assign(bad.effects[1]!, { debtor: "a" });
    if (kind === "version") Object.assign(bad, { version: "a-v1" });
    if (kind === "position") bad.position = 1;
    if (kind === "extra") Object.assign(bad, { payload: {} });
    if (kind === "type") Object.assign(bad.effects[3]!, { intensity: "80" });
    expect(() => applyFavorEvent(state(), bad)).toThrow();
  });
  it("keeps sparse directed bounds independent of reverse and legacy ties", () => {
    const first = grantFavor(state(), { ...command(), ties: [{ actor: "a", trust: -100, resentment: 100 }, { actor: "b", trust: 100, resentment: 0 }] });
    expect(first.ties[0]).toMatchObject({ actor: "a", trust: -100, resentment: 100 });
    expect(first.ties[1]).toMatchObject({ actor: "b", trust: 100, resentment: 0 });
    expect(() => grantFavor(first, { ...command("two"), ties: [{ actor: "a", trust: -1, resentment: 0 }] })).toThrow();
    expect(() => grantFavor(state(), { ...command(), ties: [{ actor: "a", trust: 0.5, resentment: 0 }] })).toThrow();
    expect(() => grantFavor(state(), { ...command(), ties: [{ actor: "a", trust: 0, resentment: -1 }] })).toThrow();
    expect(grantFavor(state(), command()).ties).toEqual([]);
  });
  it("updates only the selected direction and preserves contradictory appraisals even for one actor", () => {
    const first = grantFavor(state(), { ...command(), ties: [{ actor: "b", trust: 10, resentment: 20 }], appraisals: [{ actor: "b", interpretation: "gratitude", intensity: 80 }, { actor: "b", interpretation: "resentment", intensity: 30 }] });
    const second = grantFavor(first, { ...command("two"), ties: [{ actor: "b", trust: -3, resentment: -5 }] });
    expect(second.ties).toEqual([{ actor: "b", counterpart: "a", trust: 7, resentment: 15 }]);
    expect(second.appraisals).toEqual(first.appraisals);
    expect(new Set(second.appraisals.map((entry) => entry.id)).size).toBe(2);
    expect(second.obligations.map((entry) => entry.status)).toEqual(["open", "open"]);
    expect(second.people.a!.mind).toEqual(first.people.a!.mind);
  });
  it("rejects extra grant effects, misplaced obligation IDs and invalid appraisal vocabulary/ranges", () => {
    for (const extra of [event().effects[0]!, event().effects[1]!]) {
      const bad = event();
      bad.effects.push(extra);
      expect(() => applyFavorEvent(state(), bad)).toThrow();
    }
    for (const patch of [{ id: "duplicate" }, { origin: "other" }, { actor: "c" }, { interpretation: "fear" }, { intensity: -1 }, { intensity: 101 }, { intensity: 0.5 }]) {
      const bad = event();
      Object.assign(bad.effects[3]!, patch);
      expect(() => applyFavorEvent(state(), bad)).toThrow();
    }
    const bad = event();
    Object.assign(bad.effects[1]!, { id: "unrelated" });
    expect(() => applyFavorEvent(state(), bad)).toThrow();
  });
  it("JSON roundtrip and recorded replay match, with no automatic appraisal or legacy field invention", () => {
    const initial = state();
    const next = grantFavor(initial, full());
    const before = structuredClone(next);
    expect(replayFavorEvents(roundtrip(initial), roundtrip(next.events))).toEqual(next);
    expect(grantFavor(roundtrip(next), command("next"))).toEqual(grantFavor(next, command("next")));
    expect(next).toEqual(before);
    expect(initial.people.a!.lifeState).toBeUndefined();
    expect(grantFavor(initial, command()).appraisals).toEqual([]);
  });
  it("leaves command and recorded inputs unchanged and returns detached mutable data", () => {
    const initial = state();
    const cmd = full();
    const cmdBefore = structuredClone(cmd);
    const next = grantFavor(initial, cmd);
    expect(cmd).toEqual(cmdBefore);
    const recorded = next.events[0]!;
    const eventBefore = structuredClone(recorded);
    const replayed = applyFavorEvent(initial, recorded);
    expect(recorded).toEqual(eventBefore);
    replayed.people.a!.mind.stress = 99;
    replayed.events[0]!.actors.reverse();
    replayed.grain.a = 0;
    expect(initial.grain.a).toBe(2);
    expect(next.events[0]!.actors).toEqual(["a", "b"]);
    expect(next.people.a!.mind.stress).toBe(initial.people.a!.mind.stress);
  });
  it("rejects a custom-prototype array command key without invoking inherited toJSON", () => {
    let calls = 0;
    const key: unknown[] = [];
    Object.setPrototypeOf(key, Object.create(Array.prototype, {
      toJSON: { value() { calls++; return "grant"; } },
    }));
    const initial = state();
    expect(() => grantFavor(initial, { ...command(), key: key as unknown as string })).toThrow();
    expect(calls).toBe(0);
    expect(initial.events).toEqual([]);
  });
  it("rejects an empty custom-prototype replay array before its iterator can inject a grant", () => {
    let calls = 0;
    const recorded = event();
    const input: FavorEvent[] = [];
    Object.setPrototypeOf(input, Object.create(Array.prototype, {
      [Symbol.iterator]: { value() { calls++; return [recorded][Symbol.iterator](); } },
    }));
    const initial = state();
    let outputEvents: FavorEvent[] | undefined;
    expect(input.length).toBe(0);
    expect(() => { outputEvents = replayFavorEvents(initial, input).events; }).toThrow();
    expect(calls).toBe(0);
    expect(outputEvents).toBeUndefined();
    expect(initial.events).toEqual([]);
  });
  it.each(["effects", "causes", "events", "ties", "obligations", "appraisals"] as const)("rejects nested custom-prototype %s arrays without inherited hook execution", (field) => {
    let calls = 0;
    const hook = () => { calls++; throw new Error("Inherited hook executed"); };
    const prototype = Object.create(Array.prototype, {
      toJSON: { value: hook }, [Symbol.iterator]: { value: hook },
      forEach: { value: hook }, map: { value: hook },
    });
    const initial = state();
    const recorded = event();
    const nested = field === "effects" || field === "causes" ? recorded[field] : initial[field];
    Object.setPrototypeOf(nested, prototype);
    expect(() => applyFavorEvent(initial, recorded)).toThrow();
    expect(calls).toBe(0);
    expect(initial.events.length).toBe(0);
  });
  it("rejects null-prototype arrays but retains ordinary arrays and null-prototype records", () => {
    const bad = command();
    Object.setPrototypeOf(bad.causes, null);
    expect(() => grantFavor(state(), bad)).toThrow();
    const allocations = Object.assign(Object.create(null), { a: 2, b: 0 });
    const initial = createFavorState(people(), [], allocations);
    const cmd: FavorCommand = Object.assign(Object.create(null), full());
    const next = grantFavor(initial, cmd);
    expect(replayFavorEvents(initial, next.events)).toEqual(next);
    expect(replayFavorEvents(roundtrip(initial), roundtrip(next.events))).toEqual(next);
    expect(Object.getPrototypeOf(next.events)).toBe(Array.prototype);
  });
  it("rejects unsafe object shapes without evaluating accessors", () => {
    let accessed = false;
    const bad = command();
    Object.defineProperty(bad, "year", { enumerable: true, get() { accessed = true; return 1336; } });
    expect(() => grantFavor(state(), bad)).toThrow();
    expect(accessed).toBe(false);
    const sparse = command();
    sparse.causes = new Array(1);
    expect(() => grantFavor(state(), sparse)).toThrow();
    expect(() => grantFavor(state(), { ...command(), year: Number.MAX_SAFE_INTEGER + 1 })).toThrow();
    expect(() => grantFavor(state(), { ...command(), appraisals: [{ actor: "c", interpretation: "gratitude", intensity: 1 }] })).toThrow();
  });
});

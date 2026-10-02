import { describe, expect, it } from "vitest";
import { createMind } from "./mind";
import type { Event, Person } from "./types";
import { applyFavorEvent, createFavorState, grantFavor, replayFavorEvents, type FavorCommand, type FavorEvent } from "./effects";

const person = (id: string): Person => ({ id, name: id, sex: "f", birthYear: 1300, traits: [], job: "none", founder: true, mind: createMind("favor", id, 1300) });
const people = () => ({ a: person("a"), b: person("b"), c: person("c") });
const state = () => createFavorState(people(), [], { a: 2, b: 0 });
const command = (key = "grant"): FavorCommand => ({ key, year: 1336, creditor: "a", debtor: "b", causes: [], ties: [], appraisals: [] });
const full = (): FavorCommand => ({ ...command(), ties: [{ actor: "b", trust: 10, resentment: 3 }], appraisals: [{ actor: "b", interpretation: "gratitude", intensity: 80 }, { actor: "a", interpretation: "resentment", intensity: 20 }] });
const event = (): FavorEvent => grantFavor(state(), full()).events[0]!;
const roundtrip = <T>(value: T): T => JSON.parse(JSON.stringify(value));

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

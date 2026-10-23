import { describe, expect, it, vi } from "vitest";
import { createMind } from "./mind";
import type { Person } from "./types";
import { createHelpFavorState, grantHelpFavor, requestHelp, replayHelpFavorEvents } from "./effects";
import { createFavorScheduler, runFavorYear, admitFavorScheduler, SCHEDULER_VERSION, SCHEDULER_RNG_VERSION } from "./scheduler";
import { keyedDraw } from "./rng";
import * as rng from "./rng";

vi.mock("./hazards", () => { throw new Error("Production hazards imported"); });
vi.mock("./simulate", () => { throw new Error("Production simulation imported"); });
vi.mock("../adapters/decision/rule-decision-maker", () => { throw new Error("Production provider imported"); });
const roundtrip = <T>(value: T): T => JSON.parse(JSON.stringify(value));
function fixture(count = 2, capacity = 2, need = 2, creditor = "a", debtor = "b") {
  const people: Record<string, Person> = {};
  for (const id of [creditor, debtor]) {
    const mind = createMind("c2", id, 1300);
    mind.facets.altruism = 50;
    mind.facets.anxiety = 50;
    mind.values.wealth = 0;
    people[id] = { id, name: id, sex: "f", birthYear: 1300, founder: true, job: "none", traits: [], mind };
  }
  let state = createHelpFavorState(people, [], { [creditor]: count, [debtor]: 0 }, { [debtor]: capacity }, { [creditor]: need });
  for (let i = 0; i < count; i++) state = grantHelpFavor(state, { key: `g${i}`, year: 1336, creditor, debtor, causes: [], ties: [], appraisals: [] });
  return state;
}
const annual = (seed: string, state = fixture()) => runFavorYear(createFavorScheduler(state, seed, 1336), 1337);
const selected = (value: ReturnType<typeof annual>) => value.years.at(-1)!.attempts.filter((entry) => entry.kind === "response");

describe("standalone C2 annual opportunities", () => {
  it("fixed seeds demonstrate two distinct requests, zero requests and refusal without forcing outcomes", () => {
    const two = annual("c2-1");
    expect(selected(two)).toHaveLength(2);
    expect(new Set(selected(two).map((attempt) => attempt.obligation)).size).toBe(2);
    expect(two.state.assistance.b).toBe(0);
    expect(two.state.need.a).toBe(0);
    expect(two.state.obligations.map((debt) => debt.status)).toEqual(["fulfilled", "fulfilled"]);
    const closed = runFavorYear(two, 1338);
    expect(closed.years[1]!.attempts).toHaveLength(2);
    expect(closed.years[1]!.attempts.every((attempt) => attempt.kind === "quiet" && attempt.skipped.every((debt) => debt.reason === "closed"))).toBe(true);
    expect(closed.state).toEqual(two.state);
    const quiet = annual("c2-2");
    expect(selected(quiet)).toHaveLength(0);
    expect(quiet.completedYear).toBe(1337);
    expect(quiet.years[0]!.attempts.every((attempt) => attempt.kind === "inactive")).toBe(true);
    expect(quiet.state).toEqual(fixture());
    const refusal = annual("c2-11");
    const responses = selected(refusal);
    expect(responses.some((attempt) => attempt.outcome === "refuse")).toBe(true);
    const helpCount = responses.filter((attempt) => attempt.outcome === "help").length;
    expect(refusal.state.assistance.b).toBe(2 - helpCount);
    expect(refusal.state.need.a).toBe(2 - helpCount);
    for (const response of responses) expect(refusal.state.obligations.find((debt) => debt.id === response.obligation)!.status).toBe(response.outcome === "help" ? "fulfilled" : "broken");
  });
  it("caps attempts at exactly two per creditor, not per debt, with quarter activation and recorded seeded response", () => {
    const result = annual("c2-1", fixture(8, 8, 8));
    expect(result.years[0]!.attempts).toHaveLength(2);
    for (const attempt of result.years[0]!.attempts) {
      if (attempt.kind === "quiet") continue;
      expect(attempt.activation.value).toBe(keyedDraw(JSON.stringify([result.seed, attempt.activation.key]), "favor-c2", 0, "uniform"));
      expect(attempt.kind === "response").toBe(attempt.activation.value < 0.25);
      if (attempt.kind === "response") {
        expect(attempt.response.value).toBe(keyedDraw(JSON.stringify([result.seed, attempt.response.key]), "favor-c2", 0, "uniform"));
        const response = result.state.events.find((event) => event.id === attempt.responseId)!;
        expect(response.evidence!.noise).toBe(attempt.response.value);
        expect(response.evidence!.selected).toBe(attempt.outcome);
        expect(attempt.outcome).toBe(attempt.response.value < response.evidence!.distribution[0]! ? "help" : "refuse");
      }
    }
    expect(replayHelpFavorEvents(result.state, [])).toEqual(result.state);
  });
  it("repeats, restores JSON, persists quiet frontiers and admits monotonic gaps without imputing activity", () => {
    const initial = createFavorScheduler(fixture(), "c2-0", 1336);
    const before = structuredClone(initial);
    const first = runFavorYear(initial, 1337);
    expect(first).toEqual(runFavorYear(initial, 1337));
    expect(initial).toEqual(before);
    expect(runFavorYear(roundtrip(first), 1338)).toEqual(runFavorYear(first, 1338));
    const empty = createHelpFavorState({}, [], {}, {}, {});
    const quiet = runFavorYear(createFavorScheduler(empty, "quiet", 1336), 1337);
    expect(quiet.completedYear).toBe(1337);
    expect(quiet.state.events).toEqual([]);
    expect(quiet.years).toEqual([{ year: 1337, attempts: [] }]);
    expect(() => runFavorYear(roundtrip(quiet), 1337)).toThrow();
    expect(() => runFavorYear(quiet, 1336)).toThrow();
    expect(runFavorYear(quiet, 1340).years.map((year) => year.year)).toEqual([1337, 1340]);
    expect(() => createFavorScheduler(fixture(), "seed", 1335)).toThrow();
  });
  it("rejects pending debts as explicit skips without altering the inherited request prefix", () => {
    const initial = fixture();
    const pending = requestHelp(initial, { key: "pending", year: 1337, obligation: initial.obligations[0]!.id });
    const year = runFavorYear(createFavorScheduler(pending, "c2-0", 1337), 1338);
    expect(year.years[0]!.attempts[0]!.skipped).toContainEqual({ obligation: initial.obligations[0]!.id, reason: "already-requested" });
    expect(year.state.events.slice(0, pending.events.length)).toEqual(pending.events);
  });
  it.each(["death", "away", "capacity", "need"])("emits explicit quiet skip for %s", (kind) => {
    let state = fixture();
    if (kind === "capacity") state = fixture(2, 0, 2);
    if (kind === "need") state = fixture(2, 2, 0);
    if (kind === "death") state.people.b!.deathYear = 1337;
    if (kind === "away") state.legacyEvents.push({ id: "away", year: 1337, kind: "move", actors: ["b"], payload: { away: true }, causes: [] });
    const result = annual("c2-0", state);
    expect(result.years[0]!.attempts.every((attempt) => attempt.kind === "quiet")).toBe(true);
    expect(result.state).toEqual(state);
    expect(result.years[0]!.attempts[0]!.skipped[0]!.reason).toBe({ death: "dead", away: "absent", capacity: "exhausted-assistance", need: "no-need" }[kind]);
  });
  it("validates consumed factors before quiet activation, including candidates beyond first", () => {
    const state = fixture();
    state.people.b!.mind.values.wealth = 51;
    expect(() => annual("c2-2", state)).toThrow();
    const other = fixture(0, 2, 2, "a", "z");
    let multi = createHelpFavorState({ ...fixture().people, ...other.people }, [], { a: 2, b: 0, z: 0 }, { b: 2, z: 2 }, { a: 2 });
    multi = grantHelpFavor(multi, { key: "g0", year: 1336, creditor: "a", debtor: "b", causes: [], ties: [], appraisals: [] });
    multi = grantHelpFavor(multi, { key: "g1", year: 1336, creditor: "a", debtor: "z", causes: [], ties: [], appraisals: [] });
    multi.people.z!.mind.facets.altruism = -1;
    expect(() => annual("c2-2", multi)).toThrow();
  });
  it("revalidates last need and last shared-debtor capacity after an immediate response", () => {
    const lastNeed = annual("c2-1", fixture(2, 2, 1));
    expect(selected(lastNeed)).toHaveLength(1);
    expect(lastNeed.state.need.a).toBe(0);
    expect(lastNeed.years[0]!.attempts[1]).toMatchObject({ kind: "quiet", skipped: expect.arrayContaining([{ obligation: lastNeed.state.obligations[1]!.id, reason: "no-need" }]) });
    const registry = { ...fixture().people, ...fixture(0, 2, 2, "c", "b").people };
    let shared = createHelpFavorState(registry, [], { a: 1, c: 1, b: 0 }, { b: 1 }, { a: 1, c: 1 });
    for (const [key, creditor] of [["g0", "a"], ["g1", "c"]]) shared = grantHelpFavor(shared, { key: key!, year: 1336, creditor: creditor!, debtor: "b", causes: [], ties: [], appraisals: [] });
    const result = annual("c2-1", shared);
    expect(selected(result)).toHaveLength(1);
    expect(result.state.assistance.b).toBe(0);
    expect(result.state.obligations.map((debt) => debt.status)).toEqual(["fulfilled", "open"]);
    expect(result.years[0]!.attempts.filter((attempt) => attempt.creditor === "c").every((attempt) => attempt.kind === "quiet" && attempt.skipped[0]!.reason === "exhausted-assistance")).toBe(true);
  });
  it("uses deterministic Unicode byte order and unambiguous adversarial seed/actor tuple transport", () => {
    const ids = ["\uFFFD", "\uD800", "雪::[]", "\u{10000}", "\uE000"];
    let state = createHelpFavorState(Object.assign({}, ...ids.map((id) => fixture(0, 2, 2, id, `d-${id}`).people)), [], Object.assign({}, ...ids.map((id) => ({ [id]: 1, [`d-${id}`]: 0 }))), Object.fromEntries(ids.map((id) => [`d-${id}`, 2])), Object.fromEntries(ids.map((id) => [id, 1])));
    for (const id of ids) state = grantHelpFavor(state, { key: `g-${id}`, year: 1336, creditor: id, debtor: `d-${id}`, causes: [], ties: [], appraisals: [] });
    const first = annual("s::[雪]", state);
    const reversed = { ...state, people: Object.fromEntries(Object.entries(state.people).reverse()) };
    expect(annual("s::[雪]", reversed)).toEqual(first);
    expect([...new Set(first.years[0]!.attempts.map((attempt) => attempt.creditor))]).toEqual(["雪::[]", "\uE000", "\uD800", "\uFFFD", "\u{10000}"]);
    const keys = first.years[0]!.attempts.flatMap((attempt) => attempt.kind === "quiet" ? [] : [attempt.activation.key]);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) {
      const tuple = JSON.parse(key);
      expect(tuple.slice(0, 3)).toEqual([SCHEDULER_VERSION, SCHEDULER_RNG_VERSION, "help-opportunity"]);
      expect(tuple.at(-1)).toBe("activation");
    }
  });
  it("draws nothing without an eligible target or before invalid policy rejection; inactive slots draw activation only", () => {
    const empty = createFavorScheduler(createHelpFavorState({}, [], {}, {}, {}), "none", 1336);
    const exhausted = createFavorScheduler(fixture(2, 0, 2), "none", 1336);
    const invalid = fixture();
    invalid.people.b!.mind.values.wealth = 51;
    const inactive = createFavorScheduler(fixture(), "c2-2", 1336);
    const spy = vi.spyOn(rng, "keyedDraw");
    try {
      runFavorYear(empty, 1337);
      runFavorYear(exhausted, 1337);
      expect(() => annual("c2-2", invalid)).toThrow();
      expect(spy).not.toHaveBeenCalled();
      runFavorYear(inactive, 1337);
      expect(spy).toHaveBeenCalledTimes(2);
    } finally { spy.mockRestore(); }
  });
  it("rejects unrecorded C suffixes, malformed checkpoints and falsified prefix boundaries", () => {
    const input = annual("c2-1");
    const suffix = { ...input, state: grantHelpFavor(input.state, { key: "unrecorded", year: 1338, creditor: "b", debtor: "a", causes: [], ties: [], appraisals: [] }) };
    expect(() => admitFavorScheduler(suffix)).toThrow();
    const bad = roundtrip(input);
    bad.state.assistance.b = 9;
    expect(() => admitFavorScheduler(bad)).toThrow();
    expect(() => admitFavorScheduler({ ...input, initialPrefixLength: 1 })).toThrow();
    expect(() => admitFavorScheduler({ ...input, initialPrefixLength: input.state.events.length + 1 })).toThrow();
    expect(() => admitFavorScheduler({ ...input, years: [{ year: 1337, attempts: [] }] })).toThrow();
  });
  it("orders creditors/debts canonically despite reversed person insertion and keeps unrelated keys/draws/IDs stable", () => {
    const input = fixture();
    const unrelated = fixture(1, 2, 2, "0::雪", "z");
    const expanded = createHelpFavorState({ ...input.people, ...unrelated.people }, [], { ...input.allocations, ...unrelated.allocations }, { ...input.initialAssistance, ...unrelated.initialAssistance }, { ...input.initialNeed, ...unrelated.initialNeed });
    let all = expanded;
    for (const [key, creditor, debtor] of [["other", "0::雪", "z"], ["g0", "a", "b"], ["g1", "a", "b"]]) all = grantHelpFavor(all, { key: key!, creditor: creditor!, debtor: debtor!, year: 1336, causes: [], ties: [], appraisals: [] });
    const result = annual("c2-1", all);
    const original = annual("c2-1", input);
    expect(result.years[0]!.attempts.filter((attempt) => attempt.creditor === "a")).toEqual(original.years[0]!.attempts);
    const reversed = { ...all, people: Object.fromEntries(Object.entries(all.people).reverse()) };
    expect(annual("c2-1", reversed)).toEqual(result);
    expect(result.state.events.map((event) => event.position)).toEqual(result.state.events.map((_, i) => i));
  });
  it.each(["version", "rng", "frontier", "seed", "activation", "outcome", "request", "response", "missing", "extra", "unrecorded"])("rejects forged scheduler metadata %s", (kind) => {
    const original = annual("c2-1");
    const bad = roundtrip(original);
    if (kind === "version") Object.assign(bad, { version: "other" });
    if (kind === "rng") Object.assign(bad, { rngVersion: "other" });
    if (kind === "frontier") bad.completedYear++;
    if (kind === "seed") bad.seed = "different";
    if (kind === "activation") Object.assign(bad.years[0]!.attempts[0]!, { activation: { key: "forged", value: 0 } });
    if (kind === "outcome") Object.assign(bad.years[0]!.attempts[0]!, { outcome: "invented" });
    if (kind === "request") Object.assign(bad.years[0]!.attempts[0]!, { requestId: "forged" });
    if (kind === "response") Object.assign(bad.years[0]!.attempts[0]!, { responseId: "forged" });
    if (kind === "missing") bad.years[0]!.attempts.pop();
    if (kind === "extra") Object.assign(bad, { options: {} });
    if (kind === "unrecorded") bad.years = [];
    expect(() => admitFavorScheduler(bad)).toThrow();
    expect(original).toEqual(annual("c2-1"));
  });
  it.each(["", 1, null, {}, [], new String("seed")])("rejects nonprimitive/empty seed %j", (seed) => {
    expect(() => createFavorScheduler(fixture(), seed as string, 1336)).toThrow();
  });
  it.each([NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1, "1337"])("rejects bad year %s", (year) => {
    expect(() => runFavorYear(createFavorScheduler(fixture(), "seed", 1336), year as number)).toThrow();
  });
  it("guards accessors/custom arrays even on empty and inactive years, permits null records without hooks", () => {
    const initial = createFavorScheduler(createHelpFavorState({}, [], {}, {}, {}), "quiet", 1336);
    let calls = 0;
    const hook = () => { calls++; return []; };
    const accessor = { ...initial };
    Object.defineProperty(accessor, "completedYear", { enumerable: true, get: hook });
    expect(() => runFavorYear(accessor as never, 1337)).toThrow();
    const custom = roundtrip(initial);
    Object.setPrototypeOf(custom.years, Object.create(Array.prototype, { [Symbol.iterator]: { value: hook } }));
    expect(() => runFavorYear(custom, 1337)).toThrow();
    const extra = { ...initial, unused: { get value() { return hook(); } } };
    expect(() => runFavorYear(extra, 1337)).toThrow();
    const inactive = annual("c2-2");
    Object.setPrototypeOf(inactive.years[0]!.attempts, Object.create(Array.prototype, { toJSON: { value: hook } }));
    expect(() => admitFavorScheduler(inactive)).toThrow();
    const checkpoint = roundtrip(initial);
    Object.setPrototypeOf(checkpoint.state.events, Object.create(Array.prototype, { [Symbol.iterator]: { value: hook } }));
    expect(() => admitFavorScheduler(checkpoint)).toThrow();
    const seed: unknown[] = [];
    Object.setPrototypeOf(seed, Object.create(Array.prototype, { toJSON: { value: hook } }));
    expect(() => createFavorScheduler(initial.state, seed as never, 1336)).toThrow();
    expect(calls).toBe(0);
    expect(admitFavorScheduler(Object.assign(Object.create(null), roundtrip(initial)))).toEqual(initial);
    expect(SCHEDULER_VERSION).not.toBe(SCHEDULER_RNG_VERSION);
  });
});

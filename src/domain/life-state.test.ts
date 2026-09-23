import { describe, expect, it } from "vitest";
import { createMind } from "./mind";
import type { Event, Person } from "./types";
import { EMPTY_SITUATIONS, EMPTY_SLOTS, advanceSlot, applyLifeTransition, deriveLifeState, ensureLifeState, markMarriageable, residenceView, slotKey, type LifeState } from "./life-state";

function makePerson(id: string, overrides: Partial<Person> = {}): Person {
  const birthYear = overrides.birthYear ?? 1330;
  return {
    id,
    name: `Person ${id}`,
    sex: "f",
    birthYear,
    traits: [],
    job: "none",
    founder: true,
    mind: createMind("life-state-test-seed", id, birthYear),
    ...overrides,
  };
}

function baseLifeState(since: number): LifeState {
  return {
    marital: { status: "single", since },
    residence: { status: "home", since },
    vocation: { status: "child", since },
    slots: EMPTY_SLOTS,
    situations: EMPTY_SITUATIONS,
  };
}

describe("slotKey", () => {
  it("joins kind and subject with a colon", () => {
    expect(slotKey("Y1", "protagonist")).toBe("Y1:protagonist");
  });

  it("produces a different key for a different kind or subject (no collisions)", () => {
    expect(slotKey("Y1", "protagonist")).not.toBe(slotKey("A1", "protagonist"));
    expect(slotKey("Y1", "protagonist")).not.toBe(slotKey("Y1", "p002"));
  });
});

describe("advanceSlot", () => {
  it("starts a fresh key at occurred=1, attempts=0 when the decision occurred", () => {
    const next = advanceSlot(EMPTY_SLOTS, "death:p001", true);
    expect(next["death:p001"]).toEqual({ occurred: 1, attempts: 0 });
  });

  it("starts a fresh key at occurred=0, attempts=1 when the decision was only offered, not occurred", () => {
    const next = advanceSlot(EMPTY_SLOTS, "Y1:protagonist", false);
    expect(next["Y1:protagonist"]).toEqual({ occurred: 0, attempts: 1 });
  });

  it("increments occurred and resets attempts to 0 when a later offer occurs, keeping prior attempts out of it", () => {
    const offered = advanceSlot(EMPTY_SLOTS, "Y1:protagonist", false);
    const offeredAgain = advanceSlot(offered, "Y1:protagonist", false);
    const occurred = advanceSlot(offeredAgain, "Y1:protagonist", true);
    expect(occurred["Y1:protagonist"]).toEqual({ occurred: 1, attempts: 0 });
  });

  it("keeps incrementing occurred across repeated occurrences (2nd, 3rd time)", () => {
    const first = advanceSlot(EMPTY_SLOTS, "illness:p001", true);
    const second = advanceSlot(first, "illness:p001", true);
    const third = advanceSlot(second, "illness:p001", true);
    expect(third["illness:p001"]).toEqual({ occurred: 3, attempts: 0 });
  });

  it("leaves other keys in the slot state untouched", () => {
    const withA = advanceSlot(EMPTY_SLOTS, "Y1:protagonist", true);
    const withBoth = advanceSlot(withA, "A1:protagonist", true);
    expect(withBoth["Y1:protagonist"]).toEqual({ occurred: 1, attempts: 0 });
    expect(withBoth["A1:protagonist"]).toEqual({ occurred: 1, attempts: 0 });
  });
});

describe("applyLifeTransition", () => {
  it("applies a legal marital transition, setting status, since and partnerId", () => {
    const state = baseLifeState(1330);
    const next = applyLifeTransition(state, { axis: "marital", to: "married", partnerId: "p002" }, 1345);
    expect(next.marital).toEqual({ status: "married", since: 1345, partnerId: "p002" });
  });

  it("applies a legal residence transition (home -> away), carrying the place", () => {
    const state = baseLifeState(1330);
    const next = applyLifeTransition(state, { axis: "residence", to: "away", place: "Millbrook" }, 1350);
    expect(next.residence).toEqual({ status: "away", since: 1350, place: "Millbrook" });
  });

  it("applies a legal vocation transition (child -> working)", () => {
    const state = baseLifeState(1330);
    const next = applyLifeTransition(state, { axis: "vocation", to: "working" }, 1346);
    expect(next.vocation).toEqual({ status: "working", since: 1346, masterId: undefined });
  });

  it("re-applies working -> working (a career change), refreshing since", () => {
    const working: LifeState = { ...baseLifeState(1330), vocation: { status: "working", since: 1346 } };
    const next = applyLifeTransition(working, { axis: "vocation", to: "working" }, 1360);
    expect(next.vocation).toEqual({ status: "working", since: 1360, masterId: undefined });
  });

  it("throws on an illegal marital transition (widowed -> single, skipping back to 'never married')", () => {
    const state: LifeState = { ...baseLifeState(1330), marital: { status: "widowed", since: 1340 } };
    expect(() => applyLifeTransition(state, { axis: "marital", to: "single" }, 1345)).toThrow();
  });

  it("throws on an illegal residence transition (home -> home)", () => {
    const state = baseLifeState(1330);
    expect(() => applyLifeTransition(state, { axis: "residence", to: "home" }, 1345)).toThrow();
  });

  it("leaves every other axis untouched", () => {
    const state = baseLifeState(1330);
    const next = applyLifeTransition(state, { axis: "residence", to: "away", place: "York" }, 1340);
    expect(next.marital).toEqual(state.marital);
    expect(next.vocation).toEqual(state.vocation);
    expect(next.slots).toBe(state.slots);
    expect(next.situations).toBe(state.situations);
  });
});

describe("deriveLifeState (legacy read-time fallback)", () => {
  it("derives married from spouseId for a person with no stored lifeState, without writing to storage", () => {
    const person = makePerson("p001", { birthYear: 1300, spouseId: "p002" });
    const derived = deriveLifeState(person, []);
    expect(derived.marital).toEqual({ status: "married", since: 1300, partnerId: "p002" });
    expect(person.lifeState).toBeUndefined();
  });

  it("derives the marriage year from the event log when a matching marriage event exists", () => {
    const person = makePerson("p001", { birthYear: 1300, spouseId: "p002" });
    const events: Event[] = [{ id: "e1", year: 1322, kind: "marriage", actors: ["p001", "p002"], payload: {}, causes: [] }];
    const derived = deriveLifeState(person, events);
    expect(derived.marital).toEqual({ status: "married", since: 1322, partnerId: "p002" });
  });

  it("derives widowed from a widowed event when there is no current spouseId", () => {
    const person = makePerson("p001", { birthYear: 1300 });
    const events: Event[] = [{ id: "e1", year: 1340, kind: "widowed", actors: ["p001", "p002"], payload: {}, causes: [] }];
    const derived = deriveLifeState(person, events);
    expect(derived.marital).toEqual({ status: "widowed", since: 1340 });
  });

  it("derives single for a person with no spouseId and no marital event history", () => {
    const person = makePerson("p001", { birthYear: 1330 });
    const derived = deriveLifeState(person, []);
    expect(derived.marital).toEqual({ status: "single", since: 1330 });
  });

  it("derives away residence from a move event with no later return", () => {
    const person = makePerson("p001", { birthYear: 1300 });
    const events: Event[] = [{ id: "e1", year: 1340, kind: "move", actors: ["p001"], payload: { away: true, destination: "Millbrook, a market town" }, causes: [] }];
    const derived = deriveLifeState(person, events);
    expect(derived.residence).toEqual({ status: "away", since: 1340, place: "Millbrook, a market town" });
  });

  it("derives home residence when a later return event follows the move away", () => {
    const person = makePerson("p001", { birthYear: 1300 });
    const events: Event[] = [
      { id: "e1", year: 1340, kind: "move", actors: ["p001"], payload: { away: true, destination: "York" }, causes: [] },
      { id: "e2", year: 1344, kind: "move", actors: ["p001"], payload: { away: false, returned: true, destination: "the village" }, causes: [] },
    ];
    const derived = deriveLifeState(person, events);
    expect(derived.residence).toEqual({ status: "home", since: 1344 });
  });

  it("derives working vocation from a non-none job, keyed to the job event's year", () => {
    const person = makePerson("p001", { birthYear: 1314, job: "farmer" });
    const events: Event[] = [{ id: "e1", year: 1330, kind: "job", actors: ["p001"], payload: { job: "farmer" }, causes: [] }];
    const derived = deriveLifeState(person, events);
    expect(derived.vocation).toEqual({ status: "working", since: 1330 });
  });

  it("derives child vocation from job === none", () => {
    const person = makePerson("p001", { birthYear: 1330, job: "none" });
    const derived = deriveLifeState(person, []);
    expect(derived.vocation).toEqual({ status: "child", since: 1330 });
  });
});

describe("ensureLifeState", () => {
  it("returns the person's own lifeState when already present", () => {
    const stored = baseLifeState(1310);
    const person = makePerson("p001", { birthYear: 1330, lifeState: stored });
    expect(ensureLifeState(person, [])).toBe(stored);
  });

  it("derives a fresh lifeState when the person has none", () => {
    const person = makePerson("p001", { birthYear: 1330, spouseId: "p002" });
    const ensured = ensureLifeState(person, []);
    expect(ensured.marital.status).toBe("married");
  });
});

describe("PR6 corrective (engram #6280, item 3): self-loops/cross re-fires — reversion attempted, kept where MEASURED necessary", () => {
  // Reverting this table to the tight, design-sanctioned set was tried during the corrective and
  // MEASURED to still crash routinely (11 real test failures, dominated by `courting -> courting`) —
  // a third, still-open root cause in candidate gathering's `claimedPartners` handling (see this
  // module's own doc comment on `LEGAL_MARITAL_TRANSITIONS` for the full finding). These self-loops
  // stay legal as a documented, verified-necessary safety net, not a blind restoration.
  it("courting -> courting is a legal self-loop, updating since/partnerId instead of throwing", () => {
    const state: LifeState = { ...baseLifeState(1330), marital: { status: "courting", since: 1345, partnerId: "p2" } };
    const next = applyLifeTransition(state, { axis: "marital", to: "courting", partnerId: "p3" }, 1346);
    expect(next.marital).toEqual({ status: "courting", since: 1346, partnerId: "p3" });
  });

  it("single -> single, married -> married and widowed -> widowed are all legal self-loops", () => {
    expect(applyLifeTransition(baseLifeState(1330), { axis: "marital", to: "single" }, 1346).marital.status).toBe("single");
    const married: LifeState = { ...baseLifeState(1330), marital: { status: "married", since: 1340, partnerId: "p2" } };
    expect(applyLifeTransition(married, { axis: "marital", to: "married", partnerId: "p2" }, 1346).marital.status).toBe("married");
    const widowed: LifeState = { ...baseLifeState(1330), marital: { status: "widowed", since: 1340 } };
    expect(applyLifeTransition(widowed, { axis: "marital", to: "widowed" }, 1346).marital.status).toBe("widowed");
  });

  it("single -> widowed is legal (a residual stale-romance path the corrective's two named fixes did not fully close)", () => {
    expect(applyLifeTransition(baseLifeState(1330), { axis: "marital", to: "widowed" }, 1346).marital.status).toBe("widowed");
  });

  it("courting -> widowed is legal — a real, deliberate transition (a widow(er)'s failed remarriage reverts to widowed), not a bug mask", () => {
    const state: LifeState = { ...baseLifeState(1330), marital: { status: "courting", since: 1345, partnerId: "p2" } };
    const next = applyLifeTransition(state, { axis: "marital", to: "widowed" }, 1346);
    expect(next.marital.status).toBe("widowed");
  });
});

describe("PR6: markMarriageable (task 6.2 support — Y1's time-in-state clock)", () => {
  it("stamps marriageableSince on the first call", () => {
    const state = baseLifeState(1330);
    const stamped = markMarriageable(state, 1345);
    expect(stamped.marriageableSince).toBe(1345);
  });

  it("is idempotent — a later call never overwrites an already-stamped year", () => {
    const state = markMarriageable(baseLifeState(1330), 1345);
    const stampedAgain = markMarriageable(state, 1350);
    expect(stampedAgain.marriageableSince).toBe(1345);
    expect(stampedAgain).toBe(state); // no-op: same reference, no reallocation
  });
});

describe("residenceView", () => {
  it("returns the residence status directly when the vocation is not apprenticed/in-service", () => {
    const state: LifeState = { ...baseLifeState(1330), residence: { status: "away", since: 1350 } };
    expect(residenceView(state)).toBe("away");
  });

  it("returns 'apprenticed' when the vocation is apprenticed, even if residence is home", () => {
    const state: LifeState = { ...baseLifeState(1330), vocation: { status: "apprenticed", since: 1342, masterId: "master1" } };
    expect(residenceView(state)).toBe("apprenticed");
  });

  it("returns 'in-service' when the vocation is in-service, even if residence is away", () => {
    const state: LifeState = { ...baseLifeState(1330), residence: { status: "away", since: 1350 }, vocation: { status: "in-service", since: 1342, masterId: "master1" } };
    expect(residenceView(state)).toBe("in-service");
  });
});

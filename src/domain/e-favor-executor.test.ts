import { describe, expect, it, vi } from "vitest";
import { createFavorExecutor } from "./e-favor-executor";
import { initializeWorld } from "./world-initialization";
import type { ResponseAuthority, RuntimeEntry, RuntimeOutput } from "./e-runtime";

function fixture(year = 1327, authority?: ResponseAuthority) {
  const { world } = initializeWorld({ seed: "verify-1", startYear: 1327, endYear: 1335, founderCount: 6 });
  const actors = Object.values(world.people).filter(p => p.birthYear < 1327 && p.deathYear === undefined && !p.away).map(p => p.id);
  const draft: RuntimeOutput["state"] = {
    people: world.people, legacyEvents: world.events, events: [],
    grain: Object.fromEntries(actors.map(id => [id, 2])),
    assistance: Object.fromEntries(actors.map(id => [id, 1])),
    need: Object.fromEntries(actors.map(id => [id, 1])), obligations: [], ties: [], appraisals: [],
  };
  const entries: RuntimeEntry[] = [];
  const executor = createFavorExecutor(draft, year, entries, authority);
  return { draft, entries, executor, creditor: actors[0], debtor: actors[1], other: actors[2] };
}

function earlierDebt(authority?: ResponseAuthority) {
  const f = fixture();
  f.executor.executeGrant({ id: "grant", creditor: f.creditor, debtor: f.debtor, causes: [] }, 0);
  return { ...f, executor: createFavorExecutor(f.draft, 1328, f.entries, authority) };
}

describe("borrowed trusted favor draft", () => {
  it("uses the actual Person/Mind registry while effects replace only economic ledgers", () => {
    const { draft, executor, creditor, debtor, entries } = fixture();
    const people = draft.people, person = people[debtor], mind = person.mind, grain = draft.grain;
    expect(executor.known(debtor)).toBe(person);
    executor.executeGrant({ id: "grant", creditor, debtor, causes: [] }, 0);
    expect(draft.people).toBe(people);
    expect(draft.people[debtor]).toBe(person);
    expect(draft.people[debtor].mind).toBe(mind);
    expect(draft.grain).not.toBe(grain);
    expect(grain[creditor]).toBe(2);
    expect(draft.grain[creditor]).toBe(1);
    expect(entries[0]).toMatchObject({ id: "grant", position: 0, outcome: "committed" });
    expect(draft.events[0].id).toBe("grant");
  });

  it.each(["__proto__", "constructor", "toString", "7", "actor\ud800"])("allocates and resets separate ledgers for own key %j", actor => {
    const { draft, executor, debtor, entries } = fixture();
    const person = { ...structuredClone(draft.people[debtor]), id: actor };
    Object.defineProperty(draft.people, actor, { value: person, enumerable: true });
    executor.executeResource({ id: "allocation", kind: "allocate", actor, allocation: { grain: 0, effort: 1, need: 2 }, causes: [] }, 0);
    expect(entries[0].consumed).toMatchObject({ grain: [undefined], assistance: [undefined], need: [undefined] });
    executor.executeResource({ id: "reset", kind: "resource-change", actor, resource: "need", amount: -2, causes: ["allocation"] }, 1);
    expect(draft.people[actor]).toBe(person);
    for (const ledger of [draft.grain, draft.assistance, draft.need]) expect(Object.hasOwn(ledger, actor)).toBe(true);
    expect([draft.grain[actor], draft.assistance[actor], draft.need[actor]]).toEqual([0, 1, 0]);
    expect(() => executor.executeResource({ id: "repeat", kind: "allocate", actor, allocation: { grain: 0, effort: 0, need: 0 }, causes: [] }, 2)).toThrow(/Already allocated/);
  });

  it.each([-3, Number.MAX_SAFE_INTEGER])("rejects balance underflow/overflow (%s) before a resource entry", amount => {
    const { draft, executor, debtor, entries } = fixture();
    const ledger = draft.grain;
    expect(() => executor.executeResource({ id: "bad", kind: "resource-change", actor: debtor, resource: "grain", amount, causes: [] }, 0)).toThrow();
    expect(draft.grain).toBe(ledger);
    expect(entries).toEqual([]);
  });

  it("competing grants conserve grain, observe prior effects and retain legacy causes", () => {
    const { draft, executor, creditor, debtor, other, entries } = fixture();
    draft.grain = { ...draft.grain, [creditor]: 1 };
    const total = Object.values(draft.grain).reduce((a, b) => a + b, 0);
    const cause = draft.legacyEvents.find(e => e.year <= 1327)!.id;
    executor.executeGrant({ id: "one", creditor, debtor, causes: [cause] }, 0);
    executor.executeGrant({ id: "two", creditor, debtor: other, causes: ["one"] }, 1);
    expect(entries.map(e => [e.outcome, e.reason])).toEqual([["committed", undefined], ["ineligible", "exhausted-grain"]]);
    expect(entries[0].causes).toEqual([cause]);
    expect(entries[1].consumed).toMatchObject({ grain: [0, 2], priorOperations: ["one"] });
    expect(Object.values(draft.grain).reduce((a, b) => a + b, 0)).toBe(total);
    expect(draft.obligations).toHaveLength(1);
  });

  it.each(["unborn", "dead", "absent", "missing-allocation", "exhausted-grain", "grain-capacity"])("records ordered grant reason %s", reason => {
    const { draft, executor, creditor, debtor, entries } = fixture();
    if (reason === "unborn") { draft.people[creditor] = { ...draft.people[creditor], birthYear: 1328 }; draft.people[debtor].deathYear = 1327; }
    if (reason === "dead") { draft.people[creditor].deathYear = 1327; draft.people[debtor] = { ...draft.people[debtor], away: true }; }
    if (reason === "absent") { draft.people[creditor] = { ...draft.people[creditor], away: true }; draft.grain = {}; }
    if (reason === "missing-allocation") draft.grain = { [debtor]: 2 };
    if (reason === "exhausted-grain") draft.grain = { ...draft.grain, [creditor]: 0, [debtor]: Number.MAX_SAFE_INTEGER };
    if (reason === "grain-capacity") draft.grain = { ...draft.grain, [debtor]: Number.MAX_SAFE_INTEGER };
    executor.executeGrant({ id: "blocked", creditor, debtor, causes: [] }, 0);
    expect(entries[0]).toMatchObject({ reason, outcome: "ineligible", effects: [] });
    expect(draft.obligations).toEqual([]);
  });

  it.each([0, 0.999])("executes immediate earlier-debt response with noise %s without replacing Person/Mind", noise => {
    const { draft, executor, debtor, creditor, entries } = earlierDebt();
    const person = draft.people[debtor], mind = person.mind, assistance = draft.assistance;
    executor.executeRequest({ id: "request", obligation: "grant/help", noise }, 4);
    expect(entries.slice(1).map(e => [e.id, e.position, e.declarationIndex])).toEqual([["request", 1, 4], ["request/response", 2, 4]]);
    expect(entries[2].causes).toEqual(["grant", "request"]);
    expect(draft.obligations[0].status).toBe(noise === 0 ? "fulfilled" : "broken");
    expect([draft.assistance[debtor], draft.need[creditor]]).toEqual(noise === 0 ? [0, 0] : [1, 1]);
    expect(draft.assistance).not.toBe(assistance);
    expect(draft.people[debtor]).toBe(person); expect(person.mind).toBe(mind);
  });

  it.each(["closed", "dead", "absent", "grant-not-earlier"])("does not consult authority for ineligible HELP (%s)", reason => {
    const authority = vi.fn();
    const { draft, entries, debtor } = earlierDebt();
    if (reason === "closed") draft.obligations[0].status = "fulfilled";
    if (reason === "dead") draft.people[debtor].deathYear = 1328;
    if (reason === "absent") draft.people[debtor] = { ...draft.people[debtor], away: true };
    const executor = createFavorExecutor(draft, reason === "grant-not-earlier" ? 1327 : 1328, entries, authority);
    executor.executeRequest({ id: "blocked", obligation: "grant/help", noise: 0 }, 0);
    expect(entries.at(-1)).toMatchObject({ reason, effects: [], outcome: "ineligible" });
    expect(authority).not.toHaveBeenCalled();
  });

  it("revalidates competing HELP against actual effort consumed by the earlier response", () => {
    const { draft, entries, executor, debtor, other } = earlierDebt();
    createFavorExecutor(draft, 1327, entries).executeGrant({ id: "other", creditor: other, debtor, causes: [] }, 1);
    executor.executeRequest({ id: "first", obligation: "grant/help", noise: 0 }, 0);
    executor.executeRequest({ id: "second", obligation: "other/help", noise: 0 }, 1);
    expect(entries.at(-1)).toMatchObject({ reason: "exhausted-assistance", consumed: { assistance: [1, 0], priorOperations: ["grant", "other", "first", "first/response"] } });
    expect(draft.obligations.map(o => o.status)).toEqual(["fulfilled", "open"]);
  });

  it("uses shared identity/history checks and lossless detached evidence", () => {
    const { draft, entries, executor, creditor } = fixture();
    const person = draft.people[creditor]; person.deathYear = undefined; person.mind.stress = -0;
    const consumed = executor.evidence([creditor]);
    expect(Object.keys(consumed.people[0])).toEqual(Object.keys(person));
    expect(Object.hasOwn(consumed.people[0], "deathYear")).toBe(true);
    expect(Object.is(consumed.people[0].mind.stress, -0)).toBe(true);
    expect(consumed.people[0]).not.toBe(person);
    executor.append({ id: "physical", phase: "physical", declarationIndex: 0, kind: "residence", actors: [creditor], causes: [], effects: [], consumed, outcome: "committed" });
    expect(() => executor.prior("physical", [])).toThrow(/Duplicate/);
    expect(() => executor.prior(draft.legacyEvents[0].id, [])).toThrow(/Duplicate/);
    expect(() => executor.prior("next", ["missing"])).toThrow(/Unknown or forward/);
    draft.events.push({ id: "future", year: 1328, position: 1, kind: "residence", actors: [creditor] });
    expect(() => executor.prior("next", ["future"])).toThrow(/Unknown or forward/);
    expect(entries).toHaveLength(1);
  });

  it.each(["request", "request/response"])("rejects reserved request identity %s before executing HELP", id => {
    const { draft, entries, executor, creditor, debtor } = earlierDebt();
    executor.append({ id, phase: "resources", declarationIndex: 0, kind: "resource-change", actors: [creditor, debtor], causes: [], effects: [], consumed: {}, outcome: "committed" });
    const before = structuredClone(draft);
    expect(() => executor.executeRequest({ id: "request", obligation: "grant/help", noise: 0 }, 0)).toThrow(/Duplicate/);
    expect(draft).toEqual(before);
    expect(entries).toHaveLength(2);
  });

  it("authority receives frozen detached evidence and may choose only a human response", () => {
    const authority: ResponseAuthority = question => {
      expect(Object.isFrozen(question)).toBe(true);
      expect(Object.isFrozen(question.evidence.factors)).toBe(true);
      expect(() => { (question.actors as string[]).push("mutate"); }).toThrow();
      return { source: "human", selected: "refuse" };
    };
    const { draft, entries, executor } = earlierDebt(authority);
    executor.executeRequest({ id: "request", obligation: "grant/help", noise: 0 }, 0);
    expect(entries.at(-1)?.authority).toEqual({ source: "human", selected: "refuse", baseline: "help", noise: 0 });
    expect(draft.obligations[0].status).toBe("broken");
  });

  it.each(["invalid", "accessor", "throwing"])("failed authority (%s) leaves an unpublished partial draft for owner disposal", kind => {
    let getters = 0;
    const { draft, entries, executor } = earlierDebt(() => {
      if (kind === "throwing") throw new Error("failure");
      if (kind === "accessor") return Object.defineProperty({ source: "human" }, "selected", { enumerable: true, get() { getters++; return "help"; } });
      return { source: "rules", selected: "help" };
    });
    expect(() => executor.executeRequest({ id: "request", obligation: "grant/help", noise: 0 }, 0)).toThrow();
    expect(getters).toBe(0);
    expect(entries.map(e => e.id)).toEqual(["grant", "request"]);
    expect(draft.obligations[0].status).toBe("open");
  });
});

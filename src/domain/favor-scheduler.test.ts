import { describe, expect, it } from "vitest";
import { createMind } from "./mind";
import type { Person } from "./types";
import { createHelpFavorState, grantHelpFavor } from "./effects";
import { createFavorScheduler, runFavorYear } from "./scheduler";
import { createFavorFork, declareForkGrant, declareForkChoice, runFavorForkYear, forkFavor, semanticForkIdentity, semanticResponseTarget, type FavorFork, type ForkEvent, type ForkEvidence } from "./favor-fork";
import { forkByteOrder, forkDraw, forkOpportunityKey } from "./favor-scheduler";
import { keyedDraw } from "./rng";

export function inputs(count = 2, capacity = 2, need = 2, creditor = "a", debtor = "b") {
  const people: Record<string, Person> = Object.create(null);
  for (const id of [creditor, debtor]) {
    const mind = createMind("c2", id, 1300);
    mind.facets.altruism = 50; mind.facets.anxiety = 50; mind.values.wealth = 0;
    people[id] = { id, name: id, sex: "f", birthYear: 1300, founder: true, job: "none", traits: [], mind };
  }
  return createHelpFavorState(people, [], { [creditor]: count, [debtor]: 0 }, { [debtor]: capacity }, { [creditor]: need });
}
export function grant(key = "g0", year = 1336, creditor = "a", debtor = "b") {
  return { key, year, creditor, debtor, causes: [], ties: [], appraisals: [] };
}
export function root(seed = "c2-1", count = 2, capacity = 2, need = 2) {
  let state = createFavorFork(createFavorScheduler(inputs(count, capacity, need), seed, 1335), "root");
  for (let i = 0; i < count; i++) state = declareForkGrant(state, grant(`g${i}`));
  return runFavorForkYear(state, 1336);
}
export function responses(state: FavorFork): ForkEvent[] {
  return state.events.filter((event): event is ForkEvent => event.version === "favor-fork-d2b" && event.kind === "help-response");
}
function semanticLedgers(state: FavorFork) {
  return {
    grain: state.grain, assistance: state.assistance, need: state.need, ties: state.ties,
    obligations: state.obligations.map((debt) => ({ ...debt, id: semanticForkIdentity(state, debt.id), origin: semanticForkIdentity(state, debt.origin) })),
  };
}

describe("D2b seeded continuation", () => {
  it.each(["c2-1", "c2-2", "c2-11", "c2-0"])("has exact C2 keys/draws/policy and ledgers for %s", (seed) => {
    let c = inputs();
    for (let i = 0; i < 2; i++) c = grantHelpFavor(c, grant(`g${i}`));
    const baseline = runFavorYear(createFavorScheduler(c, seed, 1336), 1337);
    const d = runFavorForkYear(root(seed), 1337);
    expect(semanticLedgers(d)).toEqual({ grain: baseline.state.grain, assistance: baseline.state.assistance, need: baseline.state.need, ties: baseline.state.ties, obligations: baseline.state.obligations });
    const attempts = d.years.at(-1)!.attempts;
    expect(attempts).toHaveLength(baseline.years[0]!.attempts.length);
    attempts.forEach((attempt, i) => {
      const expected = baseline.years[0]!.attempts[i]!;
      expect(attempt.kind).toBe(expected.kind);
      if (attempt.kind === "quiet" || expected.kind === "quiet") return;
      expect(attempt.activation).toEqual(expected.activation);
      if (attempt.kind === "response" && expected.kind === "response") {
        expect(attempt.response).toEqual(expected.response);
        expect(attempt.outcome).toBe(expected.outcome);
        const actual = d.events.find((event) => event.id === attempt.responseId)!;
        const cEvent = baseline.state.events.find((event) => event.id === expected.responseId)!;
        const evidence = actual.evidence as ForkEvidence;
        expect(evidence.noise).toBe(cEvent.evidence!.noise);
        expect(evidence.factors).toEqual(cEvent.evidence!.factors);
        expect(evidence.distribution).toEqual(cEvent.evidence!.distribution);
        expect(evidence.baselineSelection).toBe(cEvent.evidence!.selected);
      }
    });
  });
  it.each(["dead", "absent", "no-capacity", "no-need", "missing-capacity", "missing-need"])("shared current feasibility records %s as ineligible, not human refusal", (reason) => {
    const c = inputs();
    if (reason === "dead") c.people.b = { ...c.people.b!, deathYear: 1337 };
    const assistance: Record<string, number> = reason === "missing-capacity" ? {} : reason === "no-capacity" ? { b: 0 } : { b: 2 };
    const need: Record<string, number> = reason === "missing-need" ? {} : reason === "no-need" ? { a: 0 } : { a: 2 };
    // An explicit C grant fixes the prior fact; absence starts only at the later frontier
    // for the absent fixture through a dated legacy residence transition.
    if (reason === "absent") {
      c.legacyEvents.push({ id: "migration", year: 1337, kind: "move", actors: ["b"], payload: { away: true }, causes: [] });
    }
    const supplied = createHelpFavorState(c.people, c.legacyEvents, c.allocations, assistance, need);
    const issued = grantHelpFavor(supplied, grant());
    const state = runFavorForkYear(createFavorFork(createFavorScheduler(issued, "c2-1", 1336), "root"), 1337);
    expect(responses(state)).toHaveLength(0);
    expect(state.years[0]!.attempts.every((attempt) => attempt.kind === "quiet")).toBe(true);
  });
  it("preflights malformed consumed policy even if activation would be inactive", () => {
    const c = inputs();
    c.people.b!.mind.facets.altruism = 101;
    const issued = grantHelpFavor(c, grant());
    const state = createFavorFork(createFavorScheduler(issued, "c2-2", 1336), "root");
    const before = structuredClone(state);
    expect(() => runFavorForkYear(state, 1337)).toThrow();
    expect(state).toEqual(before);
  });
  it("preserves C2 transport literals and UTF8 ordering", () => {
    const target = { creditor: "a", debtor: "b", obligation: "physical", reason: null };
    const key = forkOpportunityKey(target, "semantic", 1337, 1, "response");
    expect(JSON.parse(key)).toEqual(["favor-scheduler-c2", "keyed-mulberry32-c2", "help-opportunity", ["a", "b"], 1337, 1, "semantic", "response"]);
    expect(forkDraw("seed", key).value).toBe(keyedDraw(JSON.stringify(["seed", key]), "favor-c2", 0, "uniform"));
    expect(["é", "a", "z"].sort(forkByteOrder)).toEqual(["a", "z", "é"]);
    expect(forkByteOrder("\ud800", "\ud801")).toBeLessThan(0);
  });
  it("orders semantic debts independent of lineage and preserves no-op seeded noise", () => {
    const parent = runFavorForkYear(root(), 1337);
    const child = forkFavor(parent, 1336, "zz-child");
    const nested = forkFavor(child, 1336, "aa-nested");
    expect(semanticLedgers(child)).toEqual(semanticLedgers(parent));
    expect(semanticLedgers(nested)).toEqual(semanticLedgers(parent));
    expect(responses(child).map((event) => (event.evidence as ForkEvidence).noise)).toEqual(responses(parent).map((event) => (event.evidence as ForkEvidence).noise));
    expect(responses(nested).map((event) => event.semantic)).toEqual(responses(parent).map((event) => event.semantic));
    expect(child.events.every((event) => event.version === "favor-fork-d2b" && event.lineage === child.lineage)).toBe(true);
  });
  it("reinspects downstream feasibility after a human choice rather than forcing two requests", () => {
    const parent = runFavorForkYear(root("c2-1", 2, 1, 2), 1337);
    expect(responses(parent)).toHaveLength(1);
    const first = responses(parent)[0]!;
    const request = parent.events.find((event) => event.id === first.request)!;
    const semanticRequest = semanticForkIdentity(parent, request.id);
    const key = JSON.parse(semanticRequest)[1] as string;
    const target = JSON.stringify(["help-response", first.actors, 1337, ["favor-c1/help-request", key, 1337], "response"]);
    const child = forkFavor(parent, 1337, "refuse", [{ target, actors: ["a", "b"], year: 1337, choice: "refuse" }]);
    expect(responses(child)).toHaveLength(2);
    expect((responses(child)[0]!.evidence as ForkEvidence).effectiveChoice).toBe("refuse");
    expect((responses(child)[0]!.evidence as ForkEvidence).noise).toBe((first.evidence as ForkEvidence).noise);
    expect(child.assistance.b).toBe(0);
  });
  it("a human help replaces refusal, making an inherited downstream target inactive without forced effects", () => {
    let parent: FavorFork | undefined;
    for (let i = 0; i < 80; i++) {
      const candidate = runFavorForkYear(root(`c2-${i}`, 2, 1, 2), 1337);
      if (responses(candidate).length === 2 && (responses(candidate)[0]!.evidence as ForkEvidence).effectiveChoice === "refuse") { parent = candidate; break; }
    }
    expect(parent).toBeDefined();
    const events = responses(parent!);
    const targetOf = (event: ForkEvent) => {
      const requestSemantic = semanticForkIdentity(parent!, event.request!);
      return semanticResponseTarget(JSON.parse(requestSemantic)[1], event.actors, event.year);
    };
    const second = { target: targetOf(events[1]!), actors: ["a", "b"] as [string, string], year: 1337, choice: "refuse" as const };
    const declared = declareForkChoice(root(parent!.seed, 2, 1, 2), second);
    const withHistory = runFavorForkYear(declared, 1337);
    const child = forkFavor(withHistory, 1337, "help-first", [{ target: targetOf(events[0]!), actors: ["a", "b"], year: 1337, choice: "help" }]);
    expect(responses(child)).toHaveLength(1);
    expect(child.history.find((entry) => entry.kind === "choice" && "target" in entry.command && entry.command.target === second.target)!.status).toBe("inactive");
    expect(child.assistance.b).toBe(0);
    expect((responses(child)[0]!.evidence as ForkEvidence).baselineSelection).toBe("refuse");
    expect((responses(child)[0]!.evidence as ForkEvidence).noise).toBe((events[0]!.evidence as ForkEvidence).noise);
    expect(child.obligations[1]!.status).toBe("open");
  });
  it("closes every suffix reference and mapping, including appraisals and retained closed debt", () => {
    let d = createFavorFork(createFavorScheduler(inputs(), "c2-1", 1335), "root");
    d = declareForkGrant(d, { ...grant(), appraisals: [{ actor: "a", interpretation: "gratitude", intensity: 5 }] });
    d = runFavorForkYear(runFavorForkYear(d, 1336), 1337);
    d = forkFavor(d, 1336, "child");
    const ids = new Set(d.events.map((event) => event.id));
    for (const event of d.events) {
      for (const cause of event.causes) expect(ids.has(cause)).toBe(true);
      if (event.request) expect(ids.has(event.request)).toBe(true);
      for (const effect of event.effects) {
        if ("origin" in effect) expect(ids.has(effect.origin)).toBe(true);
        if (effect.kind === "appraisal") expect(d.mapping.some((entry) => entry.physical === effect.id && entry.kind === "appraisal")).toBe(true);
        if (effect.kind === "settlement") expect(d.obligations.some((entry) => entry.id === effect.id && entry.origin === effect.origin)).toBe(true);
      }
    }
    expect(d.mapping.filter((entry) => entry.kind === "debt")).toHaveLength(d.obligations.length);
    expect(new Set(d.mapping.map((entry) => entry.physical)).size).toBe(d.mapping.length);
    expect(new Set(d.mapping.map((entry) => entry.semantic)).size).toBe(d.mapping.length);
  });
});

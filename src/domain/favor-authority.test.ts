import { describe, expect, it } from "vitest";
import { createMind } from "./mind";
import { applyHelpFavorEvent, createHelpFavorState, grantHelpFavor, requestHelp, respondHelp, replayHelpFavorEvents } from "./effects";
import { createFavorScheduler } from "./scheduler";
import { createFavorCapsule, admitFavorCapsule } from "./favor-capsule";
import type { Person } from "./types";
import * as authority from "./favor-authority";

const person = (id: string): Person => {
  const mind = createMind("authority", id, 1300);
  mind.facets.altruism = 50;
  mind.facets.anxiety = 50;
  mind.values.wealth = 0;
  return { id, name: id, sex: "f", birthYear: 1300, traits: [], job: "none", founder: true, mind };
};
const pending = () => {
  const initial = createHelpFavorState({ a: person("a"), b: person("b") }, [], { a: 2, b: 0 }, { b: 2 }, { a: 2 });
  const grant = grantHelpFavor(initial, { key: "grant", year: 1336, creditor: "a", debtor: "b", causes: [], ties: [], appraisals: [] });
  return requestHelp(grant, { key: "request", year: 1337, obligation: grant.obligations[0]!.id });
};
const twoPending = (capacity = 2, need = 2, reverse = false) => {
  let c = createHelpFavorState({ a: person("a"), b: person("b") }, [], { a: 2, b: 0 }, { a: capacity, b: capacity }, { a: need, b: need });
  c = grantHelpFavor(c, { key: "first", year: 1336, creditor: "a", debtor: "b", causes: [], ties: [], appraisals: [] });
  c = grantHelpFavor(c, { key: "second", year: 1336, creditor: reverse ? "b" : "a", debtor: reverse ? "a" : "b", causes: [], ties: [], appraisals: [] });
  c = requestHelp(c, { key: "first-request", year: 1337, obligation: c.obligations[0]!.id });
  return requestHelp(c, { key: "second-request", year: 1337, obligation: c.obligations[1]!.id });
};
const cold = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const dState = () => authority.createAuthorityFavorState(pending());
const seeded = (state = dState(), noise = 0.1, request = state.events.at(-1)!.id) => authority.respondWithAuthority(state, { request, year: 1337, noise, appraisals: [] });
const dEvent = (state = seeded()) => state.events.at(-1)! as authority.AuthorityFavorEvent;
const human = (state = dState(), choice: "help" | "refuse" = "help"): authority.ResponseAuthority => ({ version: authority.FAVOR_AUTHORITY_VERSION, source: "human", target: authority.helpResponseTarget(state, state.events.at(-1)!.id, 1337), actors: ["a", "b"], year: 1337, choice });
const ledger = (value: ReturnType<typeof pending> | authority.AuthorityFavorState) => ({ grain: value.grain, assistance: value.assistance, need: value.need, obligations: value.obligations, ties: value.ties });

describe("standalone D response authority", () => {
  it.each([{ noise: 0.9, choice: "help", baseline: "refuse" }, { noise: 0.1, choice: "refuse", baseline: "help" }] as const)("declares $choice against baseline $baseline without forging noise", ({ noise, choice, baseline }) => {
    const c = pending();
    const state = authority.createAuthorityFavorState(c);
    const request = c.events.at(-1)!;
    const target = authority.helpResponseTarget(state, request.id, 1337);
    const next = authority.respondWithAuthority(state, { request: request.id, year: 1337, noise, appraisals: [], authority: { version: authority.FAVOR_AUTHORITY_VERSION, source: "human", target, actors: ["a", "b"], year: 1337, choice } });
    const event = dEvent(next);
    expect(event).toMatchObject({ version: authority.FAVOR_AUTHORITY_VERSION, evidence: { noise, baselineSelection: baseline, effectiveChoice: choice } });
    const oldEvidence = respondHelp(c, { request: request.id, year: 1337, noise, appraisals: [] }).events.at(-1)!.evidence!;
    expect(event.evidence.factors).toEqual(oldEvidence.factors);
    expect(event.evidence.distribution).toEqual(oldEvidence.distribution);
    expect(event.evidence.options).toEqual(oldEvidence.options);
    expect(event.evidence.feasibility).toEqual(oldEvidence.feasibility);
    expect(event.evidence.authority).toMatchObject({ source: "human", target, choice });
    expect(next.obligations[0]!.status).toBe(choice === "help" ? "fulfilled" : "broken");
    expect(next.events.slice(0, c.events.length)).toEqual(c.events);
    expect(authority.admitAuthorityFavorState(cold(next))).toEqual(next);
    expect(authority.applyAuthorityFavorEvent(cold(state), cold(event))).toEqual(next);
  });
  it.each([0.1, 0.9])("seeded D preserves C consequences and original prefix bytes: %s", (noise) => {
    const c = pending();
    const before = structuredClone(c);
    const state = authority.createAuthorityFavorState(c);
    const next = seeded(state, noise);
    const old = respondHelp(c, { request: c.events.at(-1)!.id, year: 1337, noise, appraisals: [] });
    expect(ledger(next)).toEqual(ledger(old));
    expect(dEvent(next).evidence).toMatchObject({ noise, baselineSelection: noise === 0.1 ? "help" : "refuse", effectiveChoice: noise === 0.1 ? "help" : "refuse", authority: { source: "seeded" } });
    expect(JSON.stringify(next.events.slice(0, c.events.length))).toBe(JSON.stringify(c.events));
    expect(next.people).toEqual(c.people);
    expect(next.people).not.toBe(c.people);
    expect(c).toEqual(before);
    expect(state.events).toHaveLength(c.events.length);
    expect(authority.applyAuthorityFavorEvent(state, cold(dEvent(next)))).toEqual(next);
    expect(authority.replayAuthorityFavorEvents(cold(state), cold([dEvent(next)]))).toEqual(next);
    expect(authority.replayAuthorityFavorEvents(cold(next), [])).toEqual(next);
    expect(next).not.toHaveProperty("initialPeople");
    expect(next).not.toHaveProperty("selected");
  });
  it("keeps semantic target independent of noise, choice and unrelated log position", () => {
    const state = dState();
    const request = state.events.at(-1)!.id;
    const target = authority.helpResponseTarget(state, request, 1337);
    const help = authority.respondWithAuthority(state, { request, year: 1337, noise: 0.9, appraisals: [], authority: human(state) });
    const refuse = authority.respondWithAuthority(state, { request, year: 1337, noise: 0.1, appraisals: [], authority: human(state, "refuse") });
    expect(dEvent(help).id).toBe(dEvent(refuse).id);
    expect(dEvent(help).key).toBe(target);
    const c = pending();
    const changed = grantHelpFavor(c, { key: "unrelated", year: 1337, creditor: "a", debtor: "b", causes: [], ties: [], appraisals: [] });
    const shifted = authority.createAuthorityFavorState(changed);
    expect(authority.helpResponseTarget(shifted, request, 1337)).toBe(target);
    expect(dEvent(seeded(shifted, 0.1, request)).position).toBe(dEvent(help).position + 1);
  });
  it("recomputes current policy and physical resources between pending C requests", () => {
    const root = authority.createAuthorityFavorState(twoPending(2, 2, true));
    const first = seeded(root, 0.1, root.events[2]!.id);
    const second = seeded(first, 0.602, root.events[3]!.id);
    expect(dEvent(second).evidence.factors.trust).toBe(5);
    expect(dEvent(second).evidence.distribution[0]).toBeCloseTo(0.605);
    expect(dEvent(second).evidence.baselineSelection).toBe("help");
    expect(second.obligations.map((entry) => entry.status)).toEqual(["fulfilled", "fulfilled"]);
    expect(authority.replayAuthorityFavorEvents(cold(root), cold(second.events.slice(4) as authority.AuthorityFavorEvent[]))).toEqual(second);
    const stale = dEvent(seeded(root, 0.602, root.events[3]!.id));
    stale.position++;
    expect(() => authority.applyAuthorityFavorEvent(first, stale)).toThrow();
  });
  it.each([{ capacity: 1, need: 2 }, { capacity: 2, need: 1 }])("last resource prevents both help and refusal: $capacity/$need", ({ capacity, need }) => {
    const root = authority.createAuthorityFavorState(twoPending(capacity, need));
    const first = seeded(root, 0.1, root.events[2]!.id);
    const before = structuredClone(first);
    const target = authority.helpResponseTarget(root, root.events[3]!.id, 1337);
    for (const choice of ["help", "refuse"] as const) {
      expect(() => authority.respondWithAuthority(first, { request: root.events[3]!.id, year: 1337, noise: 0.9, appraisals: [], authority: { version: authority.FAVOR_AUTHORITY_VERSION, source: "human", target, actors: ["a", "b"], year: 1337, choice } })).toThrow();
    }
    expect(first).toEqual(before);
    expect(first.obligations.filter((entry) => entry.status === "fulfilled")).toHaveLength(1);
  });
  it("retains explicit appraisals and detached inputs without automatic gratitude", () => {
    const state = dState();
    const command = { request: state.events.at(-1)!.id, year: 1337, noise: 0.9, appraisals: [{ actor: "b", interpretation: "resentment" as const, intensity: 40 }], authority: human(state) };
    const before = structuredClone({ state, command });
    const next = authority.respondWithAuthority(state, command);
    expect(next.appraisals).toHaveLength(1);
    expect(next.appraisals[0]).toMatchObject({ origin: dEvent(next).id, actor: "b", interpretation: "resentment", intensity: 40 });
    expect(authority.applyAuthorityFavorEvent(state, cold(dEvent(next)))).toEqual(next);
    next.people.b!.mind.facets.altruism = 0;
    next.events[0]!.actors.reverse();
    dEvent(next).evidence.authority.actors.reverse();
    expect({ state, command }).toEqual(before);
    expect(seeded().appraisals).toEqual([]);
  });
});

describe("closed D admission", () => {
  it.each(["source", "choice", "target", "actors", "year", "version", "missing-target", "extra", "null"])("rejects malformed declared authority: %s", (kind) => {
    const state = dState();
    const declared = human(state) as unknown as Record<string, unknown>;
    if (kind === "source") declared.source = "LLM";
    if (kind === "choice") declared.choice = "consent";
    if (kind === "target") declared.target = "wrong";
    if (kind === "actors") declared.actors = ["b", "a"];
    if (kind === "year") declared.year = 1338;
    if (kind === "version") declared.version = "favor-c1";
    if (kind === "missing-target") delete declared.target;
    if (kind === "extra") declared.authenticated = true;
    const before = structuredClone(state);
    expect(() => authority.respondWithAuthority(state, { request: state.events.at(-1)!.id, year: 1337, noise: 0.9, appraisals: [], authority: (kind === "null" ? null : declared) as never })).toThrow();
    expect(state).toEqual(before);
  });
  it("rejects seeded choice injection and missing human metadata on import", () => {
    const event = cold(dEvent());
    Object.assign(event.evidence.authority, { choice: "refuse" });
    expect(() => authority.applyAuthorityFavorEvent(dState(), event)).toThrow();
    const missing = cold(dEvent());
    Object.assign(missing.evidence.authority, { source: "human" });
    expect(() => authority.applyAuthorityFavorEvent(dState(), missing)).toThrow();
    const nullAuthority = cold(dEvent());
    Object.assign(nullAuthority.evidence, { authority: null });
    expect(() => authority.applyAuthorityFavorEvent(dState(), nullAuthority)).toThrow();
  });
  it("rejects a fresh request behind the admitted log frontier", () => {
    const c = pending();
    const later = grantHelpFavor(c, { key: "later", year: 1338, creditor: "a", debtor: "b", causes: [], ties: [], appraisals: [] });
    const state = authority.createAuthorityFavorState(later);
    const before = structuredClone(state);
    expect(() => seeded(state, 0.1, c.events.at(-1)!.id)).toThrow();
    expect(state).toEqual(before);
  });
  it.each(["manifest", "prefix", "resources", "debt", "extra", "mixed-prefix", "mixed-suffix", "duplicate-log"])("rejects forged checkpoints: %s", (kind) => {
    const state = cold(seeded());
    if (kind === "manifest") (state.manifest as { engine: string }).engine = "favor-c1";
    if (kind === "prefix") state.prefixLength--;
    if (kind === "resources") state.assistance.b!++;
    if (kind === "debt") state.obligations[0]!.status = "open";
    if (kind === "extra") Object.assign(state, { authority: human() });
    if (kind === "mixed-prefix") state.prefixLength++;
    if (kind === "mixed-suffix") state.events.push(pending().events.at(-1)!);
    if (kind === "duplicate-log") state.events.push(dEvent(state));
    const before = structuredClone(state);
    expect(() => authority.admitAuthorityFavorState(state)).toThrow();
    expect(state).toEqual(before);
  });
  it.each(["version", "id", "key", "ordinal", "kind", "actors", "year", "position", "request", "obligation", "causes", "noise", "baseline", "effective", "factors", "distribution", "feasibility", "authority", "effects", "duplicate-effect", "extra"])("rejects tampered imported responses: %s", (kind) => {
    const state = dState();
    const event = cold(dEvent());
    if (kind === "version") Object.assign(event, { version: "favor-c1" });
    if (kind === "id") event.id = "wrong";
    if (kind === "key") event.key = "wrong";
    if (kind === "ordinal") Object.assign(event, { ordinal: 1 });
    if (kind === "kind") Object.assign(event, { kind: "grain-grant" });
    if (kind === "actors") event.actors.reverse();
    if (kind === "year") event.year++;
    if (kind === "position") event.position++;
    if (kind === "request") event.request = "unknown";
    if (kind === "obligation") event.obligation = "unknown";
    if (kind === "causes") event.causes.reverse();
    if (kind === "noise") event.evidence.noise = 0.9;
    if (kind === "baseline") event.evidence.baselineSelection = "refuse";
    if (kind === "effective") event.evidence.effectiveChoice = "refuse";
    if (kind === "factors") event.evidence.factors.trust++;
    if (kind === "distribution") event.evidence.distribution.reverse();
    if (kind === "feasibility") event.evidence.feasibility.assistance++;
    if (kind === "authority") event.evidence.authority.target = "wrong";
    if (kind === "effects") Object.assign(event.effects[0]!, { status: "broken" });
    if (kind === "duplicate-effect") event.effects.push(event.effects[0]!);
    if (kind === "extra") Object.assign(event, { transport: "override" });
    const before = structuredClone(state);
    expect(() => authority.applyAuthorityFavorEvent(state, event)).toThrow();
    expect(state).toEqual(before);
  });
  it.each(["stale-year", "unknown-request", "closed", "superseded", "dead", "absent", "missing-capacity", "missing-need"])("rejects ineligible/stale response inputs: %s", (kind) => {
    const state = dState();
    if (kind === "closed") return expect(() => seeded(seeded(), 0.1, state.events.at(-1)!.id)).toThrow();
    if (kind === "superseded") {
      const c = respondHelp(pending(), { request: pending().events.at(-1)!.id, year: 1337, noise: 0.9, appraisals: [] });
      return expect(() => seeded(authority.createAuthorityFavorState(c), 0.1, c.events[1]!.id)).toThrow();
    }
    if (kind === "dead") state.people.b!.deathYear = 1337;
    if (kind === "absent") state.people.a = { ...state.people.a!, away: true };
    if (kind === "missing-capacity") delete state.assistance.b;
    if (kind === "missing-need") delete state.need.a;
    const before = structuredClone(state);
    expect(() => authority.respondWithAuthority(state, { request: kind === "unknown-request" ? "unknown" : state.events.at(-1)!.id, year: kind === "stale-year" ? 1338 : 1337, noise: 0.9, appraisals: [], authority: human() })).toThrow();
    expect(state).toEqual(before);
  });
  it.each([-1, 1, NaN, Infinity])("rejects invalid uniform noise: %s", (noise) => expect(() => seeded(dState(), noise)).toThrow());
  it("rejects repeated event/settlement without publishing any effects", () => {
    const next = seeded();
    const before = structuredClone(next);
    expect(() => authority.applyAuthorityFavorEvent(next, dEvent(next))).toThrow();
    expect(() => authority.replayAuthorityFavorEvents(dState(), [dEvent(next), dEvent(next)])).toThrow();
    expect(next).toEqual(before);
  });
});

describe("descriptor-first D boundaries and legacy isolation", () => {
  it.each(["accessor", "prototype", "sparse", "undefined", "array-hook", "cycle", "nonfinite", "authority-hook"])("rejects executable/non-data commands with zero hooks: %s", (kind) => {
    const state = dState();
    const command = { request: state.events.at(-1)!.id, year: 1337, noise: 0.9, appraisals: [] as unknown[], authority: human(state) };
    let calls = 0;
    if (kind === "accessor") Object.defineProperty(command, "year", { enumerable: true, get: () => { calls++; return 1337; } });
    if (kind === "prototype") Object.setPrototypeOf(command, { get toJSON() { calls++; return () => ({}); } });
    if (kind === "sparse") command.appraisals = new Array(1);
    if (kind === "undefined") Object.assign(command, { toJSON: undefined });
    if (kind === "array-hook") Object.defineProperty(command.appraisals, "toJSON", { enumerable: true, get: () => { calls++; return () => []; } });
    if (kind === "cycle") command.appraisals.push(command);
    if (kind === "nonfinite") command.noise = Infinity;
    if (kind === "authority-hook") Object.defineProperty(command.authority, "source", { enumerable: true, get: () => { calls++; return "human"; } });
    expect(() => authority.respondWithAuthority(state, command as never)).toThrow();
    expect(calls).toBe(0);
  });
  it.each(["state", "event", "manifest", "evidence", "effect"])("guards entire imported input before hooks: %s", (location) => {
    const state = dState();
    const event = dEvent();
    let calls = 0;
    const root = location === "state" ? state : location === "event" ? event : location === "manifest" ? state.manifest : location === "evidence" ? event.evidence : event.effects[0]!;
    Object.defineProperty(root, "hook", { enumerable: true, get: () => { calls++; return 1; } });
    expect(() => authority.applyAuthorityFavorEvent(state, event)).toThrow();
    expect(calls).toBe(0);
  });
  it("preserves own __proto__ people and traversal through cold replay", () => {
    const registry = Object.fromEntries([["b", person("b")], ["__proto__", person("__proto__")]]);
    let c = createHelpFavorState(registry, [], Object.fromEntries([["__proto__", 1], ["b", 0]]), { b: 1 }, Object.fromEntries([["__proto__", 1]]));
    c = grantHelpFavor(c, { key: "proto-grant", year: 1336, creditor: "__proto__", debtor: "b", causes: [], ties: [], appraisals: [] });
    c = requestHelp(c, { key: "proto-request", year: 1337, obligation: c.obligations[0]!.id });
    const next = seeded(authority.createAuthorityFavorState(c));
    const restored = authority.admitAuthorityFavorState(cold(next));
    expect(Object.keys(restored.people)).toEqual(["b", "__proto__"]);
    expect(Object.hasOwn(restored.people, "__proto__")).toBe(true);
    expect(restored).toEqual(next);
    expect(authority.admitAuthorityFavorState(Object.assign(Object.create(null), cold(next)))).toEqual(next);
  });
  it("permits existing declared optional Person absence but rejects unsafe undefined data", () => {
    const c = pending();
    c.people.b!.deathYear = undefined;
    const next = seeded(authority.createAuthorityFavorState(c));
    expect(authority.admitAuthorityFavorState(cold(next)).obligations).toEqual(next.obligations);
    Object.assign(next.manifest, { hook: undefined });
    expect(() => authority.admitAuthorityFavorState(next)).toThrow();
    expect(() => authority.respondWithAuthority(dState(), { request: "unknown", year: 1337, noise: 0.9, appraisals: [], authority: undefined })).toThrow();
  });
  it("keeps C constructors/imports and the D1 capsule C-only", () => {
    const c = pending();
    const d = seeded();
    expect(() => authority.createAuthorityFavorState(d as never)).toThrow();
    expect(() => replayHelpFavorEvents(d as never, [])).toThrow();
    expect(() => applyHelpFavorEvent(c, dEvent(d) as never)).toThrow();
    expect(() => authority.createAuthorityFavorState({ ...c, authority: human() } as never)).toThrow();
    expect(() => respondHelp(c, { request: c.events.at(-1)!.id, year: 1337, noise: 0.9, appraisals: [], authority: human() } as never)).toThrow();
    expect(() => createFavorScheduler(d as never, "seed", 1337)).toThrow();
    const cScheduler = createFavorScheduler(c, "seed", 1337);
    expect(() => createFavorCapsule({ ...cScheduler, state: d } as never)).toThrow();
    const capsule = createFavorCapsule(cScheduler);
    Object.assign(capsule.scheduler, { state: d });
    expect(() => admitFavorCapsule(capsule)).toThrow();
    expect(() => createHelpFavorState(d as never, [], { a: 1, b: 0 }, { b: 1 }, { a: 1 })).toThrow();
  });
});

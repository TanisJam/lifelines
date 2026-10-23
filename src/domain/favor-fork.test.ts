import { describe, expect, it } from "vitest";
import { createMind } from "./mind";
import type { Person } from "./types";
import { createHelpFavorState, replayHelpFavorEvents, type HelpFavorState } from "./effects";
import { createFavorScheduler, admitFavorScheduler, runFavorYear } from "./scheduler";
import { createAuthorityFavorState, respondWithAuthority } from "./favor-authority";
import { createFavorCapsule } from "./favor-capsule";
import {
  createFavorFork, admitFavorFork, declareForkGrant, declareForkChoice,
  runFavorForkYear, forkFavor, semanticForkIdentity, semanticResponseTarget,
  type FavorFork, type ForkEvent, type ForkEvidence, type ForkChoice,
} from "./favor-fork";
import { forkOpportunityKey } from "./favor-scheduler";
import { grantHelpFavor, requestHelp } from "./effects";

const cold = <T>(value: T): T => JSON.parse(JSON.stringify(value));
function initial() {
  const person = (id: string): Person => {
    const mind = createMind("c2", id, 1300);
    mind.facets.altruism = 50; mind.facets.anxiety = 50; mind.values.wealth = 0;
    return { id, name: id, sex: "f" as const, birthYear: 1300, founder: true, job: "none", traits: [], mind };
  };
  return createHelpFavorState({ a: person("a"), b: person("b") }, [], { a: 2, b: 0 }, { b: 2 }, { a: 2 });
}
const grant = (key = "g0", year = 1336) => ({ key, year, creditor: "a", debtor: "b", causes: [], ties: [], appraisals: [] });
function root(seed = "c2-1") {
  let state = createFavorFork(createFavorScheduler(initial(), seed, 1335), "root");
  state = declareForkGrant(declareForkGrant(state, grant()), grant("g1"));
  return runFavorForkYear(state, 1336);
}
function choice(year = 1337, slot = 0, grantKey = "g0", selected: "help" | "refuse" = "refuse"): ForkChoice {
  const debt = `${JSON.stringify(["favor-c1", grantKey, 0])}/help`;
  const key = forkOpportunityKey({ creditor: "a", debtor: "b", obligation: "ignored", reason: null }, debt, year, slot, "request");
  return { target: semanticResponseTarget(key, ["a", "b"], year), actors: ["a", "b"], year, choice: selected };
}
const responses = (state: FavorFork) => state.events.filter((entry): entry is ForkEvent => entry.version === "favor-fork-d2b" && entry.kind === "help-response");

describe("D2b core admission", () => {
  it("owns a versioned standalone root and cold reconstruction", () => {
    const state = createFavorFork(createFavorScheduler(createHelpFavorState({}, [], {}, {}, {}), "seed", 1336), "root");
    expect(state.manifest.schema).toBe("favor-fork-d2b");
    expect(admitFavorFork(cold(state))).toEqual(state);
    expect(Object.hasOwn(state, "initialPeople")).toBe(false);
    expect(Object.hasOwn(state, "finalPeople")).toBe(false);
  });
  it("cold replay, continuation and nested forks are equal without input mutation or aliases", () => {
    const state = runFavorForkYear(root(), 1337);
    const before = structuredClone(state);
    expect(admitFavorFork(cold(state))).toEqual(state);
    expect(runFavorForkYear(cold(state), 1340)).toEqual(runFavorForkYear(state, 1340));
    const child = forkFavor(state, 1337, "child", [choice()]);
    expect(child).toEqual(forkFavor(cold(state), 1337, "child", [choice()]));
    const nested = forkFavor(child, 1337, "nested", [choice(1337, 0, "g0", "help")]);
    expect(nested).toEqual(forkFavor(cold(child), 1337, "nested", [choice(1337, 0, "g0", "help")]));
    expect(admitFavorFork(cold(nested))).toEqual(nested);
    (child.people.a! as unknown as Record<string, unknown>).name = "detached";
    child.history[0]!.command.year = 9999;
    expect(state).toEqual(before);
  });
  it("preserves exact quiet prefix frontiers, gapped years and event bytes", () => {
    let state = root("c2-2");
    state = runFavorForkYear(state, 1337);
    state = runFavorForkYear(state, 1340);
    state = runFavorForkYear(state, 1344);
    const child = forkFavor(state, 1340, "child");
    expect(JSON.stringify(child.years.filter((record) => record.year < 1340))).toBe(JSON.stringify(state.years.filter((record) => record.year < 1340)));
    expect(JSON.stringify(child.events.filter((event) => event.year < 1340))).toBe(JSON.stringify(state.events.filter((event) => event.year < 1340)));
    expect(child.years.map((record) => record.year)).toEqual([1336, 1337, 1340, 1344]);
    expect(child.actions.filter((action) => action.kind === "year").map((action) => action.year)).not.toContain(1338);
  });
  it("admits explicit C2 prefixes with quiet history and locks only initial facts", () => {
    let c = grantHelpFavor(initial(), grant());
    const scheduler = runFavorYear(createFavorScheduler(c, "c2-2", 1336), 1337);
    const d = createFavorFork(scheduler, "admitted-prefix");
    const child = forkFavor(runFavorForkYear(d, 1340), 1340, "child");
    expect(JSON.stringify(child.events.slice(0, d.prefix.length))).toBe(JSON.stringify(c.events));
    expect(child.prefix).toEqual(d.prefix);
    expect(() => forkFavor(d, 1336, "bad")).toThrow();
    const earlier = forkFavor(d, 1337, "quiet-fork");
    expect(earlier.prefix.years).toHaveLength(0);
    expect(earlier.years.map((record) => record.year)).toEqual([1337]);
    expect(earlier.events).toEqual(c.events);
    c = requestHelp(c, { key: "pending", year: 1337, obligation: c.obligations[0]!.id });
    expect(createFavorFork(createFavorScheduler(c, "seed", 1337), "c-pending").events).toEqual(c.events);
  });
  it("re-executes an admitted C2 suffix without using C outcomes as commands", () => {
    const c = grantHelpFavor(grantHelpFavor(initial(), grant()), grant("g1"));
    const baseline = runFavorYear(runFavorYear(createFavorScheduler(c, "c2-1", 1336), 1337), 1340);
    const d = createFavorFork(baseline, "c2-root");
    const child = forkFavor(d, 1337, "child");
    expect(JSON.stringify(child.events.slice(0, 2))).toBe(JSON.stringify(c.events));
    expect(child.events.slice(2).every((event) => event.version === "favor-fork-d2b")).toBe(true);
    expect(child.years.map((record) => record.year)).toEqual([1337, 1340]);
    expect(child.assistance).toEqual(baseline.state.assistance);
    expect(child.need).toEqual(baseline.state.need);
    expect(child.ties).toEqual(baseline.state.ties);
    expect(child.history).toHaveLength(0);
    expect(admitFavorFork(cold(child))).toEqual(child);
    expect(forkFavor(cold(d), 1337, "child")).toEqual(child);
  });
  it("inherits declarations made before branching even when execution is later", () => {
    let state = declareForkChoice(root(), choice(1337));
    state = declareForkChoice(state, choice(1340));
    state = runFavorForkYear(runFavorForkYear(state, 1337), 1340);
    const child = forkFavor(state, 1337, "child");
    expect(child.history.filter((entry) => entry.kind === "choice")).toHaveLength(2);
    expect(child.history.filter((entry) => entry.kind === "choice").map((entry) => entry.declaredAt)).toEqual([1336, 1336]);
    expect(child.history.find((entry) => entry.kind === "choice" && entry.command.year === 1340)!.status).toBe("inactive");
    expect(responses(child).filter((entry) => entry.year === 1340)).toHaveLength(0);
  });
  it("excludes later parent declarations and future issued grants, without inheriting outcome commands", () => {
    let state = runFavorForkYear(root("c2-2"), 1337);
    state = declareForkGrant(state, { ...grant("later", 1340), creditor: "b", debtor: "a" });
    state = declareForkChoice(state, choice(1340));
    state = runFavorForkYear(state, 1340);
    const child = forkFavor(state, 1337, "child");
    expect(child.history.some((entry) => entry.kind === "choice")).toBe(false);
    expect(child.history.some((entry) => entry.kind === "grant" && "key" in entry.command && entry.command.key === "later")).toBe(false);
    expect(child.mapping.some((entry) => entry.semantic.includes("later"))).toBe(false);
    expect(child.people).toEqual(state.people);
  });
  it("keeps ordered history and executes only nearest-child same-target choice", () => {
    const parent = runFavorForkYear(declareForkChoice(root(), choice()), 1337);
    const child = forkFavor(parent, 1337, "child", [choice(1337, 0, "g0", "help")]);
    const decisions = child.history.filter((entry) => entry.kind === "choice");
    expect(decisions.map((entry) => entry.status)).toEqual(["superseded", "effective"]);
    expect(decisions[0]!.id).toBe(parent.history.find((entry) => entry.kind === "choice")!.id);
    expect(decisions[1]!.lineage).toBe(child.lineage);
    const event = responses(child)[0]!;
    const original = responses(parent)[0]!;
    const evidence = event.evidence as ForkEvidence;
    expect(evidence.effectiveChoice).toBe("help");
    expect(evidence.noise).toBe((original.evidence as ForkEvidence).noise);
    expect(event.semantic).toBe(original.semantic);
    expect(evidence.authority).toEqual({ source: "human", declaration: decisions[1]!.id });
    expect(child.events.filter((entry) => entry.kind === "help-response" && entry.obligation === event.obligation)).toHaveLength(1);
  });
  it("distinguishes future pending from inactive unreachable and never manufactures a request", () => {
    const pending = declareForkChoice(root("c2-2"), choice());
    expect(pending.history.at(-1)!.status).toBe("pending");
    const inactive = runFavorForkYear(pending, 1337);
    expect(inactive.history.at(-1)!.status).toBe("inactive");
    expect(responses(inactive)).toHaveLength(0);
    expect(forkFavor(inactive, 1337, "child").history.at(-1)!.status).toBe("inactive");
  });
  it("inherits earlier-declared future grants and marks absent execution years inactive without regeneration", () => {
    let state = createFavorFork(createFavorScheduler(initial(), "c2-1", 1335), "root");
    state = declareForkGrant(state, grant("future", 1340));
    state = runFavorForkYear(runFavorForkYear(state, 1336), 1340);
    const child = forkFavor(state, 1336, "child");
    expect(child.grain).toEqual(state.grain);
    expect(child.events[0]!.year).toBe(1340);
    const gap = runFavorForkYear(declareForkGrant(createFavorFork(createFavorScheduler(initial(), "seed", 1335), "gap"), grant()), 1337);
    expect(gap.grain).toEqual(initial().grain);
    expect(gap.events).toHaveLength(0);
    expect(gap.history[0]!.status).toBe("inactive");
  });
  it.each([
    (command: ForkChoice) => ({ ...command, target: "not-json" }),
    (command: ForkChoice) => ({ ...command, year: 1338 }),
    (command: ForkChoice) => ({ ...command, actors: ["b", "a"] }),
    (command: ForkChoice) => ({ ...command, choice: "other" }),
    (command: ForkChoice) => ({ ...command, target: ` ${command.target}` }),
    (command: ForkChoice) => ({ ...command, extra: true }),
  ])("rejects malformed target/actors/year/choice/transport atomically", (tamper) => {
    const state = root(); const before = structuredClone(state);
    expect(() => declareForkChoice(state, tamper(choice()) as ForkChoice)).toThrow();
    expect(state).toEqual(before);
  });
  it("rejects stale choices, earlier-prefix replacement and duplicate own authority", () => {
    const state = runFavorForkYear(root(), 1337);
    expect(() => declareForkChoice(state, choice())).toThrow();
    expect(() => declareForkChoice(state, choice(1340))).toThrow();
    expect(() => forkFavor(state, 1338, "child", [choice()])).toThrow();
    const declared = declareForkChoice(root(), choice());
    expect(() => declareForkChoice(declared, choice(1337, 0, "g0", "help"))).toThrow();
    const child = forkFavor(state, 1337, "child");
    expect(() => forkFavor(child, 1336, "earlier")).toThrow();
  });
  it("keeps standalone people unchanged while old C/B/A/D1/D2a admission remains isolated", () => {
    const state = runFavorForkYear(root(), 1337);
    expect(state.people).toEqual(initial().people);
    expect(() => replayHelpFavorEvents(state as unknown as HelpFavorState, [])).toThrow();
    expect(() => admitFavorScheduler(state as never)).toThrow();
    expect(() => createFavorCapsule(state as never)).toThrow();
    expect(() => createAuthorityFavorState(state as never)).toThrow();
    let c = grantHelpFavor(initial(), grant());
    c = requestHelp(c, { key: "pending", year: 1337, obligation: c.obligations[0]!.id });
    const d2a = respondWithAuthority(createAuthorityFavorState(c), { request: c.events.at(-1)!.id, year: 1337, noise: 0, appraisals: [] });
    expect(() => createFavorFork(d2a as never, "ambiguous")).toThrow();
  });
});

describe("D2b hostile admission", () => {
  const mutations: [string, (state: FavorFork) => void][] = [
    ["manifest", (state) => { (state.manifest as unknown as Record<string, unknown>).reducer = "other"; }],
    ["config", (state) => { (state.manifest.config as unknown as Record<string, unknown>).activation = 1; }],
    ["rng version", (state) => { (state.manifest as unknown as Record<string, unknown>).rng = "other"; }],
    ["seed", (state) => { state.seed = "other"; }],
    ["lineage", (state) => { state.lineage = "other"; }],
    ["root key", (state) => { state.key = "other"; }],
    ["grain", (state) => { state.grain.a = 99; }],
    ["assistance", (state) => { state.assistance.b = 99; }],
    ["need", (state) => { state.need.a = 99; }],
    ["obligation", (state) => { state.obligations[0]!.origin = "other"; }],
    ["tie", (state) => { state.ties[0]!.trust++; }],
    ["appraisal", (state) => { state.appraisals.push({ id: "bad", origin: "bad", actor: "a", interpretation: "gratitude", intensity: 1 }); }],
    ["mapping semantic", (state) => { state.mapping[0]!.semantic = "other"; }],
    ["mapping physical", (state) => { state.mapping[0]!.physical = "other"; }],
    ["mapping duplicate", (state) => { state.mapping.push(state.mapping[0]!); }],
    ["history status", (state) => { state.history[0]!.status = "pending"; }],
    ["history chronology", (state) => { state.history[0]!.declaredAt++; }],
    ["history lineage", (state) => { state.history[0]!.lineage = "other"; }],
    ["history ID", (state) => { state.history[0]!.id = "other"; }],
    ["history position", (state) => { state.history[0]!.position++; }],
    ["annual activation", (state) => { const attempt = state.years.at(-1)!.attempts[0]!; if (attempt.kind !== "quiet") attempt.activation.value = 0.9; }],
    ["frontier", (state) => { state.completedYear++; }],
    ["event identity", (state) => { state.events[0]!.id = "other"; }],
    ["event semantic", (state) => { (state.events[0] as ForkEvent).semantic = "other"; }],
    ["event cause", (state) => { responses(state)[0]!.causes[0] = "other"; }],
    ["request reference", (state) => { responses(state)[0]!.request = "other"; }],
    ["effect", (state) => { responses(state)[0]!.effects = []; }],
    ["noise", (state) => { (responses(state)[0]!.evidence as ForkEvidence).noise = 0.99; }],
    ["baseline", (state) => { (responses(state)[0]!.evidence as ForkEvidence).baselineSelection = "refuse"; }],
    ["effective choice", (state) => { (responses(state)[0]!.evidence as ForkEvidence).effectiveChoice = "refuse"; }],
    ["feasibility", (state) => { (responses(state)[0]!.evidence as ForkEvidence).feasibility.assistance = 99; }],
    ["distribution", (state) => { (responses(state)[0]!.evidence as ForkEvidence).distribution[0] = 0; }],
    ["authority", (state) => { (responses(state)[0]!.evidence as ForkEvidence).authority = { source: "human", declaration: "other" }; }],
    ["prefix length", (state) => { state.prefix.length = 1; }],
    ["action chronology", (state) => { const action = state.actions.find((entry) => entry.kind === "grant")!; if (action.kind === "grant") action.at++; }],
  ];
  it.each(mutations)("rejects tampered %s without repairing or mutating input", (_name, mutate) => {
    const state = cold(runFavorForkYear(root(), 1337));
    mutate(state); const before = structuredClone(state);
    expect(() => admitFavorFork(state)).toThrow();
    expect(state).toEqual(before);
  });
  it("rejects tampered child history and inherited authority evidence", () => {
    const parent = runFavorForkYear(declareForkChoice(root(), choice()), 1337);
    const child = forkFavor(parent, 1337, "child", [choice(1337, 0, "g0", "help")]);
    for (const mutate of [
      (state: FavorFork) => { state.history.find((entry) => entry.status === "superseded")!.status = "effective"; },
      (state: FavorFork) => { const entry = state.history.findLast((entry) => entry.kind === "choice")!; (entry.command as ForkChoice).target = choice(1337, 1).target; },
      (state: FavorFork) => { const entry = state.history.findLast((entry) => entry.kind === "choice")!; entry.declaredAt = 1337; },
      (state: FavorFork) => { (responses(state)[0]!.evidence as ForkEvidence).authority = { source: "human", declaration: parent.history.at(-1)!.id }; },
    ]) {
      const copy = cold(child); mutate(copy);
      expect(() => admitFavorFork(copy)).toThrow();
    }
  });
  it("rejects duplicate grants, invalid frontiers and atomic physical failure without aliases", () => {
    const state = root(); const before = structuredClone(state);
    expect(() => declareForkGrant(state, grant())).toThrow();
    expect(() => runFavorForkYear(state, 1336)).toThrow();
    expect(() => runFavorForkYear(state, 1335)).toThrow();
    const future = declareForkGrant(state, grant("unfunded", 1340));
    const snapshot = structuredClone(future);
    expect(() => runFavorForkYear(future, 1340)).toThrow();
    expect(future).toEqual(snapshot);
    expect(state).toEqual(before);
    const detached = admitFavorFork(state);
    (detached.manifest.config as unknown as Record<string, unknown>).activation = 1;
    expect(state.manifest.config.activation).toBe(0.25);
    expect(admitFavorFork(state)).toEqual(state);
  });
  it("descriptor-checks the whole tree before any reads or iteration; hooks remain zero", () => {
    let hooks = 0;
    const state = root();
    Object.defineProperty(state, "history", { enumerable: true, get: () => { hooks++; return []; } });
    expect(() => admitFavorFork(state)).toThrow();
    expect(hooks).toBe(0);
    const command = choice();
    Object.defineProperty(command, "target", { enumerable: true, get: () => { hooks++; return "bad"; } });
    expect(() => forkFavor(root(), 1337, "bad", [command])).toThrow();
    expect(() => declareForkChoice(root(), command)).toThrow();
    expect(hooks).toBe(0);
  });
  it.each(["prototype", "sparse", "cycle", "nonfinite", "undefined", "hidden", "symbol"])("rejects non-JSON %s", (kind) => {
    const state = root();
    if (kind === "prototype") Object.setPrototypeOf(state.actions, { toJSON() { throw new Error("hook"); } });
    if (kind === "sparse") state.actions.length++;
    if (kind === "cycle") (state as unknown as Record<string, unknown>).cycle = state;
    if (kind === "nonfinite") state.grain.a = NaN;
    if (kind === "undefined") (state as unknown as Record<string, unknown>).unsafe = undefined;
    if (kind === "hidden") Object.defineProperty(state, "hidden", { value: 1 });
    if (kind === "symbol") Object.defineProperty(state, Symbol("extra"), { value: 1, enumerable: true });
    expect(() => admitFavorFork(state)).toThrow();
  });
  it("rejects unsafe undefined inside registry while preserving declared legacy optionals", () => {
    const state = root();
    (state.people.a! as unknown as Record<string, unknown>).unsafe = undefined;
    expect(() => admitFavorFork(state)).toThrow();
    const c = initial();
    c.people.a!.deathYear = undefined;
    const valid = createFavorFork(createFavorScheduler(c, "seed", 1335), "optional");
    expect(admitFavorFork(valid)).toEqual(valid);
    expect(admitFavorFork(cold(valid)).people.a!.deathYear).toBeUndefined();
  });
  it("preserves own __proto__ actors safely and rejects inherited registry actors", () => {
    const c = initial();
    const person = { ...c.people.a!, id: "__proto__" };
    const people = { ["__proto__"]: person, b: c.people.b! };
    const input = createHelpFavorState(people, [], { ["__proto__"]: 1, b: 0 }, { b: 1 }, { ["__proto__"]: 1 });
    let state = createFavorFork(createFavorScheduler(input, "seed", 1335), "root");
    state = declareForkGrant(state, { ...grant(), creditor: "__proto__" });
    state = runFavorForkYear(runFavorForkYear(state, 1336), 1337);
    expect(Object.hasOwn(admitFavorFork(cold(state)).people, "__proto__")).toBe(true);
    expect(() => declareForkGrant(root(), { ...grant("bad", 1340), creditor: "toString" })).toThrow();
  });
  it("mapping and target identity are closed, not aliases for physical child IDs", () => {
    const state = forkFavor(runFavorForkYear(root(), 1337), 1336, "child");
    for (const event of responses(state)) {
      expect(semanticForkIdentity(state, event.id)).toBe(event.semantic);
      expect(event.semantic).not.toContain(state.lineage);
    }
    expect(() => semanticForkIdentity(state, "missing")).toThrow();
  });
});

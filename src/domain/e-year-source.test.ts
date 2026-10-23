import { describe, expect, it, vi } from "vitest";
import { RuleDecisionMaker } from "@/adapters/decision/rule-decision-maker";
import { createMind } from "./mind";
import * as simulation from "./simulate";
import * as kernel from "./legacy-year";
import { createRulesYearSource, RULES_YEAR_SOURCE_VERSION } from "./e-year-source";
import type { LegacyOwnedRunState, SimulateOptions } from "./simulate";
import type { Person, WorldConfig, YearSnapshot } from "./types";
import { generateWorld } from "./worldgen";

const declaration = { version: RULES_YEAR_SOURCE_VERSION };

function person(seed: string, id: string, birthYear = 1500): Person {
  return {
    id, name: id, sex: "f", birthYear, traits: [], job: "none", founder: true,
    socialClass: "villein", mind: createMind(seed, id, birthYear),
  };
}

function owned(people: Record<string, Person> = {}): LegacyOwnedRunState {
  return { people, events: [], decisions: [], counters: { decisionCalls: 0 } };
}

// Complete ordered own-data comparison, including undefined, -0 and shared aliases.
// This is a test comparator, not a source fingerprint or replay certificate.
function ownData(value: unknown): string {
  const seen = new Map<object, number>();
  function encode(item: unknown): unknown {
    if (item === undefined) return ["undefined"];
    if (typeof item === "number") return ["number", Object.is(item, -0) ? "-0" : String(item)];
    if (item === null || typeof item !== "object") return [typeof item, item];
    const previous = seen.get(item);
    if (previous !== undefined) return ["ref", previous];
    const id = seen.size;
    seen.set(item, id);
    return [Array.isArray(item) ? "array" : "object", id,
      Object.keys(item).map((key) => [key, encode((item as Record<string, unknown>)[key])])];
  }
  return JSON.stringify(encode(value));
}

async function publicYears(config: WorldConfig, state: LegacyOwnedRunState, protagonistId?: string, fromYear?: number) {
  const generator = simulation.simulateYears(config, state.people, state.events, {
    decisionMaker: new RuleDecisionMaker(), engineSource: "rules", protagonistId, fromYear,
  });
  const snapshots: YearSnapshot[] = [];
  for (;;) {
    const step = await generator.next();
    if (step.done) return { snapshots, report: step.value };
    snapshots.push(step.value.snapshot);
  }
}

async function sourceYears(config: WorldConfig, state: LegacyOwnedRunState, protagonistId?: string, fromYear = config.startYear) {
  const source = createRulesYearSource(declaration, config, state, protagonistId, fromYear);
  const snapshots: YearSnapshot[] = [];
  for (let year = fromYear; year <= config.endYear; year++) {
    snapshots.push(await source.execute(year));
    // Match the public facade's stop, not an invented source completion authority.
    if (protagonistId && state.people[protagonistId]?.deathYear !== undefined) break;
  }
  return { snapshots, state };
}

function smallWorld(seed: string) {
  return generateWorld({ seed, founderCount: 12, startYear: 1500, endYear: 1502,
    protagonist: { name: "Lucia", sex: "f" } });
}

function worldState(world: ReturnType<typeof generateWorld>): LegacyOwnedRunState {
  return { people: world.people, events: [...world.events], decisions: [], counters: { decisionCalls: 0 } };
}

describe("borrowed legacy context factory", () => {
  it("exports the typed factory and borrows exactly the owned references and LIVE options", () => {
    const config = { seed: "factory", startYear: 1500, endYear: 1502, town: { name: "Testville" } };
    const state = owned({ a: person(config.seed, "a"), b: person(config.seed, "b") });
    const debug = simulation.createMarriageFunnelCollector();
    const options: SimulateOptions = {
      decisionMaker: new RuleDecisionMaker(), engineSource: "rules", protagonistId: "a",
      fromYear: 1501, marriageFunnelDebug: debug,
    };
    const context = simulation.createLegacyRunContext(config, state, options);
    expect(context.people).toBe(state.people);
    expect(context.people.a.mind).toBe(state.people.a.mind);
    expect(context.events).toBe(state.events);
    expect(context.decisions).toBe(state.decisions);
    expect(context.counters).toBe(state.counters);
    expect(context.config).toBe(config);
    expect(context.options).toBe(options);
    expect(context.protagonistId).toBe("a");
    expect(context.debug).toBe(debug);
    expect(context.marriageFunnelDebug).toBe(debug);
    expect(context.originalOverrideYear).toBe(1501);
    expect(context.concurrencyLimit).toBe(8);
    expect(context.yearBatchConcurrency).toBe(64);
    expect(context.overrides).toEqual([]);
    Object.assign(options, { protagonistId: "b", marriageFunnelDebug: undefined });
    expect(context.protagonistId).toBe("a");
    expect(context.debug).toBe(debug);
    expect(context.options.protagonistId).toBe("b");
    expect(ownData(context.captureCandidates(1501, undefined))).toBe(ownData(
      simulation.gatherCandidatesForYear(1501, state.people, state.events, config.seed, "b"),
    ));
    expect(simulation.createLegacyRunContext(config, state, { decisionMaker: new RuleDecisionMaker(), engineSource: "rules" })
      .originalOverrideYear).toBe(config.startYear);
  });

  it("retains explicit captured bindings while public options change between yields", async () => {
    const world = smallWorld("captured-bindings");
    const debug = simulation.createMarriageFunnelCollector();
    const options: SimulateOptions = { decisionMaker: new RuleDecisionMaker(), engineSource: "rules",
      protagonistId: "protagonist", marriageFunnelDebug: debug };
    const run = vi.spyOn(kernel, "runLegacyYear"); // call through to actual annual phases
    try {
      const generator = simulation.simulateYears(world.config, world.people, world.events, options);
      await generator.next();
      Object.assign(world.config, { seed: "changed-between-yields" });
      Object.assign(options, { protagonistId: undefined, marriageFunnelDebug: undefined,
        fromYear: 1490, concurrencyLimit: 1, yearBatchConcurrency: 1, overrides: [] });
      await generator.next();
      const context = run.mock.calls[1]![0];
      expect(context.protagonistId).toBe("protagonist");
      expect(context.debug).toBe(debug);
      expect(context.options).toBe(options);
      expect(context.options.protagonistId).toBeUndefined();
      expect(context.originalOverrideYear).toBe(1500);
      expect(context.concurrencyLimit).toBe(8);
      expect(context.yearBatchConcurrency).toBe(64);
      expect(ownData(context.captureCandidates(1501, undefined))).toBe(ownData(
        simulation.gatherCandidatesForYear(1501, context.people, context.events, "captured-bindings", undefined),
      ));
      while (!(await generator.next()).done) { /* drain the remaining public horizon */ }
    } finally {
      run.mockRestore();
    }
  });

  it("retains override anchor behavior on a resumed year", async () => {
    const config = { seed: "factory-anchor", startYear: 1500, endYear: 1502, town: { name: "Testville" } };
    const state = owned({ actor: person(config.seed, "actor", 1400) });
    const context = simulation.createLegacyRunContext(config, state, {
      decisionMaker: new RuleDecisionMaker(), engineSource: "rules", fromYear: 1501,
      overrides: [{ id: "survival", decisionId: "death:actor:1501", optionId: "survive" }],
    });
    await kernel.runLegacyYear(context, 1501);
    const first = state.decisions.find((decision) => decision.kind === "death" && decision.year === 1501)!;
    expect(first.chosen).toBe("survive");
    expect(first.source).toBe("forced");
    await kernel.runLegacyYear(context, 1502);
    expect(state.decisions.find((decision) => decision.kind === "death" && decision.year === 1502)!.source).not.toBe("forced");
  });
});

describe("closed trusted rules-year source", () => {
  it("exposes only a frozen declaration and execute over bound immutable origin", async () => {
    const config = { seed: "origin", startYear: 1500, endYear: 1500, town: { name: "Original" } };
    const state = owned({ actor: person(config.seed, "actor") });
    const supplied = { ...declaration };
    const source = createRulesYearSource(supplied, config, state, "actor", 1499);
    Object.assign(config, { seed: "replacement", startYear: 1800 });
    config.town.name = "Replacement";
    Object.assign(supplied, { version: "replacement" });
    expect(Object.keys(source)).toEqual(["declaration", "execute"]);
    expect(source.declaration).toEqual(declaration);
    expect(Object.isFrozen(source)).toBe(true);
    expect(Object.isFrozen(source.declaration)).toBe(true);
    const run = vi.spyOn(kernel, "runLegacyYear");
    try {
      await source.execute(1500);
      const context = run.mock.calls[0]![0];
      expect(context.config).toEqual({ seed: "origin", startYear: 1500, endYear: 1500, town: { name: "Original" } });
      expect(Object.isFrozen(context.config)).toBe(true);
      expect(Object.isFrozen(context.config.town)).toBe(true);
      expect(Object.isFrozen(context.options)).toBe(true);
      expect(context.originalOverrideYear).toBe(1499);
      expect(context.options.engineSource).toBe("rules");
      expect(context.concurrencyLimit).toBe(8);
      expect(context.yearBatchConcurrency).toBe(64);
      expect(context.options.backgroundDecisionMaker).toBeUndefined();
      expect(context.debug).toBeUndefined();
      expect(context.overrides).toEqual([]);
    } finally {
      run.mockRestore();
    }
  });

  it.each([null, undefined, "native-rules/person-year-batched/v1", {},
    { version: "native-rules/person-year-batched/v2" }, { version: RULES_YEAR_SOURCE_VERSION, decisionMaker: new RuleDecisionMaker() },
    { version: RULES_YEAR_SOURCE_VERSION, overrides: [] }, { version: RULES_YEAR_SOURCE_VERSION, coreChoices: {} },
    { version: RULES_YEAR_SOURCE_VERSION, backgroundDecisionMaker: new RuleDecisionMaker() },
    { version: RULES_YEAR_SOURCE_VERSION, callback: () => undefined },
    { version: RULES_YEAR_SOURCE_VERSION, yearBatchConcurrency: 1 },
    { version: RULES_YEAR_SOURCE_VERSION, [Symbol("hidden")]: true },
    Object.create(declaration),
  ])("rejects unsupported or unknown declaration data %#", (input) => {
    const config = { seed: "reject", startYear: 1500, endYear: 1500, town: { name: "Testville" } };
    expect(() => createRulesYearSource(input, config, owned())).toThrow();
  });

  it("rejects accessor and nonenumerable extra fields without invoking getters", () => {
    const config = { seed: "accessor", startYear: 1500, endYear: 1500, town: { name: "Testville" } };
    const getter = vi.fn(() => RULES_YEAR_SOURCE_VERSION);
    for (const input of [
      Object.defineProperty({}, "version", { get: getter }),
      Object.defineProperty({ ...declaration }, "callback", { get: getter }),
      Object.defineProperty({ ...declaration }, "overrides", { value: [] }),
    ]) expect(() => createRulesYearSource(input, config, owned())).toThrow();
    expect(getter).not.toHaveBeenCalled();
    expect(createRulesYearSource(Object.assign(Object.create(null), declaration), config, owned()).declaration).toEqual(declaration);
  });

  it("privately creates fresh native resolvers and actually batches reachable social and D1 questions", async () => {
    const year = vi.spyOn(RuleDecisionMaker.prototype, "decideYear");
    const single = vi.spyOn(RuleDecisionMaker.prototype, "decide");
    try {
      const first = smallWorld("native-batching");
      const second = smallWorld("native-batching");
      const left = createRulesYearSource(declaration, first.config, worldState(first), "protagonist");
      const right = createRulesYearSource(declaration, second.config, worldState(second), "protagonist");
      const snapshot = await left.execute(1500);
      const split = year.mock.calls.length;
      expect(split).toBeGreaterThan(0);
      const leftResolvers = new Set(year.mock.contexts.slice(0, split));
      await right.execute(1500);
      const rightResolvers = new Set(year.mock.contexts.slice(split));
      expect(leftResolvers.size).toBe(1);
      expect(rightResolvers.size).toBe(1);
      const leftResolver = [...leftResolvers][0]!;
      const rightResolver = [...rightResolvers][0]!;
      expect(leftResolver).toBeInstanceOf(RuleDecisionMaker);
      expect(rightResolver).toBeInstanceOf(RuleDecisionMaker);
      expect(leftResolver).not.toBe(rightResolver);
      expect(single).not.toHaveBeenCalled();
      const batches = year.mock.calls.slice(0, split).map(([batch]) => batch);
      expect(new Set(batches.map((batch) => `${batch.personId}:${batch.year}`)).size).toBe(split);
      const situations = batches.flatMap((batch) => Object.values(batch.situations));
      expect(situations.some((situation) => situation.kind === "D1")).toBe(true);
      expect(situations.some((situation) => situation.kind !== "D1")).toBe(true);
      // The generated protagonist has a birth event at genesis, so speculative D1 need
      // not publish that year. A quiet owned infant has no such event and must publish D1.
      const quietConfig = { seed: "quiet-source", startYear: 1500, endYear: 1500, town: { name: "Testville" } };
      const quiet = await createRulesYearSource(declaration, quietConfig,
        owned({ infant: person(quietConfig.seed, "infant") }), "infant").execute(1500);
      expect(quiet.decisions.some((decision) => decision.kind === "D1")).toBe(true);
      expect(quiet.events.some((event) => event.kind === "vignette")).toBe(true);
      expect(single).not.toHaveBeenCalled();
      expect(snapshot.decisions.filter((decision) => decision.source !== "biology").every((decision) => decision.source === "rules")).toBe(true);
    } finally {
      year.mockRestore();
      single.mockRestore();
    }
  });

  for (const [protagonistId, fromYear] of [[undefined, 1500], ["protagonist", 1500], ["protagonist", 1501]] as const) {
    it(`matches independently initialized public batched simulation (${protagonistId ?? "NPC"}, ${fromYear})`, async () => {
      const initial = smallWorld("source-parity");
      const independentlyGenerated = smallWorld("source-parity");
      const again = smallWorld("source-parity");
      const state = worldState(initial);
      const actor = state.people.protagonist;
      const mind = actor.mind;
      const expected = await publicYears(independentlyGenerated.config, worldState(independentlyGenerated), protagonistId, fromYear);
      const actual = await sourceYears(initial.config, state, protagonistId, fromYear);
      const repeated = await sourceYears(again.config, worldState(again), protagonistId, fromYear);
      expect(ownData(actual.snapshots)).toBe(ownData(expected.snapshots));
      expect(ownData(actual.state)).toBe(ownData(repeated.state));
      expect(ownData(actual.snapshots)).toBe(ownData(repeated.snapshots));
      expect(ownData({ people: state.people, events: state.events, decisions: state.decisions })).toBe(ownData({
        people: expected.report.result.people, events: expected.report.result.events, decisions: expected.report.result.decisions,
      }));
      expect(state.counters.decisionCalls).toBe(expected.report.decisionCalls);
      expect(state.counters.decisionCalls).toBeGreaterThan(0);
      expect(state.people.protagonist).toBe(actor);
      expect(state.people.protagonist.mind).toBe(mind);
    });
  }

  it("preserves real birth, maternal death and survivor Mind across independent complete reexecution", async () => {
    function fixture() {
      return generateWorld({ seed: "maternal-check-37", founderCount: 24, startYear: 1498, endYear: 1558 });
    }
    const first = fixture();
    const second = fixture();
    const publicWorld = fixture();
    const actual = await sourceYears(first.config, worldState(first));
    const repeated = await sourceYears(second.config, worldState(second));
    const expected = await publicYears(publicWorld.config, worldState(publicWorld));
    expect(actual.state.events.some((event) => event.kind === "birth")).toBe(true);
    expect(actual.state.events.some((event) => event.kind === "death" && event.payload.cause === "childbirth")).toBe(true);
    expect(actual.state.events.some((event) => event.kind === "widowed")).toBe(true);
    expect(ownData(actual.state)).toBe(ownData(repeated.state));
    expect(ownData(actual.snapshots)).toBe(ownData(expected.snapshots));
    expect(actual.state.counters.decisionCalls).toBe(expected.report.decisionCalls);
  }, 30000);

  it("publishes detached snapshots, while later years keep the same owned Person and Mind", async () => {
    const world = smallWorld("source-detachment");
    const state = worldState(world);
    const actor = state.people.protagonist;
    const mind = actor.mind;
    const source = createRulesYearSource(declaration, world.config, state, "protagonist");
    const snapshot = await source.execute(1500);
    const before = ownData(snapshot);
    expect(snapshot.people.protagonist).not.toBe(actor);
    expect(snapshot.people.protagonist.mind).not.toBe(mind);
    expect(snapshot.events).not.toBe(state.events);
    expect(snapshot.decisions).not.toBe(state.decisions);
    await source.execute(1501);
    mind.stress += 100;
    state.events.push({ id: "later", year: 1502, kind: "town", actors: [], payload: {}, causes: [] });
    state.decisions.splice(0, 1);
    expect(ownData(snapshot)).toBe(before);
    expect(state.people.protagonist).toBe(actor);
    expect(state.people.protagonist.mind).toBe(mind);
    expect(Object.isFrozen(snapshot)).toBe(false);
  });
});

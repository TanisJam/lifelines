import { afterEach, describe, expect, it, vi } from "vitest";
import { RuleDecisionMaker } from "@/adapters/decision/rule-decision-maker";
import { createLifecycleGenesis } from "./e-lifecycle-genesis";
import { initializeWorld } from "./world-origin";
import { createLifecycleRuntime } from "./e-lifecycle-runtime";
import { simulateYears, type LegacyOwnedRunState } from "./simulate";
import * as kernel from "./legacy-year";
import * as sourceModule from "./e-year-source";
import * as annualPolicy from "./e-annual-policy";
import * as composition from "./e-annual-composition";
import * as executorModule from "./e-favor-executor";
import { inspectHelpOpportunities } from "./effects";
import type { RuntimeEntry, RuntimeOutput } from "./e-runtime";
import type { GenerateWorldOptions } from "./worldgen";

type Output = Awaited<ReturnType<ReturnType<typeof createLifecycleRuntime>["advance"]>>;
const defaults: GenerateWorldOptions = { seed: "lifecycle-genesis", startYear: 1327, endYear: 1327, founderCount: 6,
  protagonist: { name: "Alice", sex: "f" } };

function genesis(options: GenerateWorldOptions = defaults, protagonistId = "protagonist") {
  const { world } = initializeWorld(options);
  return createLifecycleGenesis({ initialization: options, protagonistId,
    resources: Object.fromEntries(Object.keys(world.people).map(id => [id, { grain: 2, effort: 3, need: 1 }])) });
}

// Whole own-data comparison: traversal order, property presence, -0 and undefined.
// Registry/log ownership aliases are checked separately. Module-level distribution
// objects can be reused by public native execution but detached by transaction cloning.
// Not JSON normalization or a production codec/certificate.
function ownData(value: unknown): string {
  function encode(item: unknown): unknown {
    if (item === undefined) return ["undefined"];
    if (typeof item === "number") return ["number", Object.is(item, -0) ? "-0" : String(item)];
    if (item === null || typeof item !== "object") return [typeof item, item];
    return [Array.isArray(item) ? "array" : "object",
      Object.keys(item).map(key => [key, encode((item as Record<string, unknown>)[key])])];
  }
  return JSON.stringify(encode(value));
}
function fidelity(actual: unknown, expected: unknown, path = "root"): void {
  if (expected === null || typeof expected !== "object") {
    if (!Object.is(actual, expected)) throw new Error(`${path}: ${String(actual)} != ${String(expected)}`);
    return;
  }
  if (actual === null || typeof actual !== "object") throw new Error(`${path}: missing object`);
  const a = actual as Record<string, unknown>;
  const e = expected as Record<string, unknown>;
  if (JSON.stringify(Object.keys(a)) !== JSON.stringify(Object.keys(e))) throw new Error(`${path}: key order/presence differs`);
  for (const key of Object.keys(e)) fidelity(a[key], e[key], `${path}.${key}`);
}
function fullyFrozen(value: unknown, seen = new Set<object>()): void {
  if (value === null || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  expect(Object.isFrozen(value)).toBe(true);
  Object.values(value).forEach(entry => fullyFrozen(entry, seen));
}
function negativeZeros(value: unknown): number {
  if (typeof value === "number") return Object.is(value, -0) ? 1 : 0;
  if (value === null || typeof value !== "object") return 0;
  return Object.values(value).reduce<number>((sum, item) => sum + negativeZeros(item), 0);
}

/** Independently assemble economic ownership around the PUBLIC facade's actual registry.
 * Physics parity is asserted BEFORE this helper runs; no native outcome is mocked.
 */
function favorsFor(owned: LegacyOwnedRunState, resources: Record<string, { grain: number; effort: number; need: number }>): RuntimeOutput["state"] {
  return { people: owned.people, legacyEvents: owned.events, events: [],
    grain: Object.fromEntries(Object.entries(resources).map(([id, r]) => [id, r.grain])),
    assistance: Object.fromEntries(Object.entries(resources).map(([id, r]) => [id, r.effort])),
    need: Object.fromEntries(Object.entries(resources).map(([id, r]) => [id, r.need])),
    obligations: [], ties: [], appraisals: [] };
}
function economy(view: RuntimeOutput["state"], seed: string, year: number) {
  const plan = annualPolicy.planAnnualFavorDraft(view, seed, year);
  const entries: RuntimeEntry[] = [];
  const executor = executorModule.createFavorExecutor(view, year, entries);
  plan.resources.forEach(executor.executeResource);
  plan.grants.forEach(executor.executeGrant);
  const creditors = [...new Set(inspectHelpOpportunities(view, year)
    .filter(candidate => candidate.reason === null).map(candidate => candidate.creditor))].sort(annualPolicy.stableAnnualIdOrder);
  const slots = [];
  for (const creditor of creditors) {
    for (const slot of [0, 1] as const) {
      const opportunities = inspectHelpOpportunities(view, year);
      const request = composition.planAnnualHelpSlot(view, seed, year, creditor, slot);
      slots.push({ creditor, slot, opportunities, request });
      if (request !== null) {
        plan.requests.push(request);
        executor.executeRequest(request, plan.requests.length - 1);
      }
    }
  }
  return { resources: plan.resources, grants: plan.grants, creditors, slots, requests: plan.requests, entries };
}

/** The spy observes public owned references only, with unmodified call-through native physics.
 * Public generator remains alive between years; economic mutations feed its actual Mind.
 */
async function publicParity(options: GenerateWorldOptions, throughYear: number, protagonistId = "protagonist", retainAll = true) {
  const admitted = genesis(options, protagonistId);
  const runtime = createLifecycleRuntime(admitted);
  const independent = initializeWorld(options).world;
  const generator = simulateYears({ ...independent.config, endYear: throughYear }, independent.people, independent.events,
    { decisionMaker: new RuleDecisionMaker(), engineSource: "rules", protagonistId });
  const spy = vi.spyOn(kernel, "runLegacyYear");
  let view: RuntimeOutput["state"] | undefined;
  const outputs: Output[] = [];
  try {
    for (let year = independent.config.startYear; year <= throughYear; year++) {
      spy.mockClear();
      const step = await generator.next();
      expect(step.done).toBe(false);
      if (step.done) throw new Error("Unexpected public completion");
      const context = spy.mock.calls[0][0];
      const publicOwned: LegacyOwnedRunState = { people: context.people, events: context.events,
        decisions: context.decisions, counters: context.counters };
      view ??= favorsFor(publicOwned, structuredClone(admitted.resources));
      const actual = await runtime.advance(year);
      const record = actual.journal.at(-1)!;
      // PRIMARY ASSERTIONS: complete public native snapshots/actual state BEFORE economics.
      fidelity(record.physicalSnapshot, step.value.snapshot, `year${year}`);
      fidelity(record.postNative.owned, publicOwned, `year${year}.owned`);
      expect(record.postNative.owned.people).toBe(record.postNative.favors.people);
      expect(record.postNative.owned.events).toBe(record.postNative.favors.legacyEvents);
      fidelity(record.postNative.favors, view, `year${year}.postNative.favors`);
      const economics = economy(view, independent.config.seed, year);
      fidelity(record.economics, economics, `year${year}.economics`);
      fidelity(actual.owned, publicOwned, `year${year}.final.owned`);
      fidelity(actual.favors, view, `year${year}.final.favors`);
      fidelity(record.final, { owned: publicOwned, favors: view }, `year${year}.final`);
      fidelity(actual.canonicalYearSnapshot, kernel.captureLegacyYear(publicOwned, year), `year${year}.canonical`);
      expect(actual.owned.people).toBe(actual.favors.people);
      expect(actual.owned.events).toBe(actual.favors.legacyEvents);
      if (!retainAll) outputs.length = 0;
      outputs.push(actual);
      if (actual.status === "complete") break;
    }
    await generator.return(undefined as never);
    return { runtime, outputs, admitted };
  } finally {
    spy.mockRestore();
  }
}

afterEach(() => vi.restoreAllMocks());

describe("native lifecycle annual transaction", () => {
  it("admits genesis and commits a complete native year with separate economic evidence", async () => {
    const input = genesis();
    const before = ownData(input);
    const runtime = createLifecycleRuntime(input);
    expect(Object.isFrozen(runtime)).toBe(true);
    expect(Object.keys(runtime)).toEqual(["initial", "advance", "snapshot"]);
    expect(runtime.initial.frontier).toBe(1326);
    expect(runtime.initial.status).toBe("incomplete");
    expect(runtime.initial.journal).toEqual([]);
    const output = await runtime.advance(1327);
    expect(output.frontier).toBe(1327);
    expect(output.journal).toHaveLength(1);
    expect(output.owned.counters.decisionCalls).toBeGreaterThan(0);
    expect(output.owned.people).toBe(output.favors.people);
    expect(output.owned.events).toBe(output.favors.legacyEvents);
    expect(output.journal[0].physicalSnapshot.year).toBe(1327);
    expect(output.canonicalYearSnapshot.people).toEqual(output.owned.people);
    expect(output.versions).toEqual(input.versions);
    expect(output.journal[0].versions).toEqual(input.versions);
    expect(output.genesisDigest).toBe(input.digest);
    expect(ownData(input)).toBe(before);
    fullyFrozen(runtime.initial);
    fullyFrozen(output);
    expect(runtime.snapshot()).toBe(output);
  });

  it.each(["lifecycle-genesis", "source-parity", "baseline-1327-1"])(
    "matches independent PUBLIC native phases, then economic execution (%s)", async seed => {
      const { outputs } = await publicParity({ ...defaults, seed }, 1335);
      expect(outputs.length).toBeGreaterThan(0);
      const initial = genesis({ ...defaults, seed });
      expect(negativeZeros(outputs[0].journal[0].postNative.owned.people)).toBe(negativeZeros(initial.initial.people));
      expect(ownData(outputs[0].journal[0].postNative.owned.decisions)).toContain('["undefined"]');
    });

  it("preserves genuine births, genotype/class, maternal death, survivor grief and dead ledgers", async () => {
    const options: GenerateWorldOptions = { seed: "maternal-check-37", founderCount: 24, startYear: 1498, endYear: 1558 };
    // Observed native seed: maternal death in 1500; generated p004 survives this window.
    // Bound this high-population fixture to the actual birth/death year, not a lifespan cap.
    const { outputs, admitted } = await publicParity(options, 1500, "p004", false);
    const final = outputs.at(-1)!;
    const births = final.owned.events.filter(event => event.kind === "birth" && event.year >= 1498
      && !Object.hasOwn(admitted.initial.people, event.actors[0]));
    expect(births.length).toBeGreaterThan(0);
    const maternal = final.owned.events.find(event => event.kind === "death" && (event.payload as unknown as Record<string, unknown>).cause === "childbirth" && event.year >= 1498)!;
    expect(maternal).toBeDefined();
    const deathYear = final.journal.find(record => record.year === maternal.year)!;
    const mother = maternal.actors[0];
    expect(deathYear.final.owned.people[mother].deathYear).toBe(maternal.year);
    expect(deathYear.economics.resources.some(op => op.actor === mother)).toBe(false);
    const prior = final.journal.find(record => record.year === maternal.year - 1);
    expect(deathYear.final.favors.grain[mother]).toBe(prior?.final.favors.grain[mother] ?? admitted.resources[mother].grain);
    const widowed = deathYear.final.owned.events.find(event => event.kind === "widowed" && event.causes.includes(maternal.id))!;
    expect(widowed).toBeDefined();
    const survivor = deathYear.postNative.owned.people[widowed.actors[0]];
    expect(ownData(survivor.mind)).toContain("grief");
    for (const birth of births) {
      const childId = birth.actors[0];
      const born = final.journal.find(record => record.year === birth.year)!;
      const child = born.postNative.owned.people[childId];
      expect(child.birthYear).toBe(birth.year);
      expect(child.motherId).toBeDefined();
      expect(child.fatherId).toBeDefined();
      expect(child.mind.facets).toBeDefined();
      expect(child.mind.values).toBeDefined();
      expect(child.socialClass).toBeDefined();
      expect(Object.hasOwn(born.final.favors.grain, childId)).toBe(false);
      expect(born.economics.resources.some(op => op.actor === childId)).toBe(false);
    }
  }, 30000);

  it("allocates genuine newborns only when they later reach native adulthood", async () => {
    const options = { seed: "maternal-check-37", founderCount: 6, startYear: 1498, endYear: 1516 };
    // Observed independent native fixture: child-p005-1499 survives to age 16.
    const { outputs, admitted } = await publicParity(options, 1515, "p004", false);
    const final = outputs.at(-1)!;
    const newbornIds = new Set(final.owned.events.filter(event => event.kind === "birth"
      && event.year >= admitted.initial.config.startYear && !Object.hasOwn(admitted.initial.people, event.actors[0])).map(event => event.actors[0]));
    const allocations = final.journal.flatMap(record => record.economics.resources
      .filter(op => op.kind === "allocate" && newbornIds.has(op.actor)).map(op => ({ op, record })));
    expect(allocations.length).toBeGreaterThan(0);
    for (const { op, record } of allocations) {
      expect(record.year - record.postNative.owned.people[op.actor].birthYear).toBe(16);
      const born = final.journal.find(year => year.year === record.postNative.owned.people[op.actor].birthYear)!;
      expect(Object.hasOwn(born.final.favors.grain, op.actor)).toBe(false);
      expect(record.economics.entries.some(entry => entry.kind === "allocate" && entry.actors[0] === op.actor)).toBe(true);
    }
  }, 30000);

  it("keeps economic Mind mutations on the actual registry for the next PUBLIC native step", async () => {
    // FE1 currently changes supplemental ledgers, not Mind. Instrument its borrowed
    // registry after REAL resource execution to protect ownership against future Mind effects.
    // This is a test-only mutation, not a new economy policy or mocked native parity.
    const real = executorModule.createFavorExecutor;
    vi.spyOn(executorModule, "createFavorExecutor").mockImplementation((state, year, entries) => {
      const executor = real(state, year, entries);
      return { ...executor, executeResource: (op, index) => {
        executor.executeResource(op, index);
        state.people[op.actor].mind.stress += 1;
      } };
    });
    const { outputs } = await publicParity({ ...defaults, seed: "baseline-1327-1", founderCount: 12 }, 1329);
    const changed = outputs.find(output => ownData(output.journal.at(-1)!.postNative.owned.people) !== ownData(output.owned.people));
    expect(changed).toBeDefined();
    expect(ownData(changed!.canonicalYearSnapshot.people)).toBe(ownData(changed!.owned.people));
    expect(changed!.journal.at(-1)!.economics.entries.filter(entry => entry.kind === "help-response").every(entry => entry.authority?.source === "rules")).toBe(true);
  });

  it("records separate ordered positions, causes, stable creditors and both current slots", async () => {
    // Real seeded competing-debtor fixture discovered at frontier 1332.
    const { outputs } = await publicParity({ ...defaults, seed: "competition-0", founderCount: 12 }, 1332);
    const records = outputs.at(-1)!.journal;
    let sawNull = false;
    let sawRevalidation = false;
    let sawCompetingDebtors = false;
    for (const record of records) {
      expect(record.economics.creditors).toEqual([...record.economics.creditors].sort(annualPolicy.stableAnnualIdOrder));
      expect(record.economics.slots.map(({ creditor, slot }) => [creditor, slot])).toEqual(
        record.economics.creditors.flatMap(creditor => [[creditor, 0], [creditor, 1]]));
      const { positions, economics } = record;
      expect(economics.entries.map(entry => entry.position)).toEqual(
        Array.from({ length: economics.entries.length }, (_, i) => positions.economic.start + i));
      expect(positions.economic.end - positions.economic.start).toBe(economics.entries.length);
      expect(positions.life.end).toBe(record.final.owned.events.length);
      expect(positions.decisions.end).toBe(record.final.owned.decisions.length);
      expect(positions.life.start).toBeLessThanOrEqual(positions.life.end);
      const phases = economics.entries.map(entry => entry.phase);
      expect(phases).toEqual([...phases].sort((a, b) => ["resources", "grants", "help"].indexOf(a) - ["resources", "grants", "help"].indexOf(b)));
      for (const entry of economics.entries) {
        for (const cause of entry.causes) {
          const earlier = record.final.favors.events.find(event => event.id === cause);
          expect(earlier).toBeDefined();
          expect(earlier!.position).toBeLessThan(entry.position);
        }
      }
      for (let i = 0; i < economics.slots.length; i++) {
        const slot = economics.slots[i];
        if (slot.request === null) {
          sawNull = true;
          expect(Object.keys(slot)).toEqual(["creditor", "slot", "opportunities", "request"]);
        }
        const eligible = slot.opportunities.filter(candidate => candidate.reason === null);
        if (eligible.some(candidate => eligible.some(other => other.debtor === candidate.debtor && other.creditor !== candidate.creditor))) sawCompetingDebtors = true;
        const next = economics.slots[i + 1];
        if (slot.request && next?.creditor === slot.creditor && ownData(slot.opportunities) !== ownData(next.opportunities)) sawRevalidation = true;
      }
    }
    expect(sawNull).toBe(true);
    expect(sawRevalidation).toBe(true);
    expect(sawCompetingDebtors).toBe(true);
  });

  it("creates a fresh real native resolver and borrows one Person/Mind registry per step", async () => {
    const runtime = createLifecycleRuntime(genesis({ ...defaults, seed: "baseline-1327-1" }));
    const years = vi.spyOn(kernel, "runLegacyYear");
    const decisions = vi.spyOn(RuleDecisionMaker.prototype, "decideYear");
    const real = executorModule.createFavorExecutor;
    vi.spyOn(executorModule, "createFavorExecutor").mockImplementation((state, year, entries) => {
      const native = years.mock.calls.at(-1)![0];
      expect(state.people).toBe(native.people);
      expect(state.people.protagonist.mind).toBe(native.people.protagonist.mind);
      expect(state.legacyEvents).toBe(native.events);
      return real(state, year, entries);
    });
    await runtime.advance(1327);
    const firstResolvers = new Set(decisions.mock.contexts);
    expect(firstResolvers.size).toBe(1);
    decisions.mockClear();
    await runtime.advance(1328);
    const secondResolvers = new Set(decisions.mock.contexts);
    expect(secondResolvers.size).toBe(1);
    expect([...firstResolvers][0]).not.toBe([...secondResolvers][0]);
    expect(years.mock.calls.map(([, year]) => year)).toEqual([1327, 1328]);
    expect(years.mock.calls[0][0].people).not.toBe(years.mock.calls[1][0].people);
  });

  it("cold-admits only LR1a genesis without accessor reads, callbacks or checkpoints", async () => {
    const getter = vi.fn(() => genesis());
    const hostile = Object.defineProperty({}, "origin", { get: getter });
    expect(() => createLifecycleRuntime(hostile)).toThrow();
    expect(getter).not.toHaveBeenCalled();
    expect(() => createLifecycleRuntime({ ...genesis(), authority: () => undefined })).toThrow();
    const runtime = createLifecycleRuntime(genesis());
    expect(() => createLifecycleRuntime(runtime.initial)).toThrow();
    const checkpoint = await runtime.advance(1327);
    expect(() => createLifecycleRuntime(checkpoint)).toThrow();
  });

  it("allows beyond-origin years while alive, rejects gaps/repeats/noninteger/-0 without publication", async () => {
    const runtime = createLifecycleRuntime(genesis({ ...defaults, seed: "baseline-1327-1" }));
    for (const year of [1326, 1328, -0, NaN, Infinity, 1327.5, Number.MAX_SAFE_INTEGER + 1]) {
      await expect(runtime.advance(year)).rejects.toThrow();
      expect(runtime.snapshot()).toBe(runtime.initial);
    }
    const first = await runtime.advance(1327);
    expect(first.status).toBe("incomplete");
    await expect(runtime.advance(1327)).rejects.toThrow(/contiguous/);
    const beyond = await runtime.advance(1328);
    expect(beyond.frontier).toBe(1328);
    expect(beyond.status).toBe("incomplete");
    expect(beyond.journal).toHaveLength(2);
  });

  it("commits the ENTIRE genuine death year then refuses another native call", async () => {
    const { runtime, outputs } = await publicParity({ ...defaults, seed: "baseline-1327-0" }, 1330);
    const death = outputs.at(-1)!;
    expect(death.status).toBe("complete");
    expect(death.owned.people.protagonist.deathYear).toBe(death.frontier);
    expect(death.owned.events.some(event => event.kind === "death" && event.actors[0] === "protagonist")).toBe(true);
    expect(death.journal.at(-1)!.final.favors).toEqual(death.favors);
    expect(death.journal.at(-1)!.economics.resources.length).toBeGreaterThan(0);
    const source = vi.spyOn(sourceModule, "createRulesYearSource");
    await expect(runtime.advance(death.frontier + 1)).rejects.toThrow(/dead/);
    expect(source).not.toHaveBeenCalled();
    expect(runtime.snapshot()).toBe(death);
  });

  it.each(["native", "allowances", "resource", "grant", "help", "slot", "detach", "freeze"] as const)(
    "rolls back a late %s failure and retries with a fresh source/private draft", async phase => {
      const input = genesis({ ...defaults, seed: "baseline-1327-1", founderCount: 12 });
      const reference = createLifecycleRuntime(input);
      let expected: Output | undefined;
      for (let year = 1327; year <= 1333; year++) {
        const output = await reference.advance(year);
        const economic = output.journal.at(-1)!.economics;
        const matching = phase === "grant" ? economic.entries.some(entry => entry.kind === "grain-grant")
          : phase === "help" || phase === "slot" ? economic.requests.length > 0 : true;
        if (matching) { expected = output; break; }
      }
      expect(expected).toBeDefined();
      const runtime = createLifecycleRuntime(input);
      for (let year = 1327; year < expected!.frontier; year++) await runtime.advance(year);
      const before = runtime.snapshot();
      const retained = ownData(before);
      const failure = new Error(`late-${phase}`);
      const drafts: LegacyOwnedRunState[] = [];
      const sources: sourceModule.RulesYearSource[] = [];
      const realSource = sourceModule.createRulesYearSource;
      let armed = true;
      vi.spyOn(sourceModule, "createRulesYearSource").mockImplementation((declaration, config, state, protagonist, anchor) => {
        drafts.push(state);
        const source = realSource(declaration, config, state, protagonist, anchor);
        sources.push(source);
        expect(anchor).toBe(1327);
        expect(config.endYear).toBe(1327);
        return { ...source, execute: async year => {
          const result = await source.execute(year);
          if (armed && phase === "native") throw failure;
          return result;
        } };
      });
      if (phase === "allowances") {
        const real = annualPolicy.planAnnualFavorDraft;
        vi.spyOn(annualPolicy, "planAnnualFavorDraft").mockImplementation((...args) => {
          const result = real(...args);
          if (armed) throw failure;
          return result;
        });
      }
      if (["resource", "grant", "help"].includes(phase)) {
        const real = executorModule.createFavorExecutor;
        vi.spyOn(executorModule, "createFavorExecutor").mockImplementation((state, year, entries) => {
          expect(state.people).toBe(drafts.at(-1)!.people);
          expect(state.legacyEvents).toBe(drafts.at(-1)!.events);
          const executor = real(state, year, entries);
          return { ...executor,
            executeResource: (op, index) => {
              executor.executeResource(op, index);
              if (armed && phase === "resource") throw failure;
            },
            executeGrant: (op, index) => {
              executor.executeGrant(op, index);
              if (armed && phase === "grant") throw failure;
            },
            executeRequest: (op, index) => {
              executor.executeRequest(op, index);
              if (armed && phase === "help") throw failure;
            },
          };
        });
      }
      if (phase === "slot") {
        const real = composition.planAnnualHelpSlot;
        vi.spyOn(composition, "planAnnualHelpSlot").mockImplementation((...args) => {
          const result = real(...args);
          if (armed && args[4] === 1) throw failure;
          return result;
        });
      }
      if (phase === "detach") {
        const real = globalThis.structuredClone;
        vi.spyOn(globalThis, "structuredClone").mockImplementation((value, options) => {
          const cloned = real(value, options);
          if (armed && value && typeof value === "object" && "genesisDigest" in value) throw failure;
          return cloned;
        });
      }
      if (phase === "freeze") {
        const real = Object.freeze;
        vi.spyOn(Object, "freeze").mockImplementation(value => {
          const frozen = real(value);
          if (armed && value && typeof value === "object" && "genesisDigest" in value) throw failure;
          return frozen;
        });
      }
      await expect(runtime.advance(expected!.frontier)).rejects.toBe(failure);
      expect(runtime.snapshot()).toBe(before);
      expect(ownData(runtime.snapshot())).toBe(retained);
      expect(drafts[0].counters.decisionCalls).toBeGreaterThan(before.owned.counters.decisionCalls);
      armed = false;
      const retried = await runtime.advance(expected!.frontier);
      fidelity(retried, expected);
      fullyFrozen(retried);
      expect(sources).toHaveLength(2);
      expect(sources[0]).not.toBe(sources[1]);
      expect(drafts[0].people).not.toBe(drafts[1].people);
      expect(drafts[0].people.protagonist.mind).not.toBe(drafts[1].people.protagonist.mind);
      expect(drafts[0].events).not.toBe(drafts[1].events);
    });

  it("rejects overlap while native execution awaits; snapshot exposes only the closed frontier", async () => {
    const runtime = createLifecycleRuntime(genesis());
    const before = ownData(runtime.initial);
    let release!: () => void;
    let entered!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    const reached = new Promise<void>(resolve => { entered = resolve; });
    const real = sourceModule.createRulesYearSource;
    vi.spyOn(sourceModule, "createRulesYearSource").mockImplementation((...args) => {
      const source = real(...args);
      return { ...source, execute: async year => {
        const snapshot = await source.execute(year); // full real native outcomes before blocking
        entered();
        await barrier;
        return snapshot;
      } };
    });
    const pending = runtime.advance(1327);
    await reached;
    expect(runtime.snapshot()).toBe(runtime.initial);
    await expect(runtime.advance(1327)).rejects.toThrow(/Overlapping/);
    await expect(runtime.advance(1328)).rejects.toThrow(/Overlapping/);
    expect(ownData(runtime.snapshot())).toBe(before);
    release();
    const committed = await pending;
    expect(runtime.snapshot()).toBe(committed);
    expect(committed.frontier).toBe(1327);
  });

  it("validates the admitted initial previous-year boundary without inventing a cursor import", () => {
    const input = genesis({ ...defaults, startYear: Number.MIN_SAFE_INTEGER + 72, endYear: Number.MIN_SAFE_INTEGER + 72 });
    // E1's founder arithmetic prevents unsafe low starts; runtime still checks its own boundary.
    expect(createLifecycleRuntime(input).initial.frontier).toBe(Number.MIN_SAFE_INTEGER + 71);
    expect(() => createLifecycleRuntime({})).toThrow();
  });

  it("publishes detached deeply frozen graphs and keeps older checkpoints unchanged", async () => {
    const input = structuredClone(genesis({ ...defaults, seed: "baseline-1327-1" }));
    const runtime = createLifecycleRuntime(input);
    const initial = ownData(runtime.initial);
    const first = await runtime.advance(1327);
    const retained = ownData(first);
    expect(first.owned.people).not.toBe(input.initial.people);
    expect(first.journal[0].postNative.owned.people).not.toBe(first.owned.people);
    expect(first.journal[0].final.owned.people).not.toBe(first.owned.people);
    const mutable = input as unknown as { initial: { people: Record<string, { mind: { stress: number } }> }; resources: Record<string, { grain: number }> };
    mutable.initial.people.protagonist.mind.stress = 999;
    mutable.resources.protagonist.grain = 999;
    fullyFrozen(first);
    expect(() => { (first as unknown as { owned: LegacyOwnedRunState }).owned.people.protagonist.mind.stress = 999; }).toThrow();
    await runtime.advance(1328);
    expect(ownData(first)).toBe(retained);
    expect(ownData(runtime.initial)).toBe(initial);
  });
});

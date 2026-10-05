import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { beginLegacyYear, resolveLegacyVitalDecision } from "./legacy-year";
import { mintId, overrideFor, spawnChild } from "./legacy-year-mechanics";
import * as mechanics from "./legacy-year-mechanics";
import { applyLifeTransition, ensureLifeState } from "./life-state";
import { shouldPresentLeyrwite } from "./period/markers";
import * as legacyYear from "./legacy-year";
import { RuleDecisionMaker } from "@/adapters/decision/rule-decision-maker";
import { createMind } from "./mind";
import { createMarriageFunnelCollector, simulateYears, type CandidateDescriptor, type SimulateOptions } from "./simulate";
import type { Event, Person, WorldConfig } from "./types";
import { generateWorld } from "./worldgen";

// Ordered, typed graph encoding: JSON alone loses own undefined, -0 and aliases.
// Every enumerable key (including array indices) is retained in traversal order.
function canonical(value: unknown): string {
  const seen = new Map<object, number>();
  function encode(v: unknown): unknown {
    if (v === undefined) return ["undefined"];
    if (typeof v === "number") return ["number", Object.is(v, -0) ? "-0" : String(v)];
    if (v === null || typeof v !== "object") return [typeof v, v];
    const previous = seen.get(v);
    if (previous !== undefined) return ["ref", previous];
    const id = seen.size;
    seen.set(v, id);
    if (v instanceof Map) return ["map", id, [...v].map(([k, item]) => [encode(k), encode(item)])];
    return [Array.isArray(v) ? "array" : "object", id, Object.keys(v).map((key) => [key, encode((v as Record<string, unknown>)[key])])];
  }
  return JSON.stringify(encode(value));
}
function digest(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

async function observe(config: WorldConfig, people: Record<string, Person>, events: Event[], options: Partial<SimulateOptions> = {}) {
  const debug = createMarriageFunnelCollector();
  const generator = simulateYears(config, people, events, {
    decisionMaker: new RuleDecisionMaker(), engineSource: "rules", marriageFunnelDebug: debug, ...options,
  });
  const years: [number, string][] = [];
  for (;;) {
    const step = await generator.next();
    if (step.done) {
      const { wallTimeMs: _wallTimeMs, ...report } = step.value;
      void _wallTimeMs;
      return { years: digest(years), final: digest({ report, debug }), events: report.result.events, report };
    }
    // Hash each complete yielded snapshot immediately, not a terminal reconstruction.
    years.push([step.value.year, digest(step.value)]);
  }
}

function person(seed: string, id: string, sex: "f" | "m", overrides: Partial<Person> = {}): Person {
  return { id, name: id, sex, birthYear: 1500, traits: [], job: "none", founder: true,
    socialClass: "villein", mind: createMind(seed, id, 1500), ...overrides };
}
function force(kind: string, id: string, optionId: string) {
  return { id: `force-${kind}-${id}`, decisionId: `${kind}:${id}:1530`, optionId };
}

function candidate(kind: string, personId: string, options: readonly string[]): CandidateDescriptor {
  return { decisionId: `${kind}:${personId}:1530`, kind, personId, options };
}

// Borrow the actual public generator's owned context and language-catalog port. Suppress only
// candidate capture here: direct phase tests then supply their explicit comparator input.
async function phaseContext(people: Record<string, Person>, protagonistId?: string) {
  let borrowed: Parameters<typeof beginLegacyYear>[0] | undefined;
  const begin = vi.spyOn(legacyYear, "beginLegacyYear").mockImplementation((context) => {
    borrowed = context;
    return [];
  });
  try {
    await observe({ seed: "phase-contract", startYear: 1530, endYear: 1530, town: { name: "Testville" } }, people, [], { protagonistId });
    const context = borrowed!;
    // Discard the fixture run's shocks/vignette, not the owned arrays or catalog resolver.
    context.events.length = 0;
    context.decisions.length = 0;
    return context;
  } finally {
    begin.mockRestore();
  }
}

const seeded = [
  ["maternal-check-37", 24],
  ["artisan-widow-trade-dec083-1", 30],
  ["lockout-check-12", 24],
] as const;
// Captured from the unextracted public API at 4df561a, then rerun before moving source.
const pins: Record<string, { years: string; final: string }> = {
  "maternal-check-37": { years: "e6b28ed0e44cb6ff65066d46d212b5ba42e569b59b7e6913cc6ba9726dbc5a6c", final: "5f89559cd1b109896d1ead3ca88ccdfe80a604ccbd03da6c2615c19b1be9d107" },
  "artisan-widow-trade-dec083-1": { years: "3c8358d49c84317d943a04d7027c4e93ae81c0bb401ce87741fe6f00a2f283fa", final: "dc1955c0c17592997b1e8e807aeb6c220bda506783c88bc3dafa63d6b56db81e" },
  "lockout-check-12": { years: "09201227246f2fda5a26b7093825b0ca86a5643ca721e8ed580e76f8b5406e30", final: "1181d26015a10d833b14b9eb169f622cb0ab498953e51cda6ffd0c904690837e" },
  "illness-death-widow": { years: "d4a1bffb9f88e526ba823b4d42e053398871e0a85a17896f6efdc2d4c3fd8dfa", final: "aa5e71d6ee9ebfa88fffcd8fcb946aa2707f8f9ecdc5dc4d8f18c1aaa66112a5" },
  "dead-suitors": { years: "354fd6bcecc9116be4f91192e7745d35673e528c731924e98c52a9ae75b346c5", final: "eef68ccdf78546b54f7e8171f8dfa0e2c5a4060b33f4a3bcfbce17f9bf9c8c05" },
  "arranged-departure": { years: "531399aad4a8193897f21102739b3dcd543cf050f502ae71fd311cf1026f48b3", final: "b2d61a5645d97f2d1dabcbdba47da766d30ccb35a4065dfc263f8c1589a7e127" },
  "away-birth": { years: "116ec4b7f951de66d3825c4bdfb8d08b3036fd3c444b1f151cd6e7e9b043b7dc", final: "44ebbb70ceb17ed4b68db7ec90ec3f56fbb6a8bc30d33ac6a3c3c9066cbd8341" },
  "return": { years: "9d1a96c5315c13d3eff73c10204d93ebc475c8eb725942a4e4daab8be636887d", final: "ba368c8ca4210551b14b797ac854360d7a34424f5e16523bc51549a49b1e5a7b" },
};

describe("complete legacy pre-social phase", () => {
  it("emits the town slot before independent national shocks, including a missing town slot", async () => {
    const context = await phaseContext({});
    const id = legacyYear.emitLegacyYearShocks(context, 1337, "fire");
    expect(context.events.map((e) => e.payload)).toEqual([
      { eventType: "fire" }, { eventType: "hundred-years-war-begins", period: true },
    ]);
    expect(id).toBe(context.events[0]!.id);
    expect(legacyYear.emitLegacyYearShocks(context, 1351, undefined)).toBeUndefined();
    expect(context.events[2]!.payload).toEqual({ eventType: "statute-of-labourers", period: true });
    expect(legacyYear.emitLegacyYearShocks(context, 1530, undefined)).toBeUndefined();
    expect(context.events).toHaveLength(3);
  });

  it("interleaves vital decisions in comparator order, piggybacks school, and puts real immigration last", async () => {
    const seed = "phase-contract";
    const context = await phaseContext({
      a: person(seed, "a", "m", { birthYear: 1523, literate: true }),
      b: person(seed, "b", "m"),
    });
    const input = [candidate("immigration", "world", ["arrive", "none"]),
      candidate("death", "b", ["die", "survive"]), candidate("death", "a", ["die", "survive"]),
      candidate("illness", "b", ["illness", "well"]), candidate("illness", "a", ["illness", "well"])];
    const visited: string[] = [];
    const resolve = context.resolveBiologyDecision;
    const instrumented = { ...context, mortalityMultiplier: () => 1.6, resolveBiologyDecision: ((...args) => {
      const [descriptor] = args;
      visited.push(`${descriptor.kind}:${descriptor.personId}`);
      if (descriptor.personId === "b") expect(context.events.some((e) => e.kind === "school" && e.actors[0] === "a")).toBe(true);
      if (descriptor.kind === "immigration") expect(context.people.b!.deathYear).toBe(1530);
      return resolve(...args);
    }) as typeof resolve };
    const shockId = legacyYear.emitLegacyYearShocks(context, 1530, "plague");
    const left = legacyYear.resolveLegacyBiology(instrumented, 1530, input, [
      force("illness", "a", "illness"), force("death", "a", "survive"),
      force("illness", "b", "illness"), force("death", "b", "die"), force("immigration", "world", "arrive"),
    ], "plague", shockId);
    expect(visited).toEqual(["illness:a", "death:a", "illness:b", "death:b", "immigration:world"]);
    expect(left.size).toBe(0);
    expect(context.events.map((e) => e.kind)).toEqual(["town", "illness", "school", "illness", "death", "manorial-fine", "move"]);
    expect(context.events[1]!.payload.recovered).toBe(true);
    const death = context.decisions.find((d) => d.kind === "death" && d.personId === "b")!;
    const illness = context.events[3]!;
    expect(death.causes).toEqual([illness.id, shockId]);
    expect(context.events[4]!.causes).toEqual([illness.id]);
    expect(context.events[4]!.payload.cause).toBe("plague");
    const immigrant = context.people["immigrant-1530"]!;
    expect(immigrant.founder).toBe(false);
    expect(context.events.at(-1)!.actors).toEqual([immigrant.id]);
    expect(context.decisions.at(-1)!.id).toBe("immigration:world#1530.1");
    expect(immigrant.lifeState).toBeUndefined();
  });

  it("retains the original school-after-death behavior, excluding moved-away children", async () => {
    const seed = "phase-contract";
    const context = await phaseContext({
      child: person(seed, "child", "f", { birthYear: 1523, literate: true }),
      away: person(seed, "away", "f", { birthYear: 1523, literate: true, away: true }),
    });
    context.events.push({ id: "away-move", year: 1529, kind: "move", actors: ["away"], payload: { away: true }, causes: [] });
    legacyYear.resolveLegacyBiology(context, 1530, [candidate("death", "child", ["die", "survive"]),
      candidate("death", "away", ["die", "survive"])], [force("death", "child", "die"), force("death", "away", "survive")], undefined, undefined);
    expect(context.people.child!.deathYear).toBe(1530);
    expect(context.events.filter((e) => e.kind === "school").map((e) => e.actors[0])).toEqual(["child"]);
    expect(context.events.findIndex((e) => e.kind === "school")).toBeGreaterThan(context.events.findIndex((e) => e.kind === "death"));
  });

  it("mints before deciding and commits suppressed versus forced threshold outcomes at the original anchor", async () => {
    const context = await phaseContext({ subject: person("phase-contract", "subject", "m") });
    const descriptor = candidate("illness", "subject", ["illness", "well"]);
    const resolve = context.resolveBiologyDecision;
    const mintedAtCall: string[] = [];
    const instrumented = { ...context, resolveBiologyDecision: ((...args) => {
      mintedAtCall.push(args[7].id);
      expect(args[7]).toEqual(mintId(context.people, args[0].kind, args[0].personId, args[1]));
      const record = resolve(...args);
      // Deterministic negative branch without relying on a seed's sampled outcome.
      return { ...record, chosen: "well" };
    }) as typeof resolve };
    legacyYear.resolveLegacyBiology(instrumented, 1531, [descriptor], [force("illness", "subject", "well")], undefined, undefined);
    expect(context.decisions).toHaveLength(0);
    expect(context.people.subject!.lifeState!.slots["illness:subject"]).toEqual({ occurred: 0, attempts: 1 });
    legacyYear.resolveLegacyBiology(instrumented, 1530, [descriptor], [force("illness", "subject", "well")], undefined, undefined);
    expect(context.decisions).toHaveLength(1);
    expect(context.decisions[0]!.source).toBe("forced");
    expect(context.people.subject!.lifeState!.slots["illness:subject"]).toEqual({ occurred: 1, attempts: 0 });
    expect(mintedAtCall).toEqual(["illness:subject#1.1", "illness:subject#1.2"]);
    expect(overrideFor([force("Y1", "a::b", "encourage")], "Y1", "a", true, "b")).toBeDefined();
    expect(overrideFor([force("Y1", "a::b", "encourage")], "Y1", "a", false, "b")).toBeUndefined();
  });

  it("moves actual levy, away-arrival, and return outcomes before same-year newcomer social decisions", async () => {
    const seed = "phase-contract";
    const subject = person(seed, "protagonist", "m");
    // Explicit same-year descriptor protects the phase handoff without changing the legacy
    // catalog's pre-biology eligibility policy (which remains a later extraction boundary).
    const originalBegin = legacyYear.beginLegacyYear;
    const begin = vi.spyOn(legacyYear, "beginLegacyYear").mockImplementation((context) => [
      ...originalBegin(context), { ...candidate("Y5", subject.id, ["open-up", "keep-distance"]), partnerId: "away-1530" },
    ]);
    try {
      const observed = await observe({ seed, startYear: 1530, endYear: 1530, town: { name: "Testville" } }, { protagonist: subject }, [
        { id: "away-move", year: 1525, kind: "move", actors: [subject.id], payload: { away: true }, causes: [] },
      ], { protagonistId: subject.id, overrides: [force("death", subject.id, "survive"),
        force("away-arrival", subject.id, "arrive"), force("Y5", subject.id, "open-up"), force("return", subject.id, "stay")] });
      expect(observed.report.result.people["away-1530"]?.away).toBe(true);
      expect(observed.report.result.decisions.some((d) => d.kind === "Y5" && d.partnerId === "away-1530")).toBe(true);
      expect(observed.events.some((e) => e.kind === "reflection" && e.payload.note === "opened-up-to-a-friend" && e.actors.includes("away-1530"))).toBe(true);
    } finally {
      begin.mockRestore();
    }
    const context = await phaseContext({ p: person(seed, "p", "m", { away: true }) });
    context.events.push({ id: "p-away", year: 1525, kind: "move", actors: ["p"], payload: { away: true }, causes: [] });
    legacyYear.resolveLegacyBiology(context, 1530, [candidate("return", "p", ["return", "stay"]),
      candidate("levy", "p", ["impose", "spare"])], [force("return", "p", "return"), force("levy", "p", "impose")], undefined, undefined);
    expect(context.people.p!.lifeState!.residence.status).toBe("home");
    expect(context.events.filter((e) => e.year === 1530).map((e) => e.kind)).toEqual(["move", "levy"]);
    expect(context.events[1]!.payload).toEqual({ away: false, returned: true, destination: "Testville" });
  });

  it("keeps the protagonist's arranged household home and returns only departing NPC ids", async () => {
    const seed = "phase-contract";
    const context = await phaseContext({
      heroine: person(seed, "heroine", "f", { socialClass: "gentry" }),
      npc: person(seed, "npc", "f", { socialClass: "gentry" }),
    }, "heroine");
    const left = legacyYear.resolveLegacyBiology(context, 1530, [candidate("arranged-match", "npc", ["arrange", "none"]),
      candidate("arranged-match", "heroine", ["arrange", "none"])], [force("arranged-match", "npc", "arrange"),
      force("arranged-match", "heroine", "arrange")], undefined, undefined);
    expect([...left]).toEqual(["npc"]);
    expect(context.people.heroine!.away).not.toBe(true);
    expect(context.people.npc!.lifeState!.residence.status).toBe("away");
    expect(context.people["gentry-suitor-heroine-1530"]!.away).not.toBe(true);
    expect(context.people["gentry-suitor-npc-1530"]!.away).toBe(true);
    expect(context.events.map((e) => e.kind)).toEqual(["marriage", "marriage", "move"]);
    expect(context.events[2]!.causes).toEqual([context.events[1]!.id]);
    expect(context.decisions[1]!.resultingEventIds).toEqual([context.events[1]!.id, context.events[2]!.id]);
  });

  it("preserves live arranged-protagonist reads separately from captured vital-death exclusion", async () => {
    const context = await phaseContext({
      captured: person("phase-contract", "captured", "f"),
      current: person("phase-contract", "current", "f", { socialClass: "gentry" }),
    }, "captured");
    const live = { ...context, optionsProtagonistId: "current" };
    const left = legacyYear.resolveLegacyBiology(live, 1530, [candidate("death", "captured", ["die", "survive"]),
      candidate("arranged-match", "current", ["arrange", "none"])], [force("death", "captured", "die"),
      force("arranged-match", "current", "arrange")], undefined, undefined);
    expect(left.size).toBe(0);
    expect(context.people.current!.lifeState!.residence.status).toBe("home");
    expect(context.events.map((e) => e.kind)).toEqual(["death", "marriage"]);
    expect(context.events.some((e) => e.payload.fine === "heriot")).toBe(false);
  });

  it("presents leyrwite only for living home unfree courting women on the unchanged key", async () => {
    const seed = "phase-contract";
    const context = await phaseContext({});
    const winningId = Array.from({ length: 1000 }, (_, i) => `woman-${i}`).find((id) => shouldPresentLeyrwite(seed, id, 1530))!;
    expect(winningId).toBeDefined();
    // Use the same winning id per isolated invocation so eligibility, not different RNG, is tested.
    for (const changes of [{}, { sex: "m" as const }, { socialClass: "gentry" as const }, { away: true as const }, { deathYear: 1529 }]) {
      const woman = person(seed, winningId, "f", changes);
      woman.lifeState = applyLifeTransition(ensureLifeState(woman, []), { axis: "marital", to: "courting", partnerId: "suitor" }, 1529);
      context.people[winningId] = woman;
      context.events.length = 0;
      legacyYear.presentLegacyLeyrwite(context, 1530);
      expect(context.events.map((e) => e.payload.fine)).toEqual(Object.keys(changes).length === 0 ? ["leyrwite"] : []);
    }
    context.people[winningId] = person(seed, winningId, "f");
    context.events.length = 0;
    legacyYear.presentLegacyLeyrwite(context, 1530);
    expect(context.events).toHaveLength(0);
  });

  it("the active A2 path still calls the shared child mechanic", async () => {
    const child = vi.spyOn(mechanics, "spawnChild");
    try {
      const seed = "legacy-forced";
      const people = { husband: person(seed, "husband", "m", { spouseId: "wife" }),
        wife: person(seed, "wife", "f", { spouseId: "husband" }) };
      const observed = await observe({ seed, startYear: 1530, endYear: 1530, town: { name: "Testville" } }, people, [], {
        overrides: [force("death", "husband", "survive"), force("death", "wife", "survive"), force("A2", "wife", "try")],
      });
      expect(child).toHaveBeenCalledTimes(1);
      expect(child.mock.calls[0]![4]).toBe(observed.report.result.people);
      expect(observed.report.result.people["child-wife-1530"]?.motherId).toBe("wife");
      expect(spawnChild).toBeTypeOf("function");
    } finally {
      child.mockRestore();
    }
  });
});

describe("legacy whole-year canonical baseline", () => {
  it("exposes the bounded annual phase kernel", () => {
    expect(beginLegacyYear).toBeTypeOf("function");
    expect(resolveLegacyVitalDecision).toBeTypeOf("function");
    expect(legacyYear.emitLegacyYearShocks).toBeTypeOf("function");
    expect(legacyYear.resolveLegacyBiology).toBeTypeOf("function");
    expect(legacyYear.presentLegacyLeyrwite).toBeTypeOf("function");
  });

  it("the public annual generator actively delegates on its owned state", async () => {
    const begin = vi.spyOn(legacyYear, "beginLegacyYear");
    const shocks = vi.spyOn(legacyYear, "emitLegacyYearShocks");
    const biology = vi.spyOn(legacyYear, "resolveLegacyBiology");
    const leyrwite = vi.spyOn(legacyYear, "presentLegacyLeyrwite");
    try {
      const world = generateWorld({ seed: "legacy-delegation", startYear: 1530, endYear: 1530, founderCount: 10 });
      const observed = await observe(world.config, world.people, world.events);
      expect(begin).toHaveBeenCalledTimes(1);
      expect(shocks).toHaveBeenCalledTimes(1);
      expect(biology).toHaveBeenCalledTimes(1);
      expect(leyrwite).toHaveBeenCalledTimes(1);
      expect(begin.mock.invocationCallOrder[0]).toBeLessThan(shocks.mock.invocationCallOrder[0]!);
      expect(shocks.mock.invocationCallOrder[0]).toBeLessThan(biology.mock.invocationCallOrder[0]!);
      expect(biology.mock.invocationCallOrder[0]).toBeLessThan(leyrwite.mock.invocationCallOrder[0]!);
      const context = begin.mock.calls[0]![0];
      for (const [used] of [...shocks.mock.calls, ...biology.mock.calls, ...leyrwite.mock.calls]) {
        expect(used).toBe(context);
        expect(used.people).toBe(observed.report.result.people);
        expect(used.events).toBe(observed.report.result.events);
        expect(used.decisions).toBe(observed.report.result.decisions);
      }
      expect(context.counters.decisionCalls).toBe(observed.report.decisionCalls);
      expect(world.people).not.toBe(context.people);
    } finally {
      begin.mockRestore();
      shocks.mockRestore();
      biology.mockRestore();
      leyrwite.mockRestore();
    }
  });

  it("forced recovery retains same-year illness while override anchoring stays at fromYear", async () => {
    const seed = "legacy-recovery";
    const subject = person(seed, "subject", "m");
    const config = { seed, startYear: 1529, endYear: 1531, town: { name: "Testville" } };
    const observed = await observe(config, { subject }, [], {
      fromYear: 1530,
      overrides: [force("illness", "subject", "illness"), force("death", "subject", "survive")],
    });
    const illness = observed.events.find((e) => e.kind === "illness" && e.actors[0] === "subject");
    expect(illness?.year).toBe(1530);
    expect(illness?.payload.recovered).toBe(true);
    const forced = observed.report.result.decisions.filter((d) => d.source === "forced");
    expect(forced).toHaveLength(2);
    expect(forced.every((d) => d.year === 1530)).toBe(true);
    expect([...observed.report.snapshots.keys()]).toEqual([1529, 1530, 1531]);
  });
  it("distinguishes serialization quirks and identity", () => {
    expect(canonical({ a: undefined })).not.toBe(canonical({}));
    expect(canonical(-0)).not.toBe(canonical(0));
    expect(canonical({ a: 1, b: 2 })).not.toBe(canonical({ b: 2, a: 1 }));
    const shared = {};
    expect(canonical([shared, shared])).not.toBe(canonical([{}, {}]));
  });

  for (const [seed, founderCount] of seeded) {
    it(`pins every year and final canon: ${seed}`, async () => {
      const world = generateWorld({ seed, founderCount, startYear: 1498, endYear: 1558 });
      const observed = await observe(world.config, world.people, []);
      if (seed === "maternal-check-37") expect(observed.events.some((e) => e.kind === "death" && e.payload.cause === "childbirth")).toBe(true);
      if (seed === "artisan-widow-trade-dec083-1") expect(observed.events.some((e) => e.kind === "widowed" && e.payload.keptTrade)).toBe(true);
      expect({ years: observed.years, final: observed.final }).toEqual(pins[seed] ?? {});
    }, 30000);
  }

  for (const scenario of ["illness-death-widow", "dead-suitors", "arranged-departure", "away-birth", "return"] as const) {
    it(`pins forced ${scenario}`, async () => {
      const seed = "legacy-forced";
      const config = { seed, startYear: 1530, endYear: 1530, town: { name: "Testville" } };
      const people: Record<string, Person> = {};
      const events: Event[] = [];
      const overrides = [];
      let protagonistId: string | undefined;
      if (scenario === "illness-death-widow") {
        people.husband = person(seed, "husband", "m", { spouseId: "wife", socialClass: "artisan", // Deliberately retain this legacy fixture's unrecognized trade spelling: no normalization on extraction.
          job: "smith" as Person["job"] });
        people.wife = person(seed, "wife", "f", { spouseId: "husband" });
        overrides.push(force("illness", "husband", "illness"), force("death", "husband", "die"), force("death", "wife", "survive"));
      } else if (scenario === "dead-suitors") {
        people.alice = person(seed, "alice", "f");
        for (const id of ["bob1", "bob2"]) {
          people[id] = person(seed, id, "m");
          events.push({ id: `romance-${id}`, year: 1529, kind: "romance", actors: ["alice", id], payload: {}, causes: [] });
          overrides.push(force("death", id, "survive"));
        }
        overrides.push(force("death", "alice", "die"));
      } else if (scenario === "arranged-departure") {
        people.daughter = person(seed, "daughter", "f", { socialClass: "gentry" });
        overrides.push(force("death", "daughter", "survive"), force("arranged-match", "daughter", "arrange"));
      } else {
        people.protagonist = person(seed, "protagonist", "m", { spouseId: scenario === "away-birth" ? "wife" : undefined });
        protagonistId = "protagonist";
        events.push({ id: "move", year: 1525, kind: "move", actors: ["protagonist"], payload: { away: true }, causes: [] });
        overrides.push(force("death", "protagonist", "survive"), force("return", "protagonist", scenario === "return" ? "return" : "stay"));
        if (scenario === "away-birth") {
          people.wife = person(seed, "wife", "f", { spouseId: "protagonist", away: true });
          overrides.push(force("A2", "wife", "try"));
        }
      }
      const observed = await observe(config, people, events, { overrides, protagonistId });
      const fresh = observed.events.filter((e) => e.year === 1530);
      if (scenario === "illness-death-widow") {
        expect(fresh.map((e) => e.kind).slice(0, 3)).toEqual(["illness", "death", "widowed"]);
        expect(fresh.some((e) => e.payload.keptTrade === true)).toBe(true);
      }
      if (scenario === "dead-suitors") expect(fresh.filter((e) => e.kind === "breakup")).toHaveLength(2);
      if (scenario === "arranged-departure") {
        expect(fresh.some((e) => e.kind === "move" && e.payload.arranged)).toBe(true);
        expect(observed.report.result.decisions.filter((d) => d.personId === "daughter")
          .every((d) => ["illness", "death", "arranged-match"].includes(d.kind))).toBe(true);
      }
      if (scenario === "away-birth") expect(Object.values(observed.report.result.people).some((p) => p.motherId === "wife" && p.away)).toBe(true);
      if (scenario === "return") expect(fresh.some((e) => e.kind === "move" && e.payload.returned)).toBe(true);
      expect({ years: observed.years, final: observed.final }).toEqual(pins[scenario] ?? {});
    });
  }
});

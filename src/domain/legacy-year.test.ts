import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { beginLegacyYear, resolveLegacyVitalDecision, type LegacySocialBatchContext, type LegacySocialBatchOutput, type ResolvedDecision } from "./legacy-year";
import type { DecisionMaker, PersonYearBatch } from "./decisions";
import { getVignette } from "./vignettes";
import { mintId, overrideFor, spawnChild } from "./legacy-year-mechanics";
import * as mechanics from "./legacy-year-mechanics";
import { applyLifeTransition, ensureLifeState } from "./life-state";
import { shouldPresentLeyrwite } from "./period/markers";
import * as legacyYear from "./legacy-year";
import { RuleDecisionMaker } from "@/adapters/decision/rule-decision-maker";
import { createMind } from "./mind";
import { keyedDraw, keyedRng } from "./rng";
import { activeRomancePairs, pairKey } from "./events";
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

// Borrow the public generator's initialized state/catalog without running a fixture year.
// Direct phase tests supply their explicit comparator input on those same references.
async function phaseContext(people: Record<string, Person>, protagonistId?: string) {
  const context = await borrowedRunContext(people, { protagonistId }, "phase-contract");
  return {
    ...context,
    get optionsProtagonistId() { return context.options.protagonistId; },
    captureCandidates: () => [],
    mortalityMultiplier: (age: number, sex: Person["sex"], socialClass: NonNullable<Person["socialClass"]>) => context.mortalityMultiplier(undefined, age, sex, socialClass),
  };
}

type RunContext = legacyYear.LegacyRunContext<CandidateDescriptor, ReturnType<typeof createMarriageFunnelCollector>>;
type SocialContext = LegacySocialBatchContext<CandidateDescriptor, NonNullable<CandidateDescriptor["townEventType"]>>;

async function borrowedRunContext(people: Record<string, Person>, options: Partial<SimulateOptions> = {}, seed = "social-contract") {
  let borrowed: RunContext | undefined;
  const run = vi.spyOn(legacyYear, "runLegacyYear").mockImplementation(async (context, year) => {
    borrowed = context as RunContext;
    return legacyYear.captureLegacyYear(context, year);
  });
  try {
    await observe({ seed, startYear: 1530, endYear: 1530, town: { name: "Testville" } }, people, [], options);
    return borrowed!;
  } finally {
    run.mockRestore();
  }
}

// Borrow the live catalog ports, then exercise the kernel directly on those SAME references.
async function socialContext(people: Record<string, Person>, options: Partial<SimulateOptions> = {}) {
  return borrowedRunContext(people, options);
}

describe("borrowed annual execution API", () => {
  it("exports actual finalization and annual orchestration", () => {
    expect(legacyYear).toHaveProperty("finalizeLegacyYear", expect.any(Function));
    expect(legacyYear).toHaveProperty("runLegacyYear", expect.any(Function));
  });

  it("publishes with three separate ordered clones, detached but not frozen", () => {
    const owned = { people: { actor: person("capture", "actor", "f") }, events: [], decisions: [] };
    const clone = vi.spyOn(globalThis, "structuredClone");
    try {
      const snapshot = legacyYear.captureLegacyYear(owned, 1530);
      expect(Object.keys(snapshot)).toEqual(["year", "people", "events", "decisions"]);
      expect(clone.mock.calls).toEqual([[owned.people], [owned.events], [owned.decisions]]);
      expect(snapshot.people.actor).not.toBe(owned.people.actor);
      expect(snapshot.people.actor!.mind).not.toBe(owned.people.actor!.mind);
      const capturedStress = snapshot.people.actor!.mind.stress;
      owned.people.actor.mind.stress += 100;
      expect(snapshot.people.actor!.mind.stress).toBe(capturedStress);
      expect(Object.isFrozen(snapshot)).toBe(false);
      expect(Object.isFrozen(snapshot.people.actor!.mind)).toBe(false);
    } finally {
      clone.mockRestore();
    }
  });
});

describe("annual finalization effects", () => {
  it("credits the living parent but mutates the protagonist's actual Mind before capture", async () => {
    const context = await borrowedRunContext({
      infant: person("d1-parent", "infant", "f", { birthYear: 1530, motherId: "mother" }),
      mother: person("d1-parent", "mother", "f"),
    }, { protagonistId: "infant" }, "d1-parent");
    const infant = context.people.infant!;
    const mind = infant.mind;
    const parentBefore = canonical(context.people.mother!.mind);
    const minted = mintId(context.people, "D1", "infant", 1530);
    const fallback = vi.fn(context.resolveSocialDecision);
    const snapshot = await legacyYear.finalizeLegacyYear({ ...context, resolveSocialDecision: fallback },
      applicationOutput([]), undefined, [force("D1", "infant", "watch-the-night")]);
    expect(fallback).not.toHaveBeenCalled();
    expect(context.people.infant).toBe(infant);
    expect(infant.mind).toBe(mind);
    expect(context.decisions[0]).toMatchObject({ personId: "mother", partnerId: "infant", chosen: "watch-the-night", source: "forced" });
    expect(context.events[0]!.actors).toEqual(["mother", "infant"]);
    expect(mind.thoughts.at(-1)).toMatchObject({ emotion: "relief", intensity: 30 * (0.5 + mind.facets.altruism / 100), yearsLeft: 3 });
    expect(mind.memories.at(-1)!.text).toContain("feverish child");
    expect(canonical(context.people.mother!.mind)).toBe(parentBefore);
    expect(snapshot.people.infant!.mind).toEqual(mind);
    expect(snapshot.people.infant!.mind).not.toBe(mind);
    expect(context.counters.decisionCalls).toBe(0);
    expect(context.decisions[0]!.id).toBe(mintId({ infant: person("d1-parent", "infant", "f", { birthYear: 1530, motherId: "mother" }) }, "D1", "infant", 1530).id);
    expect(infant.lifeState!.slots[minted.key]).toEqual({ occurred: 1, attempts: 0 });
  });

  it("keeps the winner's raw aliases/own undefined/-0 and nudges the current child relationship", async () => {
    const context = await borrowedRunContext({
      actor: person("d1-owned", "actor", "f"),
      child: person("d1-owned", "child", "m", { motherId: "actor", birthYear: 1525 }),
    }, { protagonistId: "actor" });
    const vignette = getVignette("teaching-a-child")!;
    const descriptor = { ...candidate("D1", "actor", Object.keys(vignette.outcomes)), decisionId: "raw:winner" };
    const raw = { "teach-patiently": 1, "teach-briskly": -0 };
    const result: ResolvedDecision = { jevRaw: raw, final: raw, source: "jev", occurrenceProbability: -0 };
    const fallback = vi.fn(context.resolveSocialDecision);
    const before = context.people.actor!.mind.relationships.find((r) => r.personId === "child")?.strength ?? 0;
    const snapshot = await legacyYear.finalizeLegacyYear({ ...context, resolveSocialDecision: fallback }, applicationOutput([], {
      d1Candidates: [{ descriptor, vignette, deciderId: "actor", question: context.buildQuestion(descriptor, 1530, context.config, context.people) }],
      resultByDecisionId: new Map([[descriptor.decisionId, result]]), finalVignetteWinner: descriptor.decisionId,
    }), undefined, []);
    expect(fallback).not.toHaveBeenCalled();
    const record = context.decisions[0]!;
    expect(record.jevRaw).toBe(raw);
    expect(record.final).toBe(raw);
    expect(Object.hasOwn(record, "prior")).toBe(true);
    expect(record.prior).toBeUndefined();
    expect(Object.hasOwn(record, "partnerId")).toBe(true);
    expect(record.partnerId).toBeUndefined();
    expect(Object.is(record.occurrenceProbability, -0)).toBe(true);
    const values = context.people.actor!.mind.values;
    const childValues = context.people.child!.mind.values;
    const names = Object.keys(values) as (keyof typeof values)[];
    const compatibility = 1 - names.reduce((sum, name) => sum + Math.abs(values[name] - childValues[name]), 0) / (names.length * 100);
    expect(context.people.actor!.mind.relationships.find((r) => r.personId === "child")!.strength).toBe(Math.round(before + 10 + compatibility * 5));
    expect(context.people.actor!.mind.memories.at(-1)!.text).toContain("teaching a child");
    expect(snapshot.decisions[0]!.final).toBe(snapshot.decisions[0]!.jevRaw);
    expect(snapshot.decisions[0]!.final).not.toBe(raw);
    expect(context.counters.decisionCalls).toBe(0);
  });

  for (const source of ["jev", "rules"] as const) {
    for (const missing of ["winner", "result"] as const) {
      it(`falls back for missing ${missing} with ${source} call accounting`, async () => {
        const context = await borrowedRunContext({ actor: person("d1-fallback", "actor", "f") }, { protagonistId: "actor" });
        const vignette = getVignette("teaching-a-child")!;
        const descriptor = candidate("D1", "actor", Object.keys(vignette.outcomes));
        const fallback = vi.fn(async (q: Parameters<SocialContext["resolveSocialDecision"]>[0]) => ({ final: { [q.options[0]!]: 1 }, source }));
        const snapshot = await legacyYear.finalizeLegacyYear({ ...context,
          options: { ...context.options, engineSource: source }, resolveSocialDecision: fallback,
        }, applicationOutput([], {
          d1Candidates: missing === "result" ? [{ descriptor, vignette, deciderId: "actor", question: context.buildQuestion(descriptor, 1530, context.config, context.people) }] : [],
          finalVignetteWinner: descriptor.decisionId,
        }), undefined, []);
        expect(fallback).toHaveBeenCalledOnce();
        expect(context.counters.decisionCalls).toBe(source === "jev" ? 1 : 0);
        expect(snapshot.events.at(-1)!.kind).toBe("vignette");
        expect(context.decisions[0]!.source).toBe(source);
      });
    }
  }

  it("gives forced option ownership precedence over a prefetched different winner", async () => {
    const context = await borrowedRunContext({ actor: person("d1-force", "actor", "f") }, { protagonistId: "actor" });
    const vignette = getVignette("teaching-a-child")!;
    const descriptor = candidate("D1", "actor", Object.keys(vignette.outcomes));
    const fallback = vi.fn(context.resolveSocialDecision);
    await legacyYear.finalizeLegacyYear({ ...context, resolveSocialDecision: fallback }, applicationOutput([], {
      d1Candidates: [{ descriptor, vignette, deciderId: "actor", question: context.buildQuestion(descriptor, 1530, context.config, context.people) }],
      finalVignetteWinner: descriptor.decisionId,
      resultByDecisionId: new Map([[descriptor.decisionId, { final: { "teach-patiently": 1 }, source: "jev" }]]),
    }), undefined, [force("D1", "actor", "feed-it")]);
    expect(context.events[0]!.payload.vignette).toBe("a-stray-dog");
    expect(context.decisions[0]!.chosen).toBe("feed-it");
    expect(fallback).not.toHaveBeenCalled();
    expect(context.counters.decisionCalls).toBe(0);
  });

  it("retains quiet guards for missing, already dead, death-year and existing-event protagonists", async () => {
    for (const state of ["missing", "dead", "death-year", "event"] as const) {
      const context = await borrowedRunContext({ actor: person("d1-guard", "actor", "f", {
        ...(state === "dead" ? { deathYear: 1529 } : state === "death-year" ? { deathYear: 1530 } : {}),
      }) }, { protagonistId: state === "missing" ? "absent" : "actor" });
      if (state === "event") mechanics.pushEvent(context.events, 1530, "reflection", ["actor"], {}, []);
      const snapshot = await legacyYear.finalizeLegacyYear(context, applicationOutput([]), undefined, [force("D1", "actor", "feed-it")]);
      expect(snapshot.decisions.filter((d) => d.kind === "D1")).toHaveLength(state === "death-year" ? 1 : 0);
    }
  });
});

describe("borrowed annual ordering", () => {
  it("preserves family lookup insertion order and the missing-parent legacy quirk", () => {
    const actor = person("family", "actor", "f", { motherId: "missing", fatherId: "father" });
    const father = person("family", "father", "m");
    const sibling = person("family", "sibling", "f", { motherId: "missing" });
    const child = person("family", "child", "m", { motherId: "actor" });
    const people = { actor, father, sibling, child };
    expect(mechanics.relationshipTargetId("parent", actor, people)).toBe("missing");
    expect(mechanics.livingSiblingId(people, actor)).toBe("sibling");
    expect(mechanics.livingChildId(people, actor)).toBe("child");
    expect(mechanics.relationshipTargetId("parent", person("family", "orphan", "f"), people)).toBeUndefined();
  });

  it("decays before mutating capture, binds the same-year shock, awaits batch, then applies and captures", async () => {
    const context = await borrowedRunContext({ actor: person("run-order", "actor", "f") });
    const mind = context.people.actor!.mind;
    mind.thoughts.push({ emotion: "hope", cause: "old", intensity: 20, yearsLeft: 3, year: 1529 });
    const calls: string[] = [];
    const raw = { help: 1 };
    const snapshot = await legacyYear.runLegacyYear({ ...context,
      townEventForYear: () => { calls.push("town"); return "harvest"; },
      captureCandidates: (year, debug) => {
        calls.push("capture");
        expect(year).toBe(1530);
        expect(debug).toBe(context.debug);
        expect(mind.thoughts[0]!.yearsLeft).toBe(2);
        ensureLifeState(context.people.actor!, context.events);
        return [candidate("death", "actor", ["die", "survive"]), { ...candidate("A5", "actor", ["help", "ignore"]), townEventType: "harvest" as const }];
      },
      mortalityMultiplier: (town, ...args) => {
        calls.push("mortality");
        expect(town).toBe("harvest");
        return context.mortalityMultiplier(town, ...args);
      },
      overrides: [force("death", "actor", "survive")],
      buildQuestion: (...args) => {
        calls.push("question");
        expect(args[3]).toBe(context.people);
        expect(context.events[0]!.kind).toBe("town");
        return context.buildQuestion(...args);
      },
      resolveSocialDecision: async () => {
        calls.push("batch-start");
        await Promise.resolve();
        expect(mind.thoughts).toHaveLength(1);
        calls.push("batch-end");
        return { final: raw, source: "jev" };
      },
      options: { ...context.options, decisionMaker: { decide: vi.fn() } },
    }, 1530);
    expect(calls).toEqual(["capture", "town", "mortality", "question", "batch-start", "batch-end"]);
    expect(context.people.actor!.mind).toBe(mind);
    expect(mind.thoughts).toHaveLength(2); // A5 has a Mind effect even without an NPC event.
    expect(snapshot.people.actor!.mind).toEqual(mind);
    expect(snapshot.decisions.at(-1)!.final).toEqual(raw);
    expect(snapshot.events.filter((e) => e.actors.includes("actor"))).toEqual([]);
  });

  it("publishes current newborn inheritance and immediate widow grief after actual ordered birth/death", async () => {
    const seed = birthSeed(true, true);
    const context = await borrowedRunContext(parents(seed), {}, seed);
    const snapshot = await legacyYear.runLegacyYear({ ...context,
      captureCandidates: () => [birthCandidate],
      townEventForYear: () => undefined,
      overrides: [force("A2", "mother", "try")],
    }, 1530);
    const child = Object.values(snapshot.people).find((p) => p.motherId === "mother")!;
    expect(child).toBeDefined();
    expect(child.mind).toEqual(context.people[child.id]!.mind);
    expect(snapshot.people.mother!.deathYear).toBe(1530);
    expect(snapshot.people.father!.mind.thoughts.some((t) => t.emotion === "grief")).toBe(true);
    expect(snapshot.people.father!.lifeState!.marital.status).toBe("widowed");
    expect(snapshot.events.map((e) => e.kind)).toEqual(["child", "birth", "death", "widowed"]);
  });
});

describe("ordered social application API", () => {
  it("exports a synchronous owned phase", () => {
    expect(legacyYear).toHaveProperty("applyLegacySocialBatch", expect.any(Function));
  });

  it("delegates the active generator phase with its owned references", async () => {
    const apply = vi.spyOn(legacyYear, "runLegacyYear");
    try {
      await observe({ seed: "apply-delegation", startYear: 1530, endYear: 1530, town: { name: "Testville" } }, {
        actor: person("apply-delegation", "actor", "f"),
      }, [], { overrides: [force("death", "actor", "survive")] });
      expect(apply).toHaveBeenCalledOnce();
      const [context, year] = apply.mock.calls[0]!;
      expect(year).toBe(1530);
      expect(context.people.actor!.id).toBe("actor");
      expect(context.decisions).toEqual(expect.any(Array));
      expect((await apply.mock.results[0]!.value).year).toBe(1530);
    } finally {
      apply.mockRestore();
    }
  });
});

// Borrow catalog ports and owned references without a fixture year's effects. Direct tests
// run the real synchronous outcome bodies, not a dispatcher.
async function applicationContext(seed: string, people: Record<string, Person>, protagonistId?: string) {
  return borrowedRunContext(people, { protagonistId }, seed);
}

function applicationOutput(candidates: CandidateDescriptor[], patch: Partial<LegacySocialBatchOutput<CandidateDescriptor>> = {}): LegacySocialBatchOutput<CandidateDescriptor> {
  return {
    year: 1530, batchable: true, socialCandidates: candidates, questions: [],
    forcedFlags: candidates.map((c) => force(c.kind, c.personId, c.options[0]!)),
    fallbackFlags: candidates.map(() => false), resolved: candidates.map(() => undefined),
    d1Candidates: [], resultByDecisionId: new Map(), finalVignetteWinner: undefined,
    ...patch,
  };
}

function birthSeed(maternalDeath: boolean, priorCore = false): string {
  // A deterministic seeded fixture search, not a forced production death or changed physics.
  for (let i = 0; i < 20000; i++) {
    const seed = `ordered-birth-${i}`;
    if (keyedDraw(seed, pairKey("mother", "father"), 1530, "conceive") >= mechanics.conceptionProbability(30)) continue;
    if ((keyedDraw(seed, "mother", 1530, "maternal-death") < 0.0095) !== maternalDeath) continue;
    if (priorCore && keyedRng(seed, "mother", 1530, "mind-memory-core-0")() >= 1 / 3) continue;
    return seed;
  }
  throw new Error("No deterministic original-physics birth fixture found");
}

function parents(seed: string) {
  const mother = person(seed, "mother", "f", { spouseId: "father" });
  const father = person(seed, "father", "m", { spouseId: "mother" });
  mother.mind.facets.perseverance = 50;
  father.mind.facets.perseverance = 50;
  return { mother, father };
}

const birthCandidate: CandidateDescriptor = { ...candidate("A2", "mother", ["try", "refuse"]), partnerId: "father" };

describe("ordered social application effects", () => {
  it("inherits the current parent Mind after an earlier core shift, before birth joy", async () => {
    const seed = birthSeed(false, true);
    const context = await applicationContext(seed, parents(seed));
    const before = structuredClone(context.people);
    const prefetched = spawnChild(seed, 1530, before.mother!, before.father!, before);
    let atBirth: Record<string, Person> | undefined;
    const actualSpawn = mechanics.spawnChild;
    const spawn = vi.spyOn(mechanics, "spawnChild").mockImplementation((...args) => {
      atBirth = structuredClone(args[4]);
      return actualSpawn(...args);
    });
    try {
      legacyYear.applyLegacySocialBatch(context, applicationOutput([
        { ...candidate("A11", "mother", ["master-it"]), breakdownKind: "despair" }, birthCandidate,
      ]), undefined);
      const motherAtBirth = atBirth!.mother!;
      const fatherAtBirth = atBirth!.father!;
      expect(motherAtBirth.mind.facets.perseverance).toBeGreaterThan(50);
      expect(motherAtBirth.mind.memories.some((m) => m.core && m.text.includes("overcame a breaking point"))).toBe(true);
      expect(motherAtBirth.mind.thoughts.some((t) => t.cause.startsWith("welcoming"))).toBe(false);
      expect(fatherAtBirth.mind.thoughts.some((t) => t.cause.startsWith("welcoming"))).toBe(false);
      const child = Object.values(context.people).find((p) => p.motherId === "mother")!;
      expect(child.mind).toEqual(createMind(seed, child.id, 1530, [motherAtBirth.mind, fatherAtBirth.mind]));
      expect(child.mind.facets.perseverance).not.toBe(prefetched.mind.facets.perseverance);
      expect(context.people.mother!.mind.thoughts.some((t) => t.cause === `welcoming ${child.name} into the family`)).toBe(true);
      expect(context.decisions.map((d) => d.kind)).toEqual(["A11", "A2"]);
      expect(context.events.map((e) => e.kind)).toEqual(["breakdown", "child", "birth"]);
      expect(spawn).toHaveBeenCalledOnce();
    } finally {
      spawn.mockRestore();
    }
  });

  it("immediately cleans maternal death and courtship before recording a later dead actor", async () => {
    const seed = birthSeed(true);
    const context = await applicationContext(seed, { ...parents(seed), suitor: person(seed, "suitor", "m") });
    const { mother, father, suitor } = context.people;
    const marriage = mechanics.pushEvent(context.events, 1529, "marriage", [mother!.id, father!.id], {}, []);
    mechanics.pushEvent(context.events, 1529, "romance", [mother!.id, suitor!.id], {}, []);
    suitor!.lifeState = applyLifeTransition(ensureLifeState(suitor!, context.events), { axis: "marital", to: "courting", partnerId: mother!.id }, 1529);
    const labels = vi.fn(context.optionLabel);
    const later = { ...candidate("A3", "mother", ["seize"]), opportunityJob: "baker" };
    let atLaterLabel: Record<string, Person> | undefined;
    labels.mockImplementation((...args) => {
      if (args[0] === "A3") atLaterLabel = structuredClone(context.people);
      return context.optionLabel(...args);
    });
    legacyYear.applyLegacySocialBatch({ ...context, optionLabel: labels }, applicationOutput([birthCandidate, later]), undefined);
    const childEvent = context.events.find((e) => e.kind === "child")!;
    const birth = context.events.find((e) => e.kind === "birth")!;
    const death = context.events.find((e) => e.kind === "death")!;
    const widow = context.events.find((e) => e.kind === "widowed")!;
    const breakup = context.events.find((e) => e.kind === "breakup")!;
    expect(context.events.map((e) => e.kind)).toEqual(["marriage", "romance", "child", "birth", "death", "widowed", "breakup"]);
    expect(childEvent.causes).toEqual([marriage.id]);
    expect(birth.causes).toEqual([childEvent.id]);
    expect(death.causes).toEqual([childEvent.id, birth.id]);
    expect(death.payload.cause).toBe("childbirth");
    expect(widow.causes).toEqual([death.id]);
    expect(breakup.causes).toEqual([death.id]);
    expect(atLaterLabel!.mother!.deathYear).toBe(1530);
    expect(atLaterLabel!.mother!.spouseId).toBeUndefined();
    expect(atLaterLabel!.father!.lifeState!.marital.status).toBe("widowed");
    expect(atLaterLabel!.suitor!.lifeState!.marital.status).toBe("single");
    expect(father!.mind.thoughts.some((t) => t.emotion === "grief" && t.personId === mother!.id)).toBe(true);
    expect(activeRomancePairs(context.events, suitor!.id)).toEqual([]);
    expect(context.decisions.map((d) => d.kind)).toEqual(["A2", "A3"]);
    expect(context.decisions[0]!.resultingEventIds).toEqual([childEvent.id, birth.id, death.id, widow.id, breakup.id]);
    expect(context.decisions[1]!.resultingEventIds).toEqual([]);
    expect(mother!.job).toBe("none");
    expect(mother!.mind.thoughts.some((t) => t.cause.includes("becoming"))).toBe(false);
    expect(mintId(context.people, "A3", "mother", 1530).id).not.toBe(context.decisions[1]!.id);
  });

  it("records unselected and dead candidates in input order with exact raw aliases and slots", async () => {
    const seed = "raw-apply";
    const context = await applicationContext(seed, { alive: person(seed, "alive", "f"), dead: person(seed, "dead", "m", { deathYear: 1529 }) });
    const before = canonical(Object.values(context.people).map((p) => p.mind));
    const raw = { help: 1, flee: -0 };
    const response: ResolvedDecision = { jevRaw: raw, prior: raw, final: raw, source: "jev", occurrenceProbability: undefined };
    const descriptors = [candidate("A5", "alive", ["help", "flee"]), candidate("A5", "dead", ["help", "flee"]), candidate("A5", "alive", ["help", "flee"])];
    const firstId = mintId(context.people, "A5", "alive", 1530).id;
    const deadId = mintId(context.people, "A5", "dead", 1530).id;
    legacyYear.applyLegacySocialBatch(context, applicationOutput(descriptors, {
      forcedFlags: [undefined, undefined, undefined], resolved: [response, { ...response, occurrenceProbability: -0 }, response],
    }), undefined);
    expect(context.decisions.map((d) => d.personId)).toEqual(["alive", "dead", "alive"]);
    expect(context.decisions[0]!.id).toBe(firstId);
    expect(context.decisions[1]!.id).toBe(deadId);
    expect(context.decisions[2]!.id).not.toBe(firstId);
    expect(mintId(context.people, "A5", "alive", 1530).id).not.toBe(context.decisions[2]!.id);
    for (const d of context.decisions) {
      expect(d.jevRaw).toBe(raw);
      expect(d.prior).toBe(raw);
      expect(d.final).toBe(raw);
      expect(Object.is(d.final.flee, -0)).toBe(true);
      expect(Object.hasOwn(d, "partnerId")).toBe(true);
      expect(d.partnerId).toBeUndefined();
      expect(Object.hasOwn(d, "occurrenceProbability")).toBe(true);
      expect(d.resultingEventIds).toEqual([]);
      expect(d.noise).not.toEqual({}); // even unselected/dead candidates are sampled
    }
    expect(Object.is(context.decisions[1]!.occurrenceProbability, -0)).toBe(true);
    expect(canonical(Object.values(context.people).map((p) => p.mind))).toBe(before);
    expect(context.events).toEqual([]);
  });

  it.each([false, true])("keeps NPC no-event Mind effects versus protagonist reflection (protagonist=%s)", async (protagonist) => {
    const seed = "npc-mind-apply";
    const context = await applicationContext(seed, {
      actor: person(seed, "actor", "f", { founder: false, motherId: "ancestor" }),
      partner: person(seed, "partner", "m"),
      ancestor: person(seed, "ancestor", "f", { birthYear: 1470, deathYear: 1529 }),
    }, protagonist ? "actor" : undefined);
    const actorBefore = canonical(context.people.actor!.mind);
    const partnerBefore = canonical(context.people.partner!.mind);
    legacyYear.applyLegacySocialBatch(context, applicationOutput([
      { ...candidate("Y1", "actor", ["decline"]), partnerId: "partner" },
      { ...candidate("A5", "actor", ["help"]), townEventType: "fire" },
    ]), "town-fire");
    expect(canonical(context.people.actor!.mind)).not.toBe(actorBefore);
    expect(canonical(context.people.partner!.mind)).not.toBe(partnerBefore);
    expect(context.people.actor!.mind.thoughts.map((t) => t.emotion)).toEqual(["relief", "pride"]);
    expect(context.people.partner!.mind.thoughts.map((t) => t.emotion)).toEqual(["shame"]);
    expect(context.marriageFunnelDebug!.y1WonDraw).toBe(1);
    expect(context.marriageFunnelDebug!.y1Outcomes.decline).toBe(1);
    if (protagonist) {
      expect(context.events.map((e) => e.kind)).toEqual(["reflection", "reflection"]);
      expect(context.events.map((e) => e.payload.note)).toEqual(["declined-a-suitor", "helped-during-a-town-event"]);
      expect(context.events[1]!.causes).toEqual(["town-fire"]);
      expect(context.decisions.map((d) => d.resultingEventIds)).toEqual(context.events.map((e) => [e.id]));
    } else {
      expect(context.events).toEqual([]);
      expect(context.decisions.map((d) => d.resultingEventIds)).toEqual([[], []]);
    }
    expect(context.decisions[1]!.causes).toEqual(["town-fire"]);
  });

  it.each([false, true])("rejects duplicate occurring kind/person before the alive guard (dead=%s)", async (dead) => {
    const seed = "duplicate-apply";
    const context = await applicationContext(seed, { actor: person(seed, "actor", "f", dead ? { deathYear: 1529 } : {}) });
    const descriptor = candidate("A5", "actor", ["help"]);
    expect(() => legacyYear.applyLegacySocialBatch(context, applicationOutput([descriptor, descriptor]), undefined))
      .toThrow("PR6 invariant violated: (A5, actor) occurred more than once in year 1530.");
    expect(context.decisions).toHaveLength(1);
    expect(mintId(context.people, "A5", "actor", 1530).id).not.toBe(context.decisions[0]!.id);
    expect(context.events).toEqual([]);
  });

  it.each(["forced", "fallback", "legacy"] as const)("bypasses selection only for %s answers", async (mode) => {
    const seed = "selection-bypass";
    const context = await applicationContext(seed, { actor: person(seed, "actor", "f") });
    const raw = { help: 1 };
    legacyYear.applyLegacySocialBatch(context, applicationOutput([candidate("A5", "actor", ["help"])], {
      batchable: mode !== "legacy",
      forcedFlags: mode === "forced" ? [force("A5", "actor", "help")] : [undefined],
      fallbackFlags: [mode === "fallback"],
      resolved: mode === "forced" ? [undefined] : [{ prior: raw, final: raw, source: "rules" }],
    }), undefined);
    expect(context.people.actor!.mind.thoughts).toHaveLength(1);
    const d = context.decisions[0]!;
    expect(d.occurrenceProbability).toBeUndefined();
    expect(d.source).toBe(mode === "forced" ? "forced" : "rules");
    expect(Object.hasOwn(d, "jevRaw")).toBe(true);
    expect(d.jevRaw).toBeUndefined();
    if (mode === "forced") {
      expect(d.noise).toEqual({});
      expect(d.prior).toBeUndefined();
    } else {
      expect(d.noise).not.toEqual({});
      expect(d.prior).toBe(raw);
      expect(d.final).toBe(raw);
    }
  });
});

const seeded = [
  ["maternal-check-37", 24],
  ["artisan-widow-trade-dec083-1", 30],
  ["lockout-check-12", 24],
] as const;
// Captured from the unextracted public API at 4df561a, then rerun before moving source.
// RE-PINNED after 2c9d1f4 ("give founder newborns the same single first mortality roll as in-sim
// children"): that fix deliberately changed two of these seeds, so their hashes moved with it. Every
// other seed kept its original pin, which is what makes this a targeted re-pin rather than a blanket
// rewrite. If a future change moves a pin, explain WHICH behaviour moved - never just paste the new
// hash.
const pins: Record<string, { years: string; final: string }> = {
  "maternal-check-37": { years: "11d4db6b468aa690e986655ae887111613776de41b23ed6576787ae51eda1d43", final: "070b8b285015c77240b49480a16e0cc06a266269240a9f2c9d22d1c4b3674385" },
  "artisan-widow-trade-dec083-1": { years: "3c8358d49c84317d943a04d7027c4e93ae81c0bb401ce87741fe6f00a2f283fa", final: "dc1955c0c17592997b1e8e807aeb6c220bda506783c88bc3dafa63d6b56db81e" },
  "lockout-check-12": { years: "aa69be2a103581c43f8ea3bc420bb46448da6b17b9c1f62a8e325b6b23a8144a", final: "87442307817ca7efc923db4f1b2f84d43eaae5eecc21e336e905a838ac1d48cc" },
  "illness-death-widow": { years: "d4a1bffb9f88e526ba823b4d42e053398871e0a85a17896f6efdc2d4c3fd8dfa", final: "aa5e71d6ee9ebfa88fffcd8fcb946aa2707f8f9ecdc5dc4d8f18c1aaa66112a5" },
  "dead-suitors": { years: "354fd6bcecc9116be4f91192e7745d35673e528c731924e98c52a9ae75b346c5", final: "eef68ccdf78546b54f7e8171f8dfa0e2c5a4060b33f4a3bcfbce17f9bf9c8c05" },
  "arranged-departure": { years: "531399aad4a8193897f21102739b3dcd543cf050f502ae71fd311cf1026f48b3", final: "b2d61a5645d97f2d1dabcbdba47da766d30ccb35a4065dfc263f8c1589a7e127" },
  "away-birth": { years: "116ec4b7f951de66d3825c4bdfb8d08b3036fd3c444b1f151cd6e7e9b043b7dc", final: "44ebbb70ceb17ed4b68db7ec90ec3f56fbb6a8bc30d33ac6a3c3c9066cbd8341" },
  "return": { years: "9d1a96c5315c13d3eff73c10204d93ebc475c8eb725942a4e4daab8be636887d", final: "ba368c8ca4210551b14b797ac854360d7a34424f5e16523bc51549a49b1e5a7b" },
};

describe("live legacy social batch phase", () => {
  it("exports the actual preparation/resolution API", () => {
    expect(legacyYear).toHaveProperty("resolveLegacySocialBatch", expect.any(Function));
  });

  it("delegates after biology and leyrwite with the one owned registry and logs", async () => {
    const context = await borrowedRunContext({ subject: person("social-delegation", "subject", "m") });
    const calls: string[] = [];
    const result = await legacyYear.runLegacyYear({ ...context,
      overrides: [force("death", "subject", "survive")],
      townEventForYear: () => "harvest",
      captureCandidates: () => [candidate("death", "subject", ["die", "survive"]), candidate("Y3", "subject", ["learn", "ignore"])],
      resolveBiologyDecision: (...args) => {
        calls.push("biology");
        expect(context.events[0]!.kind).toBe("town");
        return context.resolveBiologyDecision(...args);
      },
      buildQuestion: (...args) => {
        calls.push("question");
        expect(args[3]).toBe(context.people);
        expect(context.decisions[0]!.kind).toBe("death");
        expect(context.people.subject!.lifeState).toBeDefined();
        return context.buildQuestion(...args);
      },
    }, 1530);
    expect(calls).toEqual(["biology", "question"]);
    expect(result.decisions.map((d) => d.kind)).toEqual(["death", "Y3"]);
    expect(result.people.subject).not.toBe(context.people.subject);
  });
});

describe("social batch alternate contracts", () => {
  it("keeps an empty batch silent and forced flags aligned without calls or slot commits", async () => {
    const context = await socialContext({ subject: person("social-contract", "subject", "m") });
    const decideYear = vi.fn(async () => ({ selection: {}, response: {} }));
    const instrumented = { ...context, options: { ...context.options, decisionMaker: { decide: vi.fn(), decideYear } } };
    const before = canonical({ people: context.people, events: context.events, decisions: context.decisions });
    const empty = await legacyYear.resolveLegacySocialBatch(instrumented, 1530, [], [], new Set(), undefined);
    expect(empty).toMatchObject({ year: 1530, batchable: true, socialCandidates: [], questions: [], resolved: [], d1Candidates: [] });
    const c = candidate("Y3", "subject", ["learn", "ignore"]);
    const forced = force("Y3", "subject", "learn");
    const output = await legacyYear.resolveLegacySocialBatch(instrumented, 1530, [c], [forced], new Set(), undefined);
    expect(output.socialCandidates[0]).toBe(c);
    expect(output.forcedFlags).toEqual([forced]);
    expect(output.fallbackFlags).toEqual([false]);
    expect(output.resolved).toEqual([undefined]);
    expect(output.questions[0]!.options).toBe(c.options);
    expect(context.counters.decisionCalls).toBe(0);
    expect(decideYear).not.toHaveBeenCalled();
    expect(canonical({ people: context.people, events: context.events, decisions: context.decisions })).toBe(before);
  });

  it("awaits the legacy per-question port in candidate order and anchors overrides to fromYear", async () => {
    const context = await socialContext({ subject: person("social-contract", "subject", "m") });
    const distribution = { learn: 1 };
    const calls: string[] = [];
    const resolveSocialDecision: SocialContext["resolveSocialDecision"] = vi.fn(async (q, maker, source) => {
      expect(maker).toBe(options.decisionMaker);
      expect(source).toBe("jev");
      await Promise.resolve();
      calls.push(q.id);
      return { jevRaw: distribution, final: distribution, source: "jev" as const };
    });
    const options = { ...context.options, engineSource: "jev" as const, decisionMaker: { decide: vi.fn() } };
    const a = candidate("Y3", "subject", ["learn", "ignore"]);
    const b = candidate("A3", "subject", ["accept", "decline"]);
    const output = await legacyYear.resolveLegacySocialBatch({ ...context, options, resolveSocialDecision, concurrencyLimit: 1 },
      1531, [a, b], [force("Y3", "subject", "ignore")], new Set(), undefined);
    expect(output.batchable).toBe(false);
    expect(output.forcedFlags).toEqual([undefined, undefined]);
    expect(output.fallbackFlags).toEqual([false, false]);
    expect(calls).toEqual(output.questions.map((q) => q.id));
    expect(output.questions.map((q) => q.year)).toEqual([1531, 1531]);
    expect(context.counters.decisionCalls).toBe(2);
    expect(output.resolved[0]!.final).toBe(distribution);
    expect(output.resolved[1]!.final).toBe(distribution);
    expect(output.resultByDecisionId.size).toBe(0);
  });

  it("preserves the budget fast path but never throttles decisions about the protagonist or forced ones", async () => {
    const context = await socialContext({ subject: person("social-contract", "subject", "m"),
      npc: person("social-contract", "npc", "f") }, { protagonistId: "subject" });
    const decideYear = vi.fn(async (batch: PersonYearBatch) => {
      await Promise.resolve();
      return { selection: { nothing: 1 }, response: Object.fromEntries(Object.keys(batch.situations).map((id) => [id, { decline: 1 }])) };
    });
    context.counters.decisionCalls = context.decisionBudget;
    const options = { ...context.options, decisionMaker: { decide: vi.fn(), decideYear } };
    const ordinary = candidate("Y3", "npc", ["learn", "ignore"]);
    const about = { ...candidate("Y1", "npc", ["encourage", "decline", "wait"]), partnerId: "subject" };
    const forced = candidate("A3", "npc", ["accept", "decline"]);
    const output = await legacyYear.resolveLegacySocialBatch({ ...context, options }, 1530,
      [ordinary, about, forced], [force("D1", "subject", "none"), force("A3", "npc", "decline")], new Set(), undefined);
    expect(output.fallbackFlags).toEqual([true, false, false]);
    expect(output.resolved[0]!.source).toBe("rules");
    expect(output.resolved[0]!.final).toBe(output.resolved[0]!.prior);
    expect(output.resolved[2]).toBeUndefined();
    expect(decideYear).toHaveBeenCalledTimes(1);
    expect(Object.keys(decideYear.mock.calls[0]![0].situations)).toEqual([about.decisionId]);
    expect(context.counters.decisionCalls).toBe(context.decisionBudget + 1);
  });

  it.each([undefined, "subject"])("retains background routing and empty-circle behavior (protagonist %s)", async (protagonistId) => {
    const context = await socialContext({ subject: person("social-contract", "subject", "m"),
      distant: person("social-contract", "distant", "m") }, { protagonistId });
    const mainRaw = { learn: 1 };
    const backgroundRaw = { ignore: 1 };
    const decider = (raw: Record<string, number>): DecisionMaker => ({ decide: vi.fn(), decideYear: vi.fn(async (batch) => {
      await Promise.resolve();
      return { selection: { nothing: 1 }, response: Object.fromEntries(Object.keys(batch.situations).map((id) => [id, raw])) };
    }) });
    const main = decider(mainRaw);
    const background = decider(backgroundRaw);
    const output = await legacyYear.resolveLegacySocialBatch({ ...context, options: { ...context.options,
      decisionMaker: main, backgroundDecisionMaker: background, engineSource: "jev" } }, 1530,
    [candidate("Y3", "distant", ["learn", "ignore"])], [force("D1", "subject", "none")], new Set(), undefined);
    expect(context.counters.decisionCalls).toBe(1);
    if (protagonistId) {
      expect(background.decideYear).toHaveBeenCalledTimes(1);
      expect(main.decideYear).not.toHaveBeenCalled();
      expect(output.resolved[0]).toMatchObject({ source: "rules", occurrenceProbability: undefined });
      expect(output.resolved[0]!.prior).toBe(backgroundRaw);
    } else {
      expect(main.decideYear).toHaveBeenCalledTimes(1);
      expect(background.decideYear).not.toHaveBeenCalled();
      expect(output.resolved[0]!.jevRaw).toBe(mainRaw);
      expect(output.resolved[0]!.source).toBe("jev");
    }
  });

  it("filters same-year deaths/departures, retains historical C2 and tallies the live debug object", async () => {
    const context = await socialContext({ subject: person("social-contract", "subject", "m", { birthYear: 1520 }),
      earlier: person("social-contract", "earlier", "f", { deathYear: 1529 }),
      current: person("social-contract", "current", "f", { deathYear: 1530 }),
      departed: person("social-contract", "departed", "f") });
    // The fixture biology may have emitted school/life-state; the social phase must not do so.
    context.people.current!.deathYear = 1530;
    const debug = createMarriageFunnelCollector();
    const historical = { ...candidate("C2", "subject", ["mourn", "carry-on"]), partnerId: "earlier" };
    const died = { ...candidate("Y1", "subject", ["encourage", "decline", "wait"]), partnerId: "current" };
    const left = { ...died, partnerId: "departed" };
    const output = await legacyYear.resolveLegacySocialBatch({ ...context, marriageFunnelDebug: debug }, 1530,
      [died, historical, left], [force("C2", "subject", "mourn")], new Set(["departed"]), undefined);
    expect(output.socialCandidates).toEqual([historical]);
    expect(output.socialCandidates[0]).toBe(historical);
    expect(debug.y1LosesTo).toEqual({ "died-same-year": 1, "left-village-same-year": 1 });
  });

  it("preserves candidate order across opposite asynchronous batch completion and exact response aliases", async () => {
    const context = await socialContext({ a: person("social-contract", "a", "m"), b: person("social-contract", "b", "f") });
    const responses = { a: { learn: 1 }, b: { ignore: 1 } };
    const finish: Record<string, () => void> = {};
    const completion: string[] = [];
    const decideYear = vi.fn(async (batch: PersonYearBatch) => {
      await new Promise<void>((resolve) => { finish[batch.personId] = resolve; });
      completion.push(batch.personId);
      const id = Object.keys(batch.situations)[0]!;
      return { selection: { [id]: 1 }, response: { [id]: responses[batch.personId as "a" | "b"] } };
    });
    const candidates = [candidate("Y3", "a", ["learn", "ignore"]), candidate("Y3", "b", ["learn", "ignore"])];
    const pending = legacyYear.resolveLegacySocialBatch({ ...context, yearBatchConcurrency: 2,
      options: { ...context.options, engineSource: "jev", decisionMaker: { decide: vi.fn(), decideYear } } },
    1530, candidates, [], new Set(), undefined);
    expect(context.counters.decisionCalls).toBe(2);
    expect(decideYear.mock.calls.map(([batch]) => batch.personId)).toEqual(["a", "b"]);
    finish.b!();
    await Promise.resolve();
    finish.a!();
    const output = await pending;
    expect(completion).toEqual(["b", "a"]);
    expect(output.socialCandidates).toEqual(candidates);
    expect(output.resolved[0]!.final).toBe(responses.a);
    expect(output.resolved[1]!.final).toBe(responses.b);
    expect(output.resolved.map((r) => r!.occurrenceProbability)).toEqual([1, 1]);
    expect([...output.resultByDecisionId.keys()]).toEqual([candidates[1]!.decisionId, candidates[0]!.decisionId]);
    expect(context.events).toEqual([]);
    expect(context.decisions).toEqual([]);
  });

  it("builds newcomer questions from the actual post-biology person and current Mind", async () => {
    const seed = "phase-contract";
    const subject = person(seed, "protagonist", "m");
    const originalRun = legacyYear.runLegacyYear;
    let observedNewcomer = false;
    let newcomerMind: Person["mind"] | undefined;
    const phase = vi.spyOn(legacyYear, "runLegacyYear").mockImplementation(async (context, year) => {
      return originalRun({ ...context,
        captureCandidates: (y, debug) => [
          ...context.captureCandidates(y, debug), { ...candidate("Y5", subject.id, ["open-up", "keep-distance"]), partnerId: "away-1530" },
        ],
        buildQuestion: (descriptor, y, config, registry) => {
          expect(registry).toBe(context.people);
          const newcomer = registry["away-1530"];
          expect(newcomer).toBeDefined();
          // Capture once at the existing port, before any question construction.
          newcomerMind ??= newcomer!.mind;
          const question = context.buildQuestion(descriptor, y, config, registry);
          if (descriptor.kind === "Y5" && descriptor.partnerId === newcomer!.id) {
            expect(registry[newcomer!.id]!.mind).toBe(newcomerMind);
            observedNewcomer = true;
          }
          return question;
        },
      }, year);
    });
    try {
      const observed = await observe({ seed, startYear: 1530, endYear: 1530, town: { name: "Testville" } }, { protagonist: subject }, [
        { id: "away-move", year: 1525, kind: "move", actors: [subject.id], payload: { away: true }, causes: [] },
      ], { protagonistId: subject.id, overrides: [force("death", subject.id, "survive"),
        force("away-arrival", subject.id, "arrive"), force("Y5", subject.id, "open-up"), force("return", subject.id, "stay")] });
      expect(observedNewcomer).toBe(true);
      expect(observed.report.result.people["away-1530"]!.mind).toBe(newcomerMind);
    } finally {
      phase.mockRestore();
    }
  });

  it("returns the exact D1 question, response and nested prefetch without applying quiet-year effects", async () => {
    const context = await socialContext({ subject: person("social-contract", "subject", "m") }, { protagonistId: "subject" });
    const descriptor = candidate("D1", "subject", ["rest"]);
    const actualPool = context.buildDailyLifeVignetteCandidates(context.people.subject!, 1530, context.config.seed,
      context.people, context.events, undefined);
    const vignette = actualPool[0]!.vignette;
    expect(getVignette(vignette.id)).toBe(vignette);
    const raw = { rest: 1 };
    const decideYear = vi.fn(async (batch: PersonYearBatch) => {
      await Promise.resolve();
      expect(batch.personId).toBe("subject");
      expect(batch.year).toBe(1530);
      expect(batch.isProtagonist).toBe(true);
      expect(batch.situations[descriptor.decisionId]!.kind).toBe("D1");
      return { selection: { everyday: 1 }, vignetteSelection: { [descriptor.decisionId]: 1 }, response: { [descriptor.decisionId]: raw } };
    });
    const buildDailyLifeVignetteCandidates: SocialContext["buildDailyLifeVignetteCandidates"] = vi.fn((p, year, seed, people, events, townEvent) => {
      expect(p).toBe(context.people.subject);
      expect(p.mind).toBe(context.people.subject!.mind);
      expect(people).toBe(context.people);
      expect(events).toBe(context.events);
      expect([year, seed, townEvent]).toEqual([1530, "social-contract", undefined]);
      return [{ descriptor, vignette, deciderId: "subject" }];
    });
    const before = canonical({ people: context.people, events: context.events, decisions: context.decisions });
    const output = await legacyYear.resolveLegacySocialBatch({ ...context, buildDailyLifeVignetteCandidates,
      options: { ...context.options, engineSource: "jev", decisionMaker: { decide: vi.fn(), decideYear } } },
    1530, [], [], new Set(), undefined);
    expect(output.finalVignetteWinner).toBe(descriptor.decisionId);
    expect(output.d1Candidates[0]!.descriptor).toBe(descriptor);
    expect(output.d1Candidates[0]!.vignette).toBe(vignette);
    expect(output.d1Candidates[0]!.question).toBe(decideYear.mock.calls[0]![0].situations[descriptor.decisionId]!.question);
    expect(output.d1Candidates[0]!.question.kind).toBe("D1");
    expect(output.resultByDecisionId.get(descriptor.decisionId)).toEqual({ jevRaw: raw, final: raw, source: "jev", occurrenceProbability: 1 });
    expect(output.resultByDecisionId.get(descriptor.decisionId)!.final).toBe(raw);
    expect(context.counters.decisionCalls).toBe(1);
    expect(canonical({ people: context.people, events: context.events, decisions: context.decisions })).toBe(before);
    const forced = await legacyYear.resolveLegacySocialBatch({ ...context, buildDailyLifeVignetteCandidates }, 1530,
      [], [force("D1", "subject", "rest")], new Set(), undefined);
    expect(forced.d1Candidates).toEqual([]);
    expect(buildDailyLifeVignetteCandidates).toHaveBeenCalledTimes(1);
  });
});

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
    const originalRun = legacyYear.runLegacyYear;
    const begin = vi.spyOn(legacyYear, "runLegacyYear").mockImplementation((context, year) => originalRun({
      ...context, captureCandidates: (y, debug) => [
        ...context.captureCandidates(y, debug), { ...candidate("Y5", subject.id, ["open-up", "keep-distance"]), partnerId: "away-1530" },
      ],
    }, year));
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
    const run = vi.spyOn(legacyYear, "runLegacyYear");
    try {
      const world = generateWorld({ seed: "legacy-delegation", startYear: 1530, endYear: 1530, founderCount: 10 });
      const observed = await observe(world.config, world.people, world.events);
      expect(run).toHaveBeenCalledOnce();
      const [context, year] = run.mock.calls[0]!;
      expect(year).toBe(1530);
      expect(context.people).toBe(observed.report.result.people);
      expect(context.events).toBe(observed.report.result.events);
      expect(context.decisions).toBe(observed.report.result.decisions);
      expect(context.counters.decisionCalls).toBe(observed.report.decisionCalls);
      expect(context.debug).toBe(context.marriageFunnelDebug);
      expect(world.people).not.toBe(context.people);
      const publication = await run.mock.results[0]!.value;
      expect(publication).toBe(observed.report.snapshots.get(year));
      expect(publication.people).not.toBe(context.people);
    } finally {
      run.mockRestore();
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

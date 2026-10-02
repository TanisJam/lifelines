import { beforeAll, describe, expect, it } from "vitest";
import { RuleDecisionMaker } from "@/adapters/decision/rule-decision-maker";
import { createMind } from "@/domain/mind";
import { simulate } from "@/domain/simulate";
import type { DecisionRecord } from "@/domain/decisions";
import type { Event, Person, SimulationResult } from "@/domain/types";
import { deriveLifeScene } from "@/domain/scene";
import { generateWorld } from "@/domain/worldgen";
import { buildLifeChronicle, buildProvisionalTickEntries } from "./life-chronicle";
import { deleteLife, registerLife } from "./life-store";

async function buildRealChronicle(seed: string) {
  const { config, people, events } = generateWorld({ seed, startYear: 1500, endYear: 1600, founderCount: 10, protagonist: { name: "Testa", sex: "random" } });
  const report = await simulate(config, people, events, { decisionMaker: new RuleDecisionMaker(), engineSource: "rules", protagonistId: "protagonist" });
  const protagonist = report.result.people.protagonist!;
  const life = registerLife(`chronicle-${seed}`, `branch-${seed}`, config, protagonist.name, protagonist.sex, report.result, report.snapshots);
  const result = await buildLifeChronicle(life.id, life.originalBranchId);
  return { life, result };
}

describe("buildLifeChronicle — contract shape (fixture-free, a real simulated Chronicle)", () => {
  let chronicle: NonNullable<Awaited<ReturnType<typeof buildRealChronicle>>["result"]["data"]>;

  beforeAll(async () => {
    const { result } = await buildRealChronicle("chronicle-contract");
    expect(result.data).toBeDefined();
    chronicle = result.data!;
  });

  it("has at least one entry, sorted by year", () => {
    expect(chronicle.entries.length).toBeGreaterThan(0);
    for (let i = 1; i < chronicle.entries.length; i++) {
      expect(chronicle.entries[i]!.year).toBeGreaterThanOrEqual(chronicle.entries[i - 1]!.year);
    }
  });

  it("level 3 entries always have a turn; every other level never does", () => {
    for (const entry of chronicle.entries) {
      if (entry.level === 3) expect(entry.turn).toBeDefined();
      else expect(entry.turn).toBeUndefined();
    }
  });

  it("every {{personId}} marker in prose/summary resolves through the entry's own links", () => {
    for (const entry of chronicle.entries) {
      const markers = [...entry.prose.matchAll(/\{\{([^}]+)\}\}/g)].map((m) => m[1]!);
      for (const id of markers) expect(entry.links.some((l) => l.personId === id)).toBe(true);
    }
    const summaryMarkers = [...chronicle.summary.matchAll(/\{\{([^}]+)\}\}/g)].map((m) => m[1]!);
    for (const id of summaryMarkers) expect(chronicle.summaryLinks.some((l) => l.personId === id)).toBe(true);
  });

  it("a turn's chosen option is one of its own alternatives+chosen set, and probabilities (when present) cover the chosen option", () => {
    for (const entry of chronicle.entries) {
      if (!entry.turn) continue;
      const allOptionIds = [entry.turn.chosen.optionId, ...entry.turn.alternatives.map((o) => o.optionId)];
      expect(new Set(allOptionIds).size).toBe(allOptionIds.length); // no duplicate option ids
      if (entry.turn.probabilities) expect(entry.turn.probabilities[entry.turn.chosen.optionId]).toBeDefined();
    }
  });

  it("protagonist info is internally consistent, with a non-empty causeOfDeath", () => {
    expect(chronicle.protagonist.ageAtDeath).toBe(chronicle.protagonist.deathYear - chronicle.protagonist.birthYear);
    expect(chronicle.protagonist.causeOfDeath.length).toBeGreaterThan(0);
    expect(chronicle.protagonist.deathYear).toBeGreaterThanOrEqual(chronicle.protagonist.birthYear);
  });

  it("carries the scene, and gives every entry a time inside its year and scene-resolvable people", () => {
    const ids = new Set(chronicle.scene.people.map((p) => p.id));
    expect(ids.has("protagonist")).toBe(true);
    for (const entry of chronicle.entries) {
      expect(entry.at).toBeGreaterThanOrEqual(entry.year);
      expect(entry.at).toBeLessThan(entry.year + 1);
      for (const id of entry.who) expect(ids.has(id)).toBe(true);
    }
    expect(chronicle.scene.span.end).toBeCloseTo(chronicle.protagonist.deathYear, -1);
  });

  it("has a non-empty branches list, with the original branch labeled 'Original life'", () => {
    expect(chronicle.branches.length).toBeGreaterThan(0);
    expect(chronicle.branches.some((b) => b.label === "Original life")).toBe(true);
  });

  it("the LAST entry is the protagonist's death, and it is ALWAYS level 3 with 'survive' as a real alternative", () => {
    const last = chronicle.entries[chronicle.entries.length - 1]!;
    expect(last.kind).toBe("death");
    expect(last.level).toBe(3);
    expect(last.turn).toBeDefined();
    expect(last.turn!.chosen.optionId).toBe("die");
    expect(last.turn!.alternatives.some((o) => o.optionId === "survive")).toBe(true);
  });
});

// --- Fixture-based tests for behaviors that don't reliably occur in any given random seed --------

function fixturePeople(): { mother: Person; protagonist: Person } {
  const seed = "fixture";
  const motherMind = createMind(seed, "mom", 1470);
  const mother: Person = { id: "mom", name: "Mira Ashwell", sex: "f", birthYear: 1470, traits: [], job: "weaver", founder: true, mind: motherMind };
  const protagonistMind = createMind(seed, "protagonist", 1500, [motherMind]);
  const protagonist: Person = { id: "protagonist", name: "Elin Ashwell", sex: "f", birthYear: 1500, deathYear: 1560, traits: [], job: "farmer", motherId: "mom", founder: false, mind: protagonistMind };
  return { mother, protagonist };
}

function fixtureResult(): SimulationResult {
  const { mother, protagonist } = fixturePeople();
  const events: Event[] = [
    { id: "ev-birth", year: 1500, kind: "birth", actors: ["protagonist", "mom"], payload: {}, causes: [] },
    { id: "ev-ap1", year: 1510, kind: "reflection", actors: ["mom", "protagonist"], payload: { note: "apprenticed-to-family-trade", otherName: protagonist.name }, causes: [] },
    // An NPC-only event: NOT an actor the protagonist appears in — must never leak into the protagonist's chronicle.
    { id: "ev-npc-only", year: 1515, kind: "job", actors: ["mom"], payload: { job: "innkeeper" }, causes: [] },
    { id: "ev-death", year: 1560, kind: "death", actors: ["protagonist"], payload: { age: 60, cause: "old-age" }, causes: [] },
  ];
  const decisions: DecisionRecord[] = [
    {
      id: "AP1:mom-protagonist:1510",
      personId: "mom",
      partnerId: "protagonist",
      year: 1510,
      kind: "AP1",
      question: "My child is old enough for a trade. What do I decide for them?",
      options: [
        { id: "apprentice-own-trade", label: "Mira Ashwell apprentices Elin Ashwell to her own trade" },
        { id: "send-away", label: "Mira Ashwell sends Elin Ashwell elsewhere to apprentice" },
        { id: "keep-home", label: "Mira Ashwell keeps Elin Ashwell at home a while longer" },
      ],
      final: { "apprentice-own-trade": 0.5, "send-away": 0.3, "keep-home": 0.2 },
      noise: {},
      chosen: "apprentice-own-trade",
      fragility: 0.6,
      surprise: false,
      source: "rules",
      causes: [],
      resultingEventIds: ["ev-ap1"],
    },
    {
      id: "death:protagonist:1560",
      personId: "protagonist",
      year: 1560,
      kind: "death",
      question: "Do I survive this year?",
      options: [
        { id: "die", label: "Elin Ashwell dies" },
        { id: "survive", label: "Elin Ashwell survives" },
      ],
      final: { die: 0.35, survive: 0.65 },
      noise: {},
      chosen: "die",
      fragility: 999,
      surprise: false,
      source: "biology",
      causes: [],
      resultingEventIds: ["ev-death"],
    },
  ];
  return {
    config: { seed: "fixture", startYear: 1500, endYear: 1600, town: { name: "Testford" } },
    people: { mom: mother, protagonist },
    events,
    decisions,
  };
}

function fixtureSnapshots(result: SimulationResult): Map<number, import("@/domain/types").YearSnapshot> {
  const snapshots = new Map<number, import("@/domain/types").YearSnapshot>();
  for (let year = 1499; year <= 1560; year++) {
    snapshots.set(year, { year, people: result.people, events: result.events.filter((e) => e.year <= year), decisions: [] });
  }
  return snapshots;
}

describe("buildProvisionalTickEntries — live SSE ticks (incremental-simulation capability)", () => {
  it("scopes entries to exactly the requested year, not the whole timeline", async () => {
    const result = fixtureResult();
    const entries = await buildProvisionalTickEntries(
      "protagonist",
      1510,
      result.events,
      result.people,
      result.decisions,
      "f",
      result.config.seed,
      result.config.town.name,
      "en",
      deriveLifeScene({ seed: result.config.seed, people: result.people, events: result.events, protagonistId: "protagonist" }),
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]!.id).toBe("ev-ap1");
    expect(entries[0]!.year).toBe(1510);
    expect(entries[0]!.at).toBeGreaterThanOrEqual(1510);
    expect(entries[0]!.at).toBeLessThan(1511);
    expect(entries[0]!.who).toContain("protagonist");
  });

  it("a different year returns a different, non-overlapping entry set (triangulation)", async () => {
    const result = fixtureResult();
    const entries = await buildProvisionalTickEntries(
      "protagonist",
      1500,
      result.events,
      result.people,
      result.decisions,
      "f",
      result.config.seed,
      result.config.town.name,
      "en",
      deriveLifeScene({ seed: result.config.seed, people: result.people, events: result.events, protagonistId: "protagonist" }),
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]!.id).toBe("ev-birth");
  });
});

describe("buildLifeChronicle — NPC-decided turns are labeled (fixture)", () => {
  it("an NPC's decision ABOUT the protagonist (AP1) is decidedBy that NPC, not 'self' or 'chance'", async () => {
    const result = fixtureResult();
    const life = registerLife("fixture-npc-turn", "fixture-npc-branch", result.config, "Elin Ashwell", "f", result, fixtureSnapshots(result));
    try {
      const chronicleResult = await buildLifeChronicle(life.id, life.originalBranchId);
      expect(chronicleResult.data).toBeDefined();
      const entry = chronicleResult.data!.entries.find((e) => e.id === "ev-ap1");
      expect(entry).toBeDefined();
      expect(entry!.turn).toBeDefined();
      expect(entry!.turn!.deciderId).toBe("mom");
      expect(entry!.turn!.decidedBy).toBe("Mira Ashwell's choice");
    } finally {
      deleteLife(life.id);
    }
  });

  it("tick/chronicle entries only ever include events the protagonist is an actor in — an NPC-only event never appears", async () => {
    const result = fixtureResult();
    const life = registerLife("fixture-npc-only", "fixture-npc-only-branch", result.config, "Elin Ashwell", "f", result, fixtureSnapshots(result));
    try {
      const chronicleResult = await buildLifeChronicle(life.id, life.originalBranchId);
      expect(chronicleResult.data).toBeDefined();
      expect(chronicleResult.data!.entries.some((e) => e.id === "ev-npc-only")).toBe(false);
    } finally {
      deleteLife(life.id);
    }
  });

  // Decision 042 supersedes decision 040's period-summary machinery for the protagonist: with
  // `simulate.ts` now guaranteeing at least one event every year (a `D1` everyday-life vignette
  // when nothing else happened), a quiet multi-year gap can no longer occur for them, so no
  // "period" entry is ever produced here — see the year-coverage test below instead.

  it("no year of the protagonist's life is missing a chronicle entry, across many real simulated lives (decision 042)", async () => {
    for (let i = 0; i < 8; i++) {
      const { life, result } = await buildRealChronicle(`year-coverage-${i}`);
      try {
        expect(result.data).toBeDefined();
        const chronicle = result.data!;
        const years = new Set(chronicle.entries.map((e) => e.year));
        for (let year = chronicle.protagonist.birthYear; year <= chronicle.protagonist.deathYear; year++) {
          expect(years.has(year)).toBe(true);
        }
        expect(chronicle.entries.some((e) => e.kind === "period")).toBe(false);
      } finally {
        deleteLife(life.id);
      }
    }
  });
});

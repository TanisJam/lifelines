import { beforeAll, describe, expect, it } from "vitest";
import { RuleDecisionMaker } from "@/adapters/decision/rule-decision-maker";
import { forkWorld } from "./fork";
import { createMind } from "./mind";
import { gatherCandidatesForYear, simulate, type SimulateReport } from "./simulate";
import type { Override, Person, WorldConfig } from "./types";
import { validateOverride } from "./validate-override";
import { generateWorld } from "./worldgen";

// A protagonist-enabled world for tests: fewer founders, and the same generous lifespan cap the
// real /api/lives endpoint uses, so "the sim runs until death" is exercised for real.
function protagonistWorld(seed: string) {
  return generateWorld({ seed, startYear: 1500, endYear: 1600, founderCount: 10, protagonist: { name: "Testa", sex: "random" } });
}

async function runLife(seed: string): Promise<{ config: WorldConfig; report: SimulateReport }> {
  const { config, people, events } = protagonistWorld(seed);
  const report = await simulate(config, people, events, { decisionMaker: new RuleDecisionMaker(), engineSource: "rules", protagonistId: "protagonist" });
  return { config, report };
}

describe("protagonist-centric simulation (round 9, decision 034/035)", () => {
  let stopped: { config: WorldConfig; report: SimulateReport };

  beforeAll(async () => {
    stopped = await runLife("proto-stop");
  });

  it("stops the simulation the year the protagonist dies — no snapshot exists after it", () => {
    const protagonist = stopped.report.result.people.protagonist!;
    expect(protagonist.deathYear).toBeDefined();
    const lastSnapshotYear = Math.max(...stopped.report.snapshots.keys());
    expect(lastSnapshotYear).toBe(protagonist.deathYear);
  });

  it("does not simulate the whole configured 100-year span when the protagonist dies earlier", () => {
    const protagonist = stopped.report.result.people.protagonist!;
    // The world was generated with a 100-year safety-cap span; a real life essentially never runs
    // that long (see scripts/mortality-stats.ts), so this also proves the early-exit actually ran.
    expect(protagonist.deathYear!).toBeLessThan(stopped.config.endYear);
  });

  it("the protagonist's death event always carries a causeOfDeath code (never an NPC's death, which has none)", () => {
    const deathEvent = stopped.report.result.events.find((e) => e.kind === "death" && e.actors[0] === "protagonist");
    expect(deathEvent).toBeDefined();
    expect(typeof deathEvent!.payload.cause).toBe("string");

    const npcDeath = stopped.report.result.events.find((e) => e.kind === "death" && e.actors[0] !== "protagonist");
    if (npcDeath) expect(npcDeath.payload.cause).toBeUndefined();
  });

  it("without protagonistId, the general village simulation is completely unaffected (no death carries a cause, nothing stops early)", async () => {
    const { config, people, events } = protagonistWorld("proto-unaffected");
    const report = await simulate(config, people, events, { decisionMaker: new RuleDecisionMaker(), engineSource: "rules" });
    expect(Math.max(...report.snapshots.keys())).toBe(config.endYear);
    expect(report.result.events.every((e) => e.kind !== "death" || e.payload.cause === undefined)).toBe(true);
  });

  it("forking the protagonist's death (forcing 'survive') continues the life past the original death year", async () => {
    const { config, report } = stopped;
    const deathDecision = report.result.decisions.find((d) => d.kind === "death" && d.personId === "protagonist" && d.chosen === "die");
    expect(deathDecision).toBeDefined();

    const override: Override = { id: "ov-survive-protagonist", decisionId: deathDecision!.id, optionId: "survive" };
    const forked = await forkWorld(report.snapshots, override, new RuleDecisionMaker(), "rules", config, undefined, "protagonist");

    const person = forked.result.people.protagonist!;
    // Either they eventually died again, later — or they lived on to the safety cap.
    expect(person.deathYear === undefined || person.deathYear > deathDecision!.year).toBe(true);
    // The simulation kept running (more years were actually simulated) rather than stopping immediately.
    expect(Math.max(...forked.snapshots.keys())).toBeGreaterThan(deathDecision!.year);
  });

  it("validateOverride rejects a rewrite targeting a year before the protagonist's birth (immutable birth)", () => {
    const { config, people, events } = protagonistWorld("proto-birth-guard");
    // The protagonist's birthYear always equals the real config.startYear, so to isolate the
    // birth-immutability guard from the (separate) "outside the world's span" guard, widen the
    // span artificially here — the protagonist's own `birthYear` on `people` is unaffected.
    const widerConfig = { ...config, startYear: config.startYear - 10 };
    const override: Override = { id: "ov-before-birth", decisionId: `Y1:whoever:${config.startYear - 5}`, optionId: "encourage" };
    const result = validateOverride(override, people, events, config.seed, widerConfig, "protagonist");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/immutable|birth/i);
  });

  it("validateOverride does NOT reject on birth-year grounds alone for a decision at or after the birth year", () => {
    const { config, people, events } = protagonistWorld("proto-birth-ok");
    // Every living person gets a "death" candidate every year, including the protagonist's birth year.
    const override: Override = { id: "ov-at-birth-year", decisionId: `death:protagonist:${config.startYear}`, optionId: "survive" };
    const result = validateOverride(override, people, events, config.seed, config, "protagonist");
    expect(result.ok).toBe(true);
  });

  it("the protagonist-only extended catalog (e.g. C1, sibling rivalry) is gated strictly to protagonistId", () => {
    const seed = "catalog-gate";
    const protagonist: Person = { id: "protagonist", name: "Kid", sex: "f", birthYear: 1494, traits: [], job: "none", founder: false, motherId: "mom", mind: createMind(seed, "protagonist", 1494) };
    const sibling: Person = { id: "sib", name: "Sib", sex: "m", birthYear: 1493, traits: [], job: "none", founder: false, motherId: "mom", mind: createMind(seed, "sib", 1493) };
    const people = { protagonist, sib: sibling };

    const withProtagonist = gatherCandidatesForYear(1500, people, [], seed, "protagonist"); // protagonist is 6
    expect(withProtagonist.some((c) => c.kind === "C1" && c.personId === "protagonist")).toBe(true);

    const withoutProtagonistId = gatherCandidatesForYear(1500, people, [], seed);
    expect(withoutProtagonistId.some((c) => c.kind === "C1")).toBe(false);
  });

  it("AP1 (a parent's apprenticeship choice) is decided BY the parent, ABOUT the protagonist, at age 10", () => {
    const seed = "ap1-decider";
    const mother: Person = { id: "mom", name: "Mira", sex: "f", birthYear: 1470, traits: [], job: "weaver", founder: true, mind: createMind(seed, "mom", 1470) };
    const child: Person = { id: "protagonist", name: "Kid", sex: "m", birthYear: 1490, traits: [], job: "none", founder: false, motherId: "mom", mind: createMind(seed, "protagonist", 1490) };
    const people = { mom: mother, protagonist: child };

    const candidates = gatherCandidatesForYear(1500, people, [], seed, "protagonist"); // protagonist is 10
    const ap1 = candidates.find((c) => c.kind === "AP1");
    expect(ap1).toBeDefined();
    expect(ap1!.personId).toBe("mom");
    expect(ap1!.partnerId).toBe("protagonist");
  });

  it("the lord's levy is offered only to the protagonist, and never at all without protagonistId", () => {
    const seed = "levy-gate";
    const adult: Person = { id: "protagonist", name: "Adult", sex: "m", birthYear: 1470, traits: [], job: "farmer", founder: true, mind: createMind(seed, "protagonist", 1470) };
    const people = { protagonist: adult };

    let sawLevy = false;
    for (let year = 1500; year < 1560; year++) {
      if (gatherCandidatesForYear(year, people, [], seed, "protagonist").some((c) => c.kind === "levy")) sawLevy = true;
    }
    expect(sawLevy).toBe(true);

    let sawLevyWithoutProtagonistId = false;
    for (let year = 1500; year < 1560; year++) {
      if (gatherCandidatesForYear(year, people, [], seed).some((c) => c.kind === "levy")) sawLevyWithoutProtagonistId = true;
    }
    expect(sawLevyWithoutProtagonistId).toBe(false);
  });
});

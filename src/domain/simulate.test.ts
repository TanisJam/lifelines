import { describe, expect, it } from "vitest";
import { RuleDecisionMaker } from "@/adapters/decision/rule-decision-maker";
import { indexEventsById, walkCauses } from "./causality";
import { forkWorld } from "./fork";
import { simulate } from "./simulate";
import type { Override } from "./types";
import { generateWorld } from "./worldgen";

// A small, fast world for tests: fewer founders, fewer years than the MVP default.
function testWorld(seed: string) {
  return generateWorld({ seed, startYear: 1500, endYear: 1530, founderCount: 10 });
}

function run(seed: string) {
  const { config, people } = testWorld(seed);
  return simulate(config, people, [], { decisionMaker: new RuleDecisionMaker(), engineSource: "rules" });
}

describe("determinism", () => {
  it("produces an identical event log and decision log for the same seed", async () => {
    const reportA = await run("acorn");
    const reportB = await run("acorn");

    expect(reportA.result.events).toEqual(reportB.result.events);
    expect(reportA.result.people).toEqual(reportB.result.people);
    expect(reportA.result.decisions).toEqual(reportB.result.decisions);
  });

  it("produces a different event log for a different seed", async () => {
    const reportA = await run("acorn");
    const reportB = await run("birch");

    expect(reportA.result.events.length === reportB.result.events.length && JSON.stringify(reportA.result.people) === JSON.stringify(reportB.result.people)).toBe(false);
  });
});

describe("forking with the generic override", () => {
  it("re-choosing the SAME option a decision already landed on leaves the future identical (a true no-op)", async () => {
    const base = await run("cedar");

    const deathDecision = base.result.decisions.find((d) => d.kind === "death" && d.chosen === "survive");
    expect(deathDecision).toBeDefined();

    const override: Override = { id: "ov-noop", decisionId: deathDecision!.id, optionId: "survive" };
    const forked = await forkWorld(base.snapshots, override, new RuleDecisionMaker(), "rules", base.result.config);

    expect(forked.result.events).toEqual(base.result.events);
  });

  it("forcing a different option at a real decision leaves the timeline before it unchanged and diverges after", async () => {
    const base = await run("dogwood");

    // Find a "Y1" (courtship offer) decision that was declined, and force it to "encourage" instead.
    const declined = base.result.decisions.find((d) => d.kind === "Y1" && d.chosen === "decline");
    expect(declined).toBeDefined();
    const forkYear = declined!.year;

    const override: Override = { id: "ov-accept", decisionId: declined!.id, optionId: "encourage" };
    const forked = await forkWorld(base.snapshots, override, new RuleDecisionMaker(), "rules", base.result.config);

    const beforeBase = base.result.events.filter((e) => e.year < forkYear);
    const beforeForked = forked.result.events.filter((e) => e.year < forkYear);
    expect(beforeForked).toEqual(beforeBase);

    // The forced romance itself must appear at the fork year.
    const forcedRomance = forked.result.events.find((e) => e.kind === "romance" && e.year === forkYear && e.actors.includes(declined!.personId));
    expect(forcedRomance).toBeDefined();

    const afterBase = JSON.stringify(base.result.events.filter((e) => e.year >= forkYear));
    const afterForked = JSON.stringify(forked.result.events.filter((e) => e.year >= forkYear));
    expect(afterBase).not.toEqual(afterForked);
  });

  it("forcing 'survive' at a death decision that would otherwise have killed someone changes their fate (prevent-death via the generic override)", async () => {
    const base = await run("elm");

    const fatalDeath = base.result.decisions.find((d) => d.kind === "death" && d.chosen === "die");
    if (!fatalDeath) return; // small deterministic worlds occasionally have nobody die; that's fine, skip.

    const override: Override = { id: "ov-survive", decisionId: fatalDeath.id, optionId: "survive" };
    const forked = await forkWorld(base.snapshots, override, new RuleDecisionMaker(), "rules", base.result.config);

    const person = forked.result.people[fatalDeath.personId];
    expect(person).toBeDefined();
    expect(person!.deathYear === undefined || person!.deathYear > fatalDeath.year).toBe(true);
  });

  it("leaves at least some unrelated people unaffected when there is no causal path to them", async () => {
    const base = await run("fir2");

    const declined = base.result.decisions.find((d) => d.kind === "Y1" && d.chosen === "decline");
    expect(declined).toBeDefined();

    const override: Override = { id: "ov-accept-2", decisionId: declined!.id, optionId: "encourage" };
    const forked = await forkWorld(base.snapshots, override, new RuleDecisionMaker(), "rules", base.result.config);

    const unaffectedCount = Object.keys(base.result.people).filter((id) => {
      if (id === declined!.personId) return false;
      const before = base.result.people[id];
      const after = forked.result.people[id];
      if (!after) return false;
      return before!.job === after.job && before!.deathYear === after.deathYear && before!.spouseId === after.spouseId;
    }).length;

    expect(unaffectedCount).toBeGreaterThan(0);
  });
});

describe("population", () => {
  it("produces births across multiple generations over a full-length run under the rules engine", async () => {
    const { config, people } = generateWorld({ seed: "generations-check" });
    const startCount = Object.keys(people).length;
    const report = await simulate(config, people, [], { decisionMaker: new RuleDecisionMaker(), engineSource: "rules" });

    const births = report.result.events.filter((e) => e.kind === "birth");
    expect(births.length).toBeGreaterThan(0);

    const birthDecades = new Set(births.map((e) => Math.floor(e.year / 10) * 10));
    expect(birthDecades.size).toBeGreaterThan(1);

    const endCount = Object.keys(report.result.people).length;
    expect(endCount).toBeGreaterThan(startCount);
    const aliveAtEnd = Object.values(report.result.people).filter((p) => p.deathYear === undefined).length;
    expect(aliveAtEnd).toBeGreaterThan(0);
  });
});

describe("decision records", () => {
  it("records a DecisionRecord for every event that has a resulting decision, with a valid fragility/surprise and chosen option", async () => {
    const report = await run("holly");
    expect(report.result.decisions.length).toBeGreaterThan(0);

    for (const decision of report.result.decisions) {
      expect(decision.options.some((o) => o.id === decision.chosen)).toBe(true);
      expect(decision.fragility).toBeGreaterThanOrEqual(0);
      expect(typeof decision.surprise).toBe("boolean");
      expect(Object.keys(decision.final).length).toBeGreaterThan(0);
    }
  });

  it("does not record a biology decision when it was a near-certainty and nothing happened (recording threshold)", async () => {
    const report = await run("ivy");
    // A healthy adult's illness decision has p well under 5%; if it didn't fire, it shouldn't be recorded.
    const trivialSurvivedIllness = report.result.decisions.find((d) => d.kind === "illness" && d.chosen === "healthy" && d.final.illness! < 0.05);
    expect(trivialSurvivedIllness).toBeUndefined();
  });
});

describe("causality", () => {
  it("the causes chain is walkable back to root events", async () => {
    const base = await run("juniper");

    const marriage = base.result.events.find((e) => e.kind === "marriage" && e.causes.length > 0);
    if (!marriage) return;

    const eventsById = indexEventsById(base.result.events);
    const node = walkCauses(marriage.id, eventsById);
    expect(node).toBeDefined();
    expect(node!.event.id).toBe(marriage.id);
    expect(node!.causes.length).toBeGreaterThan(0);
    for (const cause of node!.causes) {
      expect(eventsById.has(cause.event.id)).toBe(true);
    }
  });
});

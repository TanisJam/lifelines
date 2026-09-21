import { describe, expect, it } from "vitest";
import { RuleDecisionMaker } from "@/adapters/decision/rule-decision-maker";
import type { DecisionMaker, DecisionQuestion, Distribution, PersonYearBatch, PersonYearResult } from "./decisions";
import { simulate } from "./simulate";
import { generateWorld } from "./worldgen";

/** Wraps a real `DecisionMaker` and counts how many times each port method is invoked, so tests can assert on call shape without a real network. */
class SpyDecisionMaker implements DecisionMaker {
  decideCalls = 0;
  decideYearCalls: PersonYearBatch[] = [];

  constructor(private readonly inner: RuleDecisionMaker) {}

  async decide(question: DecisionQuestion): Promise<Distribution> {
    this.decideCalls += 1;
    return this.inner.decide(question);
  }

  async decideYear(batch: PersonYearBatch): Promise<PersonYearResult> {
    this.decideYearCalls.push(batch);
    return this.inner.decideYear(batch);
  }
}

const PROTAGONIST_ID = "protagonist";

function protagonistWorld(seed: string) {
  return generateWorld({ seed, startYear: 1500, endYear: 1560, founderCount: 12, protagonist: { name: "Lucia", sex: "f" } });
}

describe("simulate() — round 11 batched person-year decisions (decision 044)", () => {
  it("asks at most one decideYear request per person per year, never falling back to decide()", async () => {
    const { config, people, events } = protagonistWorld("batch-1");
    const spy = new SpyDecisionMaker(new RuleDecisionMaker());
    const report = await simulate(config, people, events, { decisionMaker: spy, engineSource: "rules", protagonistId: PROTAGONIST_ID });

    expect(spy.decideCalls).toBe(0); // the batched path is used throughout, never the legacy per-candidate fallback
    expect(report.result.people[PROTAGONIST_ID]).toBeDefined();

    // Every recorded batch is for a distinct (personId, year) pair — i.e. never two requests for
    // the same person in the same year.
    const seen = new Set<string>();
    for (const batch of spy.decideYearCalls) {
      const key = `${batch.personId}:${batch.year}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it("gives the protagonist at least one event every year of their simulated life", async () => {
    const { config, people, events: initialEvents } = protagonistWorld("batch-2");
    const report = await simulate(config, people, initialEvents, { decisionMaker: new RuleDecisionMaker(), engineSource: "rules", protagonistId: PROTAGONIST_ID });
    const protagonist = report.result.people[PROTAGONIST_ID]!;
    const lastYear = protagonist.deathYear ?? config.endYear;

    const eventYears = new Set(report.result.events.filter((e) => e.actors.includes(PROTAGONIST_ID)).map((e) => e.year));
    for (let year = protagonist.birthYear; year <= lastYear; year++) {
      expect(eventYears.has(year)).toBe(true);
    }
  });

  it("lets several situations occur for the same person in the same year", async () => {
    const { config, people, events: initialEvents } = protagonistWorld("batch-3");
    const report = await simulate(config, people, initialEvents, { decisionMaker: new RuleDecisionMaker(), engineSource: "rules", protagonistId: PROTAGONIST_ID });
    const byPersonYear = new Map<string, number>();
    for (const e of report.result.events) {
      for (const actor of e.actors) {
        const key = `${actor}:${e.year}`;
        byPersonYear.set(key, (byPersonYear.get(key) ?? 0) + 1);
      }
    }
    const someoneHadMultipleEventsInOneYear = Array.from(byPersonYear.values()).some((count) => count > 1);
    expect(someoneHadMultipleEventsInOneYear).toBe(true);
  });

  it("records an occurrence probability on batched social decisions, deterministically across repeated runs with the same seed", async () => {
    const world1 = protagonistWorld("batch-4");
    const world2 = protagonistWorld("batch-4");
    const report1 = await simulate(world1.config, world1.people, world1.events, { decisionMaker: new RuleDecisionMaker(), engineSource: "rules", protagonistId: PROTAGONIST_ID });
    const report2 = await simulate(world2.config, world2.people, world2.events, { decisionMaker: new RuleDecisionMaker(), engineSource: "rules", protagonistId: PROTAGONIST_ID });

    const withOccurrence1 = report1.result.decisions.filter((d) => d.occurrenceProbability !== undefined);
    const withOccurrence2 = report2.result.decisions.filter((d) => d.occurrenceProbability !== undefined);
    expect(withOccurrence1.length).toBeGreaterThan(0);
    expect(withOccurrence1.map((d) => [d.id, d.occurrenceProbability])).toEqual(withOccurrence2.map((d) => [d.id, d.occurrenceProbability]));
  });

  it("a fork reuses the cache for unchanged person-years: replaying the same batch twice through JevDecisionMaker-style caching makes no second request", async () => {
    const { config, people, events: initialEvents } = protagonistWorld("batch-5");
    const spy = new SpyDecisionMaker(new RuleDecisionMaker());
    await simulate(config, people, initialEvents, { decisionMaker: spy, engineSource: "rules", protagonistId: PROTAGONIST_ID, fromYear: config.startYear });
    const firstRunBatches = spy.decideYearCalls.length;

    // Re-simulating from the SAME starting snapshot (as a fork that changes nothing would) should
    // gather the exact same person-year batches — the cache itself is `JevDecisionMaker`'s
    // responsibility (proven in jev-decision-maker.test.ts's cache test); this proves the domain
    // layer asks for the SAME batches again, which is what makes that cache effective on a fork.
    const spy2 = new SpyDecisionMaker(new RuleDecisionMaker());
    await simulate(config, people, initialEvents, { decisionMaker: spy2, engineSource: "rules", protagonistId: PROTAGONIST_ID, fromYear: config.startYear });
    expect(spy2.decideYearCalls.length).toBe(firstRunBatches);
    expect(spy2.decideYearCalls.map((b) => `${b.personId}:${b.year}:${Object.keys(b.situations).sort().join(",")}`)).toEqual(
      spy.decideYearCalls.map((b) => `${b.personId}:${b.year}:${Object.keys(b.situations).sort().join(",")}`),
    );
  });
});

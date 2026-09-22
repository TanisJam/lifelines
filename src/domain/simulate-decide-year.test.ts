import { describe, expect, it } from "vitest";
import { RuleDecisionMaker } from "@/adapters/decision/rule-decision-maker";
import { isRealTurn } from "./chronicle-view";
import { decisionSubject } from "./decision-id";
import type { DecisionMaker, DecisionMakerStats, DecisionQuestion, Distribution, PersonYearBatch, PersonYearResult } from "./decisions";
import { normalizeDistribution } from "./rng";
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

/** Answers every `resp:<id>` uniformly; never rolls dice itself (a DecisionMaker never does — see decisions.ts). */
function uniformResponse(situations: PersonYearBatch["situations"]): Record<string, Distribution> {
  const response: Record<string, Distribution> = {};
  for (const [id, situation] of Object.entries(situations)) {
    response[id] = normalizeDistribution(Object.fromEntries(situation.question.options.map((o) => [o, 1])));
  }
  return response;
}

/**
 * Round 12 (decision 045): a `decideYear` whose `selection` ALWAYS puts every weight on `"nothing"`
 * — the adapter never offers/picks any real candidate for a non-protagonist person-year. The
 * protagonist never gets a `"nothing"` option at all (see `PersonYearBatch.isProtagonist`), so for
 * them this always selects their `D1` daily-life candidate instead (the one guaranteed-present id),
 * keeping this stub focused on testing the NPC gate, not the separate protagonist-guarantee test below.
 */
class AlwaysNothingDecisionMaker implements DecisionMaker {
  async decide(question: DecisionQuestion): Promise<Distribution> {
    return normalizeDistribution(Object.fromEntries(question.options.map((o) => [o, 1])));
  }

  async decideYear(batch: PersonYearBatch): Promise<PersonYearResult> {
    const response = uniformResponse(batch.situations);
    if (!batch.isProtagonist) return { selection: { nothing: 1 }, response };
    const d1Id = Object.keys(batch.situations).find((id) => id.startsWith("D1:"));
    return { selection: d1Id ? { [d1Id]: 1 } : {}, response };
  }

  getStats(): DecisionMakerStats {
    return { calls: 0, cacheHits: 0, wallTimeMs: 0 };
  }
}

/**
 * Round 12 (decision 045): a `decideYear` that NEVER offers `"nothing"` and always puts (almost)
 * all its weight on one deterministically-picked situation id per batch — records every pick so the
 * test can assert exactly that candidate (and no other candidate in the same batch) actually fired.
 */
class RecordingSelectorDecisionMaker implements DecisionMaker {
  readonly picks: { personId: string; year: number; selectedId: string; allIds: string[] }[] = [];

  async decide(question: DecisionQuestion): Promise<Distribution> {
    return normalizeDistribution(Object.fromEntries(question.options.map((o) => [o, 1])));
  }

  async decideYear(batch: PersonYearBatch): Promise<PersonYearResult> {
    const response = uniformResponse(batch.situations);
    const ids = Object.keys(batch.situations);
    if (ids.length === 0) return { selection: {}, response };
    const selectedId = ids.slice().sort()[0]!;
    const selection: Record<string, number> = {};
    for (const id of ids) selection[id] = id === selectedId ? 1 : 1e-12;
    this.picks.push({ personId: batch.personId, year: batch.year, selectedId, allIds: ids });
    return { selection, response };
  }

  getStats(): DecisionMakerStats {
    return { calls: 0, cacheHits: 0, wallTimeMs: 0 };
  }
}

function villageWorld(seed: string) {
  return generateWorld({ seed, startYear: 1500, endYear: 1545, founderCount: 16 });
}

describe("event-selection gating (decision 045) — no social situation without going through it", () => {
  // Kinds that can ONLY come from a resolved social decision (never from biology, a world event, or
  // the deterministic `school`/`town` code paths) — used to prove nothing social slipped through.
  const SOCIAL_ONLY_EVENT_KINDS = new Set(["birth", "job", "romance", "marriage", "breakup", "feud", "reconciliation", "child", "breakdown", "dream", "reflection"]);

  it("an adapter whose selection is ALWAYS \"nothing\" produces zero NPC social events for the whole run", async () => {
    const { config, people, events } = villageWorld("gate-nothing");
    const report = await simulate(config, people, events, { decisionMaker: new AlwaysNothingDecisionMaker(), engineSource: "jev" });

    // Founder couples carry a synthesized pre-simulation backstory (`payload.backfilled`, years
    // before `config.startYear`) — real history, but never gated by `decideYear` at all, so it's
    // excluded here to isolate what the SIMULATION LOOP itself produced.
    const socialEvents = report.result.events.filter((e) => SOCIAL_ONLY_EVENT_KINDS.has(e.kind) && e.year >= config.startYear);
    expect(socialEvents.length).toBe(0);

    // Biology (illness/death/immigration) is untouched by the selection gate — the village should
    // still show basic demographic churn, proving the empty social log isn't just a broken world.
    expect(report.result.events.some((e) => e.kind === "death")).toBe(true);
  });

  it("an adapter that NEVER offers \"nothing\" and always selects one given candidate produces exactly that candidate — not any other eligible one in the same person-year", async () => {
    const { config, people, events } = villageWorld("gate-selects-one");
    const maker = new RecordingSelectorDecisionMaker();
    const report = await simulate(config, people, events, { decisionMaker: maker, engineSource: "jev" });

    const contested = maker.picks.filter((p) => p.allIds.length >= 2);
    expect(contested.length).toBeGreaterThan(0); // the world actually produced a real choice at some point

    // Decision-identity capability: `batch.situations`' keys are `decideYear`'s own internal,
    // within-batch bookkeeping ids (never persisted — see `simulate.ts#mintId`/`commitId`), distinct
    // from the `DecisionRecord.id` the engine actually mints and stores. Correlate by
    // `(kind, personId, year)` instead — unique per candidate, by the same one-candidate-per-kind-
    // per-person-per-year invariant `decideYear`'s own batching relies on.
    const decisionsByKey = new Map<string, (typeof report.result.decisions)[number]>(report.result.decisions.map((d) => [`${d.kind}:${d.personId}:${d.year}`, d]));
    const keyFor = (pick: { personId: string; year: number }, situationId: string): string => `${decisionSubject(situationId).kind}:${pick.personId}:${pick.year}`;
    for (const pick of contested) {
      const winner = decisionsByKey.get(keyFor(pick, pick.selectedId));
      expect(winner?.occurrenceProbability).toBeDefined();

      for (const loserId of pick.allIds) {
        if (loserId === pick.selectedId) continue;
        const loser = decisionsByKey.get(keyFor(pick, loserId));
        if (!loser) continue; // e.g. throttled by LIFE_DECISION_BUDGET — not part of this batch's contest
        expect(loser.occurrenceProbability).toBeUndefined();
        expect(loser.resultingEventIds.length).toBe(0);
      }
    }
  });
});

describe("protagonist event-selection is a genuine Gumbel-max SAMPLE, not argmax (decision 045)", () => {
  const PROTAGONIST_ID = "protagonist";
  function protagonistWorld(seed: string) {
    return generateWorld({ seed, startYear: 1500, endYear: 1560, founderCount: 12, protagonist: { name: "Lucia", sex: "f" } });
  }

  it("D1 (the lower-weighted rules-engine candidate) still sometimes wins a contested year against a higher-weighted alternative — impossible under plain argmax(weight)", async () => {
    const { config, people, events } = protagonistWorld("gumbel-sample-1");
    const report = await simulate(config, people, events, { decisionMaker: new RuleDecisionMaker(), engineSource: "rules", protagonistId: PROTAGONIST_ID });

    const ownDecisions = report.result.decisions.filter((d) => d.personId === PROTAGONIST_ID);
    const byYear = new Map<number, typeof ownDecisions>();
    for (const d of ownDecisions) byYear.set(d.year, [...(byYear.get(d.year) ?? []), d]);

    // RuleDecisionMaker's offline heuristic weighs D1 at 0.3 vs 0.85 for every other kind (see
    // `ruleSelectionWeight`) — under pure argmax(weight), D1 could NEVER win a year where a 0.85
    // alternative was also eligible. Gumbel-max noise can and (given enough years) does flip that.
    let contestedD1Win = false;
    for (const decisionsThisYear of byYear.values()) {
      const hasNonD1 = decisionsThisYear.some((d) => d.kind !== "D1");
      const d1Win = decisionsThisYear.find((d) => d.kind === "D1" && d.occurrenceProbability !== undefined);
      if (hasNonD1 && d1Win) contestedD1Win = true;
    }
    expect(contestedD1Win).toBe(true);
  });

  it("is deterministic given the seed: an identical re-run selects exactly the same winner every person-year", async () => {
    const world1 = protagonistWorld("gumbel-determinism");
    const world2 = protagonistWorld("gumbel-determinism");
    const report1 = await simulate(world1.config, world1.people, world1.events, { decisionMaker: new RuleDecisionMaker(), engineSource: "rules", protagonistId: PROTAGONIST_ID });
    const report2 = await simulate(world2.config, world2.people, world2.events, { decisionMaker: new RuleDecisionMaker(), engineSource: "rules", protagonistId: PROTAGONIST_ID });

    const winners = (decisions: typeof report1.result.decisions) => decisions.filter((d) => d.occurrenceProbability !== undefined).map((d) => `${d.id}:${d.occurrenceProbability}`);
    expect(winners(report1.result.decisions)).toEqual(winners(report2.result.decisions));
    expect(winners(report1.result.decisions).length).toBeGreaterThan(0);
  });

  it("hierarchical vignette selection is deterministic given the seed: identical re-runs pick the exact same vignette (and outcome) every year", async () => {
    // Decision 050 reseeded this from "hier-determinism": that seed's protagonist died at age 0 under
    // the recalibrated actuarial table (a founder child created at literal age 0, immediately hit by
    // the new age<2 death band), producing zero vignette events. "hier-determinism-5" survives to 58.
    const world1 = protagonistWorld("hier-determinism-5");
    const world2 = protagonistWorld("hier-determinism-5");
    const report1 = await simulate(world1.config, world1.people, world1.events, { decisionMaker: new RuleDecisionMaker(), engineSource: "rules", protagonistId: PROTAGONIST_ID });
    const report2 = await simulate(world2.config, world2.people, world2.events, { decisionMaker: new RuleDecisionMaker(), engineSource: "rules", protagonistId: PROTAGONIST_ID });

    const vignettes = (events: typeof report1.result.events) => events.filter((e) => e.kind === "vignette").map((e) => `${e.year}:${e.payload.vignette}:${e.payload.outcome}`);
    expect(vignettes(report1.result.events)).toEqual(vignettes(report2.result.events));
    expect(vignettes(report1.result.events).length).toBeGreaterThan(0);
  });
});

describe("hierarchical event selection (decision 046) — the vignette-pick is consumed only when 'everyday' wins the top-level pick", () => {
  /**
   * Deterministically alternates the top-level pick by year parity: even years put ALL weight on
   * the aggregate `"everyday"` option, odd years put it on the real (non-D1) candidates instead —
   * `vignetteSelection` always favors the same (alphabetically first) vignette candidate regardless,
   * so a wrong-year consumption (using the vignette-pick winner on an ODD year, when a real situation
   * won instead) would be easy to catch as a spurious `occurrenceProbability` on that year's `D1`.
   */
  class AlternatingDecisionMaker implements DecisionMaker {
    async decide(question: DecisionQuestion): Promise<Distribution> {
      return normalizeDistribution(Object.fromEntries(question.options.map((o) => [o, 1])));
    }

    async decideYear(batch: PersonYearBatch): Promise<PersonYearResult> {
      const response = uniformResponse(batch.situations);
      const d1Ids = Object.keys(batch.situations)
        .filter((id) => batch.situations[id]!.kind === "D1")
        .sort();
      const nonD1Ids = Object.keys(batch.situations).filter((id) => batch.situations[id]!.kind !== "D1");
      const vignetteSelection: Record<string, number> = {};
      for (const id of d1Ids) vignetteSelection[id] = id === d1Ids[0] ? 1 : 1e-9;
      const wantsEveryday = batch.year % 2 === 0;
      const selection: Record<string, number> = {};
      if (wantsEveryday && d1Ids.length > 0) selection.everyday = 1;
      else for (const id of nonD1Ids) selection[id] = 1;
      return { selection, vignetteSelection, response };
    }

    getStats(): DecisionMakerStats {
      return { calls: 0, cacheHits: 0, wallTimeMs: 0 };
    }
  }

  it("only sets occurrenceProbability on a D1 decision in years the top-level pick actually chose 'everyday'", async () => {
    const { config, people, events } = protagonistWorld("hier-consume-1");
    const report = await simulate(config, people, events, { decisionMaker: new AlternatingDecisionMaker(), engineSource: "jev", protagonistId: PROTAGONIST_ID });
    const d1Decisions = report.result.decisions.filter((d) => d.kind === "D1");
    const withOccurrence = d1Decisions.filter((d) => d.occurrenceProbability !== undefined);
    expect(withOccurrence.length).toBeGreaterThan(0); // "everyday" did win at least one (even) year
    for (const d of withOccurrence) expect(d.year % 2).toBe(0);
  });
});

describe("protagonist 'nothing happens' choices still produce a chronicle event (decision 047)", () => {
  /**
   * The `note` values decision 047 added for each social kind's no-op option(s) — declining,
   * waiting, staying put, and so on. Kept in sync with the branches added in `simulate.ts`'s big
   * social-decision switch. A5 is special: NONE of its three options ever pushed an event (for
   * anyone), so every option is a "no-op" there.
   */
  const NOOP_OPTIONS: Record<string, readonly string[]> = {
    Y1: ["decline", "wait"],
    A1: ["delay"],
    A3: ["pass", "ignore"],
    A2: ["wait", "refuse"],
    Y4: ["forgive", "nurse-it"],
    A6: ["feud"],
    Y3: ["stay"],
    A5: ["help", "flee", "profit"],
  };

  /**
   * Every response distribution is uniform across that situation's own options (`uniformResponse`,
   * already used above for decision 046's tests) — with 2-4 options that keeps every chosen
   * option's own probability well under 0.9, so `isRealTurn` reads every resulting decision as a
   * real turn regardless of WHICH option a given deterministic Gumbel-max draw happens to land on.
   * `selection` always puts full weight on the first (sorted) non-D1 eligible situation, so a real
   * situation — never "everyday" or "nothing" — is what's selected whenever one is eligible.
   */
  class UniformSocialDecisionMaker implements DecisionMaker {
    async decide(question: DecisionQuestion): Promise<Distribution> {
      return normalizeDistribution(Object.fromEntries(question.options.map((o) => [o, 1])));
    }

    async decideYear(batch: PersonYearBatch): Promise<PersonYearResult> {
      const response = uniformResponse(batch.situations);
      const nonD1Ids = Object.keys(batch.situations)
        .filter((id) => batch.situations[id]!.kind !== "D1")
        .sort();
      const d1Ids = Object.keys(batch.situations).filter((id) => batch.situations[id]!.kind === "D1");
      const selection: Record<string, number> = {};
      if (nonD1Ids.length > 0) selection[nonD1Ids[0]!] = 1;
      else if (d1Ids.length > 0) selection.everyday = 1;
      else selection.nothing = 1;
      const vignetteSelection: Record<string, number> = {};
      for (const id of d1Ids) vignetteSelection[id] = 1;
      return { selection, vignetteSelection, response };
    }

    getStats(): DecisionMakerStats {
      return { calls: 0, cacheHits: 0, wallTimeMs: 0 };
    }
  }

  it("the protagonist's no-op choices get a real event and still read as a real turn", async () => {
    // Decision 050 reseeded this from "noop-turn-1": that seed's protagonist was a founder child
    // created at literal age 0 (worldgen's `makeChild`, still growing up at world start) who then hit
    // the recalibrated age<2 death band immediately — surviving zero years, before ever reaching a
    // social decision. "noop-turn-4" survives to age 56 under the same recalibrated table, giving the
    // scenario the decades of adult life its "at least one no-op branch" assertion actually needs.
    const { config, people, events } = protagonistWorld("noop-turn-4");
    const report = await simulate(config, people, events, { decisionMaker: new UniformSocialDecisionMaker(), engineSource: "rules", protagonistId: PROTAGONIST_ID });
    const noOpMatches = report.result.decisions.filter(
      (d) => d.personId === PROTAGONIST_ID && d.occurrenceProbability !== undefined && (NOOP_OPTIONS[d.kind] ?? []).includes(d.chosen),
    );
    expect(noOpMatches.length).toBeGreaterThan(0); // the scenario actually exercises at least one no-op branch
    for (const d of noOpMatches) {
      expect(d.resultingEventIds.length).toBeGreaterThan(0);
      expect(isRealTurn(d)).toBe(true);
    }
  });

  it("an NPC's no-op choice still produces no event (only the protagonist gets the decision-047 backfill)", async () => {
    const { config, people, events } = generateWorld({ seed: "noop-npc-1", startYear: 1500, endYear: 1540, founderCount: 12 });
    const report = await simulate(config, people, events, { decisionMaker: new UniformSocialDecisionMaker(), engineSource: "rules" });
    const noOpMatches = report.result.decisions.filter((d) => d.occurrenceProbability !== undefined && (NOOP_OPTIONS[d.kind] ?? []).includes(d.chosen));
    expect(noOpMatches.length).toBeGreaterThan(0);
    for (const d of noOpMatches) expect(d.resultingEventIds.length).toBe(0);
  });

  it("the D1 backstop does not fire in a year a real situation was selected for the protagonist", async () => {
    // Decision 050: reseeded to "noop-turn-4" — see the previous test's comment.
    const { config, people, events } = protagonistWorld("noop-turn-4");
    const report = await simulate(config, people, events, { decisionMaker: new UniformSocialDecisionMaker(), engineSource: "rules", protagonistId: PROTAGONIST_ID });
    const selectedYears = new Set(
      report.result.decisions.filter((d) => d.personId === PROTAGONIST_ID && d.kind !== "D1" && d.occurrenceProbability !== undefined).map((d) => d.year),
    );
    expect(selectedYears.size).toBeGreaterThan(0);
    const d1Years = new Set(report.result.decisions.filter((d) => d.kind === "D1").map((d) => d.year));
    for (const year of selectedYears) expect(d1Years.has(year)).toBe(false);
  });
});

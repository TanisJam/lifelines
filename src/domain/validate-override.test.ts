import { describe, expect, it } from "vitest";
import { RuleDecisionMaker } from "@/adapters/decision/rule-decision-maker";
import { pairKey } from "./events";
import { createMind } from "./mind";
import { gatherCandidatesForYear, simulate } from "./simulate";
import type { Override, Person } from "./types";
import { validateOverride } from "./validate-override";
import { generateWorld } from "./worldgen";

async function runSmallWorld(seed: string) {
  const { config, people } = generateWorld({ seed, startYear: 1500, endYear: 1530, founderCount: 10 });
  const report = await simulate(config, people, [], { decisionMaker: new RuleDecisionMaker(), engineSource: "rules" });
  return { config, report };
}

describe("validateOverride", () => {
  it("accepts a real decision from the base branch with one of its real options, given its own year explicitly (no id parsing)", async () => {
    const { config, report } = await runSmallWorld("validate-a");
    const decision = report.result.decisions[0]!;
    // Validation runs against the state one year before the decision, so use the snapshot restored there.
    const snapshot = report.snapshots.get(decision.year - 1)!;
    const override: Override = { id: "o1", decisionId: decision.id, optionId: decision.options[0]!.id };
    const result = validateOverride(override, snapshot.people, snapshot.events, decision.year, config.seed, config);
    expect(result.ok).toBe(true);
  });

  it("rejects an option that isn't one of the decision's real options", async () => {
    const { config, report } = await runSmallWorld("validate-b");
    const decision = report.result.decisions[0]!;
    const snapshot = report.snapshots.get(decision.year - 1)!;
    const override: Override = { id: "o2", decisionId: decision.id, optionId: "not-a-real-option" };
    const result = validateOverride(override, snapshot.people, snapshot.events, decision.year, config.seed, config);
    expect(result.ok).toBe(false);
  });

  it("rejects a decision id that never existed (targets someone already dead)", async () => {
    const { config, report } = await runSmallWorld("validate-c");
    const death = report.result.decisions.find((d) => d.kind === "death" && d.chosen === "die");
    if (!death) return; // no deaths in this small deterministic world; skip.
    // A death decision the YEAR AFTER they died can't exist — they're no longer alive to face it.
    const decisionId = `death:${death.personId}:${death.year + 1}`;
    const snapshot = report.snapshots.get(death.year)!; // state right after they died
    const override: Override = { id: "o3", decisionId, optionId: "survive" };
    const result = validateOverride(override, snapshot.people, snapshot.events, death.year + 1, config.seed, config);
    expect(result.ok).toBe(false);
  });

  it("rejects a year outside the world's span", async () => {
    const { config, report } = await runSmallWorld("validate-d");
    const snapshot = report.snapshots.get(config.startYear)!;
    const override: Override = { id: "o4", decisionId: `death:p001:${config.endYear + 50}`, optionId: "survive" };
    const result = validateOverride(override, snapshot.people, snapshot.events, config.endYear + 50, config.seed, config);
    expect(result.ok).toBe(false);
  });

  it("rejects a decision id whose kind never appears as a candidate at all (nothing to match)", async () => {
    const { config, report } = await runSmallWorld("validate-e");
    const snapshot = report.snapshots.get(config.startYear)!;
    const override: Override = { id: "o5", decisionId: "not-a-real-kind:p001#1.1", optionId: "x" };
    const result = validateOverride(override, snapshot.people, snapshot.events, config.startYear, config.seed, config);
    expect(result.ok).toBe(false);
  });

  it("matches a LEGACY year-embedded override id (kind:subject:year) against a candidate by (kind, subject), not exact id string", async () => {
    const { config, report } = await runSmallWorld("validate-legacy");
    const decision = report.result.decisions[0]!;
    const snapshot = report.snapshots.get(decision.year - 1)!;
    // Simulate a stored-life override built under the OLD scheme, referencing this same decision by
    // its (kind, subject) but with a year-embedded id string that the engine never actually minted.
    const legacyId = `${decision.kind}:${decision.personId}:${decision.year}`;
    const override: Override = { id: "o6", decisionId: legacyId, optionId: decision.options[0]!.id };
    const result = validateOverride(override, snapshot.people, snapshot.events, decision.year, config.seed, config);
    expect(result.ok).toBe(true);
  });

  it("matches a LEGACY paired-kind override id (kind:pairKey:year, e.g. Y1) against its candidate by (kind, personId, partnerId), not by the literal pairKey subject string (R3-001)", () => {
    const suitor: Person = { id: "suitor1", name: "Suitor", sex: "m", birthYear: 1480, traits: [], job: "labourer", founder: true, socialClass: "cottar", mind: createMind("legacy-pair", "suitor1", 1480) };
    const candidate: Person = { id: "candidate1", name: "Candidate", sex: "f", birthYear: 1485, traits: [], job: "none", founder: true, socialClass: "cottar", mind: createMind("legacy-pair", "candidate1", 1485) };
    const people = { [suitor.id]: suitor, [candidate.id]: candidate };
    const year = 1529; // well past MIN_MARRIAGE_AGE.cottar (f25/m28)
    const config = { startYear: 1498, endYear: 1558 };

    const y1Candidate = gatherCandidatesForYear(year, people, [], "legacy-pair").find((c) => c.kind === "Y1")!;
    expect(y1Candidate.partnerId).toBeDefined(); // sanity: the fixture DOES produce a real paired Y1 opportunity

    // Real pre-change persisted shape for a paired social kind: `<kind>:<pairKey>:<year>` — this WAS
    // the literal `DecisionRecord.id` before ordinal minting (see decision-id.ts's doc comment).
    const legacyId = `${y1Candidate.kind}:${pairKey(y1Candidate.personId, y1Candidate.partnerId!)}:${year}`;
    const override: Override = { id: "o8", decisionId: legacyId, optionId: y1Candidate.options[0]! };

    const result = validateOverride(override, people, [], year, "legacy-pair", config);
    expect(result.ok).toBe(true);
  });

  it("forces a LEGACY paired-kind override during simulation, not just validation (R3-001, overrideFor)", async () => {
    const { config, people } = generateWorld({ seed: "legacy-pair-force", startYear: 1498, endYear: 1500, founderCount: 12 });
    const year = config.startYear;
    const y1Candidate = gatherCandidatesForYear(year, people, [], config.seed).find((c) => c.kind === "Y1" && c.partnerId !== undefined);
    if (!y1Candidate) return; // no Y1 opportunity surfaced for this seed/config; nothing to force.
    const legacyId = `${y1Candidate.kind}:${pairKey(y1Candidate.personId, y1Candidate.partnerId!)}:${year}`;
    const forcedOption = y1Candidate.options.find((o) => o !== "wait")!; // an option Jev/rules wouldn't reliably pick on its own
    const override: Override = { id: "o9", decisionId: legacyId, optionId: forcedOption };

    const report = await simulate(config, people, [], { decisionMaker: new RuleDecisionMaker(), engineSource: "rules", overrides: [override], fromYear: year });
    const recorded = report.result.decisions.find((d) => d.kind === "Y1" && d.personId === y1Candidate.personId && d.year === year);
    expect(recorded?.chosen).toBe(forcedOption);
    expect(recorded?.source).toBe("forced");
  });

  it("matches a NEW ordinal-format override id (kind:subject#ordinal.attempt) the same way", async () => {
    const { config, report } = await runSmallWorld("validate-new-format");
    const decision = report.result.decisions[0]!;
    const snapshot = report.snapshots.get(decision.year - 1)!;
    const newFormatId = `${decision.kind}:${decision.personId}#1.1`;
    const override: Override = { id: "o7", decisionId: newFormatId, optionId: decision.options[0]!.id };
    const result = validateOverride(override, snapshot.people, snapshot.events, decision.year, config.seed, config);
    expect(result.ok).toBe(true);
  });
});

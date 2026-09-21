import { describe, expect, it } from "vitest";
import { RuleDecisionMaker } from "@/adapters/decision/rule-decision-maker";
import { simulate } from "./simulate";
import type { Override } from "./types";
import { validateOverride } from "./validate-override";
import { generateWorld } from "./worldgen";

async function runSmallWorld(seed: string) {
  const { config, people } = generateWorld({ seed, startYear: 1500, endYear: 1530, founderCount: 10 });
  const report = await simulate(config, people, [], { decisionMaker: new RuleDecisionMaker(), engineSource: "rules" });
  return { config, report };
}

describe("validateOverride", () => {
  it("accepts a real decision from the base branch with one of its real options", async () => {
    const { config, report } = await runSmallWorld("validate-a");
    const decision = report.result.decisions[0]!;
    // Validation runs against the state one year before the decision, so use the snapshot restored there.
    const snapshot = report.snapshots.get(decision.year - 1)!;
    const override: Override = { id: "o1", decisionId: decision.id, optionId: decision.options[0]!.id };
    const result = validateOverride(override, snapshot.people, snapshot.events, config.seed, config);
    expect(result.ok).toBe(true);
  });

  it("rejects an option that isn't one of the decision's real options", async () => {
    const { config, report } = await runSmallWorld("validate-b");
    const decision = report.result.decisions[0]!;
    const snapshot = report.snapshots.get(decision.year - 1)!;
    const override: Override = { id: "o2", decisionId: decision.id, optionId: "not-a-real-option" };
    const result = validateOverride(override, snapshot.people, snapshot.events, config.seed, config);
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
    const result = validateOverride(override, snapshot.people, snapshot.events, config.seed, config);
    expect(result.ok).toBe(false);
  });

  it("rejects a year outside the world's span", async () => {
    const { config, report } = await runSmallWorld("validate-d");
    const snapshot = report.snapshots.get(config.startYear)!;
    const override: Override = { id: "o4", decisionId: `death:p001:${config.endYear + 50}`, optionId: "survive" };
    const result = validateOverride(override, snapshot.people, snapshot.events, config.seed, config);
    expect(result.ok).toBe(false);
  });

  it("rejects a malformed decision id with no trailing year", async () => {
    const { config, report } = await runSmallWorld("validate-e");
    const snapshot = report.snapshots.get(config.startYear)!;
    const override: Override = { id: "o5", decisionId: "not-a-real-decision-id", optionId: "x" };
    const result = validateOverride(override, snapshot.people, snapshot.events, config.seed, config);
    expect(result.ok).toBe(false);
  });
});

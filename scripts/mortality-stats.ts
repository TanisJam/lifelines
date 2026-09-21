/**
 * Measures the protagonist age-at-death distribution, decisions-per-life and entries-per-life
 * across many seeds, with the rules engine (round 9, decision 035 — the "measure it and report"
 * requirement). Not part of the required verification commands — a one-off measurement tool.
 *
 * Usage: tsx scripts/mortality-stats.ts [seedCount]
 */
import { RuleDecisionMaker } from "../src/adapters/decision/rule-decision-maker";
import { simulate } from "../src/domain/simulate";
import { generateWorld } from "../src/domain/worldgen";
import { deleteLife, registerLife } from "../src/server/life-store";
import { buildLifeChronicle } from "../src/server/life-chronicle";

const START_YEAR = 1500;
const MAX_LIFESPAN_YEARS = 100;

interface LifeStats {
  readonly seed: string;
  readonly sex: "f" | "m";
  readonly ageAtDeath: number;
  readonly cause: string;
  readonly decisionCalls: number;
  readonly entryCount: number;
  readonly wallTimeMs: number;
}

async function runOne(seed: string): Promise<LifeStats> {
  const startYear = START_YEAR;
  const endYear = startYear + MAX_LIFESPAN_YEARS;
  const { config, people, events } = generateWorld({ seed, startYear, endYear, protagonist: { name: "Protagonist", sex: "random" } });
  const decisionMaker = new RuleDecisionMaker();
  const report = await simulate(config, people, events, { decisionMaker, engineSource: "rules", protagonistId: "protagonist" });

  const protagonist = report.result.people.protagonist!;
  const deathEvent = report.result.events.find((e) => e.kind === "death" && e.actors[0] === "protagonist");
  const cause = deathEvent && typeof deathEvent.payload.cause === "string" ? deathEvent.payload.cause : "unknown";
  const ageAtDeath = protagonist.deathYear !== undefined ? protagonist.deathYear - protagonist.birthYear : -1;

  const life = registerLife(`life-${seed}`, `branch-${seed}`, config, protagonist.name, protagonist.sex, report.result, report.snapshots);
  const chronicleResult = await buildLifeChronicle(life.id, life.originalBranchId);
  const entryCount = chronicleResult.data?.entries.length ?? -1;
  deleteLife(life.id); // free the snapshots immediately — this script registers many short-lived lives in one process

  return { seed, sex: protagonist.sex, ageAtDeath, cause, decisionCalls: report.decisionCalls, entryCount, wallTimeMs: report.wallTimeMs };
}

async function main(): Promise<void> {
  const seedCount = Number(process.argv[2] ?? 30);
  const results: LifeStats[] = [];
  for (let i = 0; i < seedCount; i++) {
    results.push(await runOne(`mortality-${i}`));
  }

  console.log(`\nRan ${results.length} seeds.\n`);
  console.log("seed              sex  age  cause               decisions  entries  ms");
  for (const r of results) {
    console.log(`${r.seed.padEnd(18)}${r.sex.padEnd(5)}${String(r.ageAtDeath).padEnd(5)}${r.cause.padEnd(20)}${String(r.decisionCalls).padEnd(11)}${String(r.entryCount).padEnd(9)}${r.wallTimeMs}`);
  }

  const under15 = results.filter((r) => r.ageAtDeath < 15).length;
  const pctUnder15 = (100 * under15) / results.length;

  const causeCounts = new Map<string, number>();
  for (const r of results) causeCounts.set(r.cause, (causeCounts.get(r.cause) ?? 0) + 1);

  const ages = results.map((r) => r.ageAtDeath).sort((a, b) => a - b);
  const avgAge = ages.reduce((a, b) => a + b, 0) / ages.length;
  const medianAge = ages[Math.floor(ages.length / 2)];

  const avgDecisions = results.reduce((a, r) => a + r.decisionCalls, 0) / results.length;
  const avgEntries = results.reduce((a, r) => a + r.entryCount, 0) / results.length;
  const maxDecisions = Math.max(...results.map((r) => r.decisionCalls));

  console.log(`\nDeaths before age 15: ${under15}/${results.length} (${pctUnder15.toFixed(1)}%) — target 15-20%.`);
  console.log(`Average age at death: ${avgAge.toFixed(1)}. Median: ${medianAge}.`);
  console.log(`\nCause distribution:`);
  for (const [cause, count] of [...causeCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${cause.padEnd(20)} ${count} (${((100 * count) / results.length).toFixed(1)}%)`);
  }
  console.log(`\nAverage decisions/life: ${avgDecisions.toFixed(0)} (max ${maxDecisions}, budget 2000).`);
  console.log(`Average chronicle entries/life: ${avgEntries.toFixed(1)}.`);
}

main().catch((error: unknown) => {
  console.error("mortality-stats failed:", error);
  process.exitCode = 1;
});

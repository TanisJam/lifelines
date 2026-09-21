/**
 * Measures chronicle richness across many seeds with the rules engine (decision 040's "richness
 * target": a full-length protagonist life should produce 30-60 chronicle entries, whether they
 * stay or leave). Reports entry count split by stayed/left, and the longest period-summary span
 * seen — the direct check for the reported bug (a 61-year gap after leaving town). Same style as
 * `mortality-stats.ts`; not part of the required verification commands.
 *
 * Usage: tsx scripts/richness-stats.ts [seedCount]
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
  readonly left: boolean;
  readonly ageAtDeath: number;
  readonly entryCount: number;
  readonly longestPeriodSpan: number;
  readonly bareTitleCount: number;
}

async function runOne(seed: string): Promise<LifeStats> {
  const startYear = START_YEAR;
  const endYear = startYear + MAX_LIFESPAN_YEARS;
  const { config, people, events } = generateWorld({ seed, startYear, endYear, protagonist: { name: "Protagonist", sex: "random" } });
  const decisionMaker = new RuleDecisionMaker();
  const report = await simulate(config, people, events, { decisionMaker, engineSource: "rules", protagonistId: "protagonist" });

  const protagonist = report.result.people.protagonist!;
  const left = report.result.events.some((e) => e.kind === "move" && e.actors[0] === "protagonist" && e.payload.away === true);
  const ageAtDeath = protagonist.deathYear !== undefined ? protagonist.deathYear - protagonist.birthYear : -1;

  const life = registerLife(`life-${seed}`, `branch-${seed}`, config, protagonist.name, protagonist.sex, report.result, report.snapshots);
  const chronicleResult = await buildLifeChronicle(life.id, life.originalBranchId);
  const entries = chronicleResult.data?.entries ?? [];
  const periods = entries.filter((e) => e.kind === "period");
  const longestPeriodSpan = Math.max(0, ...periods.map((p) => (p.endYear ?? p.year) - p.year + 1));
  const bareTitleCount = periods.filter((p) => /^\d+[–-]\d+$/.test(p.title)).length;
  deleteLife(life.id);

  return { seed, left, ageAtDeath, entryCount: entries.length, longestPeriodSpan, bareTitleCount };
}

async function main(): Promise<void> {
  const seedCount = Number(process.argv[2] ?? 20);
  const results: LifeStats[] = [];
  for (let i = 0; i < seedCount; i++) {
    results.push(await runOne(`richness-${i}`));
  }

  console.log(`\nRan ${results.length} seeds.\n`);
  console.log("seed              left   age  entries  longestPeriod  bareTitles");
  for (const r of results) {
    console.log(`${r.seed.padEnd(18)}${String(r.left).padEnd(7)}${String(r.ageAtDeath).padEnd(5)}${String(r.entryCount).padEnd(9)}${String(r.longestPeriodSpan).padEnd(15)}${r.bareTitleCount}`);
  }

  const stayed = results.filter((r) => !r.left);
  const left = results.filter((r) => r.left);
  const avg = (rs: LifeStats[]) => (rs.length === 0 ? 0 : rs.reduce((a, r) => a + r.entryCount, 0) / rs.length);
  const maxSpan = Math.max(0, ...results.map((r) => r.longestPeriodSpan));
  const totalBareTitles = results.reduce((a, r) => a + r.bareTitleCount, 0);
  const inTarget = results.filter((r) => r.entryCount >= 30 && r.entryCount <= 60).length;

  console.log(`\nStayed: ${stayed.length}, avg entries ${avg(stayed).toFixed(1)}.`);
  console.log(`Left: ${left.length}, avg entries ${avg(left).toFixed(1)}.`);
  console.log(`Longest period span across all seeds: ${maxSpan} years (target: rare, and under ~8 for an adult).`);
  console.log(`Bare "year-year" period titles: ${totalBareTitles} (target: 0).`);
  console.log(`Lives in the 30-60 entry target range: ${inTarget}/${results.length}.`);
}

main().catch((error: unknown) => {
  console.error("richness-stats failed:", error);
  process.exitCode = 1;
});

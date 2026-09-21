/**
 * Measures chronicle richness across many seeds with the rules engine. Decision 042 supersedes
 * decision 040's "30-60 entries, no bare period titles" target: `simulate.ts` now guarantees at
 * least one chronicle entry for every year of the protagonist's life (a `D1` everyday-life
 * vignette when nothing else happened), so this instead reports entries/life and the MINIMUM
 * entries-per-year across every simulated life — the direct check that the guarantee actually
 * holds. Same style as `mortality-stats.ts`; not part of the required verification commands.
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
  readonly minEntriesPerYear: number;
  readonly missingYears: number;
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
  const chronicle = chronicleResult.data;
  const entries = chronicle?.entries ?? [];

  const countByYear = new Map<number, number>();
  for (const entry of entries) countByYear.set(entry.year, (countByYear.get(entry.year) ?? 0) + 1);
  let minEntriesPerYear = Infinity;
  let missingYears = 0;
  if (chronicle) {
    for (let year = chronicle.protagonist.birthYear; year <= chronicle.protagonist.deathYear; year++) {
      const count = countByYear.get(year) ?? 0;
      if (count === 0) missingYears += 1;
      minEntriesPerYear = Math.min(minEntriesPerYear, count);
    }
  }
  deleteLife(life.id);

  return { seed, left, ageAtDeath, entryCount: entries.length, minEntriesPerYear: Number.isFinite(minEntriesPerYear) ? minEntriesPerYear : 0, missingYears };
}

async function main(): Promise<void> {
  const seedCount = Number(process.argv[2] ?? 20);
  const results: LifeStats[] = [];
  for (let i = 0; i < seedCount; i++) {
    results.push(await runOne(`richness-${i}`));
  }

  console.log(`\nRan ${results.length} seeds.\n`);
  console.log("seed              left   age  entries  minEntries/yr  missingYears");
  for (const r of results) {
    console.log(`${r.seed.padEnd(18)}${String(r.left).padEnd(7)}${String(r.ageAtDeath).padEnd(5)}${String(r.entryCount).padEnd(9)}${String(r.minEntriesPerYear).padEnd(15)}${r.missingYears}`);
  }

  const stayed = results.filter((r) => !r.left);
  const left = results.filter((r) => r.left);
  const avg = (rs: LifeStats[]) => (rs.length === 0 ? 0 : rs.reduce((a, r) => a + r.entryCount, 0) / rs.length);
  const worstMin = Math.min(...results.map((r) => r.minEntriesPerYear));
  const totalMissingYears = results.reduce((a, r) => a + r.missingYears, 0);

  console.log(`\nStayed: ${stayed.length}, avg entries ${avg(stayed).toFixed(1)}.`);
  console.log(`Left: ${left.length}, avg entries ${avg(left).toFixed(1)}.`);
  console.log(`Minimum entries/year across all seeds: ${worstMin} (target: >=1, every year).`);
  console.log(`Total missing protagonist-years across all seeds: ${totalMissingYears} (target: 0).`);
}

main().catch((error: unknown) => {
  console.error("richness-stats failed:", error);
  process.exitCode = 1;
});

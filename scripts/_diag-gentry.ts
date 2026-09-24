/**
 * One-off diagnostic (backlog item: "Gentry women marry too late") — how many gentry daughters
 * exist across the standard calibration run, their marriage-age distribution, and (cheaply, at just
 * their first-eligible year, not a full per-year scan) whether ANY eligible gentry male existed in
 * the village at all. Answers whether the miss is genuinely partner-SUPPLY scarcity, or the same
 * slow onset+ramp courtship hazard everyone else is subject to (which a "more supply" fix alone
 * wouldn't close, per `params/demography.ts#MARRIAGE_FLOORS`'s own doc comment reasoning).
 */
import { RuleDecisionMaker } from "../src/adapters/decision/rule-decision-maker";
import { MARRIAGE_FLOORS } from "../src/domain/params/demography";
import { simulate } from "../src/domain/simulate";
import { generateWorld } from "../src/domain/worldgen";

const PERIOD_WINDOW = { startYear: 1327, endYear: 1427 } as const;
const SEED_COUNT = Number(process.argv[2] ?? 30);

async function main(): Promise<void> {
  let daughterCount = 0;
  let marriedCount = 0;
  const marriageAges: number[] = [];
  let firstEligibleYearsChecked = 0;
  let firstEligibleYearsWithGentryMale = 0;

  for (let i = 0; i < SEED_COUNT; i++) {
    const { config, people } = generateWorld({ seed: `demo-stats-${i}`, startYear: PERIOD_WINDOW.startYear, endYear: PERIOD_WINDOW.endYear });
    const report = await simulate(config, people, [], { decisionMaker: new RuleDecisionMaker(), engineSource: "rules" });
    const finalPeople = report.result.people;
    const events = report.result.events;
    const allPeople = Object.values(finalPeople);

    const daughters = allPeople.filter((p) => p.motherId !== undefined && p.sex === "f" && (p.socialClass ?? "cottar") === "gentry");
    for (const daughter of daughters) {
      daughterCount++;
      const marriageEvent = events.find((e) => e.kind === "marriage" && e.actors.includes(daughter.id));
      if (marriageEvent) {
        marriedCount++;
        marriageAges.push(marriageEvent.year - daughter.birthYear);
      }

      const firstEligibleYear = daughter.birthYear + MARRIAGE_FLOORS.gentry.f.minEligible;
      if (firstEligibleYear < PERIOD_WINDOW.startYear || firstEligibleYear > PERIOD_WINDOW.endYear) continue;
      if (daughter.deathYear !== undefined && daughter.deathYear <= firstEligibleYear) continue;
      firstEligibleYearsChecked++;

      const hasGentryMale = allPeople.some((p) => {
        if (p.sex !== "m" || (p.socialClass ?? "cottar") !== "gentry") return false;
        if (p.deathYear !== undefined && p.deathYear <= firstEligibleYear) return false;
        if (p.birthYear > firstEligibleYear) return false;
        const age = firstEligibleYear - p.birthYear;
        if (age < MARRIAGE_FLOORS.gentry.m.minEligible) return false;
        const marriedAt = events.find((e) => e.kind === "marriage" && e.actors.includes(p.id))?.year;
        return marriedAt === undefined || marriedAt > firstEligibleYear;
      });
      if (hasGentryMale) firstEligibleYearsWithGentryMale++;
    }
  }

  console.log(`Seeds: ${SEED_COUNT}, window ${PERIOD_WINDOW.startYear}-${PERIOD_WINDOW.endYear}`);
  console.log(`Gentry daughters (motherId-set cohort): ${daughterCount} (${(daughterCount / SEED_COUNT).toFixed(2)}/seed)`);
  console.log(`  Married by sim end: ${marriedCount} (${((marriedCount / daughterCount) * 100).toFixed(1)}%)`);
  const mean = marriageAges.reduce((a, b) => a + b, 0) / (marriageAges.length || 1);
  console.log(`  Mean first-marriage age (of the married ones): ${mean.toFixed(2)} (n=${marriageAges.length})`);
  console.log(`  Marriage ages: ${marriageAges.sort((a, b) => a - b).join(", ")}`);
  console.log(`At her first-eligible year (age ${MARRIAGE_FLOORS.gentry.f.minEligible}), among ${firstEligibleYearsChecked} daughters still alive then:`);
  console.log(`  ...with an eligible SAME-VILLAGE gentry male already available: ${firstEligibleYearsWithGentryMale} (${((firstEligibleYearsWithGentryMale / firstEligibleYearsChecked) * 100).toFixed(1)}%)`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

/**
 * Fast, no-network sanity check for population dynamics under the rules
 * engine. Not part of the required verification commands — a dev tool used
 * while tuning worldgen/simulate, and reused for the rules-engine
 * comparison in the iteration report.
 *
 * Usage: tsx scripts/check-demographics.ts [seed]
 */
import { RuleDecisionMaker } from "../src/adapters/decision/rule-decision-maker";
import { simulate } from "../src/domain/simulate";
import { generateWorld } from "../src/domain/worldgen";

async function main(): Promise<void> {
  const seed = process.argv[2] ?? "check-demographics";
  const { config, people } = generateWorld({ seed });

  const startCount = Object.keys(people).length;
  console.log(`Seed "${seed}": ${config.startYear}-${config.endYear}, ${startCount} people at start.`);

  const decisionMaker = new RuleDecisionMaker();
  const started = Date.now();
  const report = await simulate(config, people, [], { decisionMaker, engineSource: "rules" });
  const wallMs = Date.now() - started;

  const endAlive = Object.values(report.result.people).filter((p) => p.deathYear === undefined).length;
  const births = report.result.events.filter((e) => e.kind === "birth").length;
  const immigrants = report.result.events.filter((e) => e.kind === "move" && e.payload.arrived === true).length;
  const deaths = report.result.events.filter((e) => e.kind === "death").length;
  const marriages = report.result.events.filter((e) => e.kind === "marriage").length;
  const illnesses = report.result.events.filter((e) => e.kind === "illness").length;

  // Age at marriage, to sanity-check "age-appropriate, not everyone marries at 53".
  const marriageAges: number[] = [];
  for (const event of report.result.events) {
    if (event.kind !== "marriage") continue;
    for (const actorId of event.actors) {
      const person = report.result.people[actorId];
      if (person) marriageAges.push(event.year - person.birthYear);
    }
  }
  const avgMarriageAge = marriageAges.length > 0 ? marriageAges.reduce((a, b) => a + b, 0) / marriageAges.length : 0;

  console.log(`Final population: ${Object.keys(report.result.people).length} total, ${endAlive} alive at ${config.endYear}.`);
  console.log(`Births: ${births}, immigrants: ${immigrants}, deaths: ${deaths}, marriages: ${marriages}, illnesses: ${illnesses}.`);
  console.log(`Average age at marriage: ${avgMarriageAge.toFixed(1)}.`);
  console.log(`Events: ${report.result.events.length}. Social decisions asked: ${report.decisionCalls}. Decision records kept: ${report.result.decisions.length}. Wall time: ${wallMs} ms.`);

  // Generational check: how many distinct birth-decade cohorts exist among people ever alive?
  const decades = new Set(Object.values(report.result.people).map((p) => Math.floor(p.birthYear / 10) * 10));
  console.log(`Distinct birth decades represented: ${decades.size} (${[...decades].sort((a, b) => a - b).join(", ")}).`);
}

main().catch((error: unknown) => {
  console.error("check-demographics failed:", error);
  process.exitCode = 1;
});

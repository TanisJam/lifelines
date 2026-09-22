/**
 * Fast, no-network sanity check for population dynamics under the rules
 * engine. Not part of the required verification commands — a dev tool used
 * while tuning worldgen/simulate, and reused for the rules-engine
 * comparison in the iteration report.
 *
 * Usage: tsx scripts/check-demographics.ts [seed]
 *        tsx scripts/check-demographics.ts --stats [seedCount]   (decision 050)
 */
import { RuleDecisionMaker } from "../src/adapters/decision/rule-decision-maker";
import { simulate } from "../src/domain/simulate";
import { generateWorld } from "../src/domain/worldgen";

/**
 * Decision 050: aggregate infant mortality, life expectancy at birth and the under-15 death share
 * across many full-length (default 1498-1558), multi-generation VILLAGE runs — not just the
 * protagonist (that's `mortality-stats.ts`) — under the deterministic `RuleDecisionMaker`, offline,
 * with no calls to the Jev API. This is the tool `actuarial.ts`'s doc comment on
 * `deathProbabilityAtAge` cites as how its table was calibrated; see docs/decisions.md 050 for the
 * exact before/after figures from the run it was tuned against.
 *
 * Infant mortality note: `simulate.ts` gathers a year's death candidates from `people` BEFORE that
 * year's births are applied (one pass per year — `gatherCandidatesForYear` runs first, then social
 * outcomes including A2 births mutate `people`). A child born in year Y is therefore never in that
 * year's `livingIds` and, unlike a founder who happens to start the world at literal age 0, is first
 * evaluated for death in year Y+1, at `ageInYear` = 1, not 0. So "infant mortality" is measured here,
 * operationally, as death by the end of that first EVALUATED year (age <= 1) — matching
 * `actuarial.ts`'s age<2 band, not a strict age<1 read of `deathYear - birthYear`. This is a disclosed
 * adaptation to the engine's once-per-year candidate-gathering order, not a scope change to it (a fix
 * would mean restructuring `simulate()`'s year loop, out of scope for a mortality-table tuning batch).
 *
 * Life expectancy note: an adult FOUNDER is created already having "survived" to their starting age
 * (22-60+) with no infant/child mortality risk ever applied to them — including them in an age-at-death
 * average would overstate e0 (survivorship bias: we only ever see founders who made it to adulthood).
 * `Person.motherId` is set only for someone the engine actually generated FROM birth — a founder's own
 * child (`worldgen.ts#makeChild`, present at world start but not itself a `founder`) or an in-sim birth
 * (`simulate.ts#spawnChild`) — never a founder, spawned immigrant, or away-catalog NPC (none of which
 * carry parent ids). That's the unbiased "life expectancy at birth" cohort used below; the population-wide
 * average (everyone who died, founders included) is also reported for context, but runs high on purpose.
 *
 * Window note: measured against a 100-year run (`STATS_END_YEAR`), not the game's default 60-year
 * 1498-1558 window — same reasoning as `mortality-stats.ts`'s `MAX_LIFESPAN_YEARS`. A real e0 of ~35
 * needs room for the occasional person who lives to 70-90; capped at the game's own 60-year window,
 * anyone who'd still be alive in 1558 is simply excluded from the "observed death" sample (right-censored),
 * which biases a from-birth average DOWN as adult survival improves, not up — confirmed empirically while
 * tuning this table (lowering adult-band mortality moved e0 the wrong way at a 60-year window). A 100-year
 * window gives nearly every from-birth person time to actually die, so the sample reflects the table's real
 * shape rather than an artifact of the window length.
 */
const STATS_END_YEAR = 1598;

async function runStats(seedCount: number): Promise<void> {
  const decisionMaker = new RuleDecisionMaker();

  let observedBirths = 0;
  let infantDeaths = 0;
  const ageAtDeathFromBirth: number[] = [];
  const ageAtDeathAll: number[] = [];
  let under15Deaths = 0;
  let under15Resolved = 0;

  for (let i = 0; i < seedCount; i++) {
    const { config, people } = generateWorld({ seed: `demo-stats-${i}`, startYear: 1498, endYear: STATS_END_YEAR });
    const report = await simulate(config, people, [], { decisionMaker, engineSource: "rules" });
    const finalPeople = report.result.people;
    const endYear = config.endYear;

    const births = report.result.events.filter((e) => e.kind === "birth");
    for (const birth of births) {
      if (birth.year >= endYear) continue; // no follow-up year left to observe an infant death
      const childId = birth.actors[0];
      const child = childId ? finalPeople[childId] : undefined;
      if (!child) continue;
      observedBirths++;
      if (child.deathYear !== undefined && child.deathYear - child.birthYear <= 1) infantDeaths++;
    }

    // Life expectancy at birth and the under-15 share, restricted to the from-birth cohort
    // (`motherId` set — see doc comment above). Anyone still alive at the run's end is right-censored
    // — excluded from both the e0 sample and the under-15 share UNLESS they've already passed 15 (in
    // which case their under-15 outcome is already resolved, even though their eventual lifespan isn't).
    for (const person of Object.values(finalPeople)) {
      if (person.deathYear !== undefined) ageAtDeathAll.push(person.deathYear - person.birthYear);
      if (person.motherId === undefined) continue;
      if (person.deathYear !== undefined) {
        const ageAtDeath = person.deathYear - person.birthYear;
        ageAtDeathFromBirth.push(ageAtDeath);
        under15Resolved++;
        if (ageAtDeath < 15) under15Deaths++;
      } else if (endYear - person.birthYear >= 15) {
        under15Resolved++;
      }
    }
  }

  const avg = (samples: readonly number[]) => (samples.length > 0 ? samples.reduce((a, b) => a + b, 0) / samples.length : NaN);
  const imrPer1000 = observedBirths > 0 ? (1000 * infantDeaths) / observedBirths : NaN;
  const e0 = avg(ageAtDeathFromBirth);
  const e0AllDeaths = avg(ageAtDeathAll);
  const under15Pct = under15Resolved > 0 ? (100 * under15Deaths) / under15Resolved : NaN;

  console.log(`\nStats across ${seedCount} seeds, 1498-${STATS_END_YEAR} village runs (decision 050 calibration; the 100-year window avoids right-censoring e0 — see doc comment):`);
  console.log(`  Births with >=1yr follow-up: ${observedBirths}. Infant deaths (age<=1): ${infantDeaths}.`);
  console.log(`  Infant mortality: ${imrPer1000.toFixed(1)} per 1,000 births. Target: ~150-170.`);
  console.log(`  Life expectancy at birth (from-birth cohort, ${ageAtDeathFromBirth.length} observed deaths): ${e0.toFixed(1)} years. Target: ~35.`);
  console.log(`  Share dying before age 15 (of ${under15Resolved} resolved outcomes): ${under15Pct.toFixed(1)}%. Research.md: ~30% (unverified).`);
  console.log(`  (Context only, NOT the tuning target — population-wide avg age at death incl. adult founders, ${ageAtDeathAll.length} deaths): ${e0AllDeaths.toFixed(1)} years.`);
}

async function main(): Promise<void> {
  if (process.argv[2] === "--stats") {
    await runStats(Number(process.argv[3] ?? 50));
    return;
  }
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

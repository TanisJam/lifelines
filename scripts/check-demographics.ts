/**
 * Fast, no-network sanity check for population dynamics under the rules
 * engine. Not part of the required verification commands — a dev tool used
 * while tuning worldgen/simulate, and reused for the rules-engine
 * comparison in the iteration report.
 *
 * Usage: tsx scripts/check-demographics.ts [seed]
 *        tsx scripts/check-demographics.ts --stats [seedCount] [--set period|tudor] [--assert]
 *
 * Engine life course PR8 (task 8.5, engram #6311): `--set` selects which calibration window/target
 * set `--stats` measures against.
 *   - `period` (default): the engine's OWN 1327-1361 window (`sdd/engine-life-course/spec`'s
 *     "period-setting-1327-1361" capability) against `params/targets.ts#CALIBRATION_TARGETS` — the
 *     bands PR8 tunes `params/demography.ts` toward.
 *   - `tudor`: the legacy 1498-1558/1498-1598 window decision 050 originally calibrated
 *     `actuarial.ts#deathProbabilityAtAge` against — kept so that table's own historical tuning run
 *     stays reproducible, unaffected by the period-setting move.
 * `--assert` checks the `period` set's measured metrics against `CALIBRATION_TARGETS` and exits 1 if
 * any band is missed (never silently passes a red calibration run).
 */
import { RuleDecisionMaker } from "../src/adapters/decision/rule-decision-maker";
import { cohortConditionalDeathShare, cohortDeathShareByAge } from "../src/domain/cohort-stats";
import { CALIBRATION_TARGETS } from "../src/domain/params/targets";
import { simulate } from "../src/domain/simulate";
import type { SocialClass } from "../src/domain/types";
import { generateWorld } from "../src/domain/worldgen";

/**
 * Decision 050: aggregate infant mortality, life expectancy at birth and the under-15 death share
 * across many full-length, multi-generation VILLAGE runs — not just the protagonist (that's
 * `mortality-stats.ts`) — under the deterministic `RuleDecisionMaker`, offline, with no calls to the
 * Jev API.
 *
 * Infant mortality note: `simulate.ts` gathers a year's death candidates from `people` BEFORE that
 * year's births are applied (one pass per year — `gatherCandidatesForYear` runs first, then social
 * outcomes including A2 births mutate `people`). A child born in year Y is therefore never in that
 * year's `livingIds` and, unlike a founder who happens to start the world at literal age 0, is first
 * evaluated for death in year Y+1, at `ageInYear` = 1, not 0. So "infant mortality" is measured here,
 * operationally, as death by the end of that first EVALUATED year (age <= 1) — matching
 * `actuarial.ts`'s age<2 band, not a strict age<1 read of `deathYear - birthYear`.
 *
 * Life expectancy note: an adult FOUNDER is created already having "survived" to their starting age
 * with no infant/child mortality risk ever applied to them — including them in an age-at-death average
 * would overstate e0 (survivorship bias). `Person.motherId` is set only for someone the engine
 * actually generated FROM birth (a founder's own pre-existing child, or an in-sim birth) — never a
 * founder, spawned immigrant, or away-catalog NPC. That's the unbiased "life expectancy at birth"
 * cohort used below.
 *
 * "Founders skew the sample" (engram #6284/#6280): every from-birth/from-marriage measurement below
 * (e0, infant mortality, marriage age, literacy) is restricted to the `motherId`-set, non-widowed-
 * remarriage cohort for exactly this reason — founders arrive already adult, with no developmental
 * clock, and folding them in inflates ages and hides the engine's own hazard-curve behavior.
 */
const TUDOR_WINDOW = { startYear: 1498, endYear: 1598 } as const; // decision 050's original 100-year calibration window
/**
 * PR8 (task 8.5, engram #6311): 1327-1427, NOT the game's own default 1327-1361 play window — the
 * same right-censoring reasoning `actuarial.ts`'s doc comment already gives for the Tudor set's
 * 100-year window applies identically here. A 34-year window right-censors e0 and widow remarriage
 * severely (most from-birth people, and most widows, simply haven't had TIME to die/remarry by 1361),
 * which measured e0=13.4 and widow remarriage=23.5%/12.5% against 22-35/60-66%/23-29% targets before
 * this widening — a measurement artifact, not a real calibration gap. Every dated event this window
 * cares about (famine backstory, Black Death 1348-49, Ordinance/Statute, second pestilence 1361-62)
 * still fires at its own absolute year regardless of how much longer the window runs past it.
 */
const PERIOD_WINDOW = { startYear: 1327, endYear: 1427 } as const;
/** Widow remarriage needs real follow-up time; a widow made in the window's last few years hasn't had a fair chance to remarry yet (same right-censoring concern as e0 above). */
const WIDOW_REMARRIAGE_FOLLOWUP_YEARS = 15;

type CalibrationSet = "period" | "tudor";

interface StatsResult {
  readonly seedCount: number;
  readonly window: { readonly startYear: number; readonly endYear: number };
  readonly observedBirths: number;
  readonly infantDeaths: number;
  readonly imrPer1000: number;
  readonly e0: number;
  readonly e0Samples: number;
  readonly under15Pct: number;
  readonly e0AllDeaths: number;
  /** Mean age at first marriage, non-widowed, `motherId`-set cohort, by sex. */
  readonly marriageAgeBySex: Readonly<Record<"f" | "m", number>>;
  readonly marriageAgeSamples: Readonly<Record<"f" | "m", number>>;
  /** Mean age at first marriage, same cohort, by social class + sex — task 8.1's per-class view. */
  readonly marriageAgeByClassSex: Readonly<Record<string, number>>;
  readonly merchantMenMarriageAge: number;
  /** % of widows who ever remarry, split by whether they were widowed before or from 1349 onward. */
  readonly widowRemarriagePre1349Pct: number;
  readonly widowRemarriagePost1349Pct: number;
  /** % of the `motherId`-set cohort who survived infancy (age>=2) but die by age 7. */
  readonly under7AdditionalDeathPct: number;
  /** % literate among the `motherId`-set cohort with a resolved literacy flag. */
  readonly literacyPct: number;
  readonly hazardFallbackCount: number;
}

function mean(samples: readonly number[]): number {
  return samples.length > 0 ? samples.reduce((a, b) => a + b, 0) / samples.length : NaN;
}

async function runStats(seedCount: number, set: CalibrationSet): Promise<StatsResult> {
  const window = set === "period" ? PERIOD_WINDOW : TUDOR_WINDOW;
  const decisionMaker = new RuleDecisionMaker();

  let observedBirths = 0;
  let infantDeaths = 0;
  const ageAtDeathFromBirth: number[] = [];
  const ageAtDeathAll: number[] = [];
  // Accumulated across every seed, then resolved ONCE against the shared `window.endYear` by
  // `cohortDeathShareByAge`/`cohortConditionalDeathShare` (see src/domain/cohort-stats.ts) — every
  // seed shares the same window, so cross-seed accumulation is equivalent to per-seed accumulation
  // and avoids duplicating the cohort-completeness rule here.
  const motherIdCohort: { birthYear: number; deathYear?: number }[] = [];

  const marriageAges: Record<"f" | "m", number[]> = { f: [], m: [] };
  const marriageAgesByClassSex: Record<string, number[]> = {};
  let widowedPre1349 = 0;
  let widowedPre1349Remarried = 0;
  let widowedPost1349 = 0;
  let widowedPost1349Remarried = 0;
  let literateCount = 0;
  let literacyResolved = 0;
  let hazardFallbackCount = 0;

  for (let i = 0; i < seedCount; i++) {
    const { config, people } = generateWorld({ seed: `demo-stats-${i}`, startYear: window.startYear, endYear: window.endYear });
    const report = await simulate(config, people, [], { decisionMaker, engineSource: "rules" });
    const finalPeople = report.result.people;
    const endYear = config.endYear;
    for (const count of Object.values(report.hazardFallbacks)) hazardFallbackCount += count;

    const births = report.result.events.filter((e) => e.kind === "birth");
    for (const birth of births) {
      if (birth.year >= endYear) continue; // no follow-up year left to observe an infant death
      const childId = birth.actors[0];
      const child = childId ? finalPeople[childId] : undefined;
      if (!child) continue;
      observedBirths++;
      if (child.deathYear !== undefined && child.deathYear - child.birthYear <= 1) infantDeaths++;
    }

    for (const person of Object.values(finalPeople)) {
      if (person.deathYear !== undefined) ageAtDeathAll.push(person.deathYear - person.birthYear);
      if (person.motherId === undefined) continue;

      const ageAtDeath = person.deathYear !== undefined ? person.deathYear - person.birthYear : undefined;
      if (ageAtDeath !== undefined) ageAtDeathFromBirth.push(ageAtDeath);

      motherIdCohort.push({ birthYear: person.birthYear, deathYear: person.deathYear });

      if (person.literate !== undefined) {
        literacyResolved++;
        if (person.literate) literateCount++;
      }
    }

    // Marriage age + widow remarriage, mirroring simulate.test.ts's PR6-corrective methodology
    // (born-in-sim/motherId-set cohort, first marriage only, widow(er) remarriages excluded from the
    // age sample — remarriage is measured separately below).
    const seenMarried = new Set<string>();
    const widowedEvents = report.result.events.filter((e) => e.kind === "widowed");
    for (const marriage of report.result.events.filter((e) => e.kind === "marriage").sort((a, b) => a.year - b.year)) {
      for (const actorId of marriage.actors) {
        if (seenMarried.has(actorId)) continue;
        seenMarried.add(actorId);
        const person = finalPeople[actorId];
        if (!person || person.motherId === undefined) continue;
        const wasWidowed = widowedEvents.some((e) => e.actors[0] === actorId && e.year <= marriage.year);
        if (wasWidowed) continue;
        const age = marriage.year - person.birthYear;
        marriageAges[person.sex].push(age);
        const socialClass: SocialClass = person.socialClass ?? "villein";
        const key = `${socialClass}/${person.sex}`;
        (marriageAgesByClassSex[key] ??= []).push(age);
      }
    }

    for (const widowedEvent of widowedEvents) {
      const personId = widowedEvent.actors[0];
      if (!personId) continue;
      if (widowedEvent.year > endYear - WIDOW_REMARRIAGE_FOLLOWUP_YEARS) continue; // not enough follow-up time yet
      const remarried = report.result.events.some((e) => e.kind === "marriage" && e.year > widowedEvent.year && e.actors.includes(personId));
      if (widowedEvent.year < 1349) {
        widowedPre1349++;
        if (remarried) widowedPre1349Remarried++;
      } else {
        widowedPost1349++;
        if (remarried) widowedPost1349Remarried++;
      }
    }
  }

  // Cohort-completeness rule (PR9, fixing the right-censoring bias engram #6142 flagged): a person
  // is only added to an age-X denominator once their BIRTH COHORT is fully observable to age X,
  // i.e. `window.endYear - birthYear >= X`, regardless of whether they died or are still alive.
  // The old inline code counted every resolved death (however recently born — dying is a fast,
  // fully-observed event) but only counted a LIVING person once they had already survived the full
  // window — a living, not-yet-X-years-old person was silently dropped instead of being treated as
  // "not yet resolved". Because the simulated population is not static (recent birth cohorts are
  // frequently the largest, especially pre-plague), that asymmetry structurally over-represented
  // deaths relative to survivors and inflated every death-share metric below. See
  // src/domain/cohort-stats.ts for the shared, unit-tested implementation.
  const under15 = cohortDeathShareByAge(motherIdCohort, window.endYear, 15);
  const under7Additional = cohortConditionalDeathShare(motherIdCohort, window.endYear, 2, 7);

  const avg = (samples: readonly number[]) => mean(samples);
  const imrPer1000 = observedBirths > 0 ? (1000 * infantDeaths) / observedBirths : NaN;
  const e0 = avg(ageAtDeathFromBirth);
  const e0AllDeaths = avg(ageAtDeathAll);
  const under15Pct = under15.resolved > 0 ? (100 * under15.deaths) / under15.resolved : NaN;
  const under7AdditionalDeathPct = under7Additional.resolved > 0 ? (100 * under7Additional.deaths) / under7Additional.resolved : NaN;
  const literacyPct = literacyResolved > 0 ? (100 * literateCount) / literacyResolved : NaN;

  const marriageAgeByClassSex: Record<string, number> = {};
  for (const [key, ages] of Object.entries(marriageAgesByClassSex)) marriageAgeByClassSex[key] = avg(ages);

  return {
    seedCount,
    window,
    observedBirths,
    infantDeaths,
    imrPer1000,
    e0,
    e0Samples: ageAtDeathFromBirth.length,
    under15Pct,
    e0AllDeaths,
    marriageAgeBySex: { f: avg(marriageAges.f), m: avg(marriageAges.m) },
    marriageAgeSamples: { f: marriageAges.f.length, m: marriageAges.m.length },
    marriageAgeByClassSex,
    merchantMenMarriageAge: avg(marriageAgesByClassSex["merchant/m"] ?? []),
    widowRemarriagePre1349Pct: widowedPre1349 > 0 ? (100 * widowedPre1349Remarried) / widowedPre1349 : NaN,
    widowRemarriagePost1349Pct: widowedPost1349 > 0 ? (100 * widowedPost1349Remarried) / widowedPost1349 : NaN,
    under7AdditionalDeathPct,
    literacyPct,
    hazardFallbackCount,
  };
}

function printStats(result: StatsResult, set: CalibrationSet): void {
  console.log(`\nStats across ${result.seedCount} seeds, ${result.window.startYear}-${result.window.endYear} village runs (--set ${set}):`);
  console.log(`  Births with >=1yr follow-up: ${result.observedBirths}. Infant deaths (age<=1): ${result.infantDeaths}.`);
  console.log(`  Infant mortality: ${result.imrPer1000.toFixed(1)} per 1,000 births.`);
  console.log(`  Life expectancy at birth (from-birth cohort, ${result.e0Samples} observed deaths): ${result.e0.toFixed(1)} years.`);
  console.log(`  Share dying before age 15 (of resolved outcomes): ${result.under15Pct.toFixed(1)}%.`);
  console.log(`  Additional share dying by age 7, of those surviving infancy: ${result.under7AdditionalDeathPct.toFixed(1)}%.`);
  console.log(`  (Context only — population-wide avg age at death incl. adult founders): ${result.e0AllDeaths.toFixed(1)} years.`);
  console.log(`  Mean age at first marriage: F=${result.marriageAgeBySex.f.toFixed(1)} (n=${result.marriageAgeSamples.f}), M=${result.marriageAgeBySex.m.toFixed(1)} (n=${result.marriageAgeSamples.m}).`);
  console.log(`  Mean age at first marriage by class/sex: ${JSON.stringify(Object.fromEntries(Object.entries(result.marriageAgeByClassSex).map(([k, v]) => [k, Number(v.toFixed(1))])))}`);
  console.log(`  Merchant men mean first-marriage age: ${result.merchantMenMarriageAge.toFixed(1)}.`);
  console.log(`  Widow remarriage: pre-1349=${result.widowRemarriagePre1349Pct.toFixed(1)}%, post-1349=${result.widowRemarriagePost1349Pct.toFixed(1)}%.`);
  console.log(`  Literacy: ${result.literacyPct.toFixed(1)}%.`);
  console.log(`  Hazard-table lookup fallbacks: ${result.hazardFallbackCount}.`);
}

interface AssertionCheck {
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
}

function runAssertions(result: StatsResult): boolean {
  const checks: AssertionCheck[] = [
    { label: "firstMarriageAgeWomen", value: result.marriageAgeBySex.f, ...CALIBRATION_TARGETS.firstMarriageAgeWomen! },
    { label: "firstMarriageAgeMen", value: result.marriageAgeBySex.m, ...CALIBRATION_TARGETS.firstMarriageAgeMen! },
    { label: "firstMarriageAgeMen (merchant men, explicit upper-bound check)", value: result.merchantMenMarriageAge, min: 0, max: CALIBRATION_TARGETS.firstMarriageAgeMen!.max },
    { label: "widowRemarriagePreBlackDeath", value: result.widowRemarriagePre1349Pct, ...CALIBRATION_TARGETS.widowRemarriagePreBlackDeath! },
    { label: "widowRemarriagePostBlackDeath", value: result.widowRemarriagePost1349Pct, ...CALIBRATION_TARGETS.widowRemarriagePostBlackDeath! },
    { label: "lifeExpectancyAtBirth", value: result.e0, ...CALIBRATION_TARGETS.lifeExpectancyAtBirth! },
    { label: "infantMortality", value: result.imrPer1000 / 10, ...CALIBRATION_TARGETS.infantMortality! }, // per-1000 -> %
    { label: "under15DeathShare (additional, by age 7)", value: result.under7AdditionalDeathPct, ...CALIBRATION_TARGETS.under15DeathShare! },
    { label: "literacyOverall", value: result.literacyPct, ...CALIBRATION_TARGETS.literacyOverall! },
  ];

  console.log("\nCalibration assertions (params/targets.ts#CALIBRATION_TARGETS):");
  let allPass = true;
  for (const check of checks) {
    const pass = Number.isFinite(check.value) && check.value >= check.min && check.value <= check.max;
    if (!pass) allPass = false;
    console.log(`  [${pass ? "PASS" : "FAIL"}] ${check.label}: ${check.value.toFixed(2)} (band: ${check.min}-${check.max})`);
  }
  if (result.hazardFallbackCount > 0) {
    allPass = false;
    console.log(`  [FAIL] hazardFallbacks: ${result.hazardFallbackCount} (must be 0 across calibration seeds — task 8.3/8.4)`);
  } else {
    console.log(`  [PASS] hazardFallbacks: 0`);
  }
  return allPass;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args[0] === "--stats") {
    const seedCountArg = args[1] && !args[1].startsWith("--") ? Number(args[1]) : 50;
    const setIndex = args.indexOf("--set");
    const set: CalibrationSet = setIndex !== -1 && args[setIndex + 1] === "tudor" ? "tudor" : "period";
    const shouldAssert = args.includes("--assert");

    const result = await runStats(seedCountArg, set);
    printStats(result, set);

    if (shouldAssert) {
      if (set !== "period") {
        console.error("\n--assert only checks the 'period' calibration set (params/targets.ts targets the 1327-1361 window).");
        process.exitCode = 1;
        return;
      }
      const allPass = runAssertions(result);
      if (!allPass) process.exitCode = 1;
    }
    return;
  }

  const seed = args[0] ?? "check-demographics";
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

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
 *
 * PR10 (decision 071, `sdd/engine-life-course/state`): extended into a real life-table / accounting
 * view — population trajectory at fixed checkpoint years, crude birth/death rates pre-plague,
 * children ever born per completed marriage, age-specific marital fertility, adult mortality by age
 * band against `actuarial.ts`'s own table, the never-married share, widow remarriage (pre-existing),
 * and migration accounting (immigration arrivals, people leaving home, returns) — so the population
 * TRAJECTORY (decision 068/069/070's repeatedly-flagged open item) is diagnosed with real numbers
 * before any tuning, not guessed at. All of it is derived from the SAME `--set period` run each seed
 * already does (config.startYear=1327, config.endYear=1427) — the checkpoint years (1327/1347/1350/
 * 1361) are a subset of that window, so no second `simulate()` call per seed is needed; a person's
 * birth/death year is a static fact once the run finishes, independent of how much further the run
 * continues past a given checkpoint.
 */
import { RuleDecisionMaker } from "../src/adapters/decision/rule-decision-maker";
import { cohortConditionalDeathShare, cohortDeathShareByAge } from "../src/domain/cohort-stats";
import { hasMovedAway } from "../src/domain/events";
import { FERTILITY_HAZARD_BANDS, MORTALITY_BY_AGE_BAND } from "../src/domain/params/demography";
import { CALIBRATION_TARGETS } from "../src/domain/params/targets";
import { BLACK_DEATH_YEARS, SECOND_PESTILENCE_YEARS } from "../src/domain/period/events";
import { completedMarriageWives, inNeverMarriedCohort, lifeExpectancyFromExposure, meanChildrenPerMarriage, neverMarriedSharePercent, rateByAgeBand, type AgeBand, type AgeBandObservation, type AgeBandRate } from "../src/domain/population-stats";
import { simulate } from "../src/domain/simulate";
import type { Event, Person, SocialClass } from "../src/domain/types";
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

/** PR10 (GOAL A): the population-trajectory checkpoints the task itself names — pre-plague, the eve of the Black Death, just after it, and the game's own default 1327-1361 play-window end. */
const TRAJECTORY_YEARS = [1327, 1347, 1350, 1361] as const;
/** PR10: the pre-plague CBR/CDR window — the same span `populationPrePlagueChangePercent` measures, [1327, 1347). */
const PRE_PLAGUE_WINDOW = { startYear: 1327, endYear: 1347 } as const;
/** PR10: the age band `isFertileAge`/`FERTILITY_HAZARD_BANDS` treat as a woman's fertile window — the ASMFR/never-married cohort-completeness threshold below. */
const FEMALE_FERTILE_WINDOW_END_AGE = 45;
/** PR10: the age by which a never-married person's outcome is treated as settled, for the never-married-share diagnostic. */
const NEVER_MARRIED_COHORT_AGE = 45;

type CalibrationSet = "period" | "tudor";

/** PR10: adult-only (age >= 16) bands, reusing `MORTALITY_BY_AGE_BAND`'s own cutpoints so the observed rate compares directly against the table it's checked against. */
const ADULT_MORTALITY_BANDS: readonly AgeBand[] = MORTALITY_BY_AGE_BAND.filter((b) => b.maxAge > 15).map((b) => ({ maxAge: b.maxAge, label: b.maxAge === Infinity ? "90+" : `<${b.maxAge}` }));
const MORTALITY_TABLE_HAZARD_BY_LABEL: Readonly<Record<string, number>> = Object.fromEntries(ADULT_MORTALITY_BANDS.map((b) => [b.label, MORTALITY_BY_AGE_BAND.find((m) => m.maxAge === b.maxAge)!.hazard]));

/** PR10: fertility age bands, reusing `FERTILITY_HAZARD_BANDS`'s own cutpoints so ASMFR compares directly against the hazard curve that's meant to produce it. */
const FERTILITY_AGE_BANDS: readonly AgeBand[] = FERTILITY_HAZARD_BANDS.map((b) => ({ maxAge: b.maxAge, label: b.maxAge === Infinity ? "40+" : `<${b.maxAge}` }));
const FERTILITY_TABLE_HAZARD_BY_LABEL: Readonly<Record<string, number>> = Object.fromEntries(FERTILITY_AGE_BANDS.map((b) => [b.label, FERTILITY_HAZARD_BANDS.find((f) => f.maxAge === b.maxAge)!.hazard]));

/**
 * PR11 (STEP 0 fix, RDD advisory carried over from PR10): an immigrant's `birthYear` is
 * back-computed from their arrival age (`simulate.ts#spawnImmigrant`, "18 + a spread of years"),
 * NOT a real developmental clock — the same fact decision 066's marriage-age cohort exclusion and
 * this script's own e0/marriage-age measurements already document. Before this fix, `aliveAtYear`
 * used ONLY `birthYear <= y`, so an immigrant who arrives in, say, 1350 at age 25 (birthYear
 * back-computed to 1325) read as "alive" at 1327 — three years before they ever joined the
 * village — inflating every population-trajectory checkpoint and CBR/CDR person-year count that
 * falls before their real arrival. Fixed by looking up each immigrant's REAL arrival year from
 * their own `move`/`arrived: true` event (the same event `immigrantArrivals` below already counts)
 * and refusing to count them alive before it. Founders and in-sim births have no such event and are
 * unaffected (`arrivalYear` is `undefined` for them, so the check is a no-op).
 */
function immigrantArrivalYears(events: readonly Event[]): ReadonlyMap<string, number> {
  const arrivals = new Map<string, number>();
  for (const e of events) {
    if (e.kind === "move" && e.payload.arrived === true) {
      const id = e.actors[0];
      if (id) arrivals.set(id, e.year);
    }
  }
  return arrivals;
}

/** Whether `person` was alive during calendar year `y` — same convention as the single-seed mode's `endAlive` (a death in year Y is no longer "alive" as of Y). `arrivalYear`, when given, refuses to count an immigrant as alive before they actually joined the village (see `immigrantArrivalYears`'s own doc comment). */
function aliveAtYear(person: Person, y: number, arrivalYear?: number): boolean {
  if (arrivalYear !== undefined && y < arrivalYear) return false;
  return person.birthYear <= y && (person.deathYear === undefined || person.deathYear > y);
}

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
  /** PR11 (decision 072): median age at first marriage, same cohort, by sex — the mean is pulled up by a long right tail (decision 070's own finding), so the median is reported alongside it, not as a replacement. */
  readonly marriageAgeMedianBySex: Readonly<Record<"f" | "m", number>>;
  /** Mean age at first marriage, same cohort, by social class + sex — task 8.1's per-class view. */
  readonly marriageAgeByClassSex: Readonly<Record<string, number>>;
  /** PR11 (decision 072): median age at first marriage, same cohort, by social class + sex. */
  readonly marriageAgeMedianByClassSex: Readonly<Record<string, number>>;
  readonly merchantMenMarriageAge: number;
  /** PR10 (GOAL B): gentry's own per-class marriage-age bands (`marriageAgeByClassSex`'s gentry cells, surfaced explicitly for `--assert`). */
  readonly gentryWomenMarriageAge: number;
  readonly gentryMenMarriageAge: number;
  /** % of widows who ever remarry, split by whether they were widowed before or from 1349 onward. */
  readonly widowRemarriagePre1349Pct: number;
  readonly widowRemarriagePost1349Pct: number;
  /** % of the `motherId`-set cohort who survived infancy (age>=2) but die by age 7. */
  readonly under7AdditionalDeathPct: number;
  /** % literate among the `motherId`-set cohort with a resolved literacy flag. */
  readonly literacyPct: number;
  readonly hazardFallbackCount: number;

  // --- PR10: population-trajectory / life-table accounting (GOAL A) --------------------------------
  /** Average living population (`aliveAtYear`) at each trajectory checkpoint — `NaN` for `--set tudor`, whose window doesn't cover them. */
  readonly population: Readonly<Record<(typeof TRAJECTORY_YEARS)[number], number>>;
  readonly populationPrePlagueChangePercent: number;
  readonly populationPlagueShockPercent: number;
  readonly populationRecoveryChangePercent: number;
  /** Crude birth/death rate, per 1,000 person-years, over `PRE_PLAGUE_WINDOW`. */
  readonly cbrPrePlaguePer1000: number;
  readonly cdrPrePlaguePer1000: number;
  /** Children ever born to a marriage whose family size is a settled fact — the wife has died (fertility ended then, fully resolved) or lived to the end of her fertile window. Includes marriages cut short by early death, so it's a "family size at resolution" figure, not a mortality-free "intact marriage" one — comparable in spirit to the ~6-7 research anchor, but read alongside the adult-mortality figures above, not in isolation. */
  readonly meanChildrenPerCompletedMarriage: number;
  readonly completedMarriageSamples: number;
  /** Age-specific marital fertility rate (births per married-woman-year), banded like `FERTILITY_HAZARD_BANDS`. */
  readonly maritalFertilityByAgeBand: Readonly<Record<string, AgeBandRate>>;
  /** Observed adult (age>=16) mortality by age band, EXCLUDING Black Death/second-pestilence years, banded like `MORTALITY_BY_AGE_BAND`'s adult rows — the "vs the actuarial table" comparison. */
  readonly adultMortalityByAgeBand: Readonly<Record<string, AgeBandRate>>;
  /** % of the `motherId`-set cohort (age>=45 by window end, i.e. fully observable) who never married. */
  readonly neverMarriedWomenPct: number;
  readonly neverMarriedMenPct: number;
  /** Migration accounting: `simulate.ts`'s own "immigration"/Y3-leave-home/"return" move events. */
  readonly immigrantArrivals: number;
  readonly homeLeavers: number;
  readonly returnedHome: number;
  readonly netMigration: number;
  /** % of the living population, at the window's own end year, who left home (Y3) and never returned — confirms whether "leaving home" removes someone from the population COUNT (it does not; see the diagnosis in decision 071). */
  readonly awayShareOfLivingPct: number;
}

function mean(samples: readonly number[]): number {
  return samples.length > 0 ? samples.reduce((a, b) => a + b, 0) / samples.length : NaN;
}

/** PR11 (decision 072): median alongside mean — decision 070's own precedent ("the mean is pulled up by a long right tail... report regardless of pass/fail") reported this by hand; now a first-class field of `--stats`'s own output. */
function median(samples: readonly number[]): number {
  if (samples.length === 0) return NaN;
  const sorted = [...samples].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/** Sums every band's `exposure`/`events` across per-seed partial tables, then recomputes each band's rate once — mirrors how every other aggregate below accumulates across seeds before dividing. */
function mergeAgeBandRates(accumulated: Record<string, { exposure: number; events: number }>, partial: Readonly<Record<string, AgeBandRate>>): void {
  for (const [label, rate] of Object.entries(partial)) {
    const entry = (accumulated[label] ??= { exposure: 0, events: 0 });
    entry.exposure += rate.exposure;
    entry.events += rate.events;
  }
}

function finalizeAgeBandRates(accumulated: Readonly<Record<string, { exposure: number; events: number }>>): Readonly<Record<string, AgeBandRate>> {
  const result: Record<string, AgeBandRate> = {};
  for (const [label, entry] of Object.entries(accumulated)) {
    result[label] = { exposure: entry.exposure, events: entry.events, rate: entry.exposure > 0 ? entry.events / entry.exposure : NaN };
  }
  return result;
}

async function runStats(seedCount: number, set: CalibrationSet): Promise<StatsResult> {
  const window = set === "period" ? PERIOD_WINDOW : TUDOR_WINDOW;
  const decisionMaker = new RuleDecisionMaker();
  const trackTrajectory = set === "period" && window.startYear <= TRAJECTORY_YEARS[0] && window.endYear >= TRAJECTORY_YEARS[TRAJECTORY_YEARS.length - 1];

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

  // PR10 accumulators
  const populationSamples: Record<number, number[]> = Object.fromEntries(TRAJECTORY_YEARS.map((y) => [y, []]));
  let prePlagueBirths = 0;
  let prePlagueDeaths = 0;
  let prePlaguePersonYears = 0;
  const completedMarriageChildCounts: number[] = [];
  const maritalFertilityAccumulated: Record<string, { exposure: number; events: number }> = {};
  const adultMortalityAccumulated: Record<string, { exposure: number; events: number }> = {};
  const neverMarriedCohortF: { everMarried: boolean }[] = [];
  const neverMarriedCohortM: { everMarried: boolean }[] = [];
  let immigrantArrivals = 0;
  let homeLeavers = 0;
  let returnedHome = 0;
  let livingAtWindowEnd = 0;
  let awayAtWindowEnd = 0;

  for (let i = 0; i < seedCount; i++) {
    const { config, people } = generateWorld({ seed: `demo-stats-${i}`, startYear: window.startYear, endYear: window.endYear });
    const report = await simulate(config, people, [], { decisionMaker, engineSource: "rules" });
    const finalPeople = report.result.people;
    const events = report.result.events;
    const endYear = config.endYear;
    for (const count of Object.values(report.hazardFallbacks)) hazardFallbackCount += count;

    const births = events.filter((e) => e.kind === "birth");
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
    const widowedEvents = events.filter((e) => e.kind === "widowed");
    const marriageEventsSorted = events.filter((e) => e.kind === "marriage").sort((a, b) => a.year - b.year);
    for (const marriage of marriageEventsSorted) {
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
      const remarried = events.some((e) => e.kind === "marriage" && e.year > widowedEvent.year && e.actors.includes(personId));
      if (widowedEvent.year < 1349) {
        widowedPre1349++;
        if (remarried) widowedPre1349Remarried++;
      } else {
        widowedPost1349++;
        if (remarried) widowedPost1349Remarried++;
      }
    }

    // --- PR10: population trajectory + CBR/CDR -----------------------------------------------------
    const arrivalYears = immigrantArrivalYears(events); // PR11 STEP 0: immortal-time-before-arrival fix
    if (trackTrajectory) {
      for (const y of TRAJECTORY_YEARS) {
        populationSamples[y]!.push(Object.values(finalPeople).filter((p) => aliveAtYear(p, y, arrivalYears.get(p.id))).length);
      }
      for (let y = PRE_PLAGUE_WINDOW.startYear; y < PRE_PLAGUE_WINDOW.endYear; y++) {
        prePlaguePersonYears += Object.values(finalPeople).filter((p) => aliveAtYear(p, y, arrivalYears.get(p.id))).length;
      }
      prePlagueBirths += events.filter((e) => e.kind === "birth" && e.year >= PRE_PLAGUE_WINDOW.startYear && e.year < PRE_PLAGUE_WINDOW.endYear).length;
      prePlagueDeaths += events.filter((e) => e.kind === "death" && e.year >= PRE_PLAGUE_WINDOW.startYear && e.year < PRE_PLAGUE_WINDOW.endYear).length;
    }

    // --- PR10: children per completed marriage + age-specific marital fertility --------------------
    const birthYearsByMother = new Map<string, Set<number>>();
    for (const e of events) {
      if (e.kind !== "birth") continue;
      const motherId = e.actors[1];
      if (!motherId) continue;
      const set = birthYearsByMother.get(motherId) ?? new Set<number>();
      set.add(e.year);
      birthYearsByMother.set(motherId, set);
    }
    const fertilityObservations: AgeBandObservation[] = [];
    const wivesById = new Map<string, { id: string; birthYear: number; deathYear?: number }>();
    const marriageRecords: { wifeId: string; marriageYear: number }[] = [];
    for (const marriage of marriageEventsSorted) {
      const [aId, bId] = marriage.actors;
      const a = aId ? finalPeople[aId] : undefined;
      const b = bId ? finalPeople[bId] : undefined;
      if (!a || !b) continue;
      const wife = a.sex === "f" ? a : b.sex === "f" ? b : undefined;
      const husband = a.sex === "m" ? a : b.sex === "m" ? b : undefined;
      if (!wife || !husband) continue;

      wivesById.set(wife.id, { id: wife.id, birthYear: wife.birthYear, deathYear: wife.deathYear });
      marriageRecords.push({ wifeId: wife.id, marriageYear: marriage.year });

      const start = Math.max(marriage.year, window.startYear);
      const end = Math.min(wife.deathYear ?? window.endYear, husband.deathYear ?? window.endYear, window.endYear);
      const birthYears = birthYearsByMother.get(wife.id);
      for (let y = start; y < end; y++) {
        const age = y - wife.birthYear;
        if (age < 16 || age >= FEMALE_FERTILE_WINDOW_END_AGE) continue;
        fertilityObservations.push({ age, occurred: birthYears?.has(y) ?? false });
      }
    }
    mergeAgeBandRates(maritalFertilityAccumulated, rateByAgeBand(fertilityObservations, FERTILITY_AGE_BANDS));

    // PR14 STEP 1 (decision 076): the historical "~6-7 children ever born per completed marriage"
    // anchor is a PER-WIFE lifetime total for a woman who married and SURVIVED to the end of her
    // fertile window (45) — not a per-MARRIAGE sample. The previous version of this loop pushed a
    // sample for every marriage event that (by itself) passed `inNeverMarriedCohort`, which only
    // checks the wife's own survival, not which marriage: a remarried wife who survives to 45 (the
    // Black Death widows many mid-window) was counted once per marriage, her true lifetime children
    // split into deflated per-husband samples, and a marriage starting at/after 45 was counted
    // despite zero possible fertile exposure. `completedMarriageWives` selects one wife id per
    // qualifying cohort member; her TOTAL children (any father, any marriage) is summed here exactly
    // once. See `population-stats.ts#completedMarriageWives`'s own doc comment for the full
    // before/after evidence.
    for (const wifeId of completedMarriageWives(marriageRecords, wivesById, endYear, FEMALE_FERTILE_WINDOW_END_AGE)) {
      const childCount = Object.values(finalPeople).filter((c) => c.motherId === wifeId).length;
      completedMarriageChildCounts.push(childCount);
    }

    // --- PR10: adult mortality by age band, vs actuarial.ts's own table -----------------------------
    // PR11 (STEP 0 fix, RDD advisory carried over from PR10): this loop walked from
    // `person.birthYear + 16` for EVERY person, including immigrants — whose `birthYear` is
    // back-computed, not real (see `immigrantArrivalYears`'s own doc comment above). That credited
    // an immigrant with years of risk-free "survival" exposure BEFORE they ever joined the village
    // (classic immortal-time bias: person-years with zero possible death events, deflating the
    // observed rate). `arrivalYears.get(person.id)` is `undefined` for founders/in-sim births (no
    // `move`/`arrived` event), so `Math.max` with it is a no-op for them.
    const adultMortalityObservations: AgeBandObservation[] = [];
    for (const person of Object.values(finalPeople)) {
      const from = Math.max(person.birthYear + 16, window.startYear, arrivalYears.get(person.id) ?? -Infinity);
      const to = person.deathYear !== undefined ? Math.min(person.deathYear, window.endYear) : window.endYear;
      for (let y = from; y <= to; y++) {
        if (BLACK_DEATH_YEARS.has(y) || SECOND_PESTILENCE_YEARS.has(y)) continue;
        adultMortalityObservations.push({ age: y - person.birthYear, occurred: person.deathYear === y });
      }
    }
    mergeAgeBandRates(adultMortalityAccumulated, rateByAgeBand(adultMortalityObservations, ADULT_MORTALITY_BANDS));

    // --- PR10: never-married share (motherId-set cohort, survived to and observable at the cohort age) -
    const everMarriedIds = new Set<string>();
    for (const e of events) if (e.kind === "marriage") for (const actorId of e.actors) everMarriedIds.add(actorId);
    for (const person of Object.values(finalPeople)) {
      if (person.motherId === undefined) continue;
      if (!inNeverMarriedCohort(person, endYear, NEVER_MARRIED_COHORT_AGE)) continue;
      const entry = { everMarried: everMarriedIds.has(person.id) };
      (person.sex === "f" ? neverMarriedCohortF : neverMarriedCohortM).push(entry);
    }

    // --- PR10: migration accounting ------------------------------------------------------------------
    immigrantArrivals += events.filter((e) => e.kind === "move" && e.payload.arrived === true).length;
    homeLeavers += events.filter((e) => e.kind === "move" && e.payload.away === true).length;
    returnedHome += events.filter((e) => e.kind === "move" && e.payload.returned === true).length;
    const livingThisSeed = Object.values(finalPeople).filter((p) => p.deathYear === undefined);
    livingAtWindowEnd += livingThisSeed.length;
    awayAtWindowEnd += livingThisSeed.filter((p) => hasMovedAway(events, p.id)).length;
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
  // Censoring-corrected (decision 077): the mean age at death of those who already died is biased low
  // while part of the from-birth cohort is still alive at window end.
  const e0 = lifeExpectancyFromExposure(motherIdCohort, window.endYear);
  const e0AllDeaths = avg(ageAtDeathAll);
  const under15Pct = under15.resolved > 0 ? (100 * under15.deaths) / under15.resolved : NaN;
  const under7AdditionalDeathPct = under7Additional.resolved > 0 ? (100 * under7Additional.deaths) / under7Additional.resolved : NaN;
  const literacyPct = literacyResolved > 0 ? (100 * literateCount) / literacyResolved : NaN;

  const marriageAgeByClassSex: Record<string, number> = {};
  const marriageAgeMedianByClassSex: Record<string, number> = {};
  for (const [key, ages] of Object.entries(marriageAgesByClassSex)) {
    marriageAgeByClassSex[key] = avg(ages);
    marriageAgeMedianByClassSex[key] = median(ages);
  }

  const population = Object.fromEntries(TRAJECTORY_YEARS.map((y) => [y, avg(populationSamples[y]!)])) as Record<(typeof TRAJECTORY_YEARS)[number], number>;
  const percentChange = (from: number, to: number) => (100 * (to - from)) / from;

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
    marriageAgeMedianBySex: { f: median(marriageAges.f), m: median(marriageAges.m) },
    marriageAgeByClassSex,
    marriageAgeMedianByClassSex,
    merchantMenMarriageAge: avg(marriageAgesByClassSex["merchant/m"] ?? []),
    gentryWomenMarriageAge: avg(marriageAgesByClassSex["gentry/f"] ?? []),
    gentryMenMarriageAge: avg(marriageAgesByClassSex["gentry/m"] ?? []),
    widowRemarriagePre1349Pct: widowedPre1349 > 0 ? (100 * widowedPre1349Remarried) / widowedPre1349 : NaN,
    widowRemarriagePost1349Pct: widowedPost1349 > 0 ? (100 * widowedPost1349Remarried) / widowedPost1349 : NaN,
    under7AdditionalDeathPct,
    literacyPct,
    hazardFallbackCount,

    population,
    populationPrePlagueChangePercent: percentChange(population[1327], population[1347]),
    populationPlagueShockPercent: percentChange(population[1347], population[1350]),
    populationRecoveryChangePercent: percentChange(population[1350], population[1361]),
    cbrPrePlaguePer1000: prePlaguePersonYears > 0 ? (1000 * prePlagueBirths) / prePlaguePersonYears : NaN,
    cdrPrePlaguePer1000: prePlaguePersonYears > 0 ? (1000 * prePlagueDeaths) / prePlaguePersonYears : NaN,
    meanChildrenPerCompletedMarriage: meanChildrenPerMarriage(completedMarriageChildCounts.map((childCount) => ({ childCount }))),
    completedMarriageSamples: completedMarriageChildCounts.length,
    maritalFertilityByAgeBand: finalizeAgeBandRates(maritalFertilityAccumulated),
    adultMortalityByAgeBand: finalizeAgeBandRates(adultMortalityAccumulated),
    neverMarriedWomenPct: neverMarriedSharePercent(neverMarriedCohortF),
    neverMarriedMenPct: neverMarriedSharePercent(neverMarriedCohortM),
    immigrantArrivals,
    homeLeavers,
    returnedHome,
    netMigration: immigrantArrivals - (homeLeavers - returnedHome),
    awayShareOfLivingPct: livingAtWindowEnd > 0 ? (100 * awayAtWindowEnd) / livingAtWindowEnd : NaN,
  };
}

function printStats(result: StatsResult, set: CalibrationSet): void {
  console.log(`\nStats across ${result.seedCount} seeds, ${result.window.startYear}-${result.window.endYear} village runs (--set ${set}):`);
  console.log(`  Births with >=1yr follow-up: ${result.observedBirths}. Infant deaths (age<=1): ${result.infantDeaths}.`);
  console.log(`  Infant mortality: ${result.imrPer1000.toFixed(1)} per 1,000 births.`);
  console.log(`  Life expectancy at birth (from-birth cohort, censoring-corrected; ${result.e0Samples} observed deaths): ${result.e0.toFixed(1)} years.`);
  console.log(`  Share dying before age 15 (of resolved outcomes): ${result.under15Pct.toFixed(1)}%.`);
  console.log(`  Additional share dying by age 7, of those surviving infancy: ${result.under7AdditionalDeathPct.toFixed(1)}%.`);
  console.log(`  (Context only — population-wide avg age at death incl. adult founders): ${result.e0AllDeaths.toFixed(1)} years.`);
  console.log(`  Mean age at first marriage: F=${result.marriageAgeBySex.f.toFixed(1)} (n=${result.marriageAgeSamples.f}), M=${result.marriageAgeBySex.m.toFixed(1)} (n=${result.marriageAgeSamples.m}).`);
  console.log(`  Median age at first marriage: F=${result.marriageAgeMedianBySex.f.toFixed(1)}, M=${result.marriageAgeMedianBySex.m.toFixed(1)}.`);
  console.log(`  Mean age at first marriage by class/sex: ${JSON.stringify(Object.fromEntries(Object.entries(result.marriageAgeByClassSex).map(([k, v]) => [k, Number(v.toFixed(1))])))}`);
  console.log(`  Median age at first marriage by class/sex: ${JSON.stringify(Object.fromEntries(Object.entries(result.marriageAgeMedianByClassSex).map(([k, v]) => [k, Number(v.toFixed(1))])))}`);
  console.log(`  Merchant men mean first-marriage age: ${result.merchantMenMarriageAge.toFixed(1)}.`);
  console.log(`  Gentry mean first-marriage age: F=${result.gentryWomenMarriageAge.toFixed(1)}, M=${result.gentryMenMarriageAge.toFixed(1)}.`);
  console.log(`  Widow remarriage: pre-1349=${result.widowRemarriagePre1349Pct.toFixed(1)}%, post-1349=${result.widowRemarriagePost1349Pct.toFixed(1)}%.`);
  console.log(`  Literacy: ${result.literacyPct.toFixed(1)}%.`);
  console.log(`  Hazard-table lookup fallbacks: ${result.hazardFallbackCount}.`);

  if (set === "period") {
    console.log(`\n  --- PR10 life-table / accounting view (decision 071) ---`);
    console.log(`  Population trajectory: ${TRAJECTORY_YEARS.map((y) => `${y}=${result.population[y].toFixed(1)}`).join(", ")}.`);
    console.log(
      `  Change: pre-plague (1327->1347) ${result.populationPrePlagueChangePercent.toFixed(1)}%, ` +
        `plague shock (1347->1350) ${result.populationPlagueShockPercent.toFixed(1)}%, ` +
        `recovery (1350->1361) ${result.populationRecoveryChangePercent.toFixed(1)}%.`,
    );
    console.log(`  Pre-plague CBR: ${result.cbrPrePlaguePer1000.toFixed(1)} per 1,000/yr. Pre-plague CDR: ${result.cdrPrePlaguePer1000.toFixed(1)} per 1,000/yr.`);
    console.log(`  Children ever born per completed marriage: ${result.meanChildrenPerCompletedMarriage.toFixed(2)} (n=${result.completedMarriageSamples}).`);
    console.log(`  Age-specific marital fertility (observed rate vs. FERTILITY_HAZARD_BANDS's own hazard):`);
    for (const [label, rate] of Object.entries(result.maritalFertilityByAgeBand)) {
      console.log(`    ${label}: observed=${(rate.rate * 100).toFixed(1)}% (n=${rate.exposure} woman-years), table hazard=${(FERTILITY_TABLE_HAZARD_BY_LABEL[label]! * 100).toFixed(1)}%.`);
    }
    console.log(`  Adult mortality by age band (observed, excl. Black Death/2nd pestilence years, vs. MORTALITY_BY_AGE_BAND):`);
    for (const [label, rate] of Object.entries(result.adultMortalityByAgeBand)) {
      console.log(`    ${label}: observed=${(rate.rate * 100).toFixed(2)}% (n=${rate.exposure} person-years), table hazard=${(MORTALITY_TABLE_HAZARD_BY_LABEL[label]! * 100).toFixed(2)}%.`);
    }
    console.log(`  Never married by age ${NEVER_MARRIED_COHORT_AGE}: F=${result.neverMarriedWomenPct.toFixed(1)}%, M=${result.neverMarriedMenPct.toFixed(1)}%.`);
    console.log(
      `  Migration: ${result.immigrantArrivals} arrivals, ${result.homeLeavers} left home, ${result.returnedHome} returned ` +
        `(net ${result.netMigration >= 0 ? "+" : ""}${result.netMigration}).`,
    );
    console.log(`  Of the living population at window end, ${result.awayShareOfLivingPct.toFixed(1)}% left home (Y3) and never returned — still counted as living population, not removed.`);
  }
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
    { label: "firstMarriageAgeWomenGentry", value: result.gentryWomenMarriageAge, ...CALIBRATION_TARGETS.firstMarriageAgeWomenGentry! },
    { label: "firstMarriageAgeMenGentry", value: result.gentryMenMarriageAge, ...CALIBRATION_TARGETS.firstMarriageAgeMenGentry! },
    { label: "widowRemarriagePreBlackDeath", value: result.widowRemarriagePre1349Pct, ...CALIBRATION_TARGETS.widowRemarriagePreBlackDeath! },
    { label: "widowRemarriagePostBlackDeath", value: result.widowRemarriagePost1349Pct, ...CALIBRATION_TARGETS.widowRemarriagePostBlackDeath! },
    { label: "lifeExpectancyAtBirth", value: result.e0, ...CALIBRATION_TARGETS.lifeExpectancyAtBirth! },
    { label: "infantMortality", value: result.imrPer1000 / 10, ...CALIBRATION_TARGETS.infantMortality! }, // per-1000 -> %
    { label: "under15DeathShare (additional, by age 7)", value: result.under7AdditionalDeathPct, ...CALIBRATION_TARGETS.under15DeathShare! },
    { label: "literacyOverall", value: result.literacyPct, ...CALIBRATION_TARGETS.literacyOverall! },
    { label: "populationPrePlagueChangePercent", value: result.populationPrePlagueChangePercent, ...CALIBRATION_TARGETS.populationPrePlagueChangePercent! },
    { label: "populationPlagueShockPercent", value: result.populationPlagueShockPercent, ...CALIBRATION_TARGETS.populationPlagueShockPercent! },
    { label: "populationRecoveryChangePercent", value: result.populationRecoveryChangePercent, ...CALIBRATION_TARGETS.populationRecoveryChangePercent! },
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

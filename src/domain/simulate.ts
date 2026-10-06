import { ageInYear, isAdult, isFertileAge, isWorkingAge } from "./actuarial";
import { captureLegacyYear, runLegacyYear, type LegacyRunContext, type ResolvedDecision } from "./legacy-year";
import { dreamGoalSatisfiedBy, livingChildId, livingSiblingId, relationshipTargetId, resolveCourtshipOnDeath } from "./legacy-year-mechanics";
export { conceptionProbability, fertilityDampingFactor } from "./legacy-year-mechanics";
import type { MintedId } from "./decision-id";
import type { DecisionMaker, DecisionOption, DecisionQuestion, DecisionRecord } from "./decisions";
import { activeFeudPair, activeRomancePair, awayMoveYear, eventsFor, hasMovedAway, isAlive, lastIllnessYear, pairKey } from "./events";
import { biologyDistribution } from "./life-course-rules";
import { ensureLifeState, markMarriageable } from "./life-state";
import { compactMindState, computeMood, type DreamGoal, renderPortrait } from "./mind";
import type { Locale } from "./locale";
import {
  IMMIGRATION_POPULATION_CAP_RATIO,
  MARRIAGE_FLOORS,
  RETURN_HOME_MIN_AWAY_YEARS,
} from "./params/demography";
import { FALLBACK_CLASS } from "./period/classes";
import {
  BLACK_DEATH_YEARS,
  SECOND_PESTILENCE_YEARS,
} from "./period/events";
import { minEligibleAge } from "./hazards";
import { decisionFragility, isSurprise, keyedDraw, keyedRng, normalizeDistribution, NOT_FRAGILE, sampleGumbelMax } from "./rng";
import { ruleDistribution } from "./rule-heuristics";
import { seasonFor } from "./town";
import type { Event, EventKind, JsonValue, Job, Override, Person, Sex, SimulationResult, SocialClass, WorldConfig, YearSnapshot } from "./types";
import { eligibleVignettePool, getVignette, getVignetteForOption, pickVignette, type Vignette, type VignetteContext } from "./vignettes";
import { pickJobForClass } from "./worldgen";

const DEFAULT_CONCURRENCY_LIMIT = 8;

/** Round 11 (decision 044): how many people's person-year batches to request in parallel within a single simulated year. Distinct from `DEFAULT_CONCURRENCY_LIMIT` (biology/legacy per-candidate calls) — this is the fan-out width across people, throttled further by the adapter's own rate limiter. */
const DEFAULT_YEAR_BATCH_CONCURRENCY = 64;

export interface SimulateOptions {
  readonly decisionMaker: DecisionMaker;
  /** Which engine `decisionMaker` is, so `resolveSocialDecision` knows whether to treat its answer as `jevRaw` or a plain `prior`. */
  readonly engineSource: "jev" | "rules";
  /**
   * Decision 084: decides every person-year OUTSIDE the protagonist's story circle
   * (`story-circle.ts`), so only the circle pays for `decisionMaker` (Jev) and a life fits in about a
   * minute. Its decisions are recorded with source `"rules"`. When absent, or when there is no
   * protagonist, `decisionMaker` decides for everyone, as before.
   */
  readonly backgroundDecisionMaker?: DecisionMaker;
  readonly overrides?: readonly Override[];
  readonly concurrencyLimit?: number;
  /** Round 11 (decision 044): how many people's person-year `decideYear` batches to request in parallel within one simulated year. Default 64. */
  readonly yearBatchConcurrency?: number;
  /** Continue an existing run from this year instead of `config.startYear` (used by fork). */
  readonly fromYear?: number;
  /**
   * Round 9 (decision 034, the single-life pivot). When set:
   *  - the extended, protagonist-only situation catalog (C1, C4, Y2, Y5, A4, A7, A9, A10, O1, O3,
   *    AP1, PIL1, the lord's levy) is gated on, purely additive — with no `protagonistId`, this
   *    option has ZERO effect on candidate gathering, resolution or output, so every non-protagonist
   *    caller and test keeps its exact byte-for-byte behavior.
   *  - the yearly loop stops once this person has a `deathYear` (their life is what's being told).
   *  - this person's own social decisions are never diverted to the budget fallback below.
   */
  readonly protagonistId?: string;
  /**
   * PR11 (STEP 1, `sdd/engine-life-course/state`): a one-time diagnostic collector for the marriage
   * FUNNEL (eligible -> partner found -> Y1 emitted -> Y1 wins the competing-risk draw -> outcome ->
   * romance -> A1 offered -> A1 wins its own draw -> married), plus reasons no partner was found.
   * `undefined` (the default, every existing caller) means every instrumentation check below is a
   * single falsy branch — zero behavioral or measurable perf effect on a normal run; nothing here
   * reads or influences any RNG draw, so attaching a collector cannot change `people`/`events`/
   * `decisions` output for a given seed (see `simulate.test.ts`'s own determinism check for this).
   */
  readonly marriageFunnelDebug?: MarriageFunnelCollector;
}

/** PR11 (STEP 1) marriage-funnel diagnostic counters — see `SimulateOptions.marriageFunnelDebug`'s own doc comment. */
export interface MarriageFunnelCollector {
  /** Person-years where a single person passed Y1's own age/canMarry/mourning gate (simulate.ts's `if` right before `eligible()` is tried), restricted to `marriageFunnelCohort`. */
  eligiblePersonYears: number;
  /**
   * Person-years where `eligible()` found a partner. Identical to "a Y1 candidate was emitted" BY
   * CONSTRUCTION — `gatherCandidatesForYear` only pushes a `Y1` candidate when `eligible()` returns
   * someone (see the `if (partner)` guard) — so one counter stands in for both funnel stages the
   * task asked for; reported under both names in `check-demographics.ts`'s funnel table.
   */
  partnerFoundPersonYears: number;
  /** Of those, how many actually won that person-year's competing-risk selection draw (i.e. the Y1 candidate was the one thing that happened to this person that year). */
  y1WonDraw: number;
  /** Outcome breakdown among `y1WonDraw` — sums to `y1WonDraw`. */
  readonly y1Outcomes: { encourage: number; decline: number; wait: number };
  /** Of the "encourage" outcomes, how many actually created a romance event (guarded by neither side already being married that same year — see the Y1 "encourage" case). */
  romancesCreated: number;
  /** A1 (proposal) candidates emitted for a person in the cohort (once per established, >=1-year-old romance per year). */
  a1Offered: number;
  /** Of those, how many won their own person-year's competing-risk draw. */
  a1WonDraw: number;
  /** Outcome breakdown among `a1WonDraw` — sums to `a1WonDraw`. */
  readonly a1Outcomes: { propose: number; delay: number; "end-it": number };
  /** Of the "propose" outcomes, how many actually resolved to a marriage event (guarded the same way as `romancesCreated`). */
  married: number;
  /**
   * Candidate-level tally of why `eligible()`'s six tiers all failed for a person who WAS otherwise
   * eligible — one increment per opposite-sex village candidate examined (not one per person-year),
   * classified by the first predicate `eligible()` itself checks that this specific candidate fails,
   * at the widest window (age gap <= 40, any class). "Different class only" never appears here: since
   * `eligible()` always retries at `sameClassOnly=false` before giving up, a candidate blocked ONLY by
   * class would already have been matched — see `matchesByCrossClassTier` for that preference-only
   * signal instead. `unclassified` must stay 0 (see `classifyNoPartnerReasons`'s own doc comment) —
   * a nonzero value means this classifier's predicate chain has drifted from `eligible()`'s own.
   */
  readonly noPartnerReasons: {
    /** Zero living opposite-sex people in the whole village (dead or never generated). */
    noLivingCandidate: number;
    /** Opposite-sex living people exist, but every one of them has moved away (`hasMovedAway`). */
    awayOnly: number;
    claimed: number;
    alreadyMarried: number;
    alreadyCourting: number;
    related: number;
    notMarriageableAge: number;
    ageWindow: number;
    unclassified: number;
  };
  /** Of `partnerFoundPersonYears`, how many matched within the same social class (tiers 1-3: age gap 10/20/40, `sameClassOnly=true`). */
  matchesBySameClassTier: number;
  /** Of `partnerFoundPersonYears`, how many matched only after falling back to any class (tiers 4-6). */
  matchesByCrossClassTier: number;
  /**
   * PR12 STEP 1 diagnostic: of `partnerFoundPersonYears` minus `y1WonDraw` (a Y1 candidate was
   * offered but did NOT win that person-year's competing-risk draw), what actually won instead —
   * keyed by the other situation's `kind` (e.g. "A2", "Y3"), `"nothing"` (the residual — no
   * situation occurred at all this person-year), or `"everyday"` (a D1 daily-life vignette won).
   * Always sums to exactly `partnerFoundPersonYears - y1WonDraw`.
   */
  readonly y1LosesTo: Record<string, number>;
}

export function createMarriageFunnelCollector(): MarriageFunnelCollector {
  return {
    eligiblePersonYears: 0,
    partnerFoundPersonYears: 0,
    y1WonDraw: 0,
    y1Outcomes: { encourage: 0, decline: 0, wait: 0 },
    romancesCreated: 0,
    a1Offered: 0,
    a1WonDraw: 0,
    a1Outcomes: { propose: 0, delay: 0, "end-it": 0 },
    married: 0,
    noPartnerReasons: {
      noLivingCandidate: 0,
      awayOnly: 0,
      claimed: 0,
      alreadyMarried: 0,
      alreadyCourting: 0,
      related: 0,
      notMarriageableAge: 0,
      ageWindow: 0,
      unclassified: 0,
    },
    matchesBySameClassTier: 0,
    matchesByCrossClassTier: 0,
    y1LosesTo: {},
  };
}

/**
 * PR11 (STEP 1) diagnostic cohort: people whose own developmental history the engine actually
 * controls — born in-sim (`motherId` set), or under 14 at `startYear` (config's real start year, not
 * a fork's `fromYear`). Excludes founders/immigrants who arrive already adult with a back-computed
 * `birthYear` that is not a real clock — the SAME exclusion decision 066's marriage-age regression
 * test already uses, for the same reason (see that test's own comment in `simulate.test.ts`).
 */
function inMarriageFunnelCohort(person: Person, startYear: number): boolean {
  return person.motherId !== undefined || person.birthYear > startYear - 14;
}

/**
 * PR11 (STEP 1) diagnostic: `person` passed Y1's own age/canMarry/mourning gate this person-year,
 * but `eligible()` (all six tiers) found nobody. Classifies WHY, per candidate examined, using the
 * exact same predicates `eligible()` checks itself, evaluated at the widest window (age gap <= 40,
 * any class) so a candidate only lands in `ageWindow` if nothing else blocks it. Read-only: takes no
 * part in the actual match (that's still `eligible()`, untouched) — purely reconstructs why it came
 * back empty, for the funnel report's own "no-partner reason" breakdown.
 */
function classifyNoPartnerReasons(
  person: Person,
  age: number,
  year: number,
  people: Readonly<Record<string, Person>>,
  events: readonly Event[],
  aliveNonMoved: readonly Person[],
  claimedPartners: ReadonlySet<string>,
  collector: MarriageFunnelCollector,
): void {
  const oppositeSexLiving = Object.values(people).filter((p) => p.id !== person.id && p.sex !== person.sex && p.deathYear === undefined);
  if (oppositeSexLiving.length === 0) {
    collector.noPartnerReasons.noLivingCandidate++;
    return;
  }
  const oppositeSexNonMoved = aliveNonMoved.filter((p) => p.id !== person.id && p.sex !== person.sex);
  if (oppositeSexNonMoved.length === 0) {
    collector.noPartnerReasons.awayOnly++;
    return;
  }
  for (const candidate of oppositeSexNonMoved) {
    if (claimedPartners.has(candidate.id)) {
      collector.noPartnerReasons.claimed++;
    } else if (candidate.spouseId) {
      collector.noPartnerReasons.alreadyMarried++;
    } else if (isRelatedForMarriage(person, candidate, people)) {
      collector.noPartnerReasons.related++;
    } else if (activeRomancePair(events, candidate.id) !== undefined) {
      collector.noPartnerReasons.alreadyCourting++;
    } else if (ageInYear(candidate.birthYear, year) < minMarriageAge(candidate) || !canMarry(candidate) || !mourningOver(candidate, events, year)) {
      collector.noPartnerReasons.notMarriageableAge++;
    } else if (Math.abs(ageInYear(candidate.birthYear, year) - age) > 40) {
      collector.noPartnerReasons.ageWindow++;
    } else {
      // This candidate passes every predicate eligible() checks at the widest tier — a contradiction
      // with "no partner found" (eligible(40, false) would have matched them). Counted, not thrown,
      // so a classifier/eligible() drift surfaces as a visible 0-should-stay-0 stat instead of
      // crashing a real run — see the collector field's own doc comment.
      collector.noPartnerReasons.unclassified++;
    }
  }
}

/**
 * PR11 (STEP 2 fix (a), decision 072): picks ONE candidate from `pool` — a seeded, deterministic,
 * weighted draw (keyed exactly like every other per-person-year decision in this file: `seed` +
 * `personId` + `year` + a distinguishing key, so re-deriving it always agrees with the real run,
 * same guarantee `keyedRng` gives everywhere else). Replaces the old `aliveNonMoved.find(...)`,
 * which deterministically returned the SAME first-id-sorted candidate every single year regardless
 * of whether that pairing ever led anywhere — see `gatherCandidatesForYear`'s own Y1 block for the
 * measured diagnosis this fixes.
 *
 * Weighted by age proximity (`1 / (1 + ageGap)`, never zero) so a closer-in-age candidate is more
 * likely to be picked, without ever fully excluding a wider-gap one within the tier's own already-
 * enforced `maxAgeGap` — the tier structure itself (age-window, then same-class-vs-any-class) still
 * does the hard filtering; this only decides WHICH of a tied pool wins for one particular year.
 */
function pickWeightedPartner(pool: readonly Person[], age: number, year: number, seed: string, personId: string, tierKey: string): Person | undefined {
  if (pool.length === 0) return undefined;
  if (pool.length === 1) return pool[0];
  const weights = pool.map((candidate) => 1 / (1 + Math.abs(ageInYear(candidate.birthYear, year) - age)));
  const total = weights.reduce((sum, w) => sum + w, 0);
  const draw = keyedRng(seed, personId, year, tierKey)() * total;
  let acc = 0;
  for (let i = 0; i < pool.length; i++) {
    acc += weights[i]!;
    if (draw < acc) return pool[i];
  }
  return pool[pool.length - 1]; // floating-point fallback: the draw should always land before this
}

/** Round 9: a decision call budget for a single life (see docs/decisions.md 037). Once the running total of REAL DecisionMaker calls for this run reaches this, any further social decision NOT about the protagonist is resolved with the deterministic rule heuristic instead of calling `decisionMaker` — the protagonist's own decisions (and decisions about them) are never throttled. */
export const LIFE_DECISION_BUDGET = 2000;

export interface SimulateReport {
  readonly result: SimulationResult;
  readonly snapshots: ReadonlyMap<number, YearSnapshot>;
  readonly wallTimeMs: number;
  readonly decisionCalls: number;
  /**
   * Engine life course PR6 (design decision 15): cumulative hazard-table lookup misses this run,
   * keyed `${kind}:${socialClass}` — sourced from the `DecisionMaker`'s own `getStats().
   * hazardFallbacks` (see `rule-decision-maker.ts`). Empty for an adapter that doesn't track it
   * (`JevDecisionMaker` before PR7, or a minimal test double). A calibration seed should show none —
   * see task 8.3's zero-fallback assertion.
   */
  readonly hazardFallbacks: Readonly<Record<string, number>>;
}

/** Incremental-simulation capability: one `simulateYears()` yield — the year just finished, and its full snapshot (people/events/decisions up to and including that year). */
export interface YearTick {
  readonly year: number;
  readonly snapshot: YearSnapshot;
}

/** Thrown by `drainSimulation` when the caller's `signal` is aborted mid-run (design decision: a disconnected SSE client stops the simulation and never persists a branch). */
export class SimulationAbortedError extends Error {
  constructor() {
    super("Simulation aborted.");
    this.name = "SimulationAbortedError";
  }
}

/**
 * Drains a `simulateYears()` generator to completion, returning its final `SimulateReport`.
 * `onYear` (if given) is called once per yielded `YearTick`, in order — the SSE routes use it to
 * build and send a provisional tick as each year finishes, rather than replaying the whole life
 * after the fact (design decision 8/9). `signal` (if given and aborted) stops draining early and
 * throws `SimulationAbortedError` instead of returning a report, so the caller never persists a
 * partial branch for a client that has already disconnected.
 */
export async function drainSimulation(
  generator: AsyncGenerator<YearTick, SimulateReport>,
  onYear?: (tick: YearTick) => void | Promise<void>,
  signal?: AbortSignal,
): Promise<SimulateReport> {
  for (;;) {
    if (signal?.aborted) throw new SimulationAbortedError();
    const step = await generator.next();
    if (step.done) return step.value;
    await onYear?.(step.value);
  }
}

function isRelated(a: Person, b: Person): boolean {
  if (a.id === b.id) return true;
  if (a.motherId === b.id || a.fatherId === b.id || b.motherId === a.id || b.fatherId === a.id) return true;
  if (a.motherId && (a.motherId === b.motherId || a.motherId === b.fatherId)) return true;
  if (a.fatherId && (a.fatherId === b.motherId || a.fatherId === b.fatherId)) return true;
  return false;
}

/**
 * Decision 053: the grandparent ids reachable from `person`'s own parent ids, via `people` (needed
 * to look up a parent's own parents — `isRelated` above only ever needs the two `Person` objects
 * directly). Missing parents/grandparents (founders, or a parent whose own parents aren't tracked)
 * just contribute nothing, which is the correct "unknown, so not provably related" reading.
 */
function grandparentIds(person: Person, people: Readonly<Record<string, Person>>): Set<string> {
  const ids = new Set<string>();
  for (const parentId of [person.motherId, person.fatherId]) {
    if (!parentId) continue;
    const parent = people[parentId];
    if (!parent) continue;
    if (parent.motherId) ids.add(parent.motherId);
    if (parent.fatherId) ids.add(parent.fatherId);
  }
  return ids;
}

/**
 * Decision 053: consanguinity to first cousins — "the most our kinship data covers" (proposal 053's
 * own scoping). Canon law (Lateran IV, canon 50; research.md, Family §rules 2) barred marriage
 * within the 4th degree of consanguinity/affinity; first cousins fall within that bar, so this is a
 * genuine, if partial, implementation of the rule, not the full 4th-degree computation — the engine
 * has no great-grandparent/great-aunt/uncle data to check further out. Sharing a grandparent implies
 * `isRelated` would already catch a sibling pair (they share BOTH parents, hence all four
 * grandparents), so this only adds NEW coverage for actual cousins.
 */
function isRelatedForMarriage(a: Person, b: Person, people: Readonly<Record<string, Person>>): boolean {
  if (isRelated(a, b)) return true;
  const aGrandparents = grandparentIds(a, people);
  if (aGrandparents.size === 0) return false;
  for (const id of grandparentIds(b, people)) {
    if (aGrandparents.has(id)) return true;
  }
  return false;
}

/**
 * A person's state for Jev (round 4): compact mind JSON plus a prose
 * portrait built from DF-style band templates (see `mind.ts`). This is
 * "who they are" for the *acting* person (`self`); other participants get
 * `otherPersonBrief` instead — name, age, job and JUST the portrait, no
 * raw mind JSON (they're not the one deciding).
 */
function personSummary(person: Person, year: number, people: Readonly<Record<string, Person>>): Record<string, JsonValue> {
  return {
    name: person.name,
    sex: person.sex,
    age: ageInYear(person.birthYear, year),
    job: person.job,
    // Decision 049: exposed so later content (vignettes, Jev's own judgment) can be class-aware.
    // Optional on `Person` for backward compat — falls back to the mapped-equivalent default class.
    socialClass: person.socialClass ?? "cottar",
    literate: person.literate ?? false,
    married: person.spouseId !== undefined,
    mind: compactMindState(person.mind),
    portrait: renderPortrait(person.name, person.mind, (id) => people[id]?.name ?? id),
  };
}

/** A short portrait of another person involved in the situation — enough for coherence, without exposing their private mind state (spec's open question: test with/without; we include it). */
function otherPersonBrief(person: Person, year: number, people: Readonly<Record<string, Person>>): Record<string, JsonValue> {
  return {
    name: person.name,
    age: ageInYear(person.birthYear, year),
    job: person.job,
    socialClass: person.socialClass ?? "cottar",
    portrait: renderPortrait(person.name, person.mind, (id) => people[id]?.name ?? id),
  };
}

/**
 * Engine life course PR5: the Clergy Marriage Act (1549-53) is a Reformation-era, Tudor-only
 * exception (decision 053) that never applies to the 1327-1361 window this engine now models —
 * removed rather than dated to a year that can never occur. Clergy are celibate under canon law
 * throughout the period (research.md, "Clergy: celibacy, concubinage..."), with no exception.
 */
export function canMarry(person: Person): boolean {
  return person.socialClass !== "clergy";
}

/**
 * The earliest age `person` is eligible to marry this year, by their class and sex — superseded from
 * decision 053's own `MIN_MARRIAGE_AGE` table by PR6's `hazards.ts#minEligibleAge` (design revision
 * 2, decision 14's revised marriage floors, sourced from `params/demography.ts#MARRIAGE_FLOORS`),
 * which never throws (design decision 15's lookup-miss chain) and never dips below canon law.
 */
function minMarriageAge(person: Person): number {
  return minEligibleAge(person.socialClass ?? FALLBACK_CLASS, person.sex);
}

/**
 * Decision 054: a widow or widower isn't immediately back in the courtship pool — a mourning
 * interval must pass since their most recent `widowed` event (see the death-resolution block
 * below) before they're offered as a `Y1` initiator or candidate again. Widowers mourned faster
 * than widows, per research.md's Family §rules 10 ("remarriage rates for widows were markedly
 * lower than for widowers, and widowers remarried both more often and faster than widows") — the
 * DIRECTION is sourced; the exact number of years is a DESIGN DEFAULT, since no interval is
 * quantified anywhere in the sources located.
 */
const MOURNING_YEARS: Readonly<Record<Sex, number>> = { m: 1, f: 3 };

function mourningOver(person: Person, events: readonly Event[], year: number): boolean {
  const widowedEvents = events.filter((e) => e.kind === "widowed" && e.actors[0] === person.id);
  const last = widowedEvents[widowedEvents.length - 1];
  if (!last) return true;
  return year - last.year >= MOURNING_YEARS[person.sex];
}

/**
 * Decision 055: birth spacing. A married woman isn't eligible for another A2 "try" this soon after
 * her last birth — ~2 years generally (Davenport 2019's 30-33 month intervals round down slightly
 * for the engine's whole-year granularity, and this is meant as a floor under the probabilistic
 * conception roll below, not the target average interval itself), shortened to ~1 year for gentry
 * (the same source's "elite... wet-nursing shortens intervals" finding — 24.6 vs 30.3 months).
 * Reset entirely (no cooldown) if her most recent child died before its first birthday, matching
 * Davenport's "the interval shortens when an infant dies before weaning."
 */
function eligibleForAnotherChild(mother: Person, people: Readonly<Record<string, Person>>, year: number): boolean {
  const children = Object.values(people).filter((c) => c.motherId === mother.id);
  if (children.length === 0) return true;
  const lastChild = children.reduce((latest, c) => (c.birthYear > latest.birthYear ? c : latest));
  // Fixed after review (R3-002): `< 1` never fired — a child born in-sim is never death-evaluated
  // in its own birth year (see actuarial.ts's age<2 band-width comment), so its earliest possible
  // `deathYear` is `birthYear + 1`. `<= 1` matches that actual engine timing (and matches
  // `check-demographics.ts`'s own `deathYear - birthYear <= 1` infant-death definition), so a child
  // who dies at its very first evaluation still resets the spacing cooldown.
  const infantDied = lastChild.deathYear !== undefined && lastChild.deathYear - lastChild.birthYear <= 1;
  if (infantDied) return true;
  const spacingYears = (mother.socialClass ?? "cottar") === "gentry" ? 1 : 2;
  return year - lastChild.birthYear >= spacingYears;
}

/** The eldest LIVING son sharing this person's father (decision 056's holding-inheritance rule) — true only for `person` itself. */
function isEldestLivingSon(person: Person, people: Readonly<Record<string, Person>>): boolean {
  if (person.sex !== "m" || !person.fatherId) return false;
  const brothers = Object.values(people).filter((p) => p.fatherId === person.fatherId && p.sex === "m" && p.deathYear === undefined);
  const eldestBirthYear = Math.min(...brothers.map((b) => b.birthYear));
  return person.birthYear === eldestBirthYear;
}

/** A decision opportunity for one year: what it is, who it's about, and its option ids — without calling any DecisionMaker. Reused by both the real simulation loop and override validation (`validate-override.ts`), so the two can never disagree about what decisions exist at a given year. */
export interface CandidateDescriptor {
  readonly decisionId: string;
  /** A `DecisionKind`, or a biology kind: "illness" | "death" | "immigration". */
  readonly kind: string;
  readonly personId: string;
  readonly partnerId?: string;
  readonly options: readonly string[];
  /** A3 only: the specific job role on offer. */
  readonly opportunityJob?: string;
  /** A11 only: which breakdown code picked (rage/despair/withdrawal) — the dominant propensity, not Jev's call. */
  readonly breakdownKind?: string;
  /** A5 only: which town event is happening (plague/famine/fire/festival/conflict/harvest/stranger) — code's call, per the "Town events" table in mind-model.md. */
  readonly townEventType?: TownEventType;
  /**
   * Extra situation-specific facts merged into `state.situation` (round 6, decision 028 —
   * "is the state missing the facts Jev needs?"). E.g. A2 gets `existingChildren`/`fertileYearsLeft`,
   * A1 gets `courtshipYears` — concrete numbers Jev can reason about a person or a dream this doesn't
   * apply to, without adding a single point of code-side bias to any answer.
   */
  readonly extra?: Record<string, JsonValue>;
}

/**
 * The town-level happenings from mind-model.md's "Town events" table — each one presents A5 to
 * every adult in town. Engine life course PR5 replaces decision 052's three Tudor-dated shocks
 * (`sweating-sickness`, `dearth`, `influenza`) with this period's own two dated shocks
 * (`black-death`, `second-pestilence`) alongside the original seven random "flavor" kinds.
 */
const TOWN_EVENT_TYPES = ["plague", "famine", "fire", "festival", "conflict", "harvest", "stranger", "black-death", "second-pestilence"] as const;
type TownEventType = (typeof TOWN_EVENT_TYPES)[number];

const TOWN_EVENT_LABEL: Record<TownEventType, string> = {
  plague: "A plague has swept through",
  famine: "A famine has struck",
  fire: "A fire has torn through part of",
  festival: "A festival has come to",
  conflict: "A conflict has broken out with a neighboring town, and it has reached",
  harvest: "A bountiful harvest has blessed",
  stranger: "A traveling stranger has arrived in",
  "black-death": "The Black Death has struck",
  "second-pestilence": "A second pestilence has struck",
};

/** Spanish counterpart of `TOWN_EVENT_LABEL` — used only by `questionText`'s `"es"` branch (decision 059); see that function's own comment for why it's currently unreached from any real call site. */
const TOWN_EVENT_LABEL_ES: Record<TownEventType, string> = {
  plague: "Una peste ha asolado",
  famine: "Una hambruna ha golpeado",
  fire: "Un incendio ha arrasado parte de",
  festival: "Una fiesta ha llegado a",
  conflict: "Ha estallado un conflicto con una aldea vecina, y ha alcanzado a",
  harvest: "Una cosecha abundante ha bendecido a",
  stranger: "Un forastero de paso ha llegado a",
  "black-death": "La peste negra ha golpeado",
  "second-pestilence": "Una segunda peste ha golpeado",
};

/** Whether a hardship-flavored town event that year (plague/famine/fire) should raise mortality risk for everyone in town that year, flat x1.6 — decision 025's original trio, unchanged since. The two dated shocks below get their own absolute-probability treatment instead (see the "death" resolution in `simulateYears`), since research.md documents them at a scale a flat multiplier on the base actuarial curve can't reliably reach. */
const HARDSHIP_TOWN_EVENTS: ReadonlySet<TownEventType> = new Set(["plague", "famine", "fire"]);

/**
 * Decision 052: plague gets its own independent, more-frequent annual roll instead of being one
 * slice of the flavor-event pool below — the brief's "stays random but a bit more frequent...
 * keep it rare, e.g. a few per century" (research.md's proposed-changes table). Tuned (not derived
 * from a per-year attack rate — none exists for this window) so a full 60-year life sees roughly
 * 1-2 plague years and a century sees roughly 2-3.
 */
const PLAGUE_ANNUAL_PROBABILITY = 0.025;

/** The random "flavor" town events (unchanged frequency and meaning from decision 025) — plague and the two PR5 dated shocks are handled separately above, so they're excluded from this uniform pool. */
const FLAVOR_TOWN_EVENT_TYPES = TOWN_EVENT_TYPES.filter((t) => t !== "plague" && t !== "black-death" && t !== "second-pestilence");

/**
 * A rare, world-level happening (round 5, decision 025 — mind-model.md's
 * "Town events" table): code alone decides WHETHER one happens and WHICH
 * kind, via a keyed roll; every adult in town then gets an `A5` Jev
 * decision about how they personally respond. Kept as its own pure
 * function (not inlined in `gatherCandidatesForYear`) because both the
 * candidate-gathering pass AND the event-pushing pass in `simulate()` need
 * to agree on the exact same answer for a given year.
 *
 * Engine life course PR5: the two dated shocks (Black Death, second pestilence) take priority —
 * they happen deterministically in their historical years, never rolled — followed by plague's own
 * more frequent independent roll, followed by the original random flavor-event roll (unchanged odds
 * and pool, minus plague, which moved to its own roll above).
 */
function townEventForYear(seed: string, year: number): TownEventType | undefined {
  if (BLACK_DEATH_YEARS.has(year)) return "black-death";
  if (SECOND_PESTILENCE_YEARS.has(year)) return "second-pestilence";
  const plagueDraw = keyedDraw(seed, "world", year, "plague-gate");
  if (plagueDraw < PLAGUE_ANNUAL_PROBABILITY) return "plague";
  const gateDraw = keyedDraw(seed, "world", year, "town-event-gate");
  if (gateDraw >= 0.02) return undefined;
  const typeDraw = keyedDraw(seed, "world", year, "town-event-type");
  return FLAVOR_TOWN_EVENT_TYPES[Math.floor(typeDraw * FLAVOR_TOWN_EVENT_TYPES.length)];
}

/**
 * Decision 052: per-person mortality multiplier for the town event that happened this year — the
 * flat `HARDSHIP_TOWN_EVENTS` x1.6 above, unchanged for the original plague/famine/fire trio. The
 * two PR5 dated shocks (Black Death, second pestilence) are DELIBERATELY excluded here (they fall
 * through to the default `1`): a flat multiplier on the base actuarial curve can't reliably hit
 * their documented ~20-62.5%/~22% two-year mortality across every age band, so they're combined as
 * an absolute per-year probability directly in the "death" resolution instead (`period/events.ts`'s
 * `blackDeathMortalityForYear`/`secondPestilenceMortalityForYear`). `age`/`sex`/`socialClass` stay
 * in the signature (unused) rather than being dropped, since this function is exported and called
 * positionally by tests and the "death" resolution below — a future per-class/age dated shock can
 * reuse this same call shape without another signature change.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function townEventMortalityMultiplier(townEvent: TownEventType | undefined, age: number, sex: Sex, socialClass: SocialClass): number {
  if (!townEvent) return 1;
  if (HARDSHIP_TOWN_EVENTS.has(townEvent)) return 1.6;
  return 1;
}

/** Years a person is "immune" from another illness roll after falling ill, so illness doesn't spam a handful of bad-luck years. */
const ILLNESS_COOLDOWN_YEARS = 3;

/**
 * Round 5 fix (decision 022, "monotone loops" — Orla Cinderfell's chronicle
 * was feud/peace/feud/peace x6 with the same two or three people): a feud
 * now needs a fresh trigger, in two ways.
 *  1. `feudPairHistory` permanently excludes anyone this person has EVER
 *     had a feud (resolved or not) with from being picked as a NEW Y4
 *     rival again — once you've made peace with someone, code won't
 *     spontaneously reignite that exact conflict from nothing.
 *  2. `MAX_FEUD_PAIRS_PER_LIFE` caps how many DISTINCT people a person can
 *     ever start a Y4 grudge with — "cap the share of any one situation
 *     kind in a life", applied directly rather than by a post-hoc quota.
 * Within one still-active episode, `FEUD_EPISODE_CAP` and
 * `FEUD_EPISODE_WINDOW_YEARS` bound how many times A6 re-asks "what do you
 * do about this feud" before code just leaves it unresolved rather than
 * re-litigating it every couple of years forever.
 */
const MAX_FEUD_PAIRS_PER_LIFE = 3;
const FEUD_EPISODE_CAP = 3;
const FEUD_EPISODE_WINDOW_YEARS = 12;

/** A short cause phrase for why a dream is being reconsidered right now (decision 030) — used in the "After {cause}, ..." prose when the dream actually changes. */
function dreamChangeCauseFor(event: Event, personId: string): string {
  switch (event.kind) {
    case "job":
      return "taking up a new trade";
    case "marriage":
      return "marrying";
    case "birth":
      return "the birth of a child";
    case "move":
      return event.actors[0] === personId ? "settling into a new place" : "a loved one's departure";
    case "breakup":
      return "a courtship's end";
    default:
      return "a change in fortune";
  }
}

/** Event kinds thematically tied to each dream goal — a recent one is a "real reason" to re-check the dream (decision 028), not a blind 5-year timer. */
const DREAM_RELATED_EVENT_KINDS: Record<DreamGoal, readonly EventKind[]> = {
  "leave for the city": ["move", "breakup"],
  "start a family": ["marriage", "birth"],
  "master a craft": ["job"],
  "found something lasting": ["marriage", "job", "birth"],
};

/** Every person this `personId` has ever had a `feud` or `reconciliation` event with, resolved or not. */
function feudPairHistory(events: readonly Event[], personId: string): Set<string> {
  const partners = new Set<string>();
  for (const e of events) {
    if ((e.kind === "feud" || e.kind === "reconciliation") && e.actors.includes(personId)) {
      const other = e.actors.find((a) => a !== personId);
      if (other) partners.add(other);
    }
  }
  return partners;
}

/**
 * Every decision opportunity for one simulated year, given the state as of
 * the start of that year. Pure and side-effect-free (no events pushed, no
 * people mutated, no DecisionMaker called) EXCEPT for the keyed RNG draws
 * that gate whether a social decision is even asked at all (e.g. "did this
 * person even attempt to seek a partner this year") — those are
 * deterministic given `seed` + state, so re-deriving them here always
 * agrees with the real run.
 */
function gatherCandidatesForYear(
  year: number,
  people: Readonly<Record<string, Person>>,
  events: readonly Event[],
  seed: string,
  protagonistId?: string,
  marriageFunnelDebug?: { readonly collector: MarriageFunnelCollector; readonly startYear: number },
): CandidateDescriptor[] {
  const candidates: CandidateDescriptor[] = [];

  // Lightweight away-NPCs (decision 040) are narrative props for the protagonist's own away
  // catalog below, not full villagers — they never face their own illness/death/immigration-cap
  // accounting, and never turn up as a match for anyone else's courtship.
  const livingIds = Object.values(people)
    .filter((p) => p.deathYear === undefined && !p.away)
    .map((p) => p.id)
    .sort();

  // Biology: illness and death are decision opportunities for every living person, every year.
  for (const id of livingIds) {
    const movedAway = hasMovedAway(events, id);
    if (!movedAway) {
      const lastIllness = lastIllnessYear(events, id);
      const offCooldown = lastIllness === undefined || year - lastIllness >= ILLNESS_COOLDOWN_YEARS;
      if (offCooldown) candidates.push({ decisionId: `illness:${id}:${year}`, kind: "illness", personId: id, options: ["illness", "healthy"] });
    } else {
      // PR10 (decision 071, population-trajectory diagnosis): "return home" — previously offered
      // ONLY to the narrated protagonist (see the old away-catalog block this replaces), which made
      // leaving home (`Y3`) a permanent, one-way population sink for every other villager: measured
      // (20-seed diagnostic) 0 of 188 general-village emigrants ever came back. Code-rolled like
      // immigration/levy, not a considered choice — see `RETURN_HOME_PROBABILITY`'s own doc comment
      // for the full measured diagnosis and provenance.
      const awaySince = awayMoveYear(events, id);
      if (awaySince !== undefined && year - awaySince >= RETURN_HOME_MIN_AWAY_YEARS) {
        candidates.push({ decisionId: `return:${id}:${year}`, kind: "return", personId: id, options: ["return", "stay"] });
      }
    }
    // A moved-away person still faces mortality (see decision log: they
    // must not become immortal), just not illness or social decisions.
    candidates.push({ decisionId: `death:${id}:${year}`, kind: "death", personId: id, options: ["die", "survive"] });
  }

  // The lord's levy (round 9, decision 035): a rare, code-rolled world happening, exactly like
  // "illness"/"death" — never asked of a DecisionMaker. Gated to the protagonist alone (see the
  // SimulateOptions doc comment): it never touches the general village simulation.
  if (protagonistId) {
    const protagonist = people[protagonistId];
    if (protagonist && protagonist.deathYear === undefined && !hasMovedAway(events, protagonistId) && ageInYear(protagonist.birthYear, year) >= 16) {
      candidates.push({ decisionId: `levy:${protagonistId}:${year}`, kind: "levy", personId: protagonistId, options: ["impose", "spare"] });
    }
  }

  // Immigration: one world-level decision opportunity per year, capped once the town is comfortably
  // sized. PR9 demography follow-up: the cap scales with the village's OWN founder headcount (see
  // `IMMIGRATION_POPULATION_CAP_RATIO`'s doc comment) rather than the old fixed `38`, which silently
  // disabled immigration entirely once the default village grew past it.
  const founderCount = Object.values(people).filter((p) => p.founder).length;
  const immigrationPopulationCap = founderCount * IMMIGRATION_POPULATION_CAP_RATIO;
  if (livingIds.length < immigrationPopulationCap) {
    candidates.push({ decisionId: `immigration:world:${year}`, kind: "immigration", personId: "world", options: ["arrive", "no-arrival"] });
  }

  // Decision 083: an arranged cross-manor match for a gentry daughter — code-rolled, like
  // immigration/return, never a DecisionMaker question (an arranged marriage is her family's
  // decision, not hers; see decision 083's own doc comment for the Follett-plausible grounding).
  // Gated to only fire when the village genuinely has NO eligible, UNRELATED gentry son for her.
  // Diagnosed first (`scripts/_diag-gentry.ts`, 30 seeds): a same-village gentry male candidate
  // (by class/age/marital-status alone) is actually available 71.8% of the time — decision 049's
  // "one gentry household per village" still means every villager of that class descends from the
  // SAME founding couple within a few generations, so most of those nominal "candidates" are her own
  // brothers or cousins, excluded by `isRelatedForMarriage`'s consanguinity check (decision 053) —
  // the real bottleneck is a lack of UNRELATED gentry supply, not raw headcount (68% of gentry
  // daughters never marry at all by the end of the run). A real home-grown, unrelated gentry match,
  // when one exists, still goes through the ordinary Y1/A1 courtship below untouched.
  // Only people still living IN the village: `away` NPCs and villagers who have moved away (a `move`
  // event, e.g. Y3 or an earlier arranged match) can neither be matched nor match anyone here.
  const livingPeople = Object.values(people).filter((p) => p.deathYear === undefined && !p.away && !hasMovedAway(events, p.id));
  for (const daughter of livingPeople) {
    const id = daughter.id;
    if (daughter.sex !== "f" || (daughter.socialClass ?? FALLBACK_CLASS) !== "gentry") continue;
    const age = ageInYear(daughter.birthYear, year);
    if (age < MARRIAGE_FLOORS.gentry.f.minEligible || daughter.spouseId || activeRomancePair(events, id) !== undefined) continue;
    if (!canMarry(daughter) || !mourningOver(daughter, events, year)) continue;
    const hasVillageGentryMatch = livingPeople.some((other) => {
      const otherId = other.id;
      return (
        other.sex === "m" &&
        (other.socialClass ?? FALLBACK_CLASS) === "gentry" &&
        !other.spouseId &&
        activeRomancePair(events, otherId) === undefined &&
        ageInYear(other.birthYear, year) >= MARRIAGE_FLOORS.gentry.m.minEligible &&
        canMarry(other) &&
        mourningOver(other, events, year) &&
        !isRelatedForMarriage(daughter, other, people)
      );
    });
    if (hasVillageGentryMatch) continue;
    candidates.push({ decisionId: `arranged-match:${id}:${year}`, kind: "arranged-match", personId: id, options: ["arrange", "no-match"] });
  }

  // Social decisions: eligibility is PURE (age, marital status, place, relationships, cooldowns,
  // caps — round 12, decision 045; superseded the old code-level probability GATES this comment
  // used to describe). Jev's per-person-year event-selection Choice, not code, decides whether an
  // eligible candidate is the one that actually happens; `LIFE_DECISION_BUDGET` below still bounds
  // call volume for the general village as the town's population compounds across generations.
  const aliveNonMoved = Object.values(people)
    .filter((p) => p.deathYear === undefined && !p.away && !hasMovedAway(events, p.id))
    .sort((a, b) => a.id.localeCompare(b.id));

  const claimedPartners = new Set<string>();

  for (const person of aliveNonMoved) {
    const age = ageInYear(person.birthYear, year);

    // Y1 Courtship offer. Age-appropriate matching: try a tight window first
    // (within 10 years) and only widen if nobody eligible is nearby in age.
    // Round 12 (decision 045): the old `seekChance`/`seekDraw` code-side probability gate is gone —
    // eligibility here is purely deterministic (age, unmarried, no active romance, a real partner on
    // hand); Jev's per-person-year event-selection Choice decides whether this actually happens.
    // Decision 053 replaces the flat `isAdult(age)` (16) floor with `minMarriageAge` (class- and
    // sex-specific, never below the canon-law 12/14 minimum) and adds the consanguinity-to-cousins
    // check (`isRelatedForMarriage`). Decision 054 adds the mourning-interval gate for a widow(er).
    // Status endogamy (research.md, Family §rules synthesis: "marriage tended to stay within one's
    // status (inferred, not measured)") is a SOFT preference, not a hard rule: `eligible` is tried
    // same-class-first across the three age windows, only falling back to any class if nobody
    // eligible shares this person's own class at any age gap.
    if (age >= minMarriageAge(person) && age <= 65 && !person.spouseId && activeRomancePair(events, person.id) === undefined && canMarry(person) && mourningOver(person, events, year)) {
      // PR11 (STEP 1) diagnostic: gated behind `marriageFunnelDebug` — see `MarriageFunnelCollector`'s
      // own doc comment. `undefined` in every existing caller/test, so this whole block is a single
      // falsy check with zero effect otherwise.
      const funnelInCohort = marriageFunnelDebug !== undefined && inMarriageFunnelCohort(person, marriageFunnelDebug.startYear);
      if (funnelInCohort) marriageFunnelDebug!.collector.eligiblePersonYears++;
      // PR6 (design's Y1 hazard ramp, D_k(t) = 1 + rho*min(t,8)): stamp the time-in-state clock the
      // FIRST year this person is observed marriageable and single, regardless of whether a partner
      // is found this year — a no-op once already set (see `life-state.ts#markMarriageable`).
      person.lifeState = markMarriageable(ensureLifeState(person, events), year);
      const yearsMarriageable = year - (person.lifeState.marriageableSince ?? year);
      const isWidowed = ensureLifeState(person, events).marital.status === "widowed";
      // PR11 (STEP 2 fix (a), `sdd/engine-life-course/state`, decision 072): each tier's CANDIDATE
      // POOL (every candidate meeting that tier's predicates), not a single `.find()` match — a
      // fixed `.find()` over `aliveNonMoved`'s id-sorted order deterministically returned the exact
      // SAME first-sorted candidate every year regardless of outcome, which the STEP 1 funnel
      // diagnostic confirmed directly: 48% of a person's consecutive Y1 offers repeated the exact
      // same partner (n=5,554 year-over-year transitions, 25 seeds), mean 23.3 Y1 attempts per
      // person against only 8.1 DISTINCT partners ever offered, some people offered 5+ Y1s ALL to
      // the same partner (max observed streak: 13 consecutive years). `eligiblePool` keeps every
      // predicate byte-for-byte identical to the old `eligible()` (including the tier order and the
      // same-class-first soft preference) — only WHICH single candidate is picked from a tied pool
      // changes, via `pickWeightedPartner` below.
      const eligiblePool = (maxAgeGap: number, sameClassOnly: boolean) =>
        aliveNonMoved.filter(
          (candidate) =>
            candidate.id !== person.id &&
            candidate.sex !== person.sex &&
            !candidate.spouseId &&
            !claimedPartners.has(candidate.id) &&
            !isRelatedForMarriage(person, candidate, people) &&
            ageInYear(candidate.birthYear, year) >= minMarriageAge(candidate) &&
            activeRomancePair(events, candidate.id) === undefined &&
            canMarry(candidate) &&
            mourningOver(candidate, events, year) &&
            Math.abs(ageInYear(candidate.birthYear, year) - age) <= maxAgeGap &&
            (!sameClassOnly || (candidate.socialClass ?? "cottar") === (person.socialClass ?? "cottar")),
        );
      const pickTier = (maxAgeGap: number, sameClassOnly: boolean) =>
        pickWeightedPartner(eligiblePool(maxAgeGap, sameClassOnly), age, year, seed, person.id, `y1-partner-${maxAgeGap}-${sameClassOnly}`);
      const partner = pickTier(10, true) ?? pickTier(20, true) ?? pickTier(40, true) ?? pickTier(10, false) ?? pickTier(20, false) ?? pickTier(40, false);
      if (funnelInCohort) {
        if (partner) {
          marriageFunnelDebug!.collector.partnerFoundPersonYears++;
          const foundSameClass = eligiblePool(10, true).length > 0 || eligiblePool(20, true).length > 0 || eligiblePool(40, true).length > 0;
          if (foundSameClass) marriageFunnelDebug!.collector.matchesBySameClassTier++;
          else marriageFunnelDebug!.collector.matchesByCrossClassTier++;
        } else {
          classifyNoPartnerReasons(person, age, year, people, events, aliveNonMoved, claimedPartners, marriageFunnelDebug!.collector);
        }
      }
      if (partner) {
        claimedPartners.add(partner.id);
        claimedPartners.add(person.id);
        candidates.push({
          decisionId: `Y1:${pairKey(person.id, partner.id)}:${year}`,
          kind: "Y1",
          personId: person.id,
          partnerId: partner.id,
          options: ["encourage", "decline", "wait"],
          extra: { yearsMarriageable, isWidowed },
        });
      }
    }

    // A1 Proposal: established romances, asked once per pair, by the lower id.
    // Guards the partner is still alive (round 5 fix, decision 022): `activeRomancePair`
    // only reads the event log, so with no guard here a partner who died after the
    // romance began would keep being offered as a living proposal target.
    // PR6 fix: `!person.spouseId` closes a pre-existing gap — `activeRomancePair` returns the most
    // recent UNRESOLVED romance for a specific pair, so a person who courted two people (the
    // multi-suitor property Y1's independent per-person batches allow — see the "encourage"/"end-it"
    // cases below) but only ever married ONE of them still has a stale, never-formally-ended romance
    // with the other. Without this guard, A1 kept offering a "proposal" for that stale pair to an
    // already-married person indefinitely — invisible before this PR (its outcome never touched
    // `lifeState`), now surfaced as an illegal `married -> single` transition when it resolved "end-it".
    const romancePartnerId = !person.spouseId ? activeRomancePair(events, person.id) : undefined;
    if (romancePartnerId && person.id < romancePartnerId && people[romancePartnerId] && isAlive(people[romancePartnerId]!, year)) {
      const romanceEvent = eventsFor(events, person.id)
        .filter((e) => e.kind === "romance" && e.actors.includes(romancePartnerId))
        .sort((a, b) => b.year - a.year)[0];
      // Round 12 (decision 045): eligible every year from one year after the romance began, not
      // just the anniversary year plus a probabilistic `reconsiderDraw` — deterministic eligibility
      // only; Jev's event-selection Choice decides whether the proposal actually comes up this year.
      if (romanceEvent && year - romanceEvent.year >= 1) {
        if (marriageFunnelDebug !== undefined && inMarriageFunnelCohort(person, marriageFunnelDebug.startYear)) marriageFunnelDebug.collector.a1Offered++;
        candidates.push({
          decisionId: `A1:${pairKey(person.id, romancePartnerId)}:${year}`,
          kind: "A1",
          personId: person.id,
          partnerId: romancePartnerId,
          options: ["propose", "delay", "end-it"],
          extra: { courtshipYears: year - romanceEvent.year },
        });
      }
    }

    // A3 Career opportunity: first job at 16 ONLY (round 13, decision 056 — the periodic
    // every-20-years re-draw is removed: villagers didn't freely change trades in this period; see
    // research.md, Economy §2, "not mechanical; free mobility between trades"). Skipped if AP1
    // (age 10) already apprenticed this person to a trade — that hook now actually sets `job` (see
    // the `AP1` outcome case below), so this is only a real "first job" opportunity for whoever
    // wasn't. The offered job is drawn from the person's OWN social class's pool (decision 049): the
    // eldest living son of a villein/freeholder/gentry (was husbandman/yeoman/gentry) father inherits
    // the holding (`farmer`/`landholder`, custom/primogeniture — research.md, Family §Inheritance
    // systems); an artisan's son has a ~15% chance (sourced 10-20%, Economy §2) of taking up his
    // father's own craft; everyone else draws at random from their class's pool.
    if (isWorkingAge(age) && age === 16 && person.job === "none") {
      const socialClass: SocialClass = person.socialClass ?? "cottar";
      const father = person.fatherId ? people[person.fatherId] : undefined;
      const inheritsHolding = person.sex === "m" && isEldestLivingSon(person, people) && (socialClass === "villein" || socialClass === "freeholder" || socialClass === "gentry");
      let opportunityJob: Job;
      if (inheritsHolding) {
        opportunityJob = socialClass === "gentry" ? "landholder" : "farmer";
      } else if (socialClass === "artisan" && father && father.job !== "none" && keyedDraw(seed, person.id, year, "father-craft") < 0.15) {
        opportunityJob = father.job;
      } else {
        opportunityJob = pickJobForClass(socialClass, keyedRng(seed, person.id, year, "opportunity-job"));
      }
      candidates.push({ decisionId: `A3:${person.id}:${year}`, kind: "A3", personId: person.id, options: ["seize", "pass", "ignore"], opportunityJob, extra: { currentJob: person.job } });
    }

    // A2 Have a child: asked via the mother. Density-damped once the living population is large.
    // Round 6 fix (decision 028, "population decline is systematic"): `extra` now carries the
    // concrete facts Jev needs to reason about urgency — existing children and years of fertility
    // left — since neither was previously in the state at all. Also a legitimate TRIGGER-timing
    // change, not an answer weight: a still-childless couple close to the end of the fertility
    // window is asked MORE often (code deciding when a decision is a real crossroads), not answered
    // differently.
    // Round 12 (decision 045): the old density-damped `gateChance`/`gateDraw` code-side probability
    // gate is gone — every married woman in her fertile window is eligible every year (deterministic:
    // sex, spouse alive, fertile age); Jev's event-selection Choice decides whether this is the year.
    if (person.sex === "f" && person.spouseId && isFertileAge(age, "f") && eligibleForAnotherChild(person, people, year)) {
      const spouse = people[person.spouseId];
      if (spouse && spouse.deathYear === undefined) {
        const existingChildren = Object.values(people).filter((c) => c.motherId === person.id).length;
        const fertileYearsLeft = Math.max(0, 45 - age);
        candidates.push({
          decisionId: `A2:${pairKey(person.id, person.spouseId)}:${year}`,
          kind: "A2",
          personId: person.id,
          partnerId: person.spouseId,
          options: ["try", "wait", "refuse"],
          extra: { existingChildren, fertileYearsLeft },
        });
      }
    }

    // Y4 First grudge: a hot-tempered or envious (high anger/greed facet) ADULT occasionally clashes
    // with an unrelated townsperson. Round 12 (decision 045): the old `feudDraw` code-side gate is
    // gone — eligible every year the deterministic conditions hold; Jev's event-selection decides.
    // `isAdult(age)` is a round 12 addition too: the old 5% `feudDraw` made this so rare that a
    // clashing infant/child (the facet checks alone never excluded them) never actually surfaced in
    // practice, but unconditional eligibility exposed it immediately (a 1-year-old getting a "feud"
    // the same year they died — see `life-chronicle.test.ts`'s "death is always last" contract).
    const pastRivals = feudPairHistory(events, person.id);
    if (isAdult(age) && (person.mind.facets.anger >= 65 || person.mind.facets.greed >= 65) && activeFeudPair(events, person.id) === undefined && pastRivals.size < MAX_FEUD_PAIRS_PER_LIFE) {
      const rival = aliveNonMoved.find(
        (c) => c.id !== person.id && c.job === person.job && !isRelated(person, c) && isAdult(ageInYear(c.birthYear, year)) && activeFeudPair(events, c.id) === undefined && !pastRivals.has(c.id) && feudPairHistory(events, c.id).size < MAX_FEUD_PAIRS_PER_LIFE,
      );
      if (rival) candidates.push({ decisionId: `Y4:${pairKey(person.id, rival.id)}:${year}`, kind: "Y4", personId: person.id, partnerId: rival.id, options: ["confront", "forgive", "nurse-it"] });
    }

    // A6 Rivalry escalates: a grudge that's been running at least two years.
    // Guards the partner is still alive (round 5 fix, decision 022) — this is the exact
    // bug the coordinator's screenshot caught ("Fira ... made peace" a year after Orla died).
    const feudPartnerId = activeFeudPair(events, person.id);
    if (feudPartnerId && person.id < feudPartnerId && people[feudPartnerId] && isAlive(people[feudPartnerId]!, year)) {
      const feudEvents = events.filter((e) => e.kind === "feud" && e.actors.includes(person.id) && e.actors.includes(feudPartnerId)).sort((a, b) => a.year - b.year);
      const feudEvent = feudEvents[feudEvents.length - 1];
      const originalYear = feudEvents[0]?.year;
      const withinEpisodeBudget = feudEvents.length < FEUD_EPISODE_CAP && originalYear !== undefined && year - originalYear <= FEUD_EPISODE_WINDOW_YEARS;
      // Round 12 (decision 045): eligible every year from 3 years after the last feud event, not
      // just the anniversary year plus a probabilistic `reconcileReconsiderDraw` — deterministic
      // eligibility only; Jev's event-selection Choice decides whether it comes up this year.
      if (feudEvent && withinEpisodeBudget && year - feudEvent.year >= 3) {
        candidates.push({ decisionId: `A6:${pairKey(person.id, feudPartnerId)}:${year}`, kind: "A6", personId: person.id, partnerId: feudPartnerId, options: ["reconcile", "feud", "sabotage"] });
      }
    }

    // Y3 Leave or stay. Round 12 (decision 045): the old `moveChance`/`moveDraw` code-side gate is
    // gone — eligible every year of adulthood (deterministic); Jev's event-selection decides.
    if (isAdult(age)) {
      candidates.push({ decisionId: `Y3:${person.id}:${year}`, kind: "Y3", personId: person.id, options: ["leave", "stay"] });
    }

    // A8 Dream check: round 6 fix (decision 028, "A8 is re-asked for almost everyone every 5
    // years") — only on a real reason, not a blind timer: a life-stage milestone (every 10 years,
    // not 5), a recent setback (mood has soured), or a recent event thematically tied to THIS
    // dream (a job change for "master a craft", a marriage/birth for "start a family"/"found
    // something lasting", a move or breakup for "leave for the city").
    //
    // Round 7 fix (decision 030, "dream churn is noise"): a dream should be rare and sticky.
    // `adjust-it` (actually CHANGING the dream) is only on the table when there's a real cause —
    // a setback or a related event — never on a bare life-stage milestone with nothing behind it.
    // The reason also rides along in `extra.dreamChangeCause` so, if the dream DOES change, the
    // prose can say why ("After the fire took the mill, she began to dream of...") instead of
    // just announcing a new dream out of nowhere.
    if (isAdult(age) && person.mind.dream.status === "pursuing") {
      const milestone = age % 10 === 0;
      const setback = computeMood(person.mind) <= -25;
      const relatedKinds = DREAM_RELATED_EVENT_KINDS[person.mind.dream.goal];
      const recentRelatedEvent = eventsFor(events, person.id)
        .filter((e) => e.year >= year - 2 && e.year < year && relatedKinds.includes(e.kind))
        .sort((a, b) => b.year - a.year)[0];
      const hasRealCause = setback || !!recentRelatedEvent;
      if (milestone || hasRealCause) {
        const dreamChangeCause = setback ? "a hard stretch" : recentRelatedEvent ? dreamChangeCauseFor(recentRelatedEvent, person.id) : undefined;
        candidates.push({
          decisionId: `A8:${person.id}:${year}`,
          kind: "A8",
          personId: person.id,
          options: hasRealCause ? ["push-harder", "adjust-it", "abandon-it"] : ["push-harder", "abandon-it"],
          extra: dreamChangeCause ? { dreamChangeCause } : undefined,
        });
      }
    }

    // A11 Breakdown: stress above threshold. Code picks WHICH kind of breakdown (the dominant propensity); Jev decides the response.
    if (person.mind.stress >= 75) {
      const breakdownKind = person.mind.facets.anger >= person.mind.facets.anxiety && person.mind.facets.anger >= 100 - person.mind.facets.perseverance ? "rage" : person.mind.facets.anxiety >= 100 - person.mind.facets.perseverance ? "despair" : "withdrawal";
      candidates.push({ decisionId: `A11:${person.id}:${year}`, kind: "A11", personId: person.id, options: ["give-in", "master-it"], breakdownKind });
    }

    // C2 Losing a parent: fires the YEAR AFTER a parent's death (not the same
    // year — a parent's death is itself resolved by the synchronous biology
    // pass, which runs AFTER this function returns for that year, so a
    // same-year death isn't visible here yet; see decision 025). Still a
    // minor at the time.
    if (age < 16) {
      for (const parentId of [person.motherId, person.fatherId]) {
        const parent = parentId ? people[parentId] : undefined;
        if (parent && parent.deathYear === year - 1) {
          candidates.push({ decisionId: `C2:${pairKey(person.id, parentId!)}:${year}`, kind: "C2", personId: person.id, partnerId: parentId, options: ["grieve-openly", "harden", "cling-to-other-parent"] });
        }
      }
    }

    // C3 Early calling (round 7, decision 030 — "thin chronicles": childhood was empty between
    // birth and the first job at 16). Fires exactly once, at age 12 (the middle of the spec's
    // 10-14 range) — only for a non-founder (someone with an actual `birth` event in this
    // world's log, whether born during the simulation or as a founder couple's pre-existing
    // child; a founder who started the world already an adult has no childhood to narrate).
    if (age === 12 && !person.founder) {
      candidates.push({ decisionId: `C3:${person.id}:${year}`, kind: "C3", personId: person.id, options: ["follow-trade", "apprentice-elsewhere", "drift"] });
    }

    // O2 Old grudge: a grudge relationship that's lingered into old age. Round 12 (decision 045):
    // the old `grudgeDraw` code-side gate is gone — eligible every year once old age + a lingering
    // grudge hold (deterministic); Jev's event-selection Choice decides whether it surfaces.
    if (age >= 60) {
      const oldGrudge = person.mind.relationships.find((r) => r.bond === "grudge" && r.strength <= -40);
      if (oldGrudge) {
        candidates.push({ decisionId: `O2:${pairKey(person.id, oldGrudge.personId)}:${year}`, kind: "O2", personId: person.id, partnerId: oldGrudge.personId, options: ["reconcile", "take-to-grave"] });
      }
    }

    // O4 Facing death: a reckoning with mortality in old age. Simplified from the spec's literal
    // "terminal illness" trigger (that fires the same year illness/death is decided, which this
    // pure/pre-biology candidate pass can't see yet — the same ordering issue as C2 above) to "old
    // age, occasionally" — disclosed as a scoping simplification in decision 025. Round 12 (decision
    // 045): the old `mortalityDraw` code-side gate is gone — eligible every year of old age.
    if (age >= 75) {
      candidates.push({ decisionId: `O4:${person.id}:${year}`, kind: "O4", personId: person.id, options: ["peace", "regret", "last-wish"] });
    }

    // --- Protagonist-only extended catalog (round 9, decision 035) ---------
    // Fills in the rest of mind-model.md's situation catalog, plus two protagonist-specific
    // situations (AP1, PIL1). Gated to the protagonist alone so the rest of the town keeps the
    // original 14-kind catalog and its exact existing call volume/output.
    if (protagonistId && person.id === protagonistId) {
      // C1 Sibling rivalry: a sibling within 3 years of age, around school age.
      if (age === 6) {
        const sibling = aliveNonMoved.find(
          (c) => c.id !== person.id && ((c.motherId && c.motherId === person.motherId) || (c.fatherId && c.fatherId === person.fatherId)) && Math.abs(ageInYear(c.birthYear, year) - age) <= 3,
        );
        if (sibling) candidates.push({ decisionId: `C1:${pairKey(person.id, sibling.id)}:${year}`, kind: "C1", personId: person.id, partnerId: sibling.id, options: ["compete", "bond", "withdraw"] });
      }

      // C4 A bully: an anger-prone peer close in age.
      if (age === 9) {
        const bully = aliveNonMoved.find((c) => c.id !== person.id && !isRelated(person, c) && Math.abs(ageInYear(c.birthYear, year) - age) <= 3 && c.mind.facets.anger >= 70);
        if (bully) candidates.push({ decisionId: `C4:${pairKey(person.id, bully.id)}:${year}`, kind: "C4", personId: person.id, partnerId: bully.id, options: ["fight-back", "endure", "tell-an-elder"] });
      }

      // Y2 Trade vs. dream: once, in early adulthood, while still pursuing the dream.
      if (age === 20 && person.mind.dream.status === "pursuing") {
        candidates.push({ decisionId: `Y2:${person.id}:${year}`, kind: "Y2", personId: person.id, options: ["pursue-the-dream", "stay-practical"] });
      }

      // Y5 Close friendship: without an existing friend bond. Round 12 (decision 045): the old
      // `friendDraw` code-side gate is gone — eligible every year the deterministic conditions hold
      // (age band, no existing friend, a real candidate on hand); Jev's event-selection decides.
      if (age >= 14 && age <= 50 && !person.mind.relationships.some((r) => r.bond === "friend")) {
        const candidate = aliveNonMoved.find((c) => c.id !== person.id && !isRelated(person, c) && Math.abs(ageInYear(c.birthYear, year) - age) <= 8);
        if (candidate) candidates.push({ decisionId: `Y5:${pairKey(person.id, candidate.id)}:${year}`, kind: "Y5", personId: person.id, partnerId: candidate.id, options: ["open-up", "keep-distance"] });
      }

      // A4 Betrayal discovered: while married. Round 12 (decision 045): the old `betrayalDraw`
      // code-side gate is gone — eligible every year the marriage stands.
      if (isAdult(age) && person.spouseId && people[person.spouseId] && isAlive(people[person.spouseId]!, year)) {
        candidates.push({ decisionId: `A4:${pairKey(person.id, person.spouseId)}:${year}`, kind: "A4", personId: person.id, partnerId: person.spouseId, options: ["confront", "forgive", "leave", "revenge"] });
      }

      // A7 Crisis of faith: high faith value, after a recent hardship. Round 12 (decision 045): the
      // old `faithDraw` code-side gate is gone — eligible whenever the deterministic hardship window holds.
      if (isAdult(age) && person.mind.values.faith >= 20) {
        const recentHardship = eventsFor(events, person.id).some((e) => e.year >= year - 2 && e.year < year && (e.kind === "illness" || e.kind === "feud" || e.kind === "breakdown"));
        if (recentHardship) candidates.push({ decisionId: `A7:${person.id}:${year}`, kind: "A7", personId: person.id, options: ["double-down", "lose-faith", "seek-another-path"] });
      }

      // A9 Affair temptation: married and unhappy (low mood). Round 12 (decision 045): the old
      // `affairDraw` code-side gate is gone — eligible every year the mood/marriage conditions hold.
      if (isAdult(age) && person.spouseId && computeMood(person.mind) <= -10) {
        candidates.push({ decisionId: `A9:${person.id}:${year}`, kind: "A9", personId: person.id, partnerId: person.spouseId, options: ["resist", "pursue"] });
      }

      // A10 Mentor: skilled and established, with a youth nearby. Round 12 (decision 045): the old
      // `mentorDraw` code-side gate is gone — eligible every year a real apprentice candidate is on hand.
      if (age >= 35 && person.job !== "none") {
        const apprentice = aliveNonMoved.find((c) => c.id !== person.id && !isRelated(person, c) && ageInYear(c.birthYear, year) >= 14 && ageInYear(c.birthYear, year) <= 20);
        if (apprentice) candidates.push({ decisionId: `A10:${pairKey(person.id, apprentice.id)}:${year}`, kind: "A10", personId: person.id, partnerId: apprentice.id, options: ["take-an-apprentice", "decline"] });
      }

      // O1 Inheritance: old, with living heirs. `extra.quarrel` when there's more than one heir.
      // Round 12 (decision 045): the old `inheritanceDraw` code-side gate is gone.
      if (age >= 70) {
        const heirs = Object.values(people).filter((c) => (c.motherId === person.id || c.fatherId === person.id) && c.deathYear === undefined);
        if (heirs.length > 0) candidates.push({ decisionId: `O1:${person.id}:${year}`, kind: "O1", personId: person.id, options: ["eldest", "favorite", "split", "town"], extra: { heirs: heirs.length, quarrel: heirs.length >= 2 } });
      }

      // O3 Legacy: old, with a dream that never came true. Round 12 (decision 045): the old
      // `legacyDraw` code-side gate is gone — eligible every year the deterministic conditions hold.
      if (age >= 65 && person.mind.dream.status !== "realized") {
        candidates.push({ decisionId: `O3:${person.id}:${year}`, kind: "O3", personId: person.id, options: ["last-attempt", "pass-it-on", "make-peace-with-it"] });
      }

      // PIL1 Pilgrimage: a real pull of faith, in adulthood. Round 12 (decision 045): the old
      // `pilgrimageDraw` code-side gate is gone — eligible every year the deterministic conditions hold.
      if (age >= 20 && age <= 55 && person.mind.values.faith >= 15) {
        candidates.push({ decisionId: `PIL1:${person.id}:${year}`, kind: "PIL1", personId: person.id, options: ["go", "stay"] });
      }
    }
  }

  // --- Away catalog (round 10, decision 040) ------------------------------
  // The loop above is built from `aliveNonMoved`, which — by construction — excludes anyone who
  // moved away, protagonist included. Without this block, leaving home was a dead end: the
  // protagonist stopped receiving situations entirely, which is exactly the bug this closes. The
  // away protagonist's partners are a separate, lightweight cast met in the new place (`away:
  // true` on `Person`, ids `away-<year>-...`, see `spawnAwayPerson`) — never the home village's
  // own population — so this is gathered here rather than by just admitting the protagonist back
  // into `aliveNonMoved` above. Reuses the SAME `DecisionKind`s as home life (Y1/A1 courtship and
  // marriage, A2 children, A3 work, Y5 friendship, A7 faith, A8 dream, A9 temptation, A11
  // breakdown, O1/O3/O4 old age, PIL1, C2 for news from home) — zero new prompts/heuristics to
  // maintain, per decision 016's ban on code-side weights on Jev answers.
  if (protagonistId) {
    const protagonist = people[protagonistId];
    if (protagonist && protagonist.deathYear === undefined && hasMovedAway(events, protagonistId)) {
      const age = ageInYear(protagonist.birthYear, year);
      const awaySince = awayMoveYear(events, protagonistId);
      const awayCast = Object.values(people).filter((p) => p.away === true);

      // Work: same one-time cadence as A3 at home (age 16, no re-draw — decision 056), plus one
      // extra roll the year after arriving — settling into a livelihood in the new place is the
      // first thing that actually happens there, so it's allowed even if a home job was already set.
      if (isWorkingAge(age) && ((age === 16 && protagonist.job === "none") || (awaySince !== undefined && year === awaySince + 1))) {
        const socialClass: SocialClass = protagonist.socialClass ?? "cottar";
        const opportunityJob = pickJobForClass(socialClass, keyedRng(seed, protagonist.id, year, "away-opportunity-job"));
        candidates.push({ decisionId: `A3:${protagonist.id}:${year}`, kind: "A3", personId: protagonist.id, options: ["seize", "pass", "ignore"], opportunityJob, extra: { currentJob: protagonist.job } });
      }

      // A newcomer arrives in the away cast — code-rolled, like immigration, and resolved in the
      // SAME biology pass (before social `buildQuestion` runs), so a real Person already exists to
      // reference by id in Y1/Y5 below the very same year. Kept to a small standing cast (<2).
      if (awayCast.length < 2) {
        candidates.push({ decisionId: `away-arrival:${protagonist.id}:${year}`, kind: "away-arrival", personId: protagonist.id, options: ["arrive", "no-arrival"] });
      }

      // Y1/A1 Courtship and marriage, with whoever's on hand in the away cast. Round 12 (decision
      // 045): the old `seekDraw` code-side gate is gone — eligible whenever a real suitor is on hand.
      // Decision 053/054: same `minMarriageAge`/`isRelatedForMarriage`/mourning-interval rules as
      // the home village — a small standing cast (<2), so class endogamy isn't worth widening for
      // here (there's rarely a real choice of partner to prefer among).
      if (
        age >= minMarriageAge(protagonist) &&
        age <= 65 &&
        !protagonist.spouseId &&
        activeRomancePair(events, protagonist.id) === undefined &&
        canMarry(protagonist) &&
        mourningOver(protagonist, events, year)
      ) {
        protagonist.lifeState = markMarriageable(ensureLifeState(protagonist, events), year);
        const yearsMarriageable = year - (protagonist.lifeState.marriageableSince ?? year);
        const isWidowed = ensureLifeState(protagonist, events).marital.status === "widowed";
        const suitor = awayCast.find(
          (c) =>
            c.sex !== protagonist.sex &&
            !c.spouseId &&
            !isRelatedForMarriage(protagonist, c, people) &&
            ageInYear(c.birthYear, year) >= minMarriageAge(c) &&
            activeRomancePair(events, c.id) === undefined &&
            canMarry(c) &&
            mourningOver(c, events, year),
        );
        if (suitor) {
          candidates.push({
            decisionId: `Y1:${pairKey(protagonist.id, suitor.id)}:${year}`,
            kind: "Y1",
            personId: protagonist.id,
            partnerId: suitor.id,
            options: ["encourage", "decline", "wait"],
            extra: { yearsMarriageable, isWidowed },
          });
        }
      }
      // PR6 fix: same `!protagonist.spouseId` guard as the home A1 block above.
      const awayRomancePartnerId = !protagonist.spouseId ? activeRomancePair(events, protagonist.id) : undefined;
      if (awayRomancePartnerId && people[awayRomancePartnerId] && isAlive(people[awayRomancePartnerId]!, year)) {
        const romanceEvent = eventsFor(events, protagonist.id)
          .filter((e) => e.kind === "romance" && e.actors.includes(awayRomancePartnerId))
          .sort((a, b) => b.year - a.year)[0];
        if (romanceEvent && year - romanceEvent.year >= 1) {
          candidates.push({
            decisionId: `A1:${pairKey(protagonist.id, awayRomancePartnerId)}:${year}`,
            kind: "A1",
            personId: protagonist.id,
            partnerId: awayRomancePartnerId,
            options: ["propose", "delay", "end-it"],
            extra: { courtshipYears: year - romanceEvent.year },
          });
        }
      }

      // A2 Have a child, once married — asked via whichever of the couple is the mother, exactly
      // like the home loop's own "asked via the mother" rule. Round 12 (decision 045): the old
      // `gateDraw` code-side gate is gone — eligible every year the fertility window holds.
      // Decision 079 fix: only for a spouse who is ACTUALLY part of the away cast (`away === true`),
      // matching this whole block's own doc comment ("never the home village's own population"). A
      // spouse married before the protagonist left home stays in `aliveNonMoved` (the general
      // population loop above already generates her own, legitimate A2 candidate there) — without
      // this guard, both loops fired for the same (personId, year), tripping `simulateYears`' hard
      // "no kind twice per person per year" invariant (found via a real curated-seed crash).
      const awaySpouse = protagonist.spouseId ? people[protagonist.spouseId] : undefined;
      if (awaySpouse && awaySpouse.away === true && awaySpouse.deathYear === undefined) {
        const mother = protagonist.sex === "f" ? protagonist : awaySpouse;
        const father = protagonist.sex === "f" ? awaySpouse : protagonist;
        const motherAge = ageInYear(mother.birthYear, year);
        if (isFertileAge(motherAge, "f") && eligibleForAnotherChild(mother, people, year)) {
          const existingChildren = Object.values(people).filter((c) => c.motherId === mother.id).length;
          candidates.push({
            decisionId: `A2:${pairKey(mother.id, father.id)}:${year}`,
            kind: "A2",
            personId: mother.id,
            partnerId: father.id,
            options: ["try", "wait", "refuse"],
            extra: { existingChildren, fertileYearsLeft: Math.max(0, 45 - motherAge) },
          });
        }
      }

      // Y5 Close friendship, with whoever's on hand in the away cast. Round 12 (decision 045): the
      // old `friendDraw` code-side gate is gone — eligible whenever a real friend candidate is on hand.
      if (age >= 14 && age <= 60 && !protagonist.mind.relationships.some((r) => r.bond === "friend")) {
        const friend = awayCast.find((c) => c.id !== protagonist.id);
        if (friend) candidates.push({ decisionId: `Y5:${pairKey(protagonist.id, friend.id)}:${year}`, kind: "Y5", personId: protagonist.id, partnerId: friend.id, options: ["open-up", "keep-distance"] });
      }

      // A7 Crisis of faith, A8 dream check, A9 affair temptation, A11 breakdown, O1/O3/O4 old age,
      // PIL1 pilgrimage — every one of these is already self-contained (own mind/events/spouseId),
      // not a home-village lookup, so the exact home trigger applies unchanged away from home. Round
      // 12 (decision 045): the old `faithDraw` code-side gate is gone — eligible whenever the
      // deterministic hardship window holds.
      if (isAdult(age) && protagonist.mind.values.faith >= 20) {
        const recentHardship = eventsFor(events, protagonist.id).some((e) => e.year >= year - 2 && e.year < year && (e.kind === "illness" || e.kind === "feud" || e.kind === "breakdown"));
        if (recentHardship) candidates.push({ decisionId: `A7:${protagonist.id}:${year}`, kind: "A7", personId: protagonist.id, options: ["double-down", "lose-faith", "seek-another-path"] });
      }
      if (isAdult(age) && protagonist.mind.dream.status === "pursuing") {
        const milestone = age % 10 === 0;
        const setback = computeMood(protagonist.mind) <= -25;
        const relatedKinds = DREAM_RELATED_EVENT_KINDS[protagonist.mind.dream.goal];
        const recentRelatedEvent = eventsFor(events, protagonist.id)
          .filter((e) => e.year >= year - 2 && e.year < year && relatedKinds.includes(e.kind))
          .sort((a, b) => b.year - a.year)[0];
        const hasRealCause = setback || !!recentRelatedEvent;
        if (milestone || hasRealCause) {
          const dreamChangeCause = setback ? "a hard stretch" : recentRelatedEvent ? dreamChangeCauseFor(recentRelatedEvent, protagonist.id) : undefined;
          candidates.push({
            decisionId: `A8:${protagonist.id}:${year}`,
            kind: "A8",
            personId: protagonist.id,
            options: hasRealCause ? ["push-harder", "adjust-it", "abandon-it"] : ["push-harder", "abandon-it"],
            extra: dreamChangeCause ? { dreamChangeCause } : undefined,
          });
        }
      }
      // Round 12 (decision 045): the old `affairDraw` code-side gate is gone.
      if (isAdult(age) && protagonist.spouseId && computeMood(protagonist.mind) <= -10) {
        candidates.push({ decisionId: `A9:${protagonist.id}:${year}`, kind: "A9", personId: protagonist.id, partnerId: protagonist.spouseId, options: ["resist", "pursue"] });
      }
      if (protagonist.mind.stress >= 75) {
        const breakdownKind =
          protagonist.mind.facets.anger >= protagonist.mind.facets.anxiety && protagonist.mind.facets.anger >= 100 - protagonist.mind.facets.perseverance
            ? "rage"
            : protagonist.mind.facets.anxiety >= 100 - protagonist.mind.facets.perseverance
              ? "despair"
              : "withdrawal";
        candidates.push({ decisionId: `A11:${protagonist.id}:${year}`, kind: "A11", personId: protagonist.id, options: ["give-in", "master-it"], breakdownKind });
      }
      // Round 12 (decision 045): the old `inheritanceDraw`/`legacyDraw`/`mortalityDraw`/`pilgrimageDraw` code-side gates are all gone below.
      if (age >= 70) {
        const heirs = Object.values(people).filter((c) => (c.motherId === protagonist.id || c.fatherId === protagonist.id) && c.deathYear === undefined);
        if (heirs.length > 0) candidates.push({ decisionId: `O1:${protagonist.id}:${year}`, kind: "O1", personId: protagonist.id, options: ["eldest", "favorite", "split", "town"], extra: { heirs: heirs.length, quarrel: heirs.length >= 2 } });
      }
      if (age >= 65 && protagonist.mind.dream.status !== "realized") {
        candidates.push({ decisionId: `O3:${protagonist.id}:${year}`, kind: "O3", personId: protagonist.id, options: ["last-attempt", "pass-it-on", "make-peace-with-it"] });
      }
      if (age >= 75) {
        candidates.push({ decisionId: `O4:${protagonist.id}:${year}`, kind: "O4", personId: protagonist.id, options: ["peace", "regret", "last-wish"] });
      }
      if (age >= 20 && age <= 55 && protagonist.mind.values.faith >= 15) {
        candidates.push({ decisionId: `PIL1:${protagonist.id}:${year}`, kind: "PIL1", personId: protagonist.id, options: ["go", "stay"] });
      }

      // C2, reused: news of a parent's death reaching the away protagonist a year later — the
      // exact same grieve-openly/harden/lean-on-family options, only the trigger (any age, while
      // away) differs from home C2's "still a minor" gate. `extra.awayNews` flags the prose to
      // frame it as word reaching them from afar rather than a death they witnessed firsthand.
      for (const parentId of [protagonist.motherId, protagonist.fatherId]) {
        const parent = parentId ? people[parentId] : undefined;
        if (parent && parent.deathYear === year - 1) {
          candidates.push({
            decisionId: `C2:${pairKey(protagonist.id, parentId!)}:${year}`,
            kind: "C2",
            personId: protagonist.id,
            partnerId: parentId,
            options: ["grieve-openly", "harden", "cling-to-other-parent"],
            extra: { awayNews: true, relative: parentId === protagonist.motherId ? "mother" : "father" },
          });
        }
      }

      // Return home: PR10 (decision 071) moved this into the general biology loop above (the
      // `livingIds`/`movedAway` block), which now covers the protagonist too — `awaySince` (already
      // computed above for the work/A3 check) is unused here as of this change, but the away-catalog
      // block still needs it for those other candidates, so it stays.
    }
  }

  // AP1 Apprenticeship offer (round 9, decision 035): a parent's choice ABOUT the protagonist — an
  // "other person's decision" turn in the protagonist's own chronicle (`decidedBy` the parent, not
  // the protagonist). Fires once, at age 10 (two years before the protagonist's own C3 "early
  // calling"), if a living parent is on hand to make it.
  if (protagonistId) {
    const protagonist = people[protagonistId];
    if (protagonist && protagonist.deathYear === undefined && ageInYear(protagonist.birthYear, year) === 10) {
      const parentId = [protagonist.fatherId, protagonist.motherId].find((id) => id && people[id] && people[id]!.deathYear === undefined);
      const parent = parentId ? people[parentId] : undefined;
      if (parent) candidates.push({ decisionId: `AP1:${pairKey(parent.id, protagonist.id)}:${year}`, kind: "AP1", personId: parent.id, partnerId: protagonist.id, options: ["apprentice-own-trade", "send-away", "keep-home"] });
    }
  }

  // A5 Town crisis: a rare world-level event presents the SAME situation to every adult in town.
  const townEvent = townEventForYear(seed, year);
  if (townEvent) {
    for (const person of aliveNonMoved) {
      if (!isAdult(ageInYear(person.birthYear, year))) continue;
      candidates.push({ decisionId: `A5:${person.id}:${year}`, kind: "A5", personId: person.id, options: ["help", "flee", "profit"], townEventType: townEvent });
    }
  }

  // D1 daily-life vignette (round 10, decision 043): the real simulation only asks this AFTER every
  // other decision for the year has resolved with no event to show for it (see
  // `resolveDailyLifeVignette`'s doc comment) — that "was the year otherwise quiet" fact isn't known
  // at candidate-gathering time. Still listed here, unconditionally for a living, already-born
  // protagonist, using the exact same pure descriptor builder `resolveDailyLifeVignette` uses, so
  // `validate-override.ts` can reconstruct a `D1:<protagonistId>:<year>` candidate to validate a
  // rewrite against — `feast-day`'s universal eligibility means this is never a false negative.
  // Excluded from `socialCandidates` below (its own dedicated call site already handles it) so it's
  // never double-resolved.
  if (protagonistId) {
    const protagonist = people[protagonistId];
    if (protagonist && protagonist.deathYear === undefined && year >= protagonist.birthYear) {
      // Round 12 continuation (decision 046, hierarchical event selection): the WHOLE eligible pool,
      // not one RNG-picked vignette — a single combined `D1:<protagonistId>:<year>` candidate whose
      // `options` is the union of every eligible vignette's outcomes, so `validate-override.ts`'s
      // simple "is this optionId one of this decision's options" check still works unchanged for a
      // fork/rewrite targeting ANY of them (`getVignetteForOption` resolves which one owns it).
      const vignetteCandidates = buildDailyLifeVignetteCandidates(protagonist, year, seed, people, events, townEvent);
      const options = Array.from(new Set(vignetteCandidates.flatMap((c) => c.descriptor.options)));
      candidates.push({ decisionId: `D1:${protagonist.id}:${year}`, kind: "D1", personId: protagonist.id, options });
    }
  }

  candidates.sort((a, b) => (a.personId === b.personId ? a.kind.localeCompare(b.kind) : a.personId.localeCompare(b.personId)));
  return candidates;
}

// --- Human-readable question/option text -----------------------------------

/** Option labels for the DecisionRecord (third-person, for the log/UI) — distinct from the first-person criteria text sent to Jev (see jev-decision-maker.ts). */
/**
 * Round 7 fix (decision 030, "Sable Underhill set their sights..." should use a real pronoun): a
 * few of these branches referred back to the acting person with singular "their"/"they"/"them"
 * even though `sex` is always known for a real person. `sex` is optional (defaults to gender-
 * neutral "their"/"they"/"them") only so this stays usable from a context with no person object.
 */
function optionLabel(kind: string, optionId: string, selfName: string, otherName?: string, opportunityJob?: string, sex?: Sex): string {
  const their = sex === "f" ? "her" : sex === "m" ? "his" : "their";
  const they = sex === "f" ? "she" : sex === "m" ? "he" : "they";
  switch (kind) {
    case "Y1":
      return optionId === "encourage" ? `${selfName} encourages ${otherName}` : optionId === "decline" ? `${selfName} declines` : `${selfName} waits and says nothing`;
    case "A1":
      return optionId === "propose" ? `${selfName} proposes marriage` : optionId === "delay" ? `${selfName} puts it off` : `${selfName} ends the courtship`;
    case "A3":
      return optionId === "seize" ? `${selfName} seizes the ${opportunityJob ?? "opportunity"} role` : optionId === "pass" ? `${selfName} passes it to a friend` : `${selfName} ignores it`;
    case "A2":
      // Round 8 fix (decision 033): "They decided to have a child" reads as a real turn's chosen
      // outcome — the old "They try for a child" read like an attempt in progress, not something
      // that already happened (spawnChild fires unconditionally the same year "try" is chosen).
      return optionId === "try" ? "They decided to have a child" : optionId === "wait" ? "They decide to wait" : `${selfName} refuses`;
    case "Y4":
      return optionId === "confront" ? `${selfName} confronts ${otherName ?? "them"} openly` : optionId === "forgive" ? `${selfName} lets it go` : `${selfName} nurses the grudge quietly`;
    case "A6":
      return optionId === "reconcile" ? "They reconcile" : optionId === "feud" ? "The feud continues" : `${selfName} sabotages ${otherName ?? "them"}`;
    case "Y3":
      return optionId === "leave" ? `${selfName} leaves for the city` : `${selfName} stays`;
    case "A8":
      return optionId === "push-harder" ? `${selfName} pushes harder toward ${their} dream` : optionId === "adjust-it" ? `${selfName} adjusts ${their} dream` : `${selfName} abandons ${their} dream`;
    case "A11":
      return optionId === "give-in" ? `${selfName} gives in to it` : `${selfName} masters it`;
    case "C2":
      return optionId === "grieve-openly" ? `${selfName} grieves openly` : optionId === "harden" ? `${selfName} hardens` : `${selfName} clings to ${otherName ? `${their} remaining parent` : "what family remains"}`;
    case "C3":
      return optionId === "follow-trade" ? `${selfName} follows the family trade` : optionId === "apprentice-elsewhere" ? `${selfName} seeks an apprenticeship elsewhere` : `${selfName} drifts, unsure`;
    case "O2":
      return optionId === "reconcile" ? `${selfName} makes peace with ${otherName ?? "them"} at last` : `${selfName} takes it to the grave`;
    case "O4":
      return optionId === "peace" ? `${selfName} finds peace with it` : optionId === "regret" ? `${selfName} is consumed by regret` : `${selfName} makes a last wish`;
    case "A5":
      return optionId === "help" ? `${selfName} helps however ${they} can` : optionId === "flee" ? `${selfName} keeps clear of it` : `${selfName} looks for an advantage in it`;
    case "illness":
      return optionId === "illness" ? `${selfName} falls ill` : `${selfName} stays healthy`;
    case "death":
      return optionId === "die" ? `${selfName} dies` : `${selfName} survives`;
    case "immigration":
      return optionId === "arrive" ? "A newcomer arrives" : "No one arrives";
    case "levy":
      return optionId === "impose" ? "The lord imposes a levy" : "The lord spares the village";
    case "arranged-match":
      return optionId === "arrange" ? `${selfName}'s family arranges her marriage` : `No match is arranged for ${selfName} this year`;
    case "C1":
      return optionId === "compete" ? `${selfName} competes with ${otherName ?? "the sibling"} for attention` : optionId === "bond" ? `${selfName} bonds with ${otherName ?? "the sibling"} instead` : `${selfName} withdraws`;
    case "C4":
      return optionId === "fight-back" ? `${selfName} fights back` : optionId === "endure" ? `${selfName} endures it` : `${selfName} tells an elder`;
    case "Y2":
      return optionId === "pursue-the-dream" ? `${selfName} pursues ${their} dream over ${their} trade` : `${selfName} stays practical`;
    case "Y5":
      return optionId === "open-up" ? `${selfName} opens up to ${otherName ?? "them"}` : `${selfName} keeps ${their} distance`;
    case "A4":
      return optionId === "confront" ? `${selfName} confronts ${otherName ?? "them"} over the betrayal` : optionId === "forgive" ? `${selfName} forgives ${otherName ?? "them"}` : optionId === "leave" ? `${selfName} leaves ${otherName ?? "them"}` : `${selfName} seeks revenge`;
    case "A7":
      return optionId === "double-down" ? `${selfName} doubles down on ${their} faith` : optionId === "lose-faith" ? `${selfName} loses ${their} faith` : `${selfName} seeks another path`;
    case "A9":
      return optionId === "resist" ? `${selfName} resists the temptation` : `${selfName} pursues the affair`;
    case "A10":
      return optionId === "take-an-apprentice" ? `${selfName} takes ${otherName ?? "a youth"} on as an apprentice` : `${selfName} declines to take an apprentice`;
    case "O1":
      return optionId === "eldest" ? `${selfName} leaves everything to the eldest` : optionId === "favorite" ? `${selfName} leaves everything to a favorite` : optionId === "split" ? `${selfName} splits the inheritance evenly` : `${selfName} leaves it to the town`;
    case "O3":
      return optionId === "last-attempt" ? `${selfName} makes one last attempt at ${their} dream` : optionId === "pass-it-on" ? `${selfName} passes ${their} dream on` : `${selfName} makes peace with letting it go`;
    case "AP1":
      return optionId === "apprentice-own-trade" ? `${selfName} apprentices ${otherName ?? "them"} to ${their} own trade` : optionId === "send-away" ? `${selfName} sends ${otherName ?? "them"} elsewhere to apprentice` : `${selfName} keeps ${otherName ?? "them"} at home a while longer`;
    case "PIL1":
      return optionId === "go" ? `${selfName} sets out on pilgrimage` : `${selfName} stays home`;
    case "D1":
      return `${selfName} ${D1_OPTION_LABELS[optionId] ?? optionId}`;
    default:
      return optionId;
  }
}

/**
 * The situation, worded from the person's own perspective (spec: "the question fields it depends
 * on, and a question worded from the person's perspective").
 *
 * Decision 059 ("the display half of `questionText()`"): takes `Locale` as its first argument and
 * has a full Spanish branch, but every call site in this file passes `"en"` explicitly and always
 * will — this string does double duty as both `DecisionQuestion.state.situation.question` (sent to
 * Jev, must stay fixed for the answer cache) and `DecisionRecord.question` (persisted once at
 * simulate time, never re-derived per viewer the way `narrate.ts`'s prose is). Exported so the
 * Spanish branch is independently testable and available to a future display layer that reconstructs
 * a localized question from `DecisionRecord`'s structured fields, without this file needing to know
 * about locales at simulation time.
 */
export function questionText(locale: Locale, kind: string, otherName?: string, townName?: string, opportunityJob?: string, breakdownKind?: string, townEventType?: TownEventType): string {
  if (locale === "es") {
    switch (kind) {
      case "Y1":
        return `${otherName} ha mostrado interés en mí. ¿Lo alimento?`;
      case "A1":
        return `Llevamos ya un tiempo cortejándonos. ¿Le propongo matrimonio?`;
      case "A3":
        return `Se ha abierto un puesto como ${opportunityJob ?? "algo nuevo"}. ¿Lo tomo?`;
      case "A2":
        return `¿Intentamos tener un hijo este año?`;
      case "Y4":
        return `${otherName} me ha ofendido. ¿Le hago frente por ello?`;
      case "A6":
        return `Mi rencilla con ${otherName} lleva años. ¿Qué hago al respecto?`;
      case "Y3":
        return `Hay una oportunidad en la ciudad. ¿Me voy, o me quedo?`;
      case "A8":
        return `Mi sueño sigue sin cumplirse. ¿Qué hago al respecto?`;
      case "A11":
        return `El peso de todo se ha vuelto demasiado (${breakdownKind ?? "un punto de quiebre"}). ¿Cómo respondo?`;
      case "C2":
        return `${otherName ?? "Mi progenitor"} ha muerto. ¿Cómo lo afronto?`;
      case "C3":
        return `Ya tengo edad para pensar en qué haré de mi vida. ¿Qué me llama?`;
      case "O2":
        return `He cargado este rencor contra ${otherName ?? "ellos"} durante años. ¿Hago las paces al fin?`;
      case "O4":
        return `Soy viejo, y la muerte se acerca. ¿Cómo la recibo?`;
      case "A5":
        return `${townEventType ? TOWN_EVENT_LABEL_ES[townEventType] : "Algo ha sucedido en"} ${townName ?? "el pueblo"}. ¿Qué hago?`;
      case "illness":
        return `¿Enfermo este año?`;
      case "death":
        return `¿Sobrevivo este año?`;
      case "immigration":
        return `¿Llega un recién llegado a ${townName ?? "el pueblo"} este año?`;
      case "levy":
        return `¿Impone el señor un tributo contra ${townName ?? "la aldea"} este año?`;
      case "arranged-match":
        return `¿Se concierta este año un matrimonio para ella con un pretendiente de otro señorío?`;
      case "C1":
        return `${otherName ?? "Mi hermano"} sigue acaparando la atención que quiero para mí. ¿Qué hago?`;
      case "C4":
        return `${otherName ?? "Alguien"} no deja de acosarme. ¿Qué hago?`;
      case "Y2":
        return `Mi sueño y mi oficio tiran en direcciones distintas. ¿Qué hago?`;
      case "Y5":
        return `${otherName ?? "Alguien"} y yo nos hemos acercado. ¿Me sincero con esa persona?`;
      case "A4":
        return `He descubierto una traición. ¿Cómo respondo?`;
      case "A7":
        return `Mi fe se ha tambaleado. ¿Qué hago?`;
      case "A9":
        return `Siento una atracción hacia alguien que no es mi cónyuge. ¿Qué hago?`;
      case "A10":
        return `${otherName ?? "Un joven"} cerca de mí necesitaría un mentor. ¿Lo tomo bajo mi ala?`;
      case "O1":
        return `Soy viejo, con propiedades que dejar. ¿Cómo las reparto?`;
      case "O3":
        return `Mi sueño nunca se cumplió. ¿Qué hago con lo que queda de él?`;
      case "AP1":
        return `${otherName ?? "Mi hijo"} ya tiene edad para un oficio. ¿Qué decido para él?`;
      case "PIL1":
        return `Desde hace tiempo siento la llamada de una peregrinación. ¿Voy?`;
      default:
        return `¿Qué hago (${kind})?`;
    }
  }
  switch (kind) {
    case "Y1":
      return `${otherName} has shown interest in me. Do I encourage it?`;
    case "A1":
      return `We have been courting a while now. Do I propose?`;
    case "A3":
      return `A position as ${opportunityJob ?? "something new"} has opened up. Do I seize it?`;
    case "A2":
      return `Do we try for a child this year?`;
    case "Y4":
      return `${otherName} has slighted me. Do I confront them over it?`;
    case "A6":
      return `My feud with ${otherName} has gone on for years. What do I do about it?`;
    case "Y3":
      return `There is an opportunity in the city. Do I leave, or stay?`;
    case "A8":
      return `My dream still isn't realized. What do I do about it?`;
    case "A11":
      return `The weight of it all has become too much (${breakdownKind ?? "a breaking point"}). How do I respond?`;
    case "C2":
      return `${otherName ?? "My parent"} has died. How do I face it?`;
    case "C3":
      return `I am getting old enough to think about what I'll make of myself. What calls to me?`;
    case "O2":
      return `I have carried this grudge against ${otherName ?? "them"} for years. Do I finally make peace with it?`;
    case "O4":
      return `I am old, and death draws near. How do I meet it?`;
    case "A5":
      return `${townEventType ? TOWN_EVENT_LABEL[townEventType] : "Something has happened in"} ${townName ?? "town"}. What do I do?`;
    case "illness":
      return `Do I fall ill this year?`;
    case "death":
      return `Do I survive this year?`;
    case "immigration":
      return `Does a newcomer arrive in ${townName ?? "town"} this year?`;
    case "levy":
      return `Does the lord levy against ${townName ?? "the village"} this year?`;
    case "arranged-match":
      return `Is a marriage arranged for her with a suitor from another manor this year?`;
    case "C1":
      return `${otherName ?? "My sibling"} keeps drawing the attention I want. What do I do?`;
    case "C4":
      return `${otherName ?? "A peer"} keeps bullying me. What do I do?`;
    case "Y2":
      return `My dream and my trade pull in different directions. What do I do?`;
    case "Y5":
      return `${otherName ?? "Someone"} and I have grown close. Do I open up to them?`;
    case "A4":
      return `I have discovered a betrayal. How do I respond?`;
    case "A7":
      return `My faith has been shaken. What do I do?`;
    case "A9":
      return `I feel a pull toward someone who isn't my spouse. What do I do?`;
    case "A10":
      return `${otherName ?? "A young person"} nearby could use a mentor. Do I take them on?`;
    case "O1":
      return `I am old, with property to leave behind. How do I divide it?`;
    case "O3":
      return `My dream was never realized. What do I do with what's left of it?`;
    case "AP1":
      return `${otherName ?? "My child"} is old enough for a trade. What do I decide for them?`;
    case "PIL1":
      return `I have long felt the pull of a pilgrimage. Do I go?`;
    default:
      return `What do I do (${kind})?`;
  }
}

const SOCIAL_KINDS = new Set(["Y1", "A1", "A2", "A3", "Y3", "Y4", "A6", "A8", "A11", "C2", "O2", "O4", "A5", "C3", "C1", "C4", "Y2", "Y5", "A4", "A7", "A9", "A10", "O1", "O3", "AP1", "PIL1", "D1"]);

/** Short, third-person labels for `D1`'s vignette-specific option ids (round 10, decision 042) — unique across the whole pool, same as their Jev criteria text (`vignettes.ts`), just terser for the UI's `DecisionOption.label`. */
const D1_OPTION_LABELS: Readonly<Record<string, string>> = {
  "share-grain": "shares the grain",
  "keep-grain": "keeps the grain close",
  "tighten-belt": "tightens the belt",
  "grumble-openly": "grumbles about it",
  "give-thanks": "gives thanks at the feast",
  "keep-quiet": "stays quietly relieved",
  haggle: "haggles hard",
  "pay-fair": "pays a fair price",
  focus: "pays close attention",
  "wander-off": "lets attention wander",
  "make-peace": "makes peace",
  "stay-cross": "stays cross",
  help: "helps the neighbor",
  decline: "lets it go unanswered",
  approach: "finds a reason to speak with them",
  "hold-back": "says nothing",
  "join-in": "joins the festivities",
  "keep-to-self": "keeps to home",
  "nurse-it": "nurses the animal",
  "let-it-go": "lets the animal go",
  "pay-it-off": "pays off the debt",
  "let-it-ride": "lets the debt ride",
  "teach-patiently": "teaches patiently",
  "teach-briskly": "pushes through the lesson briskly",
  "push-through": "pushes through the aches",
  rest: "rests instead",
  // Round 10, decision 043: age-appropriate additions (early childhood, childhood, youth).
  "watch-the-night": "sits up watching over the cradle",
  "trust-it-passes": "trusts the fever will pass",
  "make-much-of-it": "makes much of the first step",
  "note-it-quietly": "notes it quietly",
  "make-room-gladly": "makes room gladly for the new sibling",
  "mind-the-fuss": "minds the fuss over the new sibling",
  "forbid-wandering": "forbids wandering after that",
  "let-the-world-stay-wide": "lets the world stay wide",
  "let-them-stay-up": "lets the child stay up for the festival",
  "send-them-to-bed": "sends the child to bed early",
  "pitch-in": "pitches in properly",
  "slip-off-to-play": "slips off to play",
  "keep-it": "keeps the secret",
  "let-it-slip": "lets the secret slip",
  "take-it-to-heart": "takes the scolding to heart",
  "shrug-it-off": "shrugs off the scolding",
  "feed-it": "feeds the stray dog",
  "chase-it-off": "chases the stray dog off",
  "throw-the-first-punch": "throws the first punch",
  "walk-away": "walks away from the fight",
  "fetch-without-complaint": "fetches the water without complaint",
  "grumble-about-it": "grumbles about the walk to the well",
  "take-the-floor": "takes the floor to dance",
  "watch-from-the-edge": "watches from the edge of the feast",
  "go-through-with-it": "goes through with the dare",
  "back-down": "backs down from the dare",
  "work-hard-to-impress": "works hard to impress the master",
  "keep-to-the-minimum": "keeps to the minimum asked",
  "hold-my-ground": "holds ground over the future",
  "back-down-for-peace": "backs down for the sake of peace",
};

function buildQuestion(descriptor: CandidateDescriptor, year: number, config: WorldConfig, people: Record<string, Person>): DecisionQuestion {
  const person = people[descriptor.personId]!;
  const base = personSummary(person, year, people);
  const town = config.town.name;
  const partner = descriptor.partnerId ? people[descriptor.partnerId] : undefined;
  const partnerSummary = partner ? otherPersonBrief(partner, year, people) : undefined;

  const stateKey = descriptor.kind === "Y1" ? "suitor" : descriptor.kind === "Y4" || descriptor.kind === "A6" || descriptor.kind === "O2" ? "rival" : descriptor.kind === "C2" ? "parent" : "partner";
  // D1 (round 10, decision 042): the question text comes from the vignette itself
  // (`descriptor.extra.vignette`), not the generic `questionText` table — the whole point of one
  // generic kind is that its wording lives in the vignette pool, parameterized by state.
  const vignetteId = descriptor.kind === "D1" && typeof descriptor.extra?.vignette === "string" ? descriptor.extra.vignette : undefined;
  const vignetteForQuestion = vignetteId ? getVignette(vignetteId) : undefined;
  // Decision 059: always English — this is what `state.situation.question` sends to Jev (below),
  // and the model-facing string must stay fixed regardless of the reader's locale so the answer
  // cache stays valid. See `buildQuestion`'s other call site (the `D1` `DecisionRecord.question`
  // just above `buildDailyLifeVignetteCandidates`) for the same rule, spelled out at length.
  const situationQuestion = vignetteForQuestion
    ? vignetteForQuestion.question("en", town)
    : questionText("en", descriptor.kind, partner?.name, town, descriptor.opportunityJob, descriptor.breakdownKind, descriptor.townEventType);
  const state: Record<string, JsonValue> = {
    self: base,
    situation: { code: descriptor.kind, question: situationQuestion, ...descriptor.extra },
    town,
    year,
  };
  if (partnerSummary) state[stateKey] = partnerSummary;

  return {
    id: descriptor.decisionId,
    kind: descriptor.kind as DecisionQuestion["kind"],
    personId: descriptor.personId,
    year,
    state,
    options: descriptor.options,
  };
}

/**
 * Resolves the distribution a decision samples from. Per decision 016
 * (superseding 013): when the engine is Jev, `final` IS `jevRaw` — no
 * code-side blend. `prior` (the deterministic rule heuristic) is computed
 * ONLY when Jev was not asked at all (rules engine or biology), so it's
 * never mixed with a real Jev judgment.
 */
async function resolveSocialDecision(question: DecisionQuestion, decisionMaker: DecisionMaker, engineSource: "jev" | "rules"): Promise<ResolvedDecision> {
  if (engineSource === "jev") {
    // Jev's own answer is trusted to already be a normalized probability distribution — stored and used as-is (decision 016).
    const jevRaw = await decisionMaker.decide(question);
    return { jevRaw, final: jevRaw, source: "jev" };
  }
  // `ruleDistribution` returns raw relative weights for some kinds (e.g. career-change), not necessarily summing to 1.
  const prior = normalizeDistribution(ruleDistribution(question) as Record<string, number>);
  return { prior, final: prior, source: "rules" };
}

/**
 * The pure `D1` candidate-building step: given a protagonist and year, deterministically picks the
 * eligible vignette (keyed RNG) and returns its `CandidateDescriptor` alongside the vignette itself.
 * Shared by `resolveDailyLifeVignette` (the real per-year call site, below) AND
 * `gatherCandidatesForYear` (round 10, decision 043 — `validate-override.ts` needs to be able to
 * reconstruct a `D1:<protagonistId>:<year>` candidate too, so a rewrite of a `D1` decision validates
 * the same way any other decision does), so the two can never disagree about which vignette a given
 * protagonist-year would offer.
 */
function buildDailyLifeVignetteDescriptor(
  protagonist: Person,
  year: number,
  seed: string,
  people: Readonly<Record<string, Person>>,
  events: readonly Event[],
  townEventType: TownEventType | undefined,
): { descriptor: CandidateDescriptor; vignette: Vignette; deciderId: string } {
  const ctx: VignetteContext = {
    age: ageInYear(protagonist.birthYear, year),
    away: hasMovedAway(events, protagonist.id),
    job: protagonist.job,
    socialClass: protagonist.socialClass ?? "cottar",
    hasSpouse: !!protagonist.spouseId,
    hasChild: livingChildId(people, protagonist) !== undefined,
    hasLivingParent: relationshipTargetId("parent", protagonist, people) !== undefined,
    hasLivingSibling: livingSiblingId(people, protagonist) !== undefined,
    season: seasonFor(seed, protagonist.id, year, "D1"),
    townEventType,
  };
  // Round 10, decision 043: excludes any vignette this same life used within the last 5 years —
  // deterministic (based on the actual event log, not a re-roll), and dropped rather than leaving
  // the year empty if every eligible vignette was recently used.
  const recentIds = new Set(
    events.filter((e) => e.kind === "vignette" && e.actors.includes(protagonist.id) && e.year >= year - 5 && e.year < year).map((e) => e.payload.vignette as string),
  );
  const vignette = pickVignette(seed, protagonist.id, year, ctx, recentIds);
  const options = Object.keys(vignette.outcomes);
  const decisionId = `D1:${protagonist.id}:${year}`;
  // An infant/toddler can't make this call themselves (decision 043) — attributed to a living parent
  // instead, same preference (mother, then father) `AP1`'s "other person's decision" already uses.
  const deciderId = vignette.decidedByParent ? (relationshipTargetId("parent", protagonist, people) ?? protagonist.id) : protagonist.id;
  const descriptor: CandidateDescriptor = {
    decisionId,
    kind: "D1",
    personId: deciderId,
    ...(deciderId !== protagonist.id ? { partnerId: protagonist.id } : {}),
    options,
    extra: { vignette: vignette.id },
  };
  return { descriptor, vignette, deciderId };
}

/**
 * Round 12 continuation (decision 046, hierarchical event selection): the WHOLE eligible-vignette
 * pool for this protagonist-year (same context/recency logic `buildDailyLifeVignetteDescriptor`
 * uses), one `CandidateDescriptor` per vignette — each becomes its own speculative `D1` situation in
 * a person-year batch, rather than code pre-picking a single winner by RNG. Each candidate's
 * `decisionId` embeds the protagonist and vignette (`D1:<protagonistId>:<year>:<vignetteId>`) so
 * they never collide within a year; the FINAL, single `D1:<protagonistId>:<year>` `DecisionRecord`
 * (what forks/overrides address) is assembled afterward from whichever one wins. `personId` on each
 * candidate is still `deciderId` (self, or a living parent for the `decidedByParent` early-childhood
 * pool — decision 043) — so this can split across two batches (the protagonist's own, and a living
 * parent's) when both self-decided and parent-decided vignettes are eligible the same year (ages
 * 3-5); `simulate()` merges their `vignetteSelection`s before the final cross-batch pick.
 */
function buildDailyLifeVignetteCandidates(
  protagonist: Person,
  year: number,
  seed: string,
  people: Readonly<Record<string, Person>>,
  events: readonly Event[],
  townEventType: TownEventType | undefined,
): { readonly descriptor: CandidateDescriptor; readonly vignette: Vignette; readonly deciderId: string }[] {
  const ctx: VignetteContext = {
    age: ageInYear(protagonist.birthYear, year),
    away: hasMovedAway(events, protagonist.id),
    job: protagonist.job,
    socialClass: protagonist.socialClass ?? "cottar",
    hasSpouse: !!protagonist.spouseId,
    hasChild: livingChildId(people, protagonist) !== undefined,
    hasLivingParent: relationshipTargetId("parent", protagonist, people) !== undefined,
    hasLivingSibling: livingSiblingId(people, protagonist) !== undefined,
    season: seasonFor(seed, protagonist.id, year, "D1"),
    townEventType,
  };
  const recentIds = new Set(
    events.filter((e) => e.kind === "vignette" && e.actors.includes(protagonist.id) && e.year >= year - 5 && e.year < year).map((e) => e.payload.vignette as string),
  );
  const pool = eligibleVignettePool(ctx, recentIds);
  return pool.map((vignette) => {
    const options = Object.keys(vignette.outcomes);
    const decisionId = `D1:${protagonist.id}:${year}:${vignette.id}`;
    const deciderId = vignette.decidedByParent ? (relationshipTargetId("parent", protagonist, people) ?? protagonist.id) : protagonist.id;
    const descriptor: CandidateDescriptor = {
      decisionId,
      kind: "D1",
      personId: deciderId,
      ...(deciderId !== protagonist.id ? { partnerId: protagonist.id } : {}),
      options,
      extra: { vignette: vignette.id },
    };
    return { descriptor, vignette, deciderId };
  });
}

export interface LegacyOwnedRunState {
  readonly people: Record<string, Person>;
  readonly events: Event[];
  readonly decisions: DecisionRecord[];
  readonly counters: { decisionCalls: number };
}

export type LegacySimulationRunContext = LegacyRunContext<CandidateDescriptor, MarriageFunnelCollector>;

interface LegacyRunBindings {
  readonly seed: string;
  readonly originalOverrideYear: number;
  readonly protagonistId: string | undefined;
  readonly debug: MarriageFunnelCollector | undefined;
  readonly overrides: readonly Override[];
  readonly concurrencyLimit: number;
  readonly yearBatchConcurrency: number;
}

/** Borrow owned state and LIVE options; catalog ports retain the original implementations. */
export function createLegacyRunContext(
  config: WorldConfig,
  owned: LegacyOwnedRunState,
  options: SimulateOptions,
  bindings: LegacyRunBindings = {
    seed: config.seed,
    originalOverrideYear: options.fromYear ?? config.startYear,
    protagonistId: options.protagonistId,
    debug: options.marriageFunnelDebug,
    overrides: options.overrides ?? [],
    concurrencyLimit: options.concurrencyLimit ?? DEFAULT_CONCURRENCY_LIMIT,
    yearBatchConcurrency: options.yearBatchConcurrency ?? DEFAULT_YEAR_BATCH_CONCURRENCY,
  },
): LegacySimulationRunContext {
  const { people, events, decisions, counters } = owned;
  const { seed, originalOverrideYear, protagonistId, debug: marriageFunnelDebug, overrides, concurrencyLimit, yearBatchConcurrency } = bindings;
  return {
    config, people, events, decisions, originalOverrideYear, protagonistId, counters,
    debug: marriageFunnelDebug, marriageFunnelDebug, options, overrides,
    captureCandidates: (capturedYear, debug) => gatherCandidatesForYear(
      capturedYear, people, events, seed, options.protagonistId,
      debug ? { collector: debug, startYear: config.startYear } : undefined,
    ),
    resolveBiologyDecision, mortalityMultiplier: townEventMortalityMultiplier, townEventForYear,
    isSocialKind: (kind) => SOCIAL_KINDS.has(kind),
    inMarriageFunnelCohort, buildQuestion, optionLabel, questionText,
    buildDailyLifeVignetteCandidates, buildDailyLifeVignetteDescriptor, getVignetteForOption,
    personSummary, resolveSocialDecision,
    decisionBudget: LIFE_DECISION_BUDGET, concurrencyLimit, yearBatchConcurrency,
  };
}

/**
 * Runs the deterministic yearly simulation from `fromYear` (or the config's
 * start year) through `config.endYear`. Every probabilistic choice — social
 * (via the `DecisionMaker` port) or biological (illness, death,
 * immigration, from actuarial curves) — becomes a `DecisionRecord`, sampled
 * with Gumbel-max noise keyed per (seed, personId, year, decisionKind,
 * optionId), so the same seed + same state always yields the same outcome,
 * and a generic `Override` can force any specific decision's option.
 */
export async function* simulateYears(
  config: WorldConfig,
  initialPeople: Readonly<Record<string, Person>>,
  initialEvents: readonly Event[],
  options: SimulateOptions,
): AsyncGenerator<YearTick, SimulateReport> {
  const started = Date.now();
  const people: Record<string, Person> = structuredClone(initialPeople as Record<string, Person>);
  const events: Event[] = structuredClone(initialEvents as Event[]);
  const decisions: DecisionRecord[] = [];
  const overrides = options.overrides ?? [];
  const concurrencyLimit = options.concurrencyLimit ?? DEFAULT_CONCURRENCY_LIMIT;
  const yearBatchConcurrency = options.yearBatchConcurrency ?? DEFAULT_YEAR_BATCH_CONCURRENCY;
  const seed = config.seed;
  const snapshots = new Map<number, YearSnapshot>();
  const counters = { decisionCalls: 0 };
  // Decision 047: captured once, outside the per-candidate loop below, because that loop shadows
  // `options` with a local `DecisionOption[]` of the same name (its `decisions.push({ options, ... })`
  // shorthand) — referencing `options.protagonistId` inside that loop would hit the TDZ instead of
  // this function's `SimulateOptions` parameter.
  const protagonistId = options.protagonistId;
  // PR11 (STEP 1): same shadowing hazard as `protagonistId` above — captured once here, outside the
  // per-candidate loop that shadows `options`.
  const marriageFunnelDebug = options.marriageFunnelDebug;

  const startYear = options.fromYear ?? config.startYear;

  snapshots.set(startYear - 1, captureLegacyYear({ people, events, decisions }, startYear - 1));

  for (let year = startYear; year <= config.endYear; year++) {
    const context = createLegacyRunContext(config, { people, events, decisions, counters }, options, {
      seed, originalOverrideYear: startYear, protagonistId, debug: marriageFunnelDebug,
      overrides, concurrencyLimit, yearBatchConcurrency,
    });
    const snapshot = await runLegacyYear(context, year);

    snapshots.set(year, snapshot);
    yield { year, snapshot };

    // Round 9 (decision 034, the single-life pivot): the simulation stops the year the protagonist
    // dies — their life is what's being told, and the contract's death-is-always-a-turn/fork-to-
    // continue mechanic only makes sense as the LAST year, not an arbitrary mid-run one. No-op with
    // no `protagonistId` (the general village simulation always runs the full configured span).
    if (options.protagonistId && people[options.protagonistId]?.deathYear !== undefined) break;
  }

  return {
    result: { config, people, events, decisions },
    snapshots,
    wallTimeMs: Date.now() - started,
    decisionCalls: counters.decisionCalls,
    hazardFallbacks: options.decisionMaker.getStats?.().hazardFallbacks ?? {},
  };
}

/**
 * Batch entry point — every one of `simulate()`'s ~17 existing callers keeps calling this exactly
 * as before (design decision 8: "the generator returns `SimulateReport`; `drainSimulation`
 * captures it"). It's now a thin wrapper: `simulateYears()` does the actual work, one year at a
 * time; this just drains it without a tick callback.
 */
export async function simulate(
  config: WorldConfig,
  initialPeople: Readonly<Record<string, Person>>,
  initialEvents: readonly Event[],
  options: SimulateOptions,
): Promise<SimulateReport> {
  return drainSimulation(simulateYears(config, initialPeople, initialEvents, options));
}

function resolveBiologyDecision(descriptor: CandidateDescriptor, year: number, p: number, seed: string, forced: Override | undefined, selfName: string, townName: string, minted: MintedId): DecisionRecord {
  const options: DecisionOption[] = descriptor.options.map((id) => ({ id, label: optionLabel(descriptor.kind, id, selfName) }));

  if (forced) {
    return {
      id: minted.id,
      personId: descriptor.personId,
      year,
      kind: descriptor.kind,
      question: questionText("en", descriptor.kind, undefined, townName),
      options,
      final: { [forced.optionId]: 1 },
      noise: {},
      chosen: forced.optionId,
      fragility: NOT_FRAGILE,
      surprise: false,
      source: "forced",
      causes: [],
      resultingEventIds: [],
    };
  }

  const final = biologyDistribution(descriptor.kind, p);
  const sample = sampleGumbelMax(final as Record<string, number>, seed, descriptor.personId, year, descriptor.kind);
  return {
    id: minted.id,
    personId: descriptor.personId,
    year,
    kind: descriptor.kind,
    question: questionText("en", descriptor.kind, undefined, townName),
    options,
    prior: final,
    final,
    noise: sample.noise,
    chosen: sample.chosen,
    fragility: decisionFragility(sample.scores),
    surprise: isSurprise(final, sample.chosen),
    source: "biology",
    causes: [],
    resultingEventIds: [],
  };
}

export { dreamGoalSatisfiedBy, eligibleForAnotherChild, feudPairHistory, gatherCandidatesForYear, resolveCourtshipOnDeath, townEventMortalityMultiplier };

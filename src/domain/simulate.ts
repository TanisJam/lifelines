import { ageInYear, classMortalityMultiplier, deathProbabilityAtAge, isAdult, isFertileAge, isWorkingAge } from "./actuarial";
import { mapWithConcurrency } from "./concurrency";
import { candidateMatchesSubject, decisionSubject, mintDecisionId, type MintedId } from "./decision-id";
import type { DecisionMaker, DecisionOption, DecisionQuestion, DecisionRecord, DecisionSource, Distribution, PersonYearSituation } from "./decisions";
import { activeFeudPair, activeRomancePair, activeRomancePairs, awayMoveYear, eventsFor, hasMovedAway, isAlive, lastIllnessYear, makeEventId, pairKey, recentUnresolvedBreakup } from "./events";
import { advanceSlot, applyLifeTransition, EMPTY_SLOTS, ensureLifeState, markMarriageable } from "./life-state";
import { article } from "./narrate";
import { addMemory, applyCoreMemoryShift, compactMindState, computeMood, createMind, decayMindForYear, DREAM_GOALS, dreamGerund, type DreamGoal, type Facet, pushThought, renderPortrait, updateRelationship } from "./mind";
import type { Locale } from "./locale";
import { determineDeathCause, type MortalityContext } from "./mortality";
import { storyCircle } from "./story-circle";
import { FEMALE_NAMES, MALE_NAMES, pickName, SURNAMES } from "./names";
import {
  CONCEPTION_PROBABILITY_BANDS,
  FERTILITY_DAMPING_FLOOR,
  IMMIGRATION_ANNUAL_PROBABILITY,
  IMMIGRATION_ANNUAL_PROBABILITY_POST_PLAGUE,
  IMMIGRATION_POPULATION_CAP_RATIO,
  IMMIGRATION_POST_PLAGUE_END_YEAR,
  IMMIGRATION_POST_PLAGUE_YEAR,
  RETURN_HOME_MIN_AWAY_YEARS,
  RETURN_HOME_PROBABILITY,
  VILLAGE_CARRYING_CAPACITY_RATIO,
} from "./params/demography";
import { FALLBACK_CLASS } from "./period/classes";
import {
  BLACK_DEATH_YEARS,
  blackDeathMortalityForYear,
  datedNationalEventTypesForYear,
  isHundredYearsWarLevyYear,
  SECOND_PESTILENCE_YEARS,
  secondPestilenceMortalityForYear,
} from "./period/events";
import { isLeyrwiteEligible, isUnfree, manorialFinePayload, shouldPresentLeyrwite } from "./period/markers";
import { minEligibleAge } from "./hazards";
import { decisionFragility, isSurprise, keyedDraw, keyedRng, normalizeDistribution, NOT_FRAGILE, sampleGumbelMax } from "./rng";
import { ruleDistribution } from "./rule-heuristics";
import { seasonFor } from "./town";
import { TRAIT_POOL, type Event, type EventKind, type JsonValue, type Job, type Override, type Person, type Sex, type SimulationResult, type SocialClass, type Trait, type WorldConfig, type YearSnapshot } from "./types";
import { eligibleVignettePool, getVignette, getVignetteForOption, pickVignette, type Vignette, type VignetteContext, type VignetteRelationshipTarget } from "./vignettes";
import { isLiterate, pickCommonClass, pickJobForClass, pickTraits } from "./worldgen";

const DEFAULT_CONCURRENCY_LIMIT = 8;

/** Round 11 (decision 044): how many people's person-year batches to request in parallel within a single simulated year. Distinct from `DEFAULT_CONCURRENCY_LIMIT` (biology/legacy per-candidate calls) — this is the fan-out width across people, throttled further by the adapter's own rate limiter. */
const DEFAULT_YEAR_BATCH_CONCURRENCY = 64;

/**
 * A decision gets persisted into the log if it produced a real outcome, OR
 * if the road not taken had at least this much probability mass — i.e. it
 * was a genuine crossroads, not a coin so weighted it could only ever land
 * one way. Below this, a "did nothing happen" record for every person,
 * every year, would dwarf the actually-interesting decisions (see decision
 * 007). Applies to biology decisions (illness, death, immigration); social
 * decisions are always recorded once asked, since (round 12, decision 045)
 * eligibility is now the only code-side filter — Jev's per-person-year
 * event-selection Choice, not a code-level probability gate, decides which
 * eligible candidate (if any) actually happens.
 */
const RECORD_THRESHOLD = 0.05;

/** The kind of settlement a protagonist who leaves home might settle in (decision 040). */
const SETTLEMENT_KINDS = ["market town", "port town", "city"] as const;

/**
 * Deterministically names the place a protagonist settles after leaving home (decision 040) —
 * keyed by seed + the year they left, reusing the `SURNAMES` pool (already town-name-shaped) so
 * no new name list is needed. `full` is the one-time introduction ("Millbrook, a market town");
 * `name` alone is used for every later reference.
 */
function pickAwayDestination(seed: string, year: number): { name: string; kind: string; full: string } {
  const nameIdx = Math.floor(keyedDraw(seed, "away-destination", year, "name") * SURNAMES.length);
  const kindIdx = Math.floor(keyedDraw(seed, "away-destination", year, "kind") * SETTLEMENT_KINDS.length);
  const name = SURNAMES[nameIdx]!;
  const kind = SETTLEMENT_KINDS[kindIdx]!;
  return { name, kind, full: `${name}, a ${kind}` };
}

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

function pushEvent(events: Event[], year: number, kind: EventKind, actors: readonly string[], payload: Record<string, JsonValue>, causes: readonly string[]): Event {
  const event: Event = { id: makeEventId(events, year, kind, actors), year, kind, actors, payload, causes };
  events.push(event);
  return event;
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
 * Decision 054's widowhood handling, extracted (fixed after review, R3-001) so BOTH death paths
 * that can end a marriage — the general biology death-resolution block AND decision 051's
 * maternal-death-in-childbirth roll, which previously skipped it entirely, leaving a widower's
 * `spouseId` set forever and no `widowed` event for him — share one source of truth. Clears
 * `spouseId` on both sides, records a `widowed` event causally linked to the death, and lets an
 * artisan's widow keep the shop (only when SHE doesn't already have a trade of her own) exactly as
 * decision 054 specified. No-ops (returns no event ids) when `deceased` has no living spouse.
 */
function resolveWidowhood(
  seed: string,
  events: Event[],
  people: Record<string, Person>,
  deceased: Person,
  deceasedSocialClass: SocialClass,
  year: number,
  deathEventId: string,
): readonly string[] {
  if (!deceased.spouseId) return [];
  const survivor = people[deceased.spouseId];
  if (!survivor || survivor.deathYear !== undefined) return [];
  // Read BEFORE clearing spouseId below — see the marriage-side note in the `A1` case for why.
  const survivorState = ensureLifeState(survivor, events);
  survivor.spouseId = undefined;
  deceased.spouseId = undefined;
  survivor.lifeState = applyLifeTransition(survivorState, { axis: "marital", to: "widowed" }, year);
  const keepsTrade = deceasedSocialClass === "artisan" && deceased.job !== "none" && survivor.sex === "f" && survivor.job === "none";
  if (keepsTrade) {
    survivor.job = deceased.job;
    survivor.socialClass = "artisan";
  }
  const widowedEvent = pushEvent(events, year, "widowed", [survivor.id, deceased.id], keepsTrade ? { keptTrade: true } : {}, [deathEventId]);
  pushThought(survivor.mind, "grief", `losing ${deceased.name}`, 75, 8, year, "lovePropensity", deceased.id);
  addMemory(seed, survivor.id, year, survivor.mind, `was widowed when ${deceased.name} died in ${year}`, "grief", deceased.id);
  return [widowedEvent.id];
}

/**
 * PR6 corrective (validator finding, engram #6280 "the dead-suitor lockout"): `activeRomancePair`
 * (events.ts) only treats a romance as resolved once a `breakup` or `marriage` event exists for that
 * exact pair — a partner's DEATH never resolved it, so the survivor stayed permanently barred from
 * Y1 (`!person.spouseId && activeRomancePair(...) === undefined`) and from A1 (which needs a living
 * partner). Measured: 26 of 53 romances ended this way, 18 of 91 unmarried adults locked out ~12.9
 * years on average. Called for EVERY death (general biology and decision 051's maternal-death path
 * both), regardless of the deceased's own marital status — a still-unresolved romance can persist
 * even for someone who separately married someone else (the pre-existing multi-suitor property; see
 * decision 065's "Real pre-existing bugs" note), so this always attempts to close it. No-ops when
 * the deceased had no unresolved romance, or its partner is dead or already resolved otherwise.
 *
 * Decision 079: resolves EVERY simultaneous unresolved romance the deceased had (`activeRomancePairs`),
 * not just one — found via a real 60-seed run (`lockout-check-12`) where a person had two SAME-YEAR
 * romances; the original single-partner version (`activeRomancePair`) only ever closed the first one
 * found, leaving the OTHER suitor permanently locked out — the exact "dead-suitor lockout" bug this
 * function exists to fix, just for the second (and later) simultaneous suitor instead of the first.
 * Higher population/marriage activity from decision 079's own population-growth tuning made this
 * pre-existing multi-suitor gap common enough to trip the curated invariant test below for the first
 * time (see that test's own doc comment for the exact reproduction).
 */
function resolveCourtshipOnDeath(events: Event[], people: Record<string, Person>, deceased: Person, year: number, deathEventId: string): readonly string[] {
  const resultingIds: string[] = [];
  for (const partnerId of activeRomancePairs(events, deceased.id)) {
    const partner = people[partnerId];
    if (!partner || partner.deathYear !== undefined) continue;
    const partnerState = ensureLifeState(partner, events);
    // Only reset the marital AXIS if this romance was actually the survivor's current relationship
    // (`"courting"`) — a stale, never-resolved thread from years ago shouldn't overwrite a partner who
    // has since gone on to marry someone else; the `breakup` event alone is enough to unblock them.
    if (partnerState.marital.status === "courting") {
      partner.lifeState = applyLifeTransition(partnerState, { axis: "marital", to: "single" }, year);
    }
    const breakupEvent = pushEvent(events, year, "breakup", [deceased.id, partnerId], { causeOfDeath: true }, [deathEventId]);
    resultingIds.push(breakupEvent.id);
  }
  return resultingIds;
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

/**
 * Decision 055 / PR14 STEP 2 (decision 076): conception probability given a real "try" this year —
 * replaces the old 100%. Looks up `params/demography.ts#CONCEPTION_PROBABILITY_BANDS` — see that
 * constant's own doc comment (and `provenance.ts`) for the Davenport-interval rationale and the
 * measured evidence behind PR14's raise.
 */
export function conceptionProbability(age: number): number {
  const band = CONCEPTION_PROBABILITY_BANDS.find((b) => age < b.maxAge) ?? CONCEPTION_PROBABILITY_BANDS[CONCEPTION_PROBABILITY_BANDS.length - 1]!;
  return band.probability;
}

/**
 * Decision 080: a carrying-capacity feedback on conception, closing the population-ceiling gap
 * `IMMIGRATION_POPULATION_CAP_RATIO` never covered (see `VILLAGE_CARRYING_CAPACITY_RATIO`'s own doc
 * comment, `params/demography.ts`, for the full root-cause story). Below capacity (the village's own
 * founder headcount times `VILLAGE_CARRYING_CAPACITY_RATIO`), returns 1 — no change from today's
 * behavior. Past it, tapers hyperbolically toward `FERTILITY_DAMPING_FLOOR` as `capacity / livingCount`
 * — smooth (no cliff at the boundary, unlike the immigration candidate's hard cutoff) and monotonic
 * (more overcrowding always dampens at least as much as less). Multiplies directly into the "try"
 * conceive roll at the call site below, rather than gating A2's ELIGIBILITY — a couple can still be
 * asked and still try, exactly as before; only the odds of success shrink, matching how
 * `conceptionProbability` itself already expresses "probability of success", not "eligible at all".
 */
export function fertilityDampingFactor(people: Readonly<Record<string, Person>>): number {
  const founderCount = Object.values(people).filter((p) => p.founder).length;
  const capacity = founderCount * VILLAGE_CARRYING_CAPACITY_RATIO;
  if (capacity <= 0) return 1;
  const livingCount = Object.values(people).filter((p) => p.deathYear === undefined && !p.away).length;
  if (livingCount <= capacity) return 1;
  return Math.max(FERTILITY_DAMPING_FLOOR, capacity / livingCount);
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

/**
 * Decision 058 (keys renamed 1:1 by decision 063): who actually bore feudal/tax dues (research.md,
 * Economy §"Taxes, housing, diet" — tithe of 10%, rent and entry fines) — a DESIGN ASSUMPTION (no
 * sourced per-class ratio exists), same disclosed-assumption pattern as `CLASS_MORTALITY_MULTIPLIER`
 * (decision 050). Cottars/villeins paid the most relative to their means; gentry/clergy bore feudal
 * dues far more lightly, when at all. PR5 spikes this during the Hundred Years' War levy years
 * (1337-47, `isHundredYearsWarLevyYear`) instead of decision 058's Tudor-era Lay Subsidy years.
 */
const LEVY_CLASS_MULTIPLIER: Readonly<Record<SocialClass, number>> = {
  cottar: 1.3,
  villein: 1.15,
  freeholder: 1.0,
  artisan: 0.9,
  merchant: 0.8,
  clergy: 0.5,
  gentry: 0.4,
};

/** Defensive `?? FALLBACK_CLASS` — same rationale as `minMarriageAge` above (decision 063 follow-up). */
function levyClassMultiplier(socialClass: SocialClass): number {
  return LEVY_CLASS_MULTIPLIER[socialClass] ?? LEVY_CLASS_MULTIPLIER[FALLBACK_CLASS];
}

/**
 * Matches by `(kind, subject)`, not exact id string (decision-identity capability): `subject` here
 * is always the candidate's own `personId` — the SAME identity `mintId`/`commitId` below mint
 * against — not its internal within-year bookkeeping key (which, for a paired candidate like `Y1`,
 * embeds a `pairKey`, not a bare personId, and would never match a minted id's subject). `overrides`
 * come from the caller and may carry either a legacy year-embedded id or a new ordinal one;
 * `decisionSubject` parses both the same way, so only the override side needs parsing at all.
 *
 * `isOverrideYear` gates this to the run's own start year (a fork/rewrite's `fromYear`, always the
 * target decision's own year — see `fork.ts`): dropping the year from the matched id would
 * otherwise force this SAME (kind, subject) at every later year of the re-simulation too, not just
 * the one the override actually targets.
 *
 * `partnerId`, when the candidate has one, lets a LEGACY pairKey-shaped override id (a paired social
 * kind like `Y1`, minted before ordinal ids existed) still match (fixed after review, R3-001) — see
 * `decision-id.ts#candidateMatchesSubject`.
 */
function overrideFor(overrides: readonly Override[], kind: string, subject: string, isOverrideYear: boolean, partnerId?: string): Override | undefined {
  if (!isOverrideYear) return undefined;
  return overrides.find((o) => {
    const parsed = decisionSubject(o.decisionId);
    return parsed.kind === kind && candidateMatchesSubject(parsed.subject, subject, partnerId);
  });
}

/**
 * Peeks the next id for `(kind, subject)` without mutating anything — safe to call before deciding
 * whether the resulting decision will actually be recorded (biology's `RECORD_THRESHOLD` gate runs
 * AFTER this). `subject === "world"` (immigration) needs no `people` lookup at all (see
 * `mintDecisionId`).
 */
function mintId(people: Readonly<Record<string, Person>>, kind: string, subject: string, year: number): MintedId {
  const slots = subject === "world" ? EMPTY_SLOTS : (people[subject]?.lifeState?.slots ?? EMPTY_SLOTS);
  return mintDecisionId(kind, subject, year, slots);
}

/**
 * Commits a minted id's slot advance onto its subject's `lifeState.slots` (see
 * `life-state.ts#advanceSlot`) — call exactly once per minted id, with `occurred` reflecting
 * whether the decision it belongs to was actually recorded. A `world` subject needs no commit (its
 * ordinal is the year itself, never persisted state). Reads through `ensureLifeState` first so a
 * subject's very first commit this run bootstraps the rest of `lifeState` from their real history
 * (see `life-state.ts`) instead of overwriting it with a slots-only fragment.
 */
function commitId(people: Record<string, Person>, events: readonly Event[], subject: string, minted: MintedId, occurred: boolean): void {
  if (subject === "world") return;
  const person = people[subject];
  if (!person) return;
  const state = ensureLifeState(person, events);
  person.lifeState = { ...state, slots: advanceSlot(state.slots, minted.key, occurred) };
}

/** Years a person is "immune" from another illness roll after falling ill, so illness doesn't spam a handful of bad-luck years. */
const ILLNESS_COOLDOWN_YEARS = 3;

/** Decision 051: maternal mortality per birth (research.md, "Maternal mortality" — Schofield 1986's Elizabethan 9.3/1000 anchor, ~0.9-1.0%; applied across the whole 1498-1558 window with low confidence, since the source is just after it). */
const MATERNAL_DEATH_PROBABILITY = 0.0095;

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

/**
 * Whether `goal` is already backed by a real event on `personId`'s own log
 * — the gate for A8's "push-harder" outcome (decision 023, "dream realized
 * without the act"): the underlying act has to have actually happened
 * (a real move, a real marriage/child, a real career change) before code
 * will let Jev's "push harder" roll flip the dream to realized.
 */
function dreamGoalSatisfiedBy(goal: DreamGoal, events: readonly Event[], personId: string): boolean {
  switch (goal) {
    case "leave for the city":
      return events.some((e) => e.kind === "move" && e.actors[0] === personId && e.payload.away === true);
    case "start a family":
      return events.some((e) => e.kind === "birth" && e.actors.slice(1).includes(personId));
    case "master a craft":
      return events.some((e) => e.kind === "job" && e.actors[0] === personId && !e.payload.forced);
    case "found something lasting":
      return events.some((e) => (e.kind === "marriage" || e.kind === "birth") && e.actors.includes(personId));
    default:
      return false;
  }
}

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

function baseIllnessChance(age: number): number {
  if (age < 5) return 0.012;
  if (age < 50) return 0.007;
  if (age < 70) return 0.02;
  return 0.05;
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

interface ResolvedDecision {
  readonly jevRaw?: Distribution;
  readonly prior?: Distribution;
  readonly final: Distribution;
  readonly source: DecisionSource;
  /** Round 11 (decision 044): how likely `decideYear`'s batch said this situation was to happen this year. Absent for the legacy per-candidate `decide()` path, which asks no occurrence question. */
  readonly occurrenceProbability?: number;
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

/** The protagonist's first living sibling (shares a mother or father), if any — used for `D1`'s `sibling-quarrel` vignette. */
function livingSiblingId(people: Readonly<Record<string, Person>>, person: Person): string | undefined {
  return Object.values(people).find((p) => p.id !== person.id && p.deathYear === undefined && ((person.motherId && p.motherId === person.motherId) || (person.fatherId && p.fatherId === person.fatherId)))?.id;
}

/** The protagonist's first living child, if any — used for `D1`'s `teaching-a-child` vignette. */
function livingChildId(people: Readonly<Record<string, Person>>, person: Person): string | undefined {
  return Object.values(people).find((p) => (p.motherId === person.id || p.fatherId === person.id) && p.deathYear === undefined)?.id;
}

/** Resolves a `VignetteOutcome.relationshipTarget` tag to a concrete person id — only `simulate.ts` knows the protagonist's actual spouse/parent/sibling/child, so this stays out of the (pure, person-agnostic) vignette pool itself. */
function relationshipTargetId(target: VignetteRelationshipTarget, person: Person, people: Readonly<Record<string, Person>>): string | undefined {
  if (target === "spouse") return person.spouseId;
  if (target === "child") return livingChildId(people, person);
  if (target === "sibling") return livingSiblingId(people, person);
  // "parent": prefer a living mother, then a living father.
  if (person.motherId && people[person.motherId]?.deathYear === undefined) return person.motherId;
  if (person.fatherId && people[person.fatherId]?.deathYear === undefined) return person.fatherId;
  return undefined;
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

/**
 * "At least one entry per year" (round 10, decision 042): called once per year, ONLY when the
 * protagonist produced zero events of their own that year (checked by the caller, after every
 * other biology/social decision for the year has already resolved) — presents ONE everyday-life
 * `D1` vignette, a real DecisionMaker call sampled exactly like any other social decision, never
 * throttled by `LIFE_DECISION_BUDGET` (it's always about the protagonist). `overrides` still apply
 * (a `D1:<protagonistId>:<year>` id), so a rewrite can change what the protagonist did with an
 * otherwise-quiet year too.
 */
async function resolveDailyLifeVignette(
  protagonist: Person,
  year: number,
  seed: string,
  config: WorldConfig,
  people: Record<string, Person>,
  events: Event[],
  townEventType: TownEventType | undefined,
  decisionMaker: DecisionMaker,
  engineSource: "jev" | "rules",
  overrides: readonly Override[],
  /** Round 12 continuation (decision 046): the whole eligible-vignette pool this protagonist-year offered, and which one (if any) the cross-batch `vignette-pick` sample chose. */
  d1Candidates: readonly { readonly descriptor: CandidateDescriptor; readonly vignette: Vignette; readonly deciderId: string }[],
  finalVignetteWinner: string | undefined,
  /** Round 11 (decision 044): a result already fetched as part of the decider's per-person-year batch — when present, no extra `DecisionMaker` call is made here at all. */
  preFetched?: ResolvedDecision,
  isOverrideYear = false,
): Promise<{ decision: DecisionRecord; wasRealCall: boolean }> {
  const decisionId = `D1:${protagonist.id}:${year}`;
  const forced = overrideFor(overrides, "D1", protagonist.id, isOverrideYear);

  let vignette: Vignette;
  let deciderId: string;
  if (forced) {
    // A forked/overridden D1 decision (decision 043): resolve which vignette OWNS the forced option
    // rather than assuming whichever one won selection — option ids are unique across the pool.
    vignette = getVignetteForOption(forced.optionId) ?? d1Candidates[0]?.vignette ?? buildDailyLifeVignetteDescriptor(protagonist, year, seed, people, events, townEventType).vignette;
    deciderId = vignette.decidedByParent ? (relationshipTargetId("parent", protagonist, people) ?? protagonist.id) : protagonist.id;
  } else {
    const winner = finalVignetteWinner ? d1Candidates.find((c) => c.descriptor.decisionId === finalVignetteWinner) : undefined;
    if (winner) {
      vignette = winner.vignette;
      deciderId = winner.deciderId;
    } else {
      // Legacy fallback: no batched `decideYear` result (an adapter that only implements `decide()`)
      // — fall back to the old single RNG pick, exactly as before decision 044.
      const picked = buildDailyLifeVignetteDescriptor(protagonist, year, seed, people, events, townEventType);
      vignette = picked.vignette;
      deciderId = picked.deciderId;
    }
  }

  const options = Object.keys(vignette.outcomes);
  const descriptor: CandidateDescriptor = {
    decisionId,
    kind: "D1",
    personId: deciderId,
    ...(deciderId !== protagonist.id ? { partnerId: protagonist.id } : {}),
    options,
    extra: { vignette: vignette.id },
  };
  const decider = people[deciderId] ?? protagonist;
  const question = buildQuestion(descriptor, year, config, people);

  let final: Distribution;
  let jevRaw: Distribution | undefined;
  let prior: Distribution | undefined;
  let occurrenceProbability: number | undefined;
  let source: DecisionSource;
  let chosen: string;
  let noise: Record<string, number> = {};
  let fragility: number;
  let surprise: boolean;
  let wasRealCall = false;

  if (forced) {
    chosen = forced.optionId;
    final = { [chosen]: 1 };
    source = "forced";
    fragility = NOT_FRAGILE;
    surprise = false;
  } else {
    // Already answered as part of this person's batched `decideYear` request this year — no extra
    // call. Otherwise (a legacy adapter without `decideYear`, or a caller that didn't prefetch),
    // fall back to one dedicated `decide()` call, exactly as before decision 044.
    const result = preFetched ?? (await resolveSocialDecision(question, decisionMaker, engineSource));
    wasRealCall = !preFetched && engineSource === "jev";
    jevRaw = result.jevRaw;
    prior = result.prior;
    occurrenceProbability = result.occurrenceProbability;
    final = result.final;
    source = result.source;
    const sample = sampleGumbelMax(final as Record<string, number>, seed, protagonist.id, year, "D1");
    chosen = sample.chosen;
    noise = sample.noise;
    fragility = decisionFragility(sample.scores);
    surprise = isSurprise(final, chosen);
  }

  const outcome = vignette.outcomes[chosen]!;
  // An infant/toddler vignette (decision 043) is still lived by the protagonist — the thought, the
  // memory, the relationship nudge all still land on their mind — only `deciderId` (below) credits
  // the parent who actually made the call, same split `AP1` already makes.
  const cause = outcome.cause(protagonist.name, config.town.name);
  const actors = deciderId !== protagonist.id ? [deciderId, protagonist.id] : [protagonist.id];
  const event = pushEvent(events, year, "vignette", actors, { vignette: vignette.id, outcome: chosen }, []);
  pushThought(protagonist.mind, outcome.emotion, cause, outcome.intensity, outcome.duration, year, outcome.facet as Facet | undefined);
  if (outcome.memorable) addMemory(seed, protagonist.id, year, protagonist.mind, cause, outcome.emotion);
  if (outcome.relationshipTarget) {
    const targetId = relationshipTargetId(outcome.relationshipTarget, protagonist, people);
    const target = targetId ? people[targetId] : undefined;
    if (target) updateRelationship(protagonist.mind, target.id, target.mind.values, outcome.relationshipDelta ?? 10);
  }

  const decisionOptions: DecisionOption[] = options.map((id) => ({ id, label: optionLabel("D1", id, decider.name) }));
  // D1's minted subject is always the PROTAGONIST (matching its legacy `D1:<protagonistId>:<year>`
  // shape), even when `deciderId` is a parent (decision 043) — it's fundamentally the protagonist's
  // day. Always pushed by the caller (`simulate()`'s "at least one entry per year" guarantee), so the
  // slot commits unconditionally as an occurrence.
  const minted = mintId(people, "D1", protagonist.id, year);
  commitId(people, events, protagonist.id, minted, true);
  const decision: DecisionRecord = {
    id: minted.id,
    personId: deciderId,
    partnerId: descriptor.partnerId,
    year,
    kind: "D1",
    // Decision 059: always English here, deliberately — `DecisionRecord.question` is computed once
    // at simulate time and persisted (unlike `narrate.ts`'s prose, which is re-derived fresh from
    // structured events every render), so it can't be re-localized per viewer without either storing
    // both languages or growing `DecisionRecord` with the raw params needed to rebuild it. The
    // chronicle's own reader-facing prose/title (what the proposal calls "per-locale narration") goes
    // through `narrate.ts`'s `locale` parameter instead, at render time, per the reader's locale.
    question: vignette.question("en", config.town.name),
    options: decisionOptions,
    jevRaw,
    prior,
    final,
    noise,
    chosen,
    fragility,
    surprise,
    source,
    causes: [],
    resultingEventIds: [event.id],
    occurrenceProbability,
  };
  return { decision, wasRealCall };
}

function biologyDistribution(kind: string, p: number): Distribution {
  if (kind === "illness") return { illness: p, healthy: 1 - p };
  if (kind === "death") return { die: p, survive: 1 - p };
  if (kind === "return") return { return: p, stay: 1 - p };
  // Decision 058: pre-existing bug found while adding the levy class multiplier — "levy" (options
  // `["impose", "spare"]`) fell through to this function's `arrive`/`no-arrival` default (meant for
  // "immigration"/"away-arrival", which happen to share the "arrive" label by coincidence), so
  // `sampleGumbelMax` could never actually choose `"impose"` and the death-resolution loop's
  // `if (record.chosen === "impose")` check was permanently unreachable — the lord's levy has never
  // fired an event since it was introduced (decision 035). Fixed here rather than filed as a
  // separate follow-up, since 058's own levy class-multiplier/Lay Subsidy work is otherwise inert.
  if (kind === "levy") return { impose: p, spare: 1 - p };
  return { arrive: p, "no-arrival": 1 - p };
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
  let decisionCalls = 0;
  // Decision 047: captured once, outside the per-candidate loop below, because that loop shadows
  // `options` with a local `DecisionOption[]` of the same name (its `decisions.push({ options, ... })`
  // shorthand) — referencing `options.protagonistId` inside that loop would hit the TDZ instead of
  // this function's `SimulateOptions` parameter.
  const protagonistId = options.protagonistId;
  // PR11 (STEP 1): same shadowing hazard as `protagonistId` above — captured once here, outside the
  // per-candidate loop that shadows `options`.
  const marriageFunnelDebug = options.marriageFunnelDebug;

  const startYear = options.fromYear ?? config.startYear;

  snapshots.set(startYear - 1, { year: startYear - 1, people: structuredClone(people), events: structuredClone(events), decisions: structuredClone(decisions) });

  for (let year = startYear; year <= config.endYear; year++) {
    // Yearly mind decay (spec step 2): every living person's thoughts lose a
    // year and expire at 0; stress drains ~20%/year (slower for the
    // anxious), rising first with the last year's negative mood. Done
    // before this year's situations are gathered, so an A11 breakdown
    // trigger or an A8 dream check reflects the decayed value for THIS
    // year, not a stale one.
    for (const person of Object.values(people)) {
      if (person.deathYear === undefined) decayMindForYear(person.mind);
    }

    const candidates = gatherCandidatesForYear(
      year,
      people,
      events,
      seed,
      options.protagonistId,
      marriageFunnelDebug ? { collector: marriageFunnelDebug, startYear: config.startYear } : undefined,
    );
    const biologyCandidates = candidates.filter((c) => c.kind === "illness" || c.kind === "death" || c.kind === "immigration" || c.kind === "levy" || c.kind === "away-arrival" || c.kind === "return");
    // D1 is excluded here even though it's in `SOCIAL_KINDS` (used for `validate-override.ts`'s
    // reconstruction, round 10 decision 043) — it has its own dedicated call site below
    // (`resolveDailyLifeVignette`, gated on "no event yet this year"), never the generic per-kind loop.
    let socialCandidates = candidates.filter((c) => SOCIAL_KINDS.has(c.kind) && c.kind !== "D1");

    // Town event (decision 025): pushed once here, at most once per year, deterministically —
    // `townEventForYear` is the exact same pure function `gatherCandidatesForYear` used to decide
    // whether to offer every adult an A5 decision this year, so the two can never disagree.
    const townEvent = townEventForYear(seed, year);
    let townEventId: string | undefined;
    if (townEvent) {
      const event = pushEvent(events, year, "town", [], { eventType: townEvent }, []);
      townEventId = event.id;
    }

    // Engine life course PR5: dated national events (the Hundred Years' War's opening, the
    // Ordinance and Statute of Labourers) — pushed unconditionally, independent of
    // `townEventForYear`'s single random/dated-shock slot above (see `period/events.ts`'s
    // `DATED_NATIONAL_EVENTS` doc comment for why these don't compete for that slot).
    for (const periodType of datedNationalEventTypesForYear(year)) {
      pushEvent(events, year, "town", [], { eventType: periodType, period: true }, []);
    }
    // --- Biology: synchronous, no AI calls ----------------------------------
    // Illness is processed before death for the same person (in `gatherCandidatesForYear`'s
    // sort order, "death" < "illness" alphabetically would be wrong — we sort by kind name,
    // so re-sort biology explicitly: illness first, so a same-year illness can raise the death odds).
    biologyCandidates.sort((a, b) => {
      if (a.personId !== b.personId) return a.kind === "immigration" ? 1 : b.kind === "immigration" ? -1 : a.personId.localeCompare(b.personId);
      return a.kind === "illness" ? -1 : b.kind === "illness" ? 1 : 0;
    });

    const illnessResultByPerson = new Map<string, Event | undefined>();

    const isOverrideYear = year === startYear;
    for (const descriptor of biologyCandidates) {
      const forced = overrideFor(overrides, descriptor.kind, descriptor.personId, isOverrideYear);
      const minted = mintId(people, descriptor.kind, descriptor.personId, year);
      let record: DecisionRecord;

      if (descriptor.kind === "illness") {
        const age = ageInYear(people[descriptor.personId]!.birthYear, year);
        const p = baseIllnessChance(age);
        record = resolveBiologyDecision(descriptor, year, p, seed, forced, people[descriptor.personId]!.name, config.town.name, minted);
        let illnessEvent: Event | undefined;
        if (record.chosen === "illness") {
          illnessEvent = pushEvent(events, year, "illness", [descriptor.personId], { age }, []);
        }
        illnessResultByPerson.set(descriptor.personId, illnessEvent);
        record = { ...record, resultingEventIds: illnessEvent ? [illnessEvent.id] : [] };
        // Recording threshold (decision 007): always record if it actually
        // happened, or if the road not taken (illness) had a real chance.
        const pushed = record.chosen === "illness" || p >= RECORD_THRESHOLD || record.source === "forced";
        if (pushed) decisions.push(record);
        commitId(people, events, descriptor.personId, minted, pushed);
      } else if (descriptor.kind === "death") {
        const person = people[descriptor.personId]!;
        const age = ageInYear(person.birthYear, year);
        const illnessEvent = illnessResultByPerson.get(descriptor.personId);
        const socialClass: SocialClass = person.socialClass ?? "cottar";
        // Decision 050: the protagonist-only mortality bonus (mortality.ts's old
        // `protagonistMortalityBonus`) is REMOVED — the protagonist now faces the exact same,
        // recalibrated actuarial curve, class multiplier and town-event multiplier as any NPC. What
        // decision 035 was protecting (a 15-20% pre-15 protagonist death share) is now a property of
        // the general population's own recalibrated curve (see `actuarial.ts#deathProbabilityAtAge`
        // and docs/decisions.md 050's measured figures), not a per-protagonist patch.
        const shockMultiplier = townEventMortalityMultiplier(townEvent, age, person.sex, socialClass);
        const illnessMultiplier = illnessEvent ? 3 : 1;
        // Engine life course PR5: the Black Death/second pestilence are combined as an ABSOLUTE
        // per-year probability (competing risk with the base rate above), not a multiplier — see
        // `townEventMortalityMultiplier`'s own doc comment for why a flat multiplier can't reliably
        // hit their documented scale across every age band.
        const pandemicMortality = blackDeathMortalityForYear(year) ?? secondPestilenceMortalityForYear(year, age);
        const basePandemic = Math.min(0.9, deathProbabilityAtAge(age) * classMortalityMultiplier(socialClass) * shockMultiplier * illnessMultiplier);
        const p = pandemicMortality === undefined ? basePandemic : Math.min(0.9, 1 - (1 - basePandemic) * (1 - pandemicMortality));
        // Decision 050: `hasActiveFeud` (and therefore the "feud-violence" cause) is now computed for
        // EVERY person, not just the protagonist — `activeFeudPair` already reads the general event
        // log by personId, so this was never protagonist-specific machinery, only protagonist-gated.
        const hasActiveFeud = activeFeudPair(events, person.id) !== undefined;
        const mortalityContext: MortalityContext = { age, sex: person.sex, hadIllness: !!illnessEvent, townEventType: townEvent, hasActiveFeud };
        record = resolveBiologyDecision(descriptor, year, p, seed, forced, person.name, config.town.name, minted);
        const resultingEventIds: string[] = [];
        if (record.chosen === "die") {
          person.deathYear = year;
          // Decision 050: every death now carries a `cause` (not just the protagonist's) —
          // `determineDeathCause` was already a pure function of context available for anyone.
          const cause = determineDeathCause(mortalityContext);
          const deathEvent = pushEvent(
            events,
            year,
            "death",
            [descriptor.personId],
            { age, awayFromTown: hasMovedAway(events, descriptor.personId), cause },
            illnessEvent ? [illnessEvent.id] : [],
          );
          resultingEventIds.push(deathEvent.id);
          // Decision 054: widowhood — `spouseId` was previously NEVER cleared on death (the bug the
          // decision fixes), which made remarriage impossible for anyone whose spouse died. Handled
          // by the shared `resolveWidowhood` helper (fixed after review, R3-001) so this general
          // death path and decision 051's maternal-death path below can never disagree.
          resultingEventIds.push(...resolveWidowhood(seed, events, people, person, socialClass, year, deathEvent.id));
          // PR6 corrective: close any unresolved romance the deceased leaves behind (the
          // dead-suitor lockout fix — see `resolveCourtshipOnDeath`'s own doc comment).
          resultingEventIds.push(...resolveCourtshipOnDeath(events, people, person, year, deathEvent.id));
          // PR5's heriot marker (design's markers table: "villein/cottar tenant death") — the
          // deceased's best beast, owed to the lord, on the death of an unfree tenant. Excluded for
          // the protagonist specifically: their own death is a pre-existing, load-bearing contract
          // ("the LAST entry is ALWAYS the protagonist's death, level 3" — `life-chronicle.test.ts`)
          // that a same-year, causally-later event would break by sorting after it.
          if (isUnfree(socialClass) && person.id !== protagonistId) {
            const heriotEvent = pushEvent(events, year, "manorial-fine", [person.id], manorialFinePayload("heriot", person.id), [deathEvent.id]);
            resultingEventIds.push(heriotEvent.id);
          }
        } else if (illnessEvent) {
          (illnessEvent.payload as Record<string, JsonValue>).recovered = true;
        }
        const deathCauses = [...(illnessEvent ? [illnessEvent.id] : []), ...((shockMultiplier > 1 || pandemicMortality !== undefined) && townEventId ? [townEventId] : [])];
        record = { ...record, causes: deathCauses, resultingEventIds };
        const pushed = record.chosen === "die" || p >= RECORD_THRESHOLD || record.source === "forced";
        if (pushed) decisions.push(record);
        commitId(people, events, descriptor.personId, minted, pushed);
      } else if (descriptor.kind === "levy") {
        // Decision 058: a class-specific multiplier (research.md, Economy §"Taxes, housing, diet" —
        // tithe, rent and the levy fell on tenants and labourers; gentry/clergy bore feudal dues far
        // more lightly, when at all) — a DESIGN ASSUMPTION, no sourced per-class ratio exists, same
        // disclosed-assumption pattern as decision 050's `CLASS_MORTALITY_MULTIPLIER`. Engine life
        // course PR5 spikes this during the Hundred Years' War's own levy/taxation years (1337-47,
        // research.md's event list) instead of decision 058's Tudor-era Lay Subsidy years — the levy
        // candidate is protagonist-only (see the `SimulateOptions` doc comment), so this never
        // touches the general village.
        const levySocialClass: SocialClass = people[descriptor.personId]!.socialClass ?? "cottar";
        const hywLevyYear = isHundredYearsWarLevyYear(year);
        const p = Math.min(0.9, 0.045 * (townEvent === "famine" ? 1.4 : 1) * levyClassMultiplier(levySocialClass) * (hywLevyYear ? 1.8 : 1));
        record = resolveBiologyDecision(descriptor, year, p, seed, forced, people[descriptor.personId]!.name, config.town.name, minted);
        const resultingEventIds: string[] = [];
        if (record.chosen === "impose") {
          const event = pushEvent(events, year, "levy", [descriptor.personId], {}, []);
          resultingEventIds.push(event.id);
        }
        record = { ...record, resultingEventIds };
        {
          const pushed = record.chosen === "impose" || p >= RECORD_THRESHOLD || record.source === "forced";
          if (pushed) decisions.push(record);
          commitId(people, events, descriptor.personId, minted, pushed);
        }
      } else if (descriptor.kind === "away-arrival") {
        // A lightweight newcomer joining the away cast (decision 040) — code-rolled, exactly like
        // immigration, and resolved here (before social `buildQuestion` runs) so a real Person
        // already exists for the SAME year's Y1/Y5 candidates to reference by id.
        const p = 0.4;
        record = resolveBiologyDecision(descriptor, year, p, seed, forced, people[descriptor.personId]!.name, config.town.name, minted);
        const resultingEventIds: string[] = [];
        if (record.chosen === "arrive") {
          const newPerson = spawnAwayPerson(seed, year, people);
          people[newPerson.id] = newPerson;
        }
        record = { ...record, resultingEventIds };
        {
          const pushed = record.chosen === "arrive" || p >= RECORD_THRESHOLD || record.source === "forced";
          if (pushed) decisions.push(record);
          commitId(people, events, descriptor.personId, minted, pushed);
        }
      } else if (descriptor.kind === "return") {
        // Returning home (decision 040; generalized to the whole village by PR10/decision 071 — see
        // `RETURN_HOME_PROBABILITY`'s own doc comment) — a small yearly chance, not a considered
        // choice, so it's code-rolled like immigration/levy rather than sent to a DecisionMaker.
        const p = RETURN_HOME_PROBABILITY;
        record = resolveBiologyDecision(descriptor, year, p, seed, forced, people[descriptor.personId]!.name, config.town.name, minted);
        const resultingEventIds: string[] = [];
        if (record.chosen === "return") {
          const returning = people[descriptor.personId]!;
          returning.lifeState = applyLifeTransition(ensureLifeState(returning, events), { axis: "residence", to: "home" }, year);
          const event = pushEvent(events, year, "move", [descriptor.personId], { away: false, returned: true, destination: config.town.name }, []);
          resultingEventIds.push(event.id);
        }
        record = { ...record, resultingEventIds };
        {
          const pushed = record.chosen === "return" || p >= RECORD_THRESHOLD || record.source === "forced";
          if (pushed) decisions.push(record);
          commitId(people, events, descriptor.personId, minted, pushed);
        }
      } else {
        // PR9 (partner-scarcity fix, engram #6142/#6311): named/documented in params/demography.ts
        // -- was a hardcoded, undocumented `0.05` literal. See that constant's own doc comment for
        // the measured before/after and the tradeoff this raise carries.
        // Decision 079 (Follett-plausible population growth): the rate rises for the bounded
        // [IMMIGRATION_POST_PLAGUE_YEAR, IMMIGRATION_POST_PLAGUE_END_YEAR) recovery window only, then
        // reverts -- own doc comment on `IMMIGRATION_ANNUAL_PROBABILITY_POST_PLAGUE` has the full
        // reasoning, including why this is bounded rather than left on for the rest of the run.
        const isPostPlagueWindow = year >= IMMIGRATION_POST_PLAGUE_YEAR && year < IMMIGRATION_POST_PLAGUE_END_YEAR;
        const p = isPostPlagueWindow ? IMMIGRATION_ANNUAL_PROBABILITY_POST_PLAGUE : IMMIGRATION_ANNUAL_PROBABILITY;
        record = resolveBiologyDecision(descriptor, year, p, seed, forced, config.town.name, config.town.name, minted);
        const resultingEventIds: string[] = [];
        if (record.chosen === "arrive") {
          const newPerson = spawnImmigrant(seed, year, people);
          people[newPerson.id] = newPerson;
          const event = pushEvent(events, year, "move", [newPerson.id], { away: false, arrived: true }, []);
          resultingEventIds.push(event.id);
        }
        record = { ...record, resultingEventIds };
        {
          const pushed = record.chosen === "arrive" || p >= RECORD_THRESHOLD || record.source === "forced";
          if (pushed) decisions.push(record);
          commitId(people, events, descriptor.personId, minted, pushed);
        }
      }

      // Piggyback the (deterministic, no-alternative) school event on the
      // once-per-living-person "death" pass rather than giving it its own
      // decision — starting school at 6 has no real alternative outcome.
      if (descriptor.kind === "death" && !hasMovedAway(events, descriptor.personId)) school(events, people, descriptor.personId, year);
    }

    // PR5's leyrwite presentment (design's markers table): a keyed side draw, evaluated once per
    // calendar year for every living, unfree, currently-courting woman — OUTSIDE the categorical
    // event-pick below, on its own dedicated key, so it never perturbs any other person-year draw.
    // PR6: now reads `lifeState.marital.status === "courting"` directly (design's own literal
    // wording), since PR6 wires the Y1 "encourage" outcome into that transition — PR5 fell back to
    // `activeRomancePair` because PR3 never fired it (see the Y1 case's own comment above).
    for (const person of Object.values(people)) {
      if (person.deathYear !== undefined || person.away || hasMovedAway(events, person.id)) continue;
      const isCourting = ensureLifeState(person, events).marital.status === "courting";
      if (!isLeyrwiteEligible(person, isCourting)) continue;
      if (shouldPresentLeyrwite(seed, person.id, year)) {
        pushEvent(events, year, "manorial-fine", [person.id], manorialFinePayload("leyrwite", person.id), []);
      }
    }

    // Round 12 (decision 045): `socialCandidates` was gathered BEFORE biology ran this year, so it
    // can still name someone (as `personId` or `partnerId`) who biology just killed above — with the
    // old code-side probability gates, that coincidence was rare enough to never surface; with
    // eligibility now unconditional, it happened routinely (a person "confronting a rival" or
    // "dividing their inheritance" the same year they died — see the `life-chronicle.test.ts`
    // "death is always the LAST entry" contract this broke). A decision about someone who is no
    // longer alive by the time it would be applied is dropped here rather than asked at all.
    // PR6 fix: `deathYear === year` (not merely "any deathYear set") — a partner who died in an
    // EARLIER year is exactly C2's own premise ("fires the year after a parent's death"); the old
    // unconditional check silently dropped every C2 candidate ever built, since by the time C2 fires
    // its dead parent's `deathYear` is always already set from a prior year. Caught by task 6.5's own
    // one-decision-per-(kind,person)-per-year test, which needs C2 to actually reach resolution.
    if (marriageFunnelDebug !== undefined) {
      // PR12 (STEP 1 diagnostic): a Y1 candidate offered earlier this year (before biology ran) can
      // be dropped right here when the seeker or the partner died this same year — it never reaches
      // `situationIds`/the "event-pick" sample below, so it's neither a win nor an observable loss to
      // another kind. Tallied explicitly so `y1LosesTo`'s sum still equals
      // `partnerFoundPersonYears - y1WonDraw` exactly, instead of silently under-counting.
      for (const c of socialCandidates) {
        if (c.kind !== "Y1") continue;
        const person = people[c.personId];
        if (!person || !inMarriageFunnelCohort(person, config.startYear)) continue;
        const dropped = people[c.personId]?.deathYear === year || (c.partnerId !== undefined && people[c.partnerId]?.deathYear === year);
        if (dropped) marriageFunnelDebug.y1LosesTo["died-same-year"] = (marriageFunnelDebug.y1LosesTo["died-same-year"] ?? 0) + 1;
      }
    }
    socialCandidates = socialCandidates.filter(
      (c) => people[c.personId]?.deathYear !== year && (!c.partnerId || people[c.partnerId]?.deathYear !== year),
    );

    // --- Social decisions: batch per person-year, then apply -----------------------------------
    // Round 11 (decision 044): one Jev request per person per year, not one per candidate. Every
    // candidate a person faces this year (their `socialCandidates`, plus their `D1` daily-life
    // candidate if they're the protagonist — see below) is bundled into a single `PersonYearBatch`
    // and answered with a single `decideYear` call, so the mind/portrait state is paid for once.
    const questions = socialCandidates.map((c) => buildQuestion(c, year, config, people));
    const forcedFlags = socialCandidates.map((c) => overrideFor(overrides, c.kind, c.personId, isOverrideYear, c.partnerId));
    // Budget priority (round 9, decision 037): once the running total of REAL DecisionMaker calls
    // hits LIFE_DECISION_BUDGET, any further social decision NOT about the protagonist is answered
    // with the deterministic rule heuristic instead — the protagonist's own decisions, and
    // decisions ABOUT them (like AP1), are never throttled. No-op (always false) with no
    // `protagonistId`, so the general village simulation is unaffected.
    const fallbackFlags = socialCandidates.map((c, i) => {
      if (forcedFlags[i] || !options.protagonistId) return false;
      const aboutProtagonist = c.personId === options.protagonistId || c.partnerId === options.protagonistId;
      return !aboutProtagonist && decisionCalls >= LIFE_DECISION_BUDGET;
    });

    // The protagonist's `D1` daily-life candidate (round 10, decisions 042/043) rides along in the
    // SAME per-person batch as their other social candidates this year — speculative fan-out
    // (docs.typesafe.ai/patterns/fan-out.md): asked every year regardless of whether it turns out
    // to be needed, consumed only if the year is otherwise quiet (see the guarantee block below).
    // Kept out of `socialCandidates` itself (unchanged from decision 043) so it's never
    // double-resolved through the generic per-kind loop below.
    // Round 12 continuation (decision 046): the WHOLE eligible-vignette pool, one candidate per
    // vignette — not one RNG-picked winner (see `buildDailyLifeVignetteCandidates`). Can span two
    // deciders (the protagonist, and a living parent for the `decidedByParent` pool), so it's a flat
    // array rather than a single `{descriptor, question}` like decision 044's `d1`.
    let d1Candidates: readonly { readonly descriptor: CandidateDescriptor; readonly question: DecisionQuestion; readonly vignette: Vignette; readonly deciderId: string }[] = [];
    if (options.protagonistId && !overrideFor(overrides, "D1", options.protagonistId, isOverrideYear)) {
      const protagonist = people[options.protagonistId];
      if (protagonist && (protagonist.deathYear === undefined || protagonist.deathYear === year)) {
        d1Candidates = buildDailyLifeVignetteCandidates(protagonist, year, seed, people, events, townEvent).map((c) => ({ ...c, question: buildQuestion(c.descriptor, year, config, people) }));
      }
    }

    const batchable = typeof options.decisionMaker.decideYear === "function";
    const resultByDecisionId = new Map<string, ResolvedDecision>();
    // Round 12 continuation (decision 046): every batch's raw `vignetteSelection` weights, merged
    // (decision ids are globally unique, so this is a safe union) into ONE pool for the single,
    // canonical "which vignette actually happens" sample below — and each batch's own normalized
    // `"everyday"` share, keyed by that batch's `personId`, for the winner's `occurrenceProbability`.
    const vignetteSelectionRaw: Record<string, number> = {};
    const everydayShareByPerson = new Map<string, number>();
    let finalVignetteWinner: string | undefined;

    if (batchable) {
      const batchesByPerson = new Map<string, Record<string, PersonYearSituation>>();
      for (let i = 0; i < socialCandidates.length; i++) {
        if (forcedFlags[i] || fallbackFlags[i]) continue;
        const c = socialCandidates[i]!;
        const situations = batchesByPerson.get(c.personId) ?? {};
        situations[c.decisionId] = { kind: c.kind as DecisionQuestion["kind"], question: questions[i]! };
        batchesByPerson.set(c.personId, situations);
      }
      for (const c of d1Candidates) {
        const situations = batchesByPerson.get(c.descriptor.personId) ?? {};
        situations[c.descriptor.decisionId] = { kind: "D1", question: c.question };
        batchesByPerson.set(c.descriptor.personId, situations);
      }

      // One real request per person-year batch (not per situation) — this replaces the old
      // per-candidate accounting below, which counted every social candidate as its own call.
      decisionCalls += batchesByPerson.size;

      const personIds = Array.from(batchesByPerson.keys());
      // Decision 084: only the protagonist's story circle goes to `decisionMaker`; everyone else goes
      // to `backgroundDecisionMaker` when one is given. No protagonist means an empty circle.
      const circle = options.backgroundDecisionMaker ? storyCircle(options.protagonistId, people, events) : new Set<string>();
      await mapWithConcurrency(personIds, yearBatchConcurrency, async (personId) => {
        const situations = batchesByPerson.get(personId)!;
        const situationIds = Object.keys(situations);
        const self: Record<string, JsonValue> = personSummary(people[personId]!, year, people);
        const isProtagonist = personId === options.protagonistId;
        const inBackground = circle.size > 0 && !circle.has(personId);
        const decider = inBackground ? options.backgroundDecisionMaker! : options.decisionMaker;
        const deciderSource = inBackground ? "rules" : options.engineSource;
        const result = await decider.decideYear!({ personId, year, self, situations, isProtagonist });

        if (result.vignetteSelection && Object.keys(result.vignetteSelection).length > 0) {
          Object.assign(vignetteSelectionRaw, result.vignetteSelection);
        }

        // Jev (or RuleDecisionMaker's offline equivalent) only JUDGES the joint event-selection
        // distribution — the domain engine samples it itself with Gumbel-max, exactly like every
        // other decision (a DecisionMaker never rolls dice), keyed `(seed, personId, year,
        // "event-pick")` so it's deterministic and reproducible across identical-seed runs/forks.
        // Round 12 continuation (decision 046): `"everyday"` stands in for every `D1` vignette
        // candidate this batch had — WHICH one actually wins is a second, nested sample (below,
        // after every batch has reported in), not decided here.
        let selectedId: string | undefined;
        let normalizedSelection: Record<string, number> | undefined;
        if (situationIds.length > 0 && Object.keys(result.selection).length > 0) {
          normalizedSelection = normalizeDistribution(result.selection as Record<string, number>);
          const sample = sampleGumbelMax(normalizedSelection, seed, personId, year, "event-pick");
          if (sample.chosen === "everyday") {
            everydayShareByPerson.set(personId, normalizedSelection.everyday!);
          } else if (sample.chosen !== "nothing") {
            selectedId = sample.chosen;
          }

          // PR12 (STEP 1 diagnostic, `sdd/engine-life-course/state`): of a person-year that offered a
          // Y1 candidate but did NOT let it win this exact `"event-pick"` draw, tally what won
          // instead — the other kind's name, `"nothing"` (the residual), or `"everyday"` (a D1
          // vignette). This is the SAME draw `y1WonDraw` already counts a win from (below, at the Y1
          // occurrence site) — reusing `sample.chosen` here rather than re-deriving it keeps both
          // counters reading the identical, single Gumbel-max sample for this person-year.
          if (marriageFunnelDebug !== undefined) {
            const y1Id = situationIds.find((id) => situations[id]!.kind === "Y1");
            if (y1Id !== undefined && inMarriageFunnelCohort(people[personId]!, config.startYear) && sample.chosen !== y1Id) {
              const winnerKind = sample.chosen === "nothing" || sample.chosen === "everyday" ? sample.chosen : situations[sample.chosen]!.kind;
              marriageFunnelDebug.y1LosesTo[winnerKind] = (marriageFunnelDebug.y1LosesTo[winnerKind] ?? 0) + 1;
            }
          }
        }

        for (const id of situationIds) {
          const jevRaw = result.response[id];
          if (!jevRaw) continue;
          // Round 12 (decision 045): only the SELECTED situation carries an `occurrenceProbability`
          // (its normalized share of the selection distribution) — every other candidate this
          // person-year stays undefined, same as a forced decision or the legacy fallback below. A
          // vignette candidate's `occurrenceProbability` is finalized just below instead (round 12
          // continuation, decision 046 — it depends on the cross-batch vignette-pick winner).
          const occurrenceProbability = id === selectedId ? normalizedSelection![id] : undefined;
          resultByDecisionId.set(
            id,
            deciderSource === "jev" ? { jevRaw, final: jevRaw, source: "jev", occurrenceProbability } : { prior: jevRaw, final: jevRaw, source: "rules", occurrenceProbability },
          );
        }
      });

      // Round 12 continuation (decision 046): the SECOND, nested sample — "of every eligible
      // vignette across every batch that offered one, which actually happens?" — keyed
      // `(seed, protagonistId, year, "vignette-pick")`, exactly like `"event-pick"` above. Only the
      // winning candidate's `occurrenceProbability` is set, and only when the batch that owns it
      // (its `deciderId`) actually landed on `"everyday"` — P(everyday) x P(this vignette | everyday).
      if (Object.keys(vignetteSelectionRaw).length > 0) {
        const normalizedVignetteSelection = normalizeDistribution(vignetteSelectionRaw);
        finalVignetteWinner = sampleGumbelMax(normalizedVignetteSelection, seed, options.protagonistId ?? "world", year, "vignette-pick").chosen;
        const winnerCandidate = d1Candidates.find((c) => c.descriptor.decisionId === finalVignetteWinner);
        const everydayShare = winnerCandidate ? everydayShareByPerson.get(winnerCandidate.descriptor.personId) : undefined;
        if (winnerCandidate && everydayShare !== undefined) {
          const existing = resultByDecisionId.get(finalVignetteWinner!);
          if (existing) resultByDecisionId.set(finalVignetteWinner!, { ...existing, occurrenceProbability: everydayShare * normalizedVignetteSelection[finalVignetteWinner!]! });
        }
      }
    } else {
      // Legacy fallback: an adapter that doesn't implement `decideYear` (e.g. a minimal test
      // double) still gets one `decide()` call per candidate, exactly as before decision 044.
      decisionCalls += questions.filter((_, i) => !forcedFlags[i] && !fallbackFlags[i]).length;
    }

    const resolved = await mapWithConcurrency(questions, concurrencyLimit, async (q, i) => {
      if (forcedFlags[i]) return undefined; // forced: never ask the DecisionMaker
      if (fallbackFlags[i]) {
        const prior = normalizeDistribution(ruleDistribution(q) as Record<string, number>);
        return { prior, final: prior, source: "rules" as DecisionSource };
      }
      if (batchable) return resultByDecisionId.get(q.id);
      return resolveSocialDecision(q, options.decisionMaker, options.engineSource);
    });

    // PR6 (design Open Questions, task 6.5/6.6): "(kind, subject) uniqueness per year must be
    // asserted" — the competing-risk categorical draw picks at most ONE situation id per person-year
    // to occur, but a person can face the SAME kind twice under two different partners this year
    // (e.g. C2 for both a mother and a father who died the same prior year). This guards that at
    // most one of them ever actually OCCURS — a violation is a programming error in the selection
    // pipeline, never a data-quality issue, so it throws rather than degrading silently.
    const occurredKindPerPerson = new Set<string>();

    for (let i = 0; i < socialCandidates.length; i++) {
      const descriptor = socialCandidates[i]!;
      const forced = forcedFlags[i];
      const minted = mintId(people, descriptor.kind, descriptor.personId, year);
      const person = people[descriptor.personId]!;
      const partner = descriptor.partnerId ? people[descriptor.partnerId] : undefined;

      let final: Distribution;
      let jevRaw: Distribution | undefined;
      let prior: Distribution | undefined;
      let source: DecisionSource;
      let chosen: string;
      let noise: Record<string, number> = {};
      let fragility: number;
      let surprise: boolean;

      if (forced) {
        chosen = forced.optionId;
        final = { [chosen]: 1 };
        source = "forced";
        fragility = NOT_FRAGILE;
        surprise = false;
      } else {
        const result = resolved[i]!;
        jevRaw = result.jevRaw;
        prior = result.prior;
        final = result.final;
        source = result.source;
        const sample = sampleGumbelMax(final as Record<string, number>, seed, descriptor.personId, year, descriptor.kind);
        chosen = sample.chosen;
        noise = sample.noise;
        fragility = decisionFragility(sample.scores);
        surprise = isSurprise(final, chosen);
      }

      // Round 12 (decision 045): whether this candidate is the one that actually happens this
      // person-year. `resolved[i]?.occurrenceProbability` is set ONLY on the situation id that
      // person's event-selection Choice picked (see the batch-resolution loop above) — so
      // "occurrence data was reported, and it names ME" is exactly what "occurs" should mean. A
      // forced decision always occurs (the user picked it); a candidate that never went through the
      // joint selection at all (a legacy non-`decideYear` adapter, or the `LIFE_DECISION_BUDGET`
      // rules-heuristic throttle) has no selection signal to withhold occurrence on, so it applies
      // unconditionally, exactly as it did before decision 044/045 introduced selection at all.
      const occurrenceProbability = resolved[i]?.occurrenceProbability;
      const wentThroughSelection = batchable && !forced && !fallbackFlags[i];
      const occurs = !!forced || !wentThroughSelection || occurrenceProbability !== undefined;

      if (occurs) {
        const occurrenceKey = `${descriptor.kind}:${descriptor.personId}`;
        if (occurredKindPerPerson.has(occurrenceKey)) {
          throw new Error(`PR6 invariant violated: (${descriptor.kind}, ${descriptor.personId}) occurred more than once in year ${year}.`);
        }
        occurredKindPerPerson.add(occurrenceKey);
      }

      const options: DecisionOption[] = descriptor.options.map((id) => ({ id, label: optionLabel(descriptor.kind, id, person.name, partner?.name, descriptor.opportunityJob, person.sex) }));
      const resultingEventIds: string[] = [];
      const causes: string[] = [];

      // Decision 051: `person.deathYear === undefined` guards against a candidate for someone who
      // died from an EARLIER candidate's outcome THIS SAME year's apply loop — new with maternal
      // mortality (A2's "try" case below can now kill the mother mid-loop, same year), since the
      // upfront `socialCandidates` filter above only removes people biology already killed BEFORE
      // this loop started, not someone who dies partway through it.
      if (occurs && person.deathYear === undefined) {
      switch (descriptor.kind) {
        case "Y1": {
          // PR11 (STEP 1) diagnostic: reaching this `case` body means `occurs` was true (see the
          // guard around this whole switch) — i.e. this Y1 candidate WON its person-year's
          // competing-risk draw. `marriageFunnelDebug` is `undefined` for every existing caller.
          const funnelInCohort = marriageFunnelDebug !== undefined && inMarriageFunnelCohort(person, config.startYear);
          if (funnelInCohort) {
            marriageFunnelDebug!.y1WonDraw++;
            marriageFunnelDebug!.y1Outcomes[chosen as "encourage" | "decline" | "wait"]++;
          }
          if (chosen === "encourage" && !person.spouseId && !partner!.spouseId) {
            if (funnelInCohort) marriageFunnelDebug!.romancesCreated++;
            const causeA = recentUnresolvedBreakup(events, person.id, year, 3);
            const causeB = recentUnresolvedBreakup(events, partner!.id, year, 3);
            for (const c of [causeA, causeB]) if (c) causes.push(c.id);
            const event = pushEvent(events, year, "romance", [person.id, partner!.id], {}, causes);
            resultingEventIds.push(event.id);
            // PR6 (reconciling PR5's deviation note): "courting" is now actually wired into lifeState
            // at the point courtship begins — PR3 never fired this transition, so PR5's leyrwite
            // eligibility fell back to `activeRomancePair` instead (see the leyrwite call site below,
            // now updated to read `lifeState.marital.status` directly).
            person.lifeState = applyLifeTransition(ensureLifeState(person, events), { axis: "marital", to: "courting", partnerId: partner!.id }, year);
            partner!.lifeState = applyLifeTransition(ensureLifeState(partner!, events), { axis: "marital", to: "courting", partnerId: person.id }, year);
            pushThought(person.mind, "hope", `courting ${partner!.name}`, 55, 4, year, "lovePropensity", partner!.id);
            pushThought(partner!.mind, "hope", `courting ${person.name}`, 55, 4, year, "lovePropensity", person.id);
            addMemory(seed, person.id, year, person.mind, `began courting ${partner!.name} in ${year}`, "hope", partner!.id);
            updateRelationship(person.mind, partner!.id, partner!.mind.values, 20, "lover");
            updateRelationship(partner!.mind, person.id, person.mind.values, 20, "lover");
          } else if (chosen === "decline") {
            pushThought(person.mind, "relief", `turning away ${partner!.name}`, 25, 2, year);
            pushThought(partner!.mind, "shame", `being turned away by ${person.name}`, 40, 3, year, "stressVulnerability", person.id);
          } else {
            pushThought(person.mind, "hope", `being unsure about ${partner!.name}`, 20, 1, year);
          }
          // Decision 047: "decline"/"wait" are real story beats for the protagonist, not silence —
          // an NPC's no-op stays event-free, matching the pre-047 behavior everyone else keeps.
          if (person.id === protagonistId && chosen !== "encourage") {
            const note = chosen === "decline" ? "declined-a-suitor" : "stayed-unsure-about-a-suitor";
            const event = pushEvent(events, year, "reflection", [person.id, partner!.id], { note, otherName: partner!.name }, []);
            resultingEventIds.push(event.id);
          }
          break;
        }
        case "A1": {
          // PR11 (STEP 1) diagnostic: same reasoning as the Y1 case above — reaching this body means
          // this A1 candidate won its own person-year's competing-risk draw.
          const funnelInCohort = marriageFunnelDebug !== undefined && inMarriageFunnelCohort(person, config.startYear);
          if (funnelInCohort) {
            marriageFunnelDebug!.a1WonDraw++;
            marriageFunnelDebug!.a1Outcomes[chosen as "propose" | "delay" | "end-it"]++;
          }
          const romanceEvent = events.filter((e) => e.kind === "romance" && e.actors.includes(person.id) && e.actors.includes(partner!.id)).sort((x, y) => y.year - x.year)[0];
          if (romanceEvent) causes.push(romanceEvent.id);
          if (chosen === "propose" && !person.spouseId && !partner!.spouseId) {
            if (funnelInCohort) marriageFunnelDebug!.married++;
            // Read each lifeState BEFORE setting spouseId below — `ensureLifeState` derives a
            // missing lifeState from `spouseId` (see `life-state.ts#deriveLifeState`), so deriving
            // AFTER the assignment would already see "married" and make the transition a no-op self-loop.
            const personState = ensureLifeState(person, events);
            const partnerState = ensureLifeState(partner!, events);
            person.spouseId = partner!.id;
            partner!.spouseId = person.id;
            person.lifeState = applyLifeTransition(personState, { axis: "marital", to: "married", partnerId: partner!.id }, year);
            partner!.lifeState = applyLifeTransition(partnerState, { axis: "marital", to: "married", partnerId: person.id }, year);
            // Decision 080: record each spouse's social class AT MARRIAGE TIME on the marriage event
            // itself. `Person.socialClass` can be reclassified LATER (decision 054's "widow keeps the
            // trade" turns a surviving spouse "artisan" after a later widowhood), so reading it back
            // from the final `Person` at simulation end no longer tells you what it was when the
            // merchet decision below was actually made. `classesAtMarriage` is the ground truth for
            // that decision, independent of anything that happens to either spouse afterwards.
            const classesAtMarriage: Record<string, SocialClass> = {
              [person.id]: person.socialClass ?? FALLBACK_CLASS,
              [partner!.id]: partner!.socialClass ?? FALLBACK_CLASS,
            };
            const event = pushEvent(events, year, "marriage", [person.id, partner!.id], { classesAtMarriage }, causes);
            resultingEventIds.push(event.id);
            for (const [self, other] of [[person, partner!] as const, [partner!, person] as const]) {
              pushThought(self.mind, "joy", `marrying ${other.name}`, 80, 8, year, "lovePropensity", other.id);
              const core = addMemory(seed, self.id, year, self.mind, `married ${other.name} in ${year}`, "joy", other.id);
              if (core) applyCoreMemoryShift(seed, self.id, year, self.mind, "trust", 1);
              updateRelationship(self.mind, other.id, other.mind.values, 40, "spouse");
            }
            // PR5's merchet marker (design's markers table: "villein/cottar marriage") — one fine per
            // unfree spouse (a villein marrying an artisan only pays for the unfree side; a villein
            // marrying a villein pays twice, once per household's own tenancy).
            for (const spouse of [person, partner!]) {
              if (isUnfree(spouse.socialClass)) {
                const merchetEvent = pushEvent(events, year, "manorial-fine", [spouse.id], manorialFinePayload("merchet", spouse.id), [event.id]);
                resultingEventIds.push(merchetEvent.id);
              }
            }
          } else if (chosen === "end-it") {
            const event = pushEvent(events, year, "breakup", [person.id, partner!.id], {}, causes);
            resultingEventIds.push(event.id);
            // PR6: a breakup returns each side to what they were before THIS courtship — a widow(er)
            // re-entering the Y1 pool (design's "separate base" hazard) whose new courtship fails is
            // still a widow(er), not newly "single" (a survivor who never remarries should keep
            // reading "widowed", per the life-state invariant); anyone who was never widowed goes back
            // to plain "single". Also closes the `courting -> courting` self-loop gap: without this,
            // a later, DIFFERENT courtship's "courting" transition would illegally fire from an
            // already-"courting" state.
            for (const side of [person, partner!]) {
              const backTo = events.some((e) => e.kind === "widowed" && e.actors[0] === side.id) ? "widowed" : "single";
              side.lifeState = applyLifeTransition(ensureLifeState(side, events), { axis: "marital", to: backTo }, year);
            }
            for (const [self, other] of [[person, partner!] as const, [partner!, person] as const]) {
              pushThought(self.mind, "grief", `the courtship with ${other.name} ending`, 60, 5, year, "lovePropensity", other.id);
              addMemory(seed, self.id, year, self.mind, `the courtship with ${other.name} ended in ${year}`, "grief", other.id);
              updateRelationship(self.mind, other.id, other.mind.values, -20);
            }
          } else {
            pushThought(person.mind, "hope", `still weighing marriage to ${partner!.name}`, 20, 1, year);
          }
          if (person.id === protagonistId && chosen !== "propose" && chosen !== "end-it") {
            const event = pushEvent(events, year, "reflection", [person.id, partner!.id], { note: "put-off-a-marriage-decision", otherName: partner!.name }, []);
            resultingEventIds.push(event.id);
          }
          break;
        }
        case "A3": {
          if (chosen === "seize") {
            const job = (descriptor.opportunityJob ?? person.job) as Job;
            person.job = job;
            person.lifeState = applyLifeTransition(ensureLifeState(person, events), { axis: "vocation", to: "working" }, year);
            const event = pushEvent(events, year, "job", [person.id], { job }, []);
            resultingEventIds.push(event.id);
            pushThought(person.mind, "pride", `becoming ${article(job)} ${job}`, 45, 3, year, "ambition");
          } else if (chosen === "pass") {
            pushThought(person.mind, "contentment", "helping a friend get ahead", 25, 2, year, "altruism");
            const friend = person.mind.relationships.find((r) => r.bond === "friend");
            if (friend) updateRelationship(person.mind, friend.personId, undefined, 10);
          }
          if (person.id === protagonistId && chosen !== "seize") {
            const note = chosen === "pass" ? "passed-an-opportunity-to-a-friend" : "ignored-an-opportunity";
            const event = pushEvent(events, year, "reflection", [person.id], { note }, []);
            resultingEventIds.push(event.id);
          }
          break;
        }
        case "A2": {
          if (chosen === "try") {
            // Decision 055: conception is no longer guaranteed on "try" — a probabilistic roll
            // (Davenport 2019's birth-interval evidence implies real sub-fecund periods even among
            // couples actively trying), keyed distinctly from every other A2 draw so it doesn't
            // correlate with the eligibility/spacing checks above or the maternal-death roll below.
            const conceiveDraw = keyedDraw(seed, pairKey(person.id, partner!.id), year, "conceive");
            // Decision 080: `fertilityDampingFactor` is 1 (no change) until the village outgrows its
            // own carrying capacity; see that function's own doc comment for the full mechanism.
            if (conceiveDraw < conceptionProbability(ageInYear(person.birthYear, year)) * fertilityDampingFactor(people)) {
              const marriageEvent = events.filter((e) => e.kind === "marriage" && e.actors.includes(person.id) && e.actors.includes(partner!.id)).sort((x, y) => y.year - x.year)[0];
              if (marriageEvent) causes.push(marriageEvent.id);
              let child = spawnChild(seed, year, person, partner!, people);
              // A child born to an away couple (decision 040) is itself part of the lightweight away
              // cast, not a home villager — otherwise they'd wrongly enter the home village's own
              // illness/death/courtship pools despite never having set foot in it.
              if (person.away || partner!.away) child = { ...child, away: true };
              people[child.id] = child;
              const childEvent = pushEvent(events, year, "child", [person.id, partner!.id], { childId: child.id }, causes);
              const birthEvent = pushEvent(events, year, "birth", [child.id, person.id, partner!.id], {}, [childEvent.id]);
              resultingEventIds.push(childEvent.id, birthEvent.id);
              for (const self of [person, partner!]) {
                pushThought(self.mind, "joy", `welcoming ${child.name} into the family`, 60, 5, year, "lovePropensity", child.id);
                addMemory(seed, self.id, year, self.mind, `${child.name} was born in ${year}`, "joy", child.id);
              }
              // Decision 051: maternal mortality — an independent ~1% (0.9-1.0%) risk of death for
              // the mother, the SAME year as the birth (Schofield 1986). This can't ride the general
              // per-person "death" biology decision above — that already resolved for this year
              // before this birth existed — so it's its own keyed roll, applied immediately after
              // the birth. The `person.deathYear === undefined` guard added to the apply loop above
              // is what keeps any LATER candidate this same year from still applying an outcome for
              // her once this fires.
              const maternalDraw = keyedDraw(seed, person.id, year, "maternal-death");
              if (maternalDraw < MATERNAL_DEATH_PROBABILITY) {
                person.deathYear = year;
                const motherAge = ageInYear(person.birthYear, year);
                const deathEvent = pushEvent(events, year, "death", [person.id], { age: motherAge, awayFromTown: hasMovedAway(events, person.id), cause: "childbirth" }, [childEvent.id, birthEvent.id]);
                resultingEventIds.push(deathEvent.id);
                // Fixed after review (R3-001): this maternal-death path previously never went
                // through decision 054's widowhood handling — the same shared helper the general
                // biology death path uses below, so a husband whose wife dies in childbirth is
                // widowed exactly like anyone else.
                resultingEventIds.push(...resolveWidowhood(seed, events, people, person, person.socialClass ?? "cottar", year, deathEvent.id));
                resultingEventIds.push(...resolveCourtshipOnDeath(events, people, person, year, deathEvent.id));
              }
            } else {
              pushThought(person.mind, "longing", "hoping for a child, still", 15, 1, year);
              if (person.id === protagonistId) {
                const event = pushEvent(events, year, "reflection", [person.id, partner!.id], { note: "tried-for-a-child-without-success", otherName: partner!.name }, []);
                resultingEventIds.push(event.id);
              }
            }
          } else if (chosen === "refuse") {
            pushThought(person.mind, "regret", "choosing not to have a child this year", 20, 2, year);
          }
          if (person.id === protagonistId && chosen !== "try") {
            const event = pushEvent(events, year, "reflection", [person.id, partner!.id], { note: "chose-not-to-have-a-child", otherName: partner!.name }, []);
            resultingEventIds.push(event.id);
          }
          break;
        }
        case "Y4": {
          if (chosen === "confront") {
            const event = pushEvent(events, year, "feud", [person.id, partner!.id], {}, []);
            resultingEventIds.push(event.id);
            for (const [self, other] of [[person, partner!] as const, [partner!, person] as const]) {
              pushThought(self.mind, "anger", `clashing with ${other.name}`, 55, 4, year, "anger", other.id);
              addMemory(seed, self.id, year, self.mind, `clashed with ${other.name} in ${year}`, "anger", other.id);
              updateRelationship(self.mind, other.id, other.mind.values, -40, "grudge");
            }
          } else if (chosen === "forgive") {
            pushThought(person.mind, "relief", `letting go of the slight from ${partner!.name}`, 15, 1, year);
            updateRelationship(person.mind, partner!.id, partner!.mind.values, 10);
          } else {
            pushThought(person.mind, "bitterness", `silently resenting ${partner!.name}`, 40, 6, year, "stressVulnerability", partner!.id);
            addMemory(seed, person.id, year, person.mind, `began to resent ${partner!.name} in ${year}`, "bitterness", partner!.id);
            updateRelationship(person.mind, partner!.id, partner!.mind.values, -25, "grudge");
          }
          if (person.id === protagonistId && chosen !== "confront") {
            const note = chosen === "forgive" ? "let-go-of-a-slight" : "silently-resented-someone";
            const event = pushEvent(events, year, "reflection", [person.id, partner!.id], { note, otherName: partner!.name }, []);
            resultingEventIds.push(event.id);
          }
          break;
        }
        case "A6": {
          const feudEvent = events.filter((e) => e.kind === "feud" && e.actors.includes(person.id) && e.actors.includes(partner!.id)).sort((x, y) => y.year - x.year)[0];
          if (feudEvent) causes.push(feudEvent.id);
          if (chosen === "reconcile") {
            const event = pushEvent(events, year, "reconciliation", [person.id, partner!.id], {}, causes);
            resultingEventIds.push(event.id);
            for (const [self, other] of [[person, partner!] as const, [partner!, person] as const]) {
              pushThought(self.mind, "relief", `making peace with ${other.name}`, 45, 4, year, "altruism", other.id);
              // A reconciliation is now durable (round 5 fix, decision 022): it writes a memory
              // (so it can surface again later, "…remembering the peace they made") on top of
              // raising relationship strength, rather than just a thought that decays away —
              // and per the Y4 fix above, code won't pick this same pair for a fresh grudge again.
              addMemory(seed, self.id, year, self.mind, `made peace with ${other.name} in ${year}, ending years of feuding`, "relief", other.id);
              updateRelationship(self.mind, other.id, other.mind.values, 60, "friend");
            }
          } else if (chosen === "sabotage") {
            const event = pushEvent(events, year, "feud", [person.id, partner!.id], { escalated: true }, causes);
            resultingEventIds.push(event.id);
            pushThought(person.mind, "anger", `sabotaging ${partner!.name}`, 50, 4, year, "anger", partner!.id);
            pushThought(partner!.mind, "betrayal", `being sabotaged by ${person.name}`, 70, 6, year, "trust", person.id);
            addMemory(seed, partner!.id, year, partner!.mind, `was sabotaged by ${person.name} in ${year}`, "betrayal", person.id);
            updateRelationship(person.mind, partner!.id, partner!.mind.values, -30, "grudge");
            updateRelationship(partner!.mind, person.id, person.mind.values, -50, "grudge");
          } else {
            pushThought(person.mind, "anger", `the feud with ${partner!.name} dragging on`, 30, 2, year, "anger", partner!.id);
            updateRelationship(person.mind, partner!.id, partner!.mind.values, -10, "grudge");
          }
          if (person.id === protagonistId && chosen !== "reconcile" && chosen !== "sabotage") {
            const event = pushEvent(events, year, "reflection", [person.id, partner!.id], { note: "let-a-feud-drag-on", otherName: partner!.name }, []);
            resultingEventIds.push(event.id);
          }
          break;
        }
        case "Y3": {
          if (chosen === "leave") {
            const breakup = recentUnresolvedBreakup(events, person.id, year, 3);
            if (breakup) causes.push(breakup.id);
            // Decision 040: a real, deterministically-named destination (keyed by seed + year, so
            // a fork that changes an earlier decision but not this one still lands in the same
            // place) instead of the old placeholder "a distant town" — the protagonist keeps
            // living a real life there, not falling off the edge of the story.
            const dest = pickAwayDestination(seed, year);
            person.lifeState = applyLifeTransition(ensureLifeState(person, events), { axis: "residence", to: "away", place: dest.full }, year);
            const event = pushEvent(events, year, "move", [person.id], { away: true, destination: dest.full }, causes);
            resultingEventIds.push(event.id);
            pushThought(person.mind, "hope", `leaving home for ${dest.name}`, 40, 3, year, "curiosity");
            addMemory(seed, person.id, year, person.mind, `left for ${dest.name} in ${year}`, "hope");
            if (person.spouseId) {
              const spouse = people[person.spouseId];
              if (spouse) pushThought(spouse.mind, "loneliness", `being left behind by ${person.name}`, 50, 4, year, "anxiety", person.id);
            }
            // PR5's chevage marker (design's markers table: "unfree Y3 away") — the licence an
            // unfree person needed to live off the manor.
            if (isUnfree(person.socialClass)) {
              const chevageEvent = pushEvent(events, year, "manorial-fine", [person.id], manorialFinePayload("chevage", person.id), [event.id]);
              resultingEventIds.push(chevageEvent.id);
            }
          } else if (person.id === protagonistId) {
            // Decision 047: "stay" used to be entirely silent (no thought, no event) — the
            // handoff's own example of a turn ("Tomas asks her to leave → She stays") demands one.
            const event = pushEvent(events, year, "reflection", [person.id], { note: "chose-to-stay-home" }, []);
            resultingEventIds.push(event.id);
          }
          break;
        }
        case "A8": {
          if (chosen === "push-harder") {
            const realizeRoll = keyedDraw(seed, person.id, year, "dream-realize");
            const chance = (person.mind.facets.ambition + person.mind.facets.perseverance) / 400; // up to 0.5
            // Round 5 fix (decision 023, "dream realized without the act"): rolling well isn't
            // enough by itself — the goal must ALSO already be backed by a real event on this
            // person's own log (see `dreamGoalSatisfiedBy`). A good roll with no qualifying event
            // yet just reads as "getting closer", not "realized" — the dream can't come true from
            // a die roll alone, only from something that actually happened in the world.
            if (realizeRoll < chance && dreamGoalSatisfiedBy(person.mind.dream.goal, events, person.id)) {
              person.mind.dream.status = "realized";
              const event = pushEvent(events, year, "dream", [person.id], { goal: person.mind.dream.goal, outcome: "realized" }, []);
              resultingEventIds.push(event.id);
              pushThought(person.mind, "pride", `their dream of ${dreamGerund(person.mind.dream.goal)} being realized`, 85, 10, year, "ambition");
              const core = addMemory(seed, person.id, year, person.mind, `their dream of ${dreamGerund(person.mind.dream.goal)} was realized in ${year}`, "pride");
              if (core) applyCoreMemoryShift(seed, person.id, year, person.mind, "ambition", 1);
            } else {
              pushThought(person.mind, "hope", `still chasing the dream of ${dreamGerund(person.mind.dream.goal)}`, 20, 2, year, "perseverance");
            }
          } else if (chosen === "adjust-it") {
            const pool = person.mind.dream.goal;
            const options2 = DREAM_GOALS.filter((g) => g !== pool);
            const newGoal = options2[Math.floor(keyedDraw(seed, person.id, year, "dream-adjust") * options2.length)];
            if (newGoal) person.mind.dream = { goal: newGoal, status: "pursuing", since: year };
            // Round 7 fix (decision 030): the cause rides along so the chronicle can say WHY the
            // dream changed ("After marrying, she began to dream of...") instead of just
            // announcing a new one — `adjust-it` is only ever offered when there IS a real cause
            // (see the A8 trigger above), so `extra.dreamChangeCause` is always present here.
            const cause = typeof descriptor.extra?.dreamChangeCause === "string" ? descriptor.extra.dreamChangeCause : undefined;
            const event = pushEvent(events, year, "dream", [person.id], { goal: newGoal ?? pool, outcome: "adjusted", ...(cause ? { cause } : {}) }, []);
            resultingEventIds.push(event.id);
            addMemory(seed, person.id, year, person.mind, `set aside the dream of ${dreamGerund(pool)} in ${year}, after ${cause ?? "much thought"}`, "hope");
          } else {
            person.mind.dream.status = "abandoned";
            const event = pushEvent(events, year, "dream", [person.id], { goal: person.mind.dream.goal, outcome: "abandoned" }, []);
            resultingEventIds.push(event.id);
            pushThought(person.mind, "despair", `abandoning their dream of ${dreamGerund(person.mind.dream.goal)}`, 55, 6, year, "perseverance");
            addMemory(seed, person.id, year, person.mind, `abandoned their dream of ${dreamGerund(person.mind.dream.goal)} in ${year}`, "despair");
          }
          break;
        }
        case "A11": {
          const kind = descriptor.breakdownKind ?? "withdrawal";
          const event = pushEvent(events, year, "breakdown", [person.id], { kind, response: chosen }, []);
          resultingEventIds.push(event.id);
          if (chosen === "master-it") {
            person.mind.stress = Math.max(0, person.mind.stress - 40);
            pushThought(person.mind, "pride", "overcoming a breaking point", 40, 4, year, "perseverance");
            const core = addMemory(seed, person.id, year, person.mind, `overcame a breaking point (${kind}) in ${year}`, "pride");
            if (core) applyCoreMemoryShift(seed, person.id, year, person.mind, "perseverance", 1);
          } else {
            person.mind.stress = Math.max(0, person.mind.stress - 15);
            pushThought(person.mind, kind === "rage" ? "anger" : kind === "despair" ? "despair" : "loneliness", `giving in to it (${kind})`, 50, 4, year);
            if (kind === "rage" && person.mind.relationships.length > 0) {
              const worst = person.mind.relationships[0]!;
              updateRelationship(person.mind, worst.personId, undefined, -20);
            }
          }
          break;
        }
        case "C2": {
          // Round 7 fix (decision 030, "thin chronicles"): C2/O2/O4 used to be mind-only, with no
          // event of their own — invisible in the actual chronicle UI, which reads the EVENT log,
          // not the decision log. Each branch now pushes a `reflection` event (a generic kind for
          // an internal, non-relational moment) so it actually shows up.
          const parentName = partner?.name ?? "their parent";
          let note: string;
          if (chosen === "grieve-openly") {
            note = "grieved-openly";
            pushThought(person.mind, "grief", `losing ${parentName}`, 70, 8, year, "lovePropensity", partner?.id);
            const core = addMemory(seed, person.id, year, person.mind, `grieved openly when ${parentName} died in ${year}`, "grief", partner?.id);
            if (core) applyCoreMemoryShift(seed, person.id, year, person.mind, "anxiety", 1);
          } else if (chosen === "harden") {
            note = "hardened";
            pushThought(person.mind, "bitterness", `losing ${parentName} and having to be strong`, 55, 8, year, "stressVulnerability", partner?.id);
            const core = addMemory(seed, person.id, year, person.mind, `hardened after ${parentName} died in ${year}`, "bitterness", partner?.id);
            if (core) applyCoreMemoryShift(seed, person.id, year, person.mind, "trust", -1);
          } else {
            note = "leaned-on-family";
            pushThought(person.mind, "hope", `leaning on what family remains after losing ${parentName}`, 45, 6, year, "gregariousness", partner?.id);
            const otherParentId = person.motherId === partner?.id ? person.fatherId : person.motherId;
            const otherParent = otherParentId ? people[otherParentId] : undefined;
            if (otherParent && otherParent.deathYear === undefined) updateRelationship(person.mind, otherParent.id, otherParent.mind.values, 25, "kin");
          }
          // Decision 040: when this fires for the away protagonist (`extra.awayNews`), the prose
          // frames it as word reaching them from afar rather than a death they witnessed firsthand.
          const awayNews = descriptor.extra?.awayNews === true;
          const relative = typeof descriptor.extra?.relative === "string" ? descriptor.extra.relative : undefined;
          const event = pushEvent(events, year, "reflection", [person.id], { note, ...(awayNews ? { awayNews: true, relative: relative ?? "parent" } : {}) }, []);
          resultingEventIds.push(event.id);
          break;
        }
        case "O2": {
          const stillAlive = partner && isAlive(partner, year);
          if (chosen === "reconcile" && stillAlive) {
            const event = pushEvent(events, year, "reconciliation", [person.id, partner!.id], {}, []);
            resultingEventIds.push(event.id);
            pushThought(person.mind, "relief", `making peace with ${partner!.name} at last, after all these years`, 50, 5, year, "altruism", partner!.id);
            addMemory(seed, person.id, year, person.mind, `made peace with ${partner!.name} in ${year}, after carrying the grudge for years`, "relief", partner!.id);
            updateRelationship(person.mind, partner!.id, partner!.mind.values, 70, "friend");
          } else if (chosen === "reconcile") {
            // The old rival has already died — peace is only with the memory now, no live partner to record a reconciliation event with.
            pushThought(person.mind, "relief", `finally letting go of the old grudge against ${partner?.name ?? "them"}`, 45, 5, year);
            addMemory(seed, person.id, year, person.mind, `made peace, at least within themselves, with the memory of ${partner?.name ?? "an old rival"} in ${year}`, "relief", partner?.id);
            const event = pushEvent(events, year, "reflection", [person.id], { note: "let-go-of-grudge", otherName: partner?.name ?? "an old rival" }, []);
            resultingEventIds.push(event.id);
          } else {
            pushThought(person.mind, "bitterness", `resolving to take the grudge against ${partner?.name ?? "them"} to the grave`, 40, 10, year, "stressVulnerability", partner?.id);
            const event = pushEvent(events, year, "reflection", [person.id], { note: "kept-the-grudge", otherName: partner?.name ?? "an old rival" }, []);
            resultingEventIds.push(event.id);
          }
          break;
        }
        case "O4": {
          let note: string;
          if (chosen === "peace") {
            note = "peace-with-death";
            pushThought(person.mind, "contentment", "making peace with the years that are left", 55, 6, year, "perseverance");
            addMemory(seed, person.id, year, person.mind, `made their peace with death in ${year}`, "contentment");
          } else if (chosen === "regret") {
            note = "regret";
            pushThought(person.mind, "despair", "dwelling on regrets as the years run short", 55, 6, year, "anxiety");
            addMemory(seed, person.id, year, person.mind, `was consumed by regret in ${year}, with time running short`, "despair");
          } else {
            note = "last-wish";
            pushThought(person.mind, "hope", "holding onto a last wish", 50, 6, year, "perseverance");
            addMemory(seed, person.id, year, person.mind, `spoke of a last wish in ${year}`, "hope");
          }
          const event = pushEvent(events, year, "reflection", [person.id], { note }, []);
          resultingEventIds.push(event.id);
          break;
        }
        case "C3": {
          let note: string;
          if (chosen === "follow-trade") {
            note = "followed-the-family-trade";
            pushThought(person.mind, "contentment", "following in the family's footsteps", 35, 4, year, "perseverance");
            const core = addMemory(seed, person.id, year, person.mind, `chose to follow the family trade in ${year}`, "contentment");
            if (core) applyCoreMemoryShift(seed, person.id, year, person.mind, "perseverance", 1);
          } else if (chosen === "apprentice-elsewhere") {
            note = "sought-an-apprenticeship-elsewhere";
            pushThought(person.mind, "hope", `seeking a trade of ${person.sex === "f" ? "her" : "his"} own, away from home`, 40, 4, year, "curiosity");
            addMemory(seed, person.id, year, person.mind, `left to seek an apprenticeship elsewhere in ${year}`, "hope");
          } else {
            note = "drifted";
            pushThought(person.mind, "loneliness", "not knowing what to make of themselves yet", 30, 4, year, "anxiety");
          }
          const event = pushEvent(events, year, "reflection", [person.id], { note }, []);
          resultingEventIds.push(event.id);
          break;
        }
        case "A5": {
          if (townEventId) causes.push(townEventId);
          const townKind = descriptor.townEventType ?? "festival";
          const positive = townKind === "festival" || townKind === "harvest" || townKind === "stranger";
          if (chosen === "help") {
            pushThought(person.mind, positive ? "joy" : "pride", `helping the town through the ${townKind}`, positive ? 35 : 50, 3, year, "altruism");
            const friend = person.mind.relationships.find((r) => r.bond === "friend");
            if (friend) updateRelationship(person.mind, friend.personId, undefined, 8);
          } else if (chosen === "flee") {
            pushThought(person.mind, positive ? "contentment" : "shame", positive ? `keeping to themselves during the ${townKind}` : `keeping clear of the ${townKind} instead of helping`, 30, 3, year, "gregariousness");
          } else {
            pushThought(person.mind, positive ? "contentment" : "shame", `looking for an advantage in the ${townKind}`, 35, 3, year, "greed");
          }
          // Decision 047: A5 never pushed an event for any outcome, for anyone. NPCs keep that
          // (avoids log noise), but the protagonist now gets one regardless of which option fires.
          if (person.id === protagonistId) {
            const note = chosen === "help" ? "helped-during-a-town-event" : chosen === "flee" ? "kept-clear-of-a-town-event" : "looked-for-an-advantage-in-a-town-event";
            const event = pushEvent(events, year, "reflection", [person.id], { note, otherName: townKind }, causes);
            resultingEventIds.push(event.id);
          }
          break;
        }
        // --- Protagonist-only extended catalog (round 9, decision 035) -----
        case "C1": {
          const note = chosen === "compete" ? "competed-with-sibling" : chosen === "bond" ? "bonded-with-sibling" : "withdrew-from-sibling";
          const event = pushEvent(events, year, "reflection", [person.id, partner!.id], { note, otherName: partner!.name }, []);
          resultingEventIds.push(event.id);
          if (chosen === "compete") {
            pushThought(person.mind, "anger", `competing with ${partner!.name} for attention`, 30, 3, year, "anger", partner!.id);
            updateRelationship(person.mind, partner!.id, partner!.mind.values, -10, "rival");
          } else if (chosen === "bond") {
            pushThought(person.mind, "contentment", `bonding with ${partner!.name}`, 30, 3, year, "gregariousness", partner!.id);
            updateRelationship(person.mind, partner!.id, partner!.mind.values, 25, "friend");
          } else {
            pushThought(person.mind, "loneliness", "withdrawing at home", 25, 3, year, "anxiety");
          }
          break;
        }
        case "C4": {
          const note = chosen === "fight-back" ? "fought-back-against-bully" : chosen === "endure" ? "endured-the-bully" : "told-an-elder";
          const event = pushEvent(events, year, "reflection", [person.id, partner!.id], { note, otherName: partner!.name }, []);
          resultingEventIds.push(event.id);
          if (chosen === "fight-back") pushThought(person.mind, "anger", `standing up to ${partner!.name}`, 40, 3, year, "bravery", partner!.id);
          else if (chosen === "tell-an-elder") pushThought(person.mind, "relief", "telling an elder about the bullying", 25, 2, year, "trust");
          else pushThought(person.mind, "anxiety", `enduring ${partner!.name}'s bullying`, 35, 4, year, "stressVulnerability", partner!.id);
          break;
        }
        case "Y2": {
          const note = chosen === "pursue-the-dream" ? "pursued-the-dream-over-trade" : "stayed-practical";
          const event = pushEvent(events, year, "reflection", [person.id], { note }, []);
          resultingEventIds.push(event.id);
          if (chosen === "pursue-the-dream") pushThought(person.mind, "hope", "choosing the dream over the trade", 35, 3, year, "ambition");
          else pushThought(person.mind, "contentment", "choosing the trade over the dream, for now", 25, 3, year, "perseverance");
          break;
        }
        case "Y5": {
          const note = chosen === "open-up" ? "opened-up-to-a-friend" : "kept-their-distance";
          const event = pushEvent(events, year, "reflection", [person.id, partner!.id], { note, otherName: partner!.name }, []);
          resultingEventIds.push(event.id);
          if (chosen === "open-up") {
            pushThought(person.mind, "contentment", `opening up to ${partner!.name}`, 30, 3, year, "gregariousness", partner!.id);
            addMemory(seed, person.id, year, person.mind, `became close friends with ${partner!.name} in ${year}`, "contentment", partner!.id);
            updateRelationship(person.mind, partner!.id, partner!.mind.values, 35, "friend");
          } else {
            pushThought(person.mind, "loneliness", `keeping ${partner!.name} at a distance`, 20, 2, year);
          }
          break;
        }
        case "A4": {
          const note =
            chosen === "confront" ? "confronted-the-betrayal" : chosen === "forgive" ? "forgave-the-betrayal" : chosen === "leave" ? "left-over-the-betrayal" : "sought-revenge-for-the-betrayal";
          const event = pushEvent(events, year, "reflection", [person.id, partner!.id], { note, otherName: partner!.name }, []);
          resultingEventIds.push(event.id);
          pushThought(person.mind, "betrayal", `discovering ${partner!.name}'s betrayal`, 70, 6, year, "trust", partner!.id);
          addMemory(seed, person.id, year, person.mind, `discovered ${partner!.name}'s betrayal in ${year}`, "betrayal", partner!.id);
          if (chosen === "leave") {
            // Read BEFORE clearing spouseId below — see the marriage-side note in the `A1` case.
            const personState = ensureLifeState(person, events);
            const partnerState = ensureLifeState(partner!, events);
            person.spouseId = undefined;
            partner!.spouseId = undefined;
            person.lifeState = applyLifeTransition(personState, { axis: "marital", to: "single" }, year);
            partner!.lifeState = applyLifeTransition(partnerState, { axis: "marital", to: "single" }, year);
            const breakupEvent = pushEvent(events, year, "breakup", [person.id, partner!.id], {}, [event.id]);
            resultingEventIds.push(breakupEvent.id);
            updateRelationship(person.mind, partner!.id, partner!.mind.values, -60, "grudge");
          } else if (chosen === "revenge") {
            updateRelationship(person.mind, partner!.id, partner!.mind.values, -50, "grudge");
          } else if (chosen === "forgive") {
            updateRelationship(person.mind, partner!.id, partner!.mind.values, -10);
          } else {
            updateRelationship(person.mind, partner!.id, partner!.mind.values, -20, "grudge");
          }
          break;
        }
        case "A7": {
          const note = chosen === "double-down" ? "doubled-down-on-faith" : chosen === "lose-faith" ? "lost-their-faith" : "sought-another-path";
          const event = pushEvent(events, year, "reflection", [person.id], { note }, []);
          resultingEventIds.push(event.id);
          if (chosen === "double-down") pushThought(person.mind, "hope", "holding fast to faith", 35, 4, year, "perseverance");
          else if (chosen === "lose-faith") pushThought(person.mind, "despair", "losing faith", 45, 5, year, "anxiety");
          else pushThought(person.mind, "hope", "seeking another path entirely", 30, 3, year, "curiosity");
          break;
        }
        case "A9": {
          const note = chosen === "resist" ? "resisted-temptation" : "pursued-an-affair";
          const event = pushEvent(events, year, "reflection", [person.id], { note }, []);
          resultingEventIds.push(event.id);
          if (chosen === "resist") pushThought(person.mind, "pride", "resisting the temptation", 30, 3, year, "perseverance");
          else {
            pushThought(person.mind, "shame", "giving in to temptation", 50, 6, year, "stressVulnerability");
            const core = addMemory(seed, person.id, year, person.mind, `gave in to temptation in ${year}`, "shame");
            if (core) applyCoreMemoryShift(seed, person.id, year, person.mind, "trust", -1);
          }
          break;
        }
        case "A10": {
          const note = chosen === "take-an-apprentice" ? "took-an-apprentice" : "declined-to-mentor";
          const event = pushEvent(events, year, "reflection", [person.id, partner!.id], { note, otherName: partner!.name }, []);
          resultingEventIds.push(event.id);
          if (chosen === "take-an-apprentice") {
            pushThought(person.mind, "pride", `taking ${partner!.name} on as an apprentice`, 35, 4, year, "altruism", partner!.id);
            updateRelationship(person.mind, partner!.id, partner!.mind.values, 30, "friend");
          } else {
            pushThought(person.mind, "contentment", "declining to take on an apprentice", 15, 2, year);
          }
          break;
        }
        case "O1": {
          const note =
            chosen === "eldest" ? "divided-inheritance-eldest" : chosen === "favorite" ? "divided-inheritance-favorite" : chosen === "split" ? "split-inheritance" : "inheritance-to-town";
          const event = pushEvent(events, year, "reflection", [person.id], { note }, []);
          resultingEventIds.push(event.id);
          pushThought(person.mind, "contentment", "settling how the inheritance will fall", 30, 3, year, "perseverance");
          break;
        }
        case "O3": {
          const note = chosen === "last-attempt" ? "last-attempt-at-dream" : chosen === "pass-it-on" ? "passed-on-dream" : "made-peace-with-unrealized-dream";
          const event = pushEvent(events, year, "reflection", [person.id], { note }, []);
          resultingEventIds.push(event.id);
          if (chosen === "make-peace-with-it") person.mind.dream.status = "abandoned";
          pushThought(person.mind, chosen === "last-attempt" ? "hope" : "contentment", `reckoning with the old dream of ${dreamGerund(person.mind.dream.goal)}`, 30, 4, year, "perseverance");
          break;
        }
        case "AP1": {
          const note = chosen === "apprentice-own-trade" ? "apprenticed-to-family-trade" : chosen === "send-away" ? "sent-away-to-apprentice" : "kept-at-home";
          const event = pushEvent(events, year, "reflection", [person.id, partner!.id], { note, otherName: partner!.name }, []);
          resultingEventIds.push(event.id);
          pushThought(partner!.mind, "hope", `${person.name}'s decision about ${partner!.sex === "f" ? "her" : "his"} future`, 25, 4, year, "ambition", person.id);
          // Decision 056 fix: `apprentice-own-trade` previously only narrated the apprenticeship —
          // the child's actual `job` was never set, so A3 at 16 would still draw a fresh one at
          // random. It now really does set the trade, which is also why A3 (age 16) skips anyone
          // whose `job` is already set.
          if (chosen === "apprentice-own-trade" && person.job !== "none") {
            partner!.job = person.job;
            addMemory(seed, partner!.id, year, partner!.mind, `was apprenticed to the family trade of ${person.job} in ${year}`, "hope", person.id);
          }
          break;
        }
        case "PIL1": {
          const note = chosen === "go" ? "went-on-pilgrimage" : "stayed-home-from-pilgrimage";
          const event = pushEvent(events, year, "reflection", [person.id], { note }, []);
          resultingEventIds.push(event.id);
          if (chosen === "go") {
            pushThought(person.mind, "hope", "setting out on pilgrimage", 35, 4, year, "curiosity");
            addMemory(seed, person.id, year, person.mind, `went on pilgrimage in ${year}`, "hope");
          } else {
            pushThought(person.mind, "longing", "feeling the pull of a pilgrimage not taken", 20, 2, year);
          }
          break;
        }
      }
      }

      decisions.push({
        id: minted.id,
        personId: descriptor.personId,
        partnerId: descriptor.partnerId,
        year,
        kind: descriptor.kind,
        question: questionText("en", descriptor.kind, partner?.name, config.town.name, descriptor.opportunityJob, descriptor.breakdownKind, descriptor.townEventType),
        options,
        jevRaw,
        prior,
        final,
        noise,
        chosen,
        fragility,
        surprise,
        source,
        causes,
        resultingEventIds,
        occurrenceProbability,
      });
      // Every social candidate is recorded unconditionally (no `RECORD_THRESHOLD` gate, unlike
      // biology above), so this id's slot always advances as an occurrence.
      commitId(people, events, descriptor.personId, minted, true);
    }

    // "At least one entry per year" (round 10, decision 042): if the protagonist ends this year
    // with no event of their own — every other situation this year either wasn't the one selected,
    // or was selected but resolved to "nothing happens" (e.g. A1's "delay") — present one
    // everyday-life vignette so the chronicle never has a silent year. Checked AFTER biology and
    // social resolution above (not at candidate-gathering time), since only the actual outcome, not
    // the mere presence of a candidate, determines whether a year is genuinely quiet. `D1` itself
    // never goes through the round 12 (decision 045) event-selection gate that the OTHER social
    // candidates now do — it's asked in the SAME batch (paid for once) but resolved here,
    // unconditionally, exactly like round 10-11's D1-anchored guarantee, since its vignette outcomes
    // always produce a real event and it's the one candidate that must never come up empty. What's
    // NEW this round: the candidates it's backstopping for now got a real, Jev-judged, occurrence-
    // weighted joint selection instead of N independent code-gated coin flips, so D1 fires less
    // often in practice — but the mechanism guaranteeing it fires when needed is unchanged.
    //
    // Decision 047 fix: the OTHER reason D1 dominated wasn't selection at all — it was that a
    // selected situation whose chosen option was a "nothing happens" one (A1 "delay", Y1
    // "decline"/"wait", Y3 "stay", A3 "ignore", A6 "feud" (drags on), Y4 "nurse-it", A2 "wait"/
    // "refuse", A5 every option) produced NO event for the protagonist, so `hasOwnEventThisYear`
    // was false and D1 fired anyway even though a real situation WAS selected and resolved.
    // Every no-op branch above now pushes a `reflection` event (same generic kind decision 030
    // introduced for C2/O2/O4/etc.) for the protagonist only — declining, waiting, staying are
    // story beats, not silence. NPCs are untouched (still no event on their own no-ops), so this
    // never grows the general village simulation's event volume. D1 now only fires when the
    // selected situation genuinely produced nothing (e.g. its counterpart got invalidated
    // mid-resolution) — a true safety net, not the common case.
    if (options.protagonistId) {
      const protagonist = people[options.protagonistId];
      if (protagonist && (protagonist.deathYear === undefined || protagonist.deathYear === year)) {
        const hasOwnEventThisYear = events.some((e) => e.year === year && e.actors.includes(protagonist.id));
        if (!hasOwnEventThisYear) {
          const preFetched = finalVignetteWinner ? resultByDecisionId.get(finalVignetteWinner) : undefined;
          const { decision: d1Decision, wasRealCall } = await resolveDailyLifeVignette(
            protagonist,
            year,
            seed,
            config,
            people,
            events,
            townEvent,
            options.decisionMaker,
            options.engineSource,
            overrides,
            d1Candidates,
            finalVignetteWinner,
            preFetched,
            isOverrideYear,
          );
          decisions.push(d1Decision);
          if (wasRealCall) decisionCalls += 1;
        }
      }
    }

    const snapshot: YearSnapshot = { year, people: structuredClone(people), events: structuredClone(events), decisions: structuredClone(decisions) };
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
    decisionCalls,
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

/**
 * Decision 057: replaces the old universal age-6 `school` event. `literate` is decided once, at
 * birth (`worldgen.ts#isLiterate`, keyed by class and sex per research.md's literacy table) — this
 * only decides WHEN the (already-determined) literate ones are taught, at age 7, and only pushes an
 * event for them. Everyone else simply never gets a `school` event, which is the period-faithful
 * default (research.md: labourers ~5-10% literate, ~90% of women illiterate overall).
 */
function school(events: Event[], people: Record<string, Person>, personId: string, year: number): void {
  const person = people[personId];
  if (!person) return;
  if (ageInYear(person.birthYear, year) === 7 && person.literate) {
    pushEvent(events, year, "school", [personId], { socialClass: person.socialClass ?? "cottar" }, []);
  }
}

/** Picks a first name not already in use by any of `existingNames` with this exact full name — see decision 019 (duplicate names). Falls back to an epithet if the whole pool for this sex is exhausted (small towns won't hit this, a very large one might). */
function uniqueFirstName(existingNames: ReadonlySet<string>, sex: Sex, preferredIndex: number, surname: string): string {
  const pool = sex === "f" ? FEMALE_NAMES : MALE_NAMES;
  for (let offset = 0; offset < pool.length; offset++) {
    const first = pool[(preferredIndex + offset) % pool.length]!;
    if (!existingNames.has(`${first} ${surname}`)) return first;
  }
  return `${pool[preferredIndex % pool.length]} the Younger`;
}

function spawnImmigrant(seed: string, year: number, people: Readonly<Record<string, Person>>): Person {
  const newId = `immigrant-${year}`;
  const sex: Sex = keyedRng(seed, newId, year, "sex")() < 0.5 ? "f" : "m";
  const age = 18 + Math.floor(keyedRng(seed, newId, year, "age")() * 14); // 18-31
  const birthYear = year - age;
  const nameIndex = Math.floor(keyedRng(seed, newId, year, "name")() * 20);
  const surnameIndex = Math.floor(keyedRng(seed, newId, year, "surname")() * 20);
  const surname = pickName(sex, 0, surnameIndex).split(" ")[1]!;
  const existingNames = new Set(Object.values(people).map((p) => p.name));
  const first = uniqueFirstName(existingNames, sex, nameIndex, surname);
  const name = `${first} ${surname}`;
  const traits = pickTraits(keyedRng(seed, newId, year, "traits"), 3);
  // Decision 049: an immigrant is assigned one of the five "common" classes (not clergy/gentry,
  // which are structural, one-per-village roles decided at worldgen — see `worldgen.ts`); no
  // sourced figure exists for immigrant class distribution specifically, so this reuses the same
  // founder-class weights as a documented, reasonable default.
  const socialClass = pickCommonClass(keyedRng(seed, newId, year, "social-class"));
  const job = pickJobForClass(socialClass, keyedRng(seed, newId, year, "job"));
  const literate = isLiterate(seed, newId, birthYear, sex, socialClass);
  const mind = createMind(seed, newId, birthYear, []);
  return { id: newId, name, sex, birthYear, traits, job, founder: false, mind, socialClass, literate };
}

/** A lightweight newcomer met in the protagonist's away catalog (decision 040) — deterministic and content-derived (`away-<year>`), same shape as `spawnImmigrant`, tagged `away: true` so it never joins the home village's own pools. */
function spawnAwayPerson(seed: string, year: number, people: Readonly<Record<string, Person>>): Person {
  const newId = `away-${year}`;
  const sex: Sex = keyedRng(seed, newId, year, "sex")() < 0.5 ? "f" : "m";
  const age = 16 + Math.floor(keyedRng(seed, newId, year, "age")() * 20); // 16-35
  const birthYear = year - age;
  const nameIndex = Math.floor(keyedRng(seed, newId, year, "name")() * 20);
  const surnameIndex = Math.floor(keyedRng(seed, newId, year, "surname")() * 20);
  const surname = pickName(sex, 0, surnameIndex).split(" ")[1]!;
  const existingNames = new Set(Object.values(people).map((p) => p.name));
  const first = uniqueFirstName(existingNames, sex, nameIndex, surname);
  const name = `${first} ${surname}`;
  const traits = pickTraits(keyedRng(seed, newId, year, "traits"), 3);
  const socialClass = pickCommonClass(keyedRng(seed, newId, year, "social-class"));
  const job = pickJobForClass(socialClass, keyedRng(seed, newId, year, "job"));
  const literate = isLiterate(seed, newId, birthYear, sex, socialClass);
  const mind = createMind(seed, newId, birthYear, []);
  return { id: newId, name, sex, birthYear, traits, job, founder: false, mind, away: true, socialClass, literate };
}

function spawnChild(seed: string, year: number, mother: Person, father: Person, people: Readonly<Record<string, Person>>): Person {
  // Content-derived id: a mother has at most one child per year, by construction of the have-child gate.
  const childId = `child-${mother.id}-${year}`;
  const sex: Sex = keyedRng(seed, childId, year, "child-sex")() < 0.5 ? "f" : "m";
  const traitRng = keyedRng(seed, childId, year, "child-traits");
  const traits: Trait[] = [];
  const pool = [...TRAIT_POOL];
  for (let t = 0; t < 3 && pool.length > 0; t++) {
    const idx = Math.floor(traitRng() * pool.length);
    traits.push(pool.splice(idx, 1)[0]!);
  }
  const nameIdxRng = keyedRng(seed, childId, year, "child-name");
  const surnameSource = mother.name.split(" ").slice(1).join(" ");
  const surnameIndex = Math.floor(nameIdxRng() * 20);
  const surname = surnameSource || pickName(sex, 0, surnameIndex).split(" ")[1]!;
  const existingNames = new Set(Object.values(people).map((p) => p.name));
  const first = uniqueFirstName(existingNames, sex, Math.floor(nameIdxRng() * 20), surname);
  const name = `${first} ${surname}`;
  const mind = createMind(seed, childId, year, [mother.mind, father.mind]);
  // Decision 056: inherits the father's class (mother's, if the father's is somehow unknown — a
  // hand-built `Person` fixture without `socialClass` set, since a real simulated father always has
  // one). Literacy (decision 057) is then drawn fresh for the child, at birth, by their own class/sex.
  const socialClass = father.socialClass ?? mother.socialClass ?? "cottar";
  const literate = isLiterate(seed, childId, year, sex, socialClass);
  return { id: childId, name, sex, birthYear: year, traits, job: "none", motherId: mother.id, fatherId: father.id, founder: false, mind, socialClass, literate };
}

export { dreamGoalSatisfiedBy, eligibleForAnotherChild, feudPairHistory, gatherCandidatesForYear, resolveCourtshipOnDeath, townEventMortalityMultiplier };

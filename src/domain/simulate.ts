import { ageInYear, deathProbabilityAtAge, isAdult, isFertileAge, isWorkingAge } from "./actuarial";
import { mapWithConcurrency } from "./concurrency";
import type { DecisionMaker, DecisionOption, DecisionQuestion, DecisionRecord, DecisionSource, Distribution } from "./decisions";
import { activeFeudPair, activeRomancePair, eventsFor, hasMovedAway, isAlive, lastIllnessYear, makeEventId, pairKey, recentUnresolvedBreakup } from "./events";
import { article } from "./narrate";
import { addMemory, applyCoreMemoryShift, compactMindState, computeMood, createMind, decayMindForYear, DREAM_GOALS, dreamGerund, type DreamGoal, pushThought, renderPortrait, updateRelationship } from "./mind";
import { determineDeathCause, protagonistMortalityBonus } from "./mortality";
import { FEMALE_NAMES, MALE_NAMES, pickName } from "./names";
import { decisionFragility, isSurprise, keyedDraw, keyedRng, normalizeDistribution, NOT_FRAGILE, sampleGumbelMax } from "./rng";
import { ruleDistribution } from "./rule-heuristics";
import { JOB_POOL, TRAIT_POOL, type Event, type EventKind, type JsonValue, type Job, type Override, type Person, type Sex, type SimulationResult, type Trait, type WorldConfig, type YearSnapshot } from "./types";
import { pickJob, pickTraits } from "./worldgen";

const DEFAULT_CONCURRENCY_LIMIT = 8;

/**
 * A decision gets persisted into the log if it produced a real outcome, OR
 * if the road not taken had at least this much probability mass — i.e. it
 * was a genuine crossroads, not a coin so weighted it could only ever land
 * one way. Below this, a "did nothing happen" record for every person,
 * every year, would dwarf the actually-interesting decisions (see decision
 * 007). Applies to biology decisions (illness, death, immigration); social
 * decisions are always recorded once asked, since the code-level gates
 * that precede them already filter out near-certain "no" years.
 */
const RECORD_THRESHOLD = 0.05;

export interface SimulateOptions {
  readonly decisionMaker: DecisionMaker;
  /** Which engine `decisionMaker` is, so `resolveSocialDecision` knows whether to treat its answer as `jevRaw` or a plain `prior`. */
  readonly engineSource: "jev" | "rules";
  readonly overrides?: readonly Override[];
  readonly concurrencyLimit?: number;
  /** Continue an existing run from this year instead of `config.startYear` (used by fork). */
  readonly fromYear?: number;
  readonly onYearComplete?: (snapshot: YearSnapshot) => void;
  /**
   * Round 9 (decision 034, the single-life pivot). When set:
   *  - the extended, protagonist-only situation catalog (C1, C4, Y2, Y5, A4, A7, A9, A10, O1, O3,
   *    AP1, PIL1, the lord's levy) is gated on, purely additive — with no `protagonistId`, this
   *    option has ZERO effect on candidate gathering, resolution or output, so every existing
   *    `/api/worlds` endpoint and test keeps its exact byte-for-byte behavior.
   *  - the yearly loop stops once this person has a `deathYear` (their life is what's being told).
   *  - this person's own social decisions are never diverted to the budget fallback below.
   */
  readonly protagonistId?: string;
}

/** Round 9: a decision call budget for a single life (see docs/decisions.md 037). Once the running total of REAL DecisionMaker calls for this run reaches this, any further social decision NOT about the protagonist is resolved with the deterministic rule heuristic instead of calling `decisionMaker` — the protagonist's own decisions (and decisions about them) are never throttled. */
export const LIFE_DECISION_BUDGET = 2000;

export interface SimulateReport {
  readonly result: SimulationResult;
  readonly snapshots: ReadonlyMap<number, YearSnapshot>;
  readonly wallTimeMs: number;
  readonly decisionCalls: number;
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
    portrait: renderPortrait(person.name, person.mind, (id) => people[id]?.name ?? id),
  };
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

/** The seven town-level happenings from mind-model.md's "Town events" table — each one presents A5 to every adult in town. */
const TOWN_EVENT_TYPES = ["plague", "famine", "fire", "festival", "conflict", "harvest", "stranger"] as const;
type TownEventType = (typeof TOWN_EVENT_TYPES)[number];

const TOWN_EVENT_LABEL: Record<TownEventType, string> = {
  plague: "A plague has swept through",
  famine: "A famine has struck",
  fire: "A fire has torn through part of",
  festival: "A festival has come to",
  conflict: "A conflict has broken out with a neighboring town, and it has reached",
  harvest: "A bountiful harvest has blessed",
  stranger: "A traveling stranger has arrived in",
};

/** Whether a hardship-flavored town event that year (plague/famine/fire) that should raise mortality risk for everyone in town that year. */
const HARDSHIP_TOWN_EVENTS: ReadonlySet<TownEventType> = new Set(["plague", "famine", "fire"]);

/**
 * A rare, world-level happening (round 5, decision 025 — mind-model.md's
 * "Town events" table): code alone decides WHETHER one happens and WHICH
 * kind, via a keyed roll; every adult in town then gets an `A5` Jev
 * decision about how they personally respond. Kept as its own pure
 * function (not inlined in `gatherCandidatesForYear`) because both the
 * candidate-gathering pass AND the event-pushing pass in `simulate()` need
 * to agree on the exact same answer for a given year.
 */
function townEventForYear(seed: string, year: number): TownEventType | undefined {
  const gateDraw = keyedDraw(seed, "world", year, "town-event-gate");
  if (gateDraw >= 0.02) return undefined;
  const typeDraw = keyedDraw(seed, "world", year, "town-event-type");
  return TOWN_EVENT_TYPES[Math.floor(typeDraw * TOWN_EVENT_TYPES.length)];
}

function overrideFor(overrides: readonly Override[], decisionId: string): Override | undefined {
  return overrides.find((o) => o.decisionId === decisionId);
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
function gatherCandidatesForYear(year: number, people: Readonly<Record<string, Person>>, events: readonly Event[], seed: string, protagonistId?: string): CandidateDescriptor[] {
  const candidates: CandidateDescriptor[] = [];

  const livingIds = Object.values(people)
    .filter((p) => p.deathYear === undefined)
    .map((p) => p.id)
    .sort();

  // Biology: illness and death are decision opportunities for every living person, every year.
  for (const id of livingIds) {
    const movedAway = hasMovedAway(events, id);
    if (!movedAway) {
      const lastIllness = lastIllnessYear(events, id);
      const offCooldown = lastIllness === undefined || year - lastIllness >= ILLNESS_COOLDOWN_YEARS;
      if (offCooldown) candidates.push({ decisionId: `illness:${id}:${year}`, kind: "illness", personId: id, options: ["illness", "healthy"] });
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

  // Immigration: one world-level decision opportunity per year, capped once the town is comfortably sized.
  if (livingIds.length < 38) {
    candidates.push({ decisionId: `immigration:world:${year}`, kind: "immigration", personId: "world", options: ["arrive", "no-arrival"] });
  }

  // Social decisions: gathered the same way as before — code-level
  // probability GATES (not themselves recorded as decisions) decide
  // whether a real decision is even asked this year, so the call budget
  // stays bounded as the town's population compounds across generations.
  const aliveNonMoved = Object.values(people)
    .filter((p) => p.deathYear === undefined && !hasMovedAway(events, p.id))
    .sort((a, b) => a.id.localeCompare(b.id));

  const claimedPartners = new Set<string>();

  for (const person of aliveNonMoved) {
    const age = ageInYear(person.birthYear, year);

    // Y1 Courtship offer. Age-appropriate matching: try a tight window first
    // (within 10 years) and only widen if nobody eligible is nearby in age.
    if (isAdult(age) && age <= 65 && !person.spouseId && activeRomancePair(events, person.id) === undefined) {
      const seekChance = 0.32 + (person.mind.facets.lovePropensity >= 60 ? 0.15 : 0) + (person.mind.facets.gregariousness <= 35 ? -0.1 : 0) + (person.mind.facets.gregariousness >= 65 ? 0.08 : 0);
      const seekDraw = keyedDraw(seed, person.id, year, "seeking-partner");
      if (seekDraw < Math.max(0.02, seekChance)) {
        const eligible = (maxAgeGap: number) =>
          aliveNonMoved.find(
            (candidate) =>
              candidate.id !== person.id &&
              candidate.sex !== person.sex &&
              !candidate.spouseId &&
              !claimedPartners.has(candidate.id) &&
              !isRelated(person, candidate) &&
              isAdult(ageInYear(candidate.birthYear, year)) &&
              activeRomancePair(events, candidate.id) === undefined &&
              Math.abs(ageInYear(candidate.birthYear, year) - age) <= maxAgeGap,
          );
        const partner = eligible(10) ?? eligible(20) ?? eligible(40);
        if (partner) {
          claimedPartners.add(partner.id);
          claimedPartners.add(person.id);
          candidates.push({ decisionId: `Y1:${pairKey(person.id, partner.id)}:${year}`, kind: "Y1", personId: person.id, partnerId: partner.id, options: ["encourage", "decline", "wait"] });
        }
      }
    }

    // A1 Proposal: established romances, asked once per pair, by the lower id.
    // Guards the partner is still alive (round 5 fix, decision 022): `activeRomancePair`
    // only reads the event log, so with no guard here a partner who died after the
    // romance began would keep being offered as a living proposal target.
    const romancePartnerId = activeRomancePair(events, person.id);
    if (romancePartnerId && person.id < romancePartnerId && people[romancePartnerId] && isAlive(people[romancePartnerId]!, year)) {
      const romanceEvent = eventsFor(events, person.id)
        .filter((e) => e.kind === "romance" && e.actors.includes(romancePartnerId))
        .sort((a, b) => b.year - a.year)[0];
      const reconsiderDraw = keyedDraw(seed, person.id, year, "marry-reconsider");
      if (romanceEvent && year - romanceEvent.year >= 1 && (year === romanceEvent.year + 1 || reconsiderDraw < 0.55)) {
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

    // A3 Career opportunity: first job at 16, then roughly every 20 years (round 6 fix, decision
    // 028, "careers are incoherent" — rarer, per the brief, than the old every-15-years cadence
    // that had Briala change trades four times in one life). `yearsInCurrentJob` goes into `extra`
    // so Jev can weigh "I've spent 15 years at this" — a fact the state never carried before.
    if (isWorkingAge(age) && (age === 16 || (age - 16) % 20 === 0)) {
      const lastJobEvent = eventsFor(events, person.id)
        .filter((e) => e.kind === "job")
        .sort((a, b) => b.year - a.year)[0];
      const yearsInCurrentJob = lastJobEvent ? year - lastJobEvent.year : age - 16;
      const alternatives = JOB_POOL.filter((j) => j !== person.job && j !== "none");
      const opportunity = alternatives[Math.floor(keyedDraw(seed, person.id, year, "opportunity-job") * alternatives.length)] ?? person.job;
      candidates.push({ decisionId: `A3:${person.id}:${year}`, kind: "A3", personId: person.id, options: ["seize", "pass", "ignore"], opportunityJob: opportunity, extra: { yearsInCurrentJob, currentJob: person.job } });
    }

    // A2 Have a child: asked via the mother. Density-damped once the living population is large.
    // Round 6 fix (decision 028, "population decline is systematic"): `extra` now carries the
    // concrete facts Jev needs to reason about urgency — existing children and years of fertility
    // left — since neither was previously in the state at all. Also a legitimate TRIGGER-timing
    // change, not an answer weight: a still-childless couple close to the end of the fertility
    // window is asked MORE often (code deciding when a decision is a real crossroads), not answered
    // differently.
    if (person.sex === "f" && person.spouseId && isFertileAge(age, "f")) {
      const spouse = people[person.spouseId];
      if (spouse && spouse.deathYear === undefined) {
        const existingChildren = Object.values(people).filter((c) => c.motherId === person.id).length;
        const fertileYearsLeft = Math.max(0, 45 - age);
        const densityFactor = livingIds.length > 34 ? Math.max(0.3, 1 - (livingIds.length - 34) * 0.04) : 1;
        const urgencyBoost = existingChildren === 0 && fertileYearsLeft <= 8 ? 0.2 : 0;
        const gateChance = Math.max(0.06, (0.4 - existingChildren * 0.06) * densityFactor + urgencyBoost);
        const gateDraw = keyedDraw(seed, person.id, year, "child-gate");
        if (gateDraw < gateChance) {
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
    }

    // Y4 First grudge: a hot-tempered or envious (high anger/greed facet) person occasionally clashes with an unrelated townsperson.
    const pastRivals = feudPairHistory(events, person.id);
    if ((person.mind.facets.anger >= 65 || person.mind.facets.greed >= 65) && activeFeudPair(events, person.id) === undefined && pastRivals.size < MAX_FEUD_PAIRS_PER_LIFE) {
      const feudDraw = keyedDraw(seed, person.id, year, "feud-gate");
      if (feudDraw < 0.05) {
        const rival = aliveNonMoved.find(
          (c) => c.id !== person.id && c.job === person.job && !isRelated(person, c) && activeFeudPair(events, c.id) === undefined && !pastRivals.has(c.id) && feudPairHistory(events, c.id).size < MAX_FEUD_PAIRS_PER_LIFE,
        );
        if (rival) candidates.push({ decisionId: `Y4:${pairKey(person.id, rival.id)}:${year}`, kind: "Y4", personId: person.id, partnerId: rival.id, options: ["confront", "forgive", "nurse-it"] });
      }
    }

    // A6 Rivalry escalates: a grudge that's been running at least two years.
    // Guards the partner is still alive (round 5 fix, decision 022) — this is the exact
    // bug the coordinator's screenshot caught ("Fira ... made peace" a year after Orla died).
    const feudPartnerId = activeFeudPair(events, person.id);
    if (feudPartnerId && person.id < feudPartnerId && people[feudPartnerId] && isAlive(people[feudPartnerId]!, year)) {
      const feudEvents = events.filter((e) => e.kind === "feud" && e.actors.includes(person.id) && e.actors.includes(feudPartnerId)).sort((a, b) => a.year - b.year);
      const feudEvent = feudEvents[feudEvents.length - 1];
      const originalYear = feudEvents[0]?.year;
      const reconcileReconsiderDraw = keyedDraw(seed, person.id, year, "reconcile-reconsider");
      const withinEpisodeBudget = feudEvents.length < FEUD_EPISODE_CAP && originalYear !== undefined && year - originalYear <= FEUD_EPISODE_WINDOW_YEARS;
      if (feudEvent && withinEpisodeBudget && year - feudEvent.year >= 3 && (year === feudEvent.year + 3 || reconcileReconsiderDraw < 0.3)) {
        candidates.push({ decisionId: `A6:${pairKey(person.id, feudPartnerId)}:${year}`, kind: "A6", personId: person.id, partnerId: feudPartnerId, options: ["reconcile", "feud", "sabotage"] });
      }
    }

    // Y3 Leave or stay.
    if (isAdult(age)) {
      const recentBreakup = recentUnresolvedBreakup(events, person.id, year, 3);
      const restlessBonus = person.mind.facets.curiosity >= 65 || person.mind.values.independence >= 20 ? 0.06 : 0;
      const breakupBonus = recentBreakup ? 0.05 : 0;
      const moveChance = 0.015 + restlessBonus + breakupBonus;
      const moveDraw = keyedDraw(seed, person.id, year, "move-gate");
      if (moveDraw < moveChance) {
        candidates.push({ decisionId: `Y3:${person.id}:${year}`, kind: "Y3", personId: person.id, options: ["leave", "stay"] });
      }
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

    // O2 Old grudge: a grudge relationship that's lingered into old age, surfaced occasionally rather than every year.
    if (age >= 60) {
      const oldGrudge = person.mind.relationships.find((r) => r.bond === "grudge" && r.strength <= -40);
      if (oldGrudge) {
        const grudgeDraw = keyedDraw(seed, person.id, year, "old-grudge-gate");
        if (grudgeDraw < 0.1) {
          candidates.push({ decisionId: `O2:${pairKey(person.id, oldGrudge.personId)}:${year}`, kind: "O2", personId: person.id, partnerId: oldGrudge.personId, options: ["reconcile", "take-to-grave"] });
        }
      }
    }

    // O4 Facing death: a reckoning with mortality in old age. Simplified from the spec's literal
    // "terminal illness" trigger (that fires the same year illness/death is decided, which this
    // pure/pre-biology candidate pass can't see yet — the same ordering issue as C2 above) to "old
    // age, occasionally" — disclosed as a scoping simplification in decision 025.
    if (age >= 75) {
      const mortalityDraw = keyedDraw(seed, person.id, year, "facing-death-gate");
      if (mortalityDraw < 0.08) {
        candidates.push({ decisionId: `O4:${person.id}:${year}`, kind: "O4", personId: person.id, options: ["peace", "regret", "last-wish"] });
      }
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

      // Y5 Close friendship: while young and without an existing friend bond.
      if (age >= 14 && age <= 30 && !person.mind.relationships.some((r) => r.bond === "friend")) {
        const friendDraw = keyedDraw(seed, person.id, year, "friendship-gate");
        if (friendDraw < 0.06) {
          const candidate = aliveNonMoved.find((c) => c.id !== person.id && !isRelated(person, c) && Math.abs(ageInYear(c.birthYear, year) - age) <= 8);
          if (candidate) candidates.push({ decisionId: `Y5:${pairKey(person.id, candidate.id)}:${year}`, kind: "Y5", personId: person.id, partnerId: candidate.id, options: ["open-up", "keep-distance"] });
        }
      }

      // A4 Betrayal discovered: rare, while married.
      if (isAdult(age) && person.spouseId && people[person.spouseId] && isAlive(people[person.spouseId]!, year)) {
        const betrayalDraw = keyedDraw(seed, person.id, year, "betrayal-gate");
        if (betrayalDraw < 0.015) candidates.push({ decisionId: `A4:${pairKey(person.id, person.spouseId)}:${year}`, kind: "A4", personId: person.id, partnerId: person.spouseId, options: ["confront", "forgive", "leave", "revenge"] });
      }

      // A7 Crisis of faith: high faith value, after a recent hardship.
      if (isAdult(age) && person.mind.values.faith >= 20) {
        const recentHardship = eventsFor(events, person.id).some((e) => e.year >= year - 2 && e.year < year && (e.kind === "illness" || e.kind === "feud" || e.kind === "breakdown"));
        if (recentHardship) {
          const faithDraw = keyedDraw(seed, person.id, year, "faith-crisis-gate");
          if (faithDraw < 0.12) candidates.push({ decisionId: `A7:${person.id}:${year}`, kind: "A7", personId: person.id, options: ["double-down", "lose-faith", "seek-another-path"] });
        }
      }

      // A9 Affair temptation: married and unhappy (low mood).
      if (isAdult(age) && person.spouseId && computeMood(person.mind) <= -10) {
        const affairDraw = keyedDraw(seed, person.id, year, "affair-gate");
        if (affairDraw < 0.05) candidates.push({ decisionId: `A9:${person.id}:${year}`, kind: "A9", personId: person.id, partnerId: person.spouseId, options: ["resist", "pursue"] });
      }

      // A10 Mentor: skilled and established, with a youth nearby.
      if (age >= 35 && person.job !== "none") {
        const mentorDraw = keyedDraw(seed, person.id, year, "mentor-gate");
        if (mentorDraw < 0.05) {
          const apprentice = aliveNonMoved.find((c) => c.id !== person.id && !isRelated(person, c) && ageInYear(c.birthYear, year) >= 14 && ageInYear(c.birthYear, year) <= 20);
          if (apprentice) candidates.push({ decisionId: `A10:${pairKey(person.id, apprentice.id)}:${year}`, kind: "A10", personId: person.id, partnerId: apprentice.id, options: ["take-an-apprentice", "decline"] });
        }
      }

      // O1 Inheritance: old, with living heirs. `extra.quarrel` when there's more than one heir.
      if (age >= 70) {
        const heirs = Object.values(people).filter((c) => (c.motherId === person.id || c.fatherId === person.id) && c.deathYear === undefined);
        if (heirs.length > 0) {
          const inheritanceDraw = keyedDraw(seed, person.id, year, "inheritance-gate");
          if (inheritanceDraw < 0.1) candidates.push({ decisionId: `O1:${person.id}:${year}`, kind: "O1", personId: person.id, options: ["eldest", "favorite", "split", "town"], extra: { heirs: heirs.length, quarrel: heirs.length >= 2 } });
        }
      }

      // O3 Legacy: old, with a dream that never came true.
      if (age >= 65 && person.mind.dream.status !== "realized") {
        const legacyDraw = keyedDraw(seed, person.id, year, "legacy-gate");
        if (legacyDraw < 0.1) candidates.push({ decisionId: `O3:${person.id}:${year}`, kind: "O3", personId: person.id, options: ["last-attempt", "pass-it-on", "make-peace-with-it"] });
      }

      // PIL1 Pilgrimage: a real pull of faith, in adulthood.
      if (age >= 20 && age <= 55 && person.mind.values.faith >= 15) {
        const pilgrimageDraw = keyedDraw(seed, person.id, year, "pilgrimage-gate");
        if (pilgrimageDraw < 0.04) candidates.push({ decisionId: `PIL1:${person.id}:${year}`, kind: "PIL1", personId: person.id, options: ["go", "stay"] });
      }
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
    default:
      return optionId;
  }
}

/** The situation, worded from the person's own perspective (spec: "the question fields it depends on, and a question worded from the person's perspective"). */
function questionText(kind: string, otherName?: string, townName?: string, opportunityJob?: string, breakdownKind?: string, townEventType?: TownEventType): string {
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

const SOCIAL_KINDS = new Set(["Y1", "A1", "A2", "A3", "Y3", "Y4", "A6", "A8", "A11", "C2", "O2", "O4", "A5", "C3", "C1", "C4", "Y2", "Y5", "A4", "A7", "A9", "A10", "O1", "O3", "AP1", "PIL1"]);

function buildQuestion(descriptor: CandidateDescriptor, year: number, config: WorldConfig, people: Record<string, Person>): DecisionQuestion {
  const person = people[descriptor.personId]!;
  const base = personSummary(person, year, people);
  const town = config.town.name;
  const partner = descriptor.partnerId ? people[descriptor.partnerId] : undefined;
  const partnerSummary = partner ? otherPersonBrief(partner, year, people) : undefined;

  const stateKey = descriptor.kind === "Y1" ? "suitor" : descriptor.kind === "Y4" || descriptor.kind === "A6" || descriptor.kind === "O2" ? "rival" : descriptor.kind === "C2" ? "parent" : "partner";
  const state: Record<string, JsonValue> = {
    self: base,
    situation: { code: descriptor.kind, question: questionText(descriptor.kind, partner?.name, town, descriptor.opportunityJob, descriptor.breakdownKind, descriptor.townEventType), ...descriptor.extra },
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

function biologyDistribution(kind: string, p: number): Distribution {
  if (kind === "illness") return { illness: p, healthy: 1 - p };
  if (kind === "death") return { die: p, survive: 1 - p };
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
export async function simulate(
  config: WorldConfig,
  initialPeople: Readonly<Record<string, Person>>,
  initialEvents: readonly Event[],
  options: SimulateOptions,
): Promise<SimulateReport> {
  const started = Date.now();
  const people: Record<string, Person> = structuredClone(initialPeople as Record<string, Person>);
  const events: Event[] = structuredClone(initialEvents as Event[]);
  const decisions: DecisionRecord[] = [];
  const overrides = options.overrides ?? [];
  const concurrencyLimit = options.concurrencyLimit ?? DEFAULT_CONCURRENCY_LIMIT;
  const seed = config.seed;
  const snapshots = new Map<number, YearSnapshot>();
  let decisionCalls = 0;

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

    const candidates = gatherCandidatesForYear(year, people, events, seed, options.protagonistId);
    const biologyCandidates = candidates.filter((c) => c.kind === "illness" || c.kind === "death" || c.kind === "immigration" || c.kind === "levy");
    const socialCandidates = candidates.filter((c) => SOCIAL_KINDS.has(c.kind));

    // Town event (decision 025): pushed once here, at most once per year, deterministically —
    // `townEventForYear` is the exact same pure function `gatherCandidatesForYear` used to decide
    // whether to offer every adult an A5 decision this year, so the two can never disagree.
    const townEvent = townEventForYear(seed, year);
    let townEventId: string | undefined;
    if (townEvent) {
      const event = pushEvent(events, year, "town", [], { eventType: townEvent }, []);
      townEventId = event.id;
    }
    const hardshipMultiplier = townEvent && HARDSHIP_TOWN_EVENTS.has(townEvent) ? 1.6 : 1;

    // --- Biology: synchronous, no AI calls ----------------------------------
    // Illness is processed before death for the same person (in `gatherCandidatesForYear`'s
    // sort order, "death" < "illness" alphabetically would be wrong — we sort by kind name,
    // so re-sort biology explicitly: illness first, so a same-year illness can raise the death odds).
    biologyCandidates.sort((a, b) => {
      if (a.personId !== b.personId) return a.kind === "immigration" ? 1 : b.kind === "immigration" ? -1 : a.personId.localeCompare(b.personId);
      return a.kind === "illness" ? -1 : b.kind === "illness" ? 1 : 0;
    });

    const illnessResultByPerson = new Map<string, Event | undefined>();

    for (const descriptor of biologyCandidates) {
      const forced = overrideFor(overrides, descriptor.decisionId);
      let record: DecisionRecord;

      if (descriptor.kind === "illness") {
        const age = ageInYear(people[descriptor.personId]!.birthYear, year);
        const p = baseIllnessChance(age);
        record = resolveBiologyDecision(descriptor, year, p, seed, forced, people[descriptor.personId]!.name, config.town.name);
        let illnessEvent: Event | undefined;
        if (record.chosen === "illness") {
          illnessEvent = pushEvent(events, year, "illness", [descriptor.personId], { age }, []);
        }
        illnessResultByPerson.set(descriptor.personId, illnessEvent);
        record = { ...record, resultingEventIds: illnessEvent ? [illnessEvent.id] : [] };
        // Recording threshold (decision 007): always record if it actually
        // happened, or if the road not taken (illness) had a real chance.
        if (record.chosen === "illness" || p >= RECORD_THRESHOLD || record.source === "forced") decisions.push(record);
      } else if (descriptor.kind === "death") {
        const person = people[descriptor.personId]!;
        const age = ageInYear(person.birthYear, year);
        const illnessEvent = illnessResultByPerson.get(descriptor.personId);
        let p = illnessEvent ? Math.min(0.9, deathProbabilityAtAge(age) * 3 * hardshipMultiplier) : Math.min(0.9, deathProbabilityAtAge(age) * hardshipMultiplier);
        // Round 9 (decision 035): the protagonist's mortality gets extra, cause-varied risk on top
        // of the village-wide actuarial curve above — see mortality.ts. Purely additive to `p`, and
        // gated to `descriptor.personId === options.protagonistId`, so every other person in town
        // (and the whole village when no protagonist is set) is completely unaffected.
        const isProtagonist = descriptor.personId === options.protagonistId;
        const hasActiveFeud = isProtagonist && activeFeudPair(events, person.id) !== undefined;
        const recentChildbirth = isProtagonist && person.sex === "f" && events.some((e) => e.kind === "birth" && e.year === year - 1 && (e.actors[1] === person.id || e.actors[2] === person.id));
        const mortalityContext = { age, sex: person.sex, hadIllness: !!illnessEvent, townEventType: townEvent, hasActiveFeud, recentChildbirth };
        if (isProtagonist) p = Math.min(0.95, p + protagonistMortalityBonus(mortalityContext));
        record = resolveBiologyDecision(descriptor, year, p, seed, forced, person.name, config.town.name);
        const resultingEventIds: string[] = [];
        if (record.chosen === "die") {
          person.deathYear = year;
          const cause = isProtagonist ? determineDeathCause(mortalityContext) : undefined;
          const deathEvent = pushEvent(
            events,
            year,
            "death",
            [descriptor.personId],
            { age, awayFromTown: hasMovedAway(events, descriptor.personId), ...(cause ? { cause } : {}) },
            illnessEvent ? [illnessEvent.id] : [],
          );
          resultingEventIds.push(deathEvent.id);
        } else if (illnessEvent) {
          (illnessEvent.payload as Record<string, JsonValue>).recovered = true;
        }
        const deathCauses = [...(illnessEvent ? [illnessEvent.id] : []), ...(hardshipMultiplier > 1 && townEventId ? [townEventId] : [])];
        record = { ...record, causes: deathCauses, resultingEventIds };
        if (record.chosen === "die" || p >= RECORD_THRESHOLD || record.source === "forced") decisions.push(record);
      } else if (descriptor.kind === "levy") {
        const p = 0.045 * (townEvent === "famine" ? 1.4 : 1);
        record = resolveBiologyDecision(descriptor, year, p, seed, forced, people[descriptor.personId]!.name, config.town.name);
        const resultingEventIds: string[] = [];
        if (record.chosen === "impose") {
          const event = pushEvent(events, year, "levy", [descriptor.personId], {}, []);
          resultingEventIds.push(event.id);
        }
        record = { ...record, resultingEventIds };
        if (record.chosen === "impose" || p >= RECORD_THRESHOLD || record.source === "forced") decisions.push(record);
      } else {
        const p = 0.05;
        record = resolveBiologyDecision(descriptor, year, p, seed, forced, config.town.name, config.town.name);
        const resultingEventIds: string[] = [];
        if (record.chosen === "arrive") {
          const newPerson = spawnImmigrant(seed, year, people);
          people[newPerson.id] = newPerson;
          const event = pushEvent(events, year, "move", [newPerson.id], { away: false, arrived: true }, []);
          resultingEventIds.push(event.id);
        }
        record = { ...record, resultingEventIds };
        if (record.chosen === "arrive" || p >= RECORD_THRESHOLD || record.source === "forced") decisions.push(record);
      }

      // Piggyback the (deterministic, no-alternative) school event on the
      // once-per-living-person "death" pass rather than giving it its own
      // decision — starting school at 6 has no real alternative outcome.
      if (descriptor.kind === "death" && !hasMovedAway(events, descriptor.personId)) school(events, people, descriptor.personId, year);
    }

    // --- Social decisions: gather -> concurrent decide -> apply -------------
    const questions = socialCandidates.map((c) => buildQuestion(c, year, config, people));
    const forcedFlags = socialCandidates.map((c) => overrideFor(overrides, c.decisionId));
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
    decisionCalls += questions.filter((_, i) => !forcedFlags[i] && !fallbackFlags[i]).length;

    const resolved = await mapWithConcurrency(questions, concurrencyLimit, async (q, i) => {
      if (forcedFlags[i]) return undefined; // forced: never ask the DecisionMaker
      if (fallbackFlags[i]) {
        const prior = normalizeDistribution(ruleDistribution(q) as Record<string, number>);
        return { prior, final: prior, source: "rules" as DecisionSource };
      }
      return resolveSocialDecision(q, options.decisionMaker, options.engineSource);
    });

    for (let i = 0; i < socialCandidates.length; i++) {
      const descriptor = socialCandidates[i]!;
      const forced = forcedFlags[i];
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

      const options: DecisionOption[] = descriptor.options.map((id) => ({ id, label: optionLabel(descriptor.kind, id, person.name, partner?.name, descriptor.opportunityJob, person.sex) }));
      const resultingEventIds: string[] = [];
      const causes: string[] = [];

      switch (descriptor.kind) {
        case "Y1": {
          if (chosen === "encourage" && !person.spouseId && !partner!.spouseId) {
            const causeA = recentUnresolvedBreakup(events, person.id, year, 3);
            const causeB = recentUnresolvedBreakup(events, partner!.id, year, 3);
            for (const c of [causeA, causeB]) if (c) causes.push(c.id);
            const event = pushEvent(events, year, "romance", [person.id, partner!.id], {}, causes);
            resultingEventIds.push(event.id);
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
          break;
        }
        case "A1": {
          const romanceEvent = events.filter((e) => e.kind === "romance" && e.actors.includes(person.id) && e.actors.includes(partner!.id)).sort((x, y) => y.year - x.year)[0];
          if (romanceEvent) causes.push(romanceEvent.id);
          if (chosen === "propose" && !person.spouseId && !partner!.spouseId) {
            person.spouseId = partner!.id;
            partner!.spouseId = person.id;
            const event = pushEvent(events, year, "marriage", [person.id, partner!.id], {}, causes);
            resultingEventIds.push(event.id);
            for (const [self, other] of [[person, partner!] as const, [partner!, person] as const]) {
              pushThought(self.mind, "joy", `marrying ${other.name}`, 80, 8, year, "lovePropensity", other.id);
              const core = addMemory(seed, self.id, year, self.mind, `married ${other.name} in ${year}`, "joy", other.id);
              if (core) applyCoreMemoryShift(seed, self.id, year, self.mind, "trust", 1);
              updateRelationship(self.mind, other.id, other.mind.values, 40, "spouse");
            }
          } else if (chosen === "end-it") {
            const event = pushEvent(events, year, "breakup", [person.id, partner!.id], {}, causes);
            resultingEventIds.push(event.id);
            for (const [self, other] of [[person, partner!] as const, [partner!, person] as const]) {
              pushThought(self.mind, "grief", `the courtship with ${other.name} ending`, 60, 5, year, "lovePropensity", other.id);
              addMemory(seed, self.id, year, self.mind, `the courtship with ${other.name} ended in ${year}`, "grief", other.id);
              updateRelationship(self.mind, other.id, other.mind.values, -20);
            }
          } else {
            pushThought(person.mind, "hope", `still weighing marriage to ${partner!.name}`, 20, 1, year);
          }
          break;
        }
        case "A3": {
          if (chosen === "seize") {
            const job = (descriptor.opportunityJob ?? person.job) as Job;
            person.job = job;
            const event = pushEvent(events, year, "job", [person.id], { job }, []);
            resultingEventIds.push(event.id);
            pushThought(person.mind, "pride", `becoming ${article(job)} ${job}`, 45, 3, year, "ambition");
          } else if (chosen === "pass") {
            pushThought(person.mind, "contentment", "helping a friend get ahead", 25, 2, year, "altruism");
            const friend = person.mind.relationships.find((r) => r.bond === "friend");
            if (friend) updateRelationship(person.mind, friend.personId, undefined, 10);
          }
          break;
        }
        case "A2": {
          if (chosen === "try") {
            const marriageEvent = events.filter((e) => e.kind === "marriage" && e.actors.includes(person.id) && e.actors.includes(partner!.id)).sort((x, y) => y.year - x.year)[0];
            if (marriageEvent) causes.push(marriageEvent.id);
            const child = spawnChild(seed, year, person, partner!, people);
            people[child.id] = child;
            const childEvent = pushEvent(events, year, "child", [person.id, partner!.id], { childId: child.id }, causes);
            const birthEvent = pushEvent(events, year, "birth", [child.id, person.id, partner!.id], {}, [childEvent.id]);
            resultingEventIds.push(childEvent.id, birthEvent.id);
            for (const self of [person, partner!]) {
              pushThought(self.mind, "joy", `welcoming ${child.name} into the family`, 60, 5, year, "lovePropensity", child.id);
              addMemory(seed, self.id, year, self.mind, `${child.name} was born in ${year}`, "joy", child.id);
            }
          } else if (chosen === "refuse") {
            pushThought(person.mind, "regret", "choosing not to have a child this year", 20, 2, year);
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
          break;
        }
        case "Y3": {
          if (chosen === "leave") {
            const breakup = recentUnresolvedBreakup(events, person.id, year, 3);
            if (breakup) causes.push(breakup.id);
            const event = pushEvent(events, year, "move", [person.id], { away: true, destination: "a distant town" }, causes);
            resultingEventIds.push(event.id);
            pushThought(person.mind, "hope", "leaving home for a distant town", 40, 3, year, "curiosity");
            addMemory(seed, person.id, year, person.mind, `left for a distant town in ${year}`, "hope");
            if (person.spouseId) {
              const spouse = people[person.spouseId];
              if (spouse) pushThought(spouse.mind, "loneliness", `being left behind by ${person.name}`, 50, 4, year, "anxiety", person.id);
            }
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
          const event = pushEvent(events, year, "reflection", [person.id], { note }, []);
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
            person.spouseId = undefined;
            partner!.spouseId = undefined;
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
          if (chosen === "apprentice-own-trade" && person.job !== "none") {
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

      decisions.push({
        id: descriptor.decisionId,
        personId: descriptor.personId,
        partnerId: descriptor.partnerId,
        year,
        kind: descriptor.kind,
        question: questionText(descriptor.kind, partner?.name, config.town.name, descriptor.opportunityJob, descriptor.breakdownKind, descriptor.townEventType),
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
      });
    }

    const snapshot: YearSnapshot = { year, people: structuredClone(people), events: structuredClone(events), decisions: structuredClone(decisions) };
    snapshots.set(year, snapshot);
    options.onYearComplete?.(snapshot);

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
  };
}

function resolveBiologyDecision(descriptor: CandidateDescriptor, year: number, p: number, seed: string, forced: Override | undefined, selfName: string, townName: string): DecisionRecord {
  const options: DecisionOption[] = descriptor.options.map((id) => ({ id, label: optionLabel(descriptor.kind, id, selfName) }));

  if (forced) {
    return {
      id: descriptor.decisionId,
      personId: descriptor.personId,
      year,
      kind: descriptor.kind,
      question: questionText(descriptor.kind, undefined, townName),
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
    id: descriptor.decisionId,
    personId: descriptor.personId,
    year,
    kind: descriptor.kind,
    question: questionText(descriptor.kind, undefined, townName),
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

function school(events: Event[], people: Record<string, Person>, personId: string, year: number): void {
  const person = people[personId];
  if (!person) return;
  if (ageInYear(person.birthYear, year) === 6) pushEvent(events, year, "school", [personId], {}, []);
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
  const job = pickJob(keyedRng(seed, newId, year, "job"));
  const mind = createMind(seed, newId, birthYear, []);
  return { id: newId, name, sex, birthYear, traits, job, founder: false, mind };
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
  return { id: childId, name, sex, birthYear: year, traits, job: "none", motherId: mother.id, fatherId: father.id, founder: false, mind };
}

export { dreamGoalSatisfiedBy, feudPairHistory, gatherCandidatesForYear };

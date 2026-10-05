import { ageInYear, classMortalityMultiplier, deathProbabilityAtAge } from "./actuarial";
import type { MintedId } from "./decision-id";
import type { DecisionMaker, DecisionQuestion, DecisionRecord, DecisionSource, Distribution, PersonYearSituation } from "./decisions";
import { mapWithConcurrency } from "./concurrency";
import { normalizeDistribution, sampleGumbelMax } from "./rng";
import { ruleDistribution } from "./rule-heuristics";
import { storyCircle } from "./story-circle";
import type { Vignette } from "./vignettes";
import { activeFeudPair, hasMovedAway } from "./events";
import { commitId, levyClassMultiplier, mintId, overrideFor, pickAwayDestination, pushEvent, resolveCourtshipOnDeath, resolveWidowhood, school, spawnAwayPerson, spawnGentrySuitor, spawnImmigrant } from "./legacy-year-mechanics";
import { applyLifeTransition, ensureLifeState } from "./life-state";
import { addMemory, applyCoreMemoryShift, decayMindForYear, pushThought, updateRelationship } from "./mind";
import { determineDeathCause, type MortalityContext } from "./mortality";
import { ARRANGED_GENTRY_MATCH_PROBABILITY, IMMIGRATION_ANNUAL_PROBABILITY, IMMIGRATION_ANNUAL_PROBABILITY_POST_PLAGUE, IMMIGRATION_POST_PLAGUE_END_YEAR, IMMIGRATION_POST_PLAGUE_YEAR, RETURN_HOME_PROBABILITY } from "./params/demography";
import { blackDeathMortalityForYear, datedNationalEventTypesForYear, isHundredYearsWarLevyYear, secondPestilenceMortalityForYear } from "./period/events";
import { isLeyrwiteEligible, isUnfree, manorialFinePayload, shouldPresentLeyrwite } from "./period/markers";
import type { Event, JsonValue, Override, Person, Sex, SocialClass, WorldConfig } from "./types";

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

export interface ResolvedDecision {
  readonly jevRaw?: Distribution;
  readonly prior?: Distribution;
  readonly final: Distribution;
  readonly source: DecisionSource;
  /** Absent for forced and legacy per-candidate answers. */
  readonly occurrenceProbability?: number;
}

interface SocialCandidate extends VitalCandidate {
  readonly decisionId: string;
  readonly partnerId?: string;
}

export interface LegacyDailyLifeCandidate<C> {
  readonly descriptor: C;
  readonly vignette: Vignette;
  readonly deciderId: string;
}

/** Borrowed live references, never a second people registry or a snapshot projection.
 * Catalog ports construct language/questions only; this phase owns filtering, batching,
 * call accounting, asynchronous resolution and both ordered selection samples.
 */
export interface LegacySocialBatchContext<C extends SocialCandidate, TownEvent extends string = string> {
  readonly config: WorldConfig;
  readonly people: Record<string, Person>;
  readonly events: Event[];
  readonly decisions: DecisionRecord[];
  readonly counters: { decisionCalls: number };
  readonly originalOverrideYear: number;
  readonly options: {
    readonly protagonistId?: string;
    readonly decisionMaker: DecisionMaker;
    readonly backgroundDecisionMaker?: DecisionMaker;
    readonly engineSource: "jev" | "rules";
  };
  readonly marriageFunnelDebug: { readonly y1LosesTo: Record<string, number> } | undefined;
  readonly inMarriageFunnelCohort: (person: Person, startYear: number) => boolean;
  readonly buildQuestion: (descriptor: C, year: number, config: WorldConfig, people: Record<string, Person>) => DecisionQuestion;
  readonly buildDailyLifeVignetteCandidates: (person: Person, year: number, seed: string, people: Record<string, Person>, events: Event[], townEvent: TownEvent | undefined) => readonly LegacyDailyLifeCandidate<C>[];
  readonly personSummary: (person: Person, year: number, people: Record<string, Person>) => Record<string, JsonValue>;
  readonly resolveSocialDecision: (question: DecisionQuestion, maker: DecisionMaker, source: "jev" | "rules") => Promise<ResolvedDecision>;
  readonly decisionBudget: number;
  readonly concurrencyLimit: number;
  readonly yearBatchConcurrency: number;
}

/** Aligned arrays are consumed by the old ordered apply loop. D1 stays speculative:
 * the later quiet-year guard consumes the exact prefetched winner/result from this phase.
 * No slot commits, births, Mind outcomes, snapshots or D1 application happen here.
 */
export interface LegacySocialBatchOutput<C> {
  readonly year: number;
  readonly batchable: boolean;
  readonly socialCandidates: C[];
  readonly questions: DecisionQuestion[];
  readonly forcedFlags: (Override | undefined)[];
  readonly fallbackFlags: boolean[];
  readonly resolved: (ResolvedDecision | undefined)[];
  readonly d1Candidates: readonly (LegacyDailyLifeCandidate<C> & { readonly question: DecisionQuestion })[];
  readonly resultByDecisionId: Map<string, ResolvedDecision>;
  readonly finalVignetteWinner: string | undefined;
}

export async function resolveLegacySocialBatch<C extends SocialCandidate, TownEvent extends string = string>(
  context: LegacySocialBatchContext<C, TownEvent>,
  year: number,
  candidates: C[],
  overrides: readonly Override[],
  leftVillageThisYear: ReadonlySet<string>,
  townEvent: TownEvent | undefined,
): Promise<LegacySocialBatchOutput<C>> {
  const { config, people, events, counters, options, marriageFunnelDebug,
    inMarriageFunnelCohort, buildQuestion, buildDailyLifeVignetteCandidates,
    personSummary, resolveSocialDecision, concurrencyLimit, yearBatchConcurrency } = context;
  const seed = config.seed;
  const isOverrideYear = year === context.originalOverrideYear;
  // Only SAME-year deaths drop a partner: C2 requires a parent dead in an earlier year.
  const goneThisYear = (id: string): boolean => people[id]?.deathYear === year || leftVillageThisYear.has(id);
  if (marriageFunnelDebug !== undefined) {
    for (const c of candidates) {
      if (c.kind !== "Y1") continue;
      const person = people[c.personId];
      if (!person || !inMarriageFunnelCohort(person, config.startYear)) continue;
      const died = people[c.personId]?.deathYear === year || (c.partnerId !== undefined && people[c.partnerId]?.deathYear === year);
      const left = leftVillageThisYear.has(c.personId) || (c.partnerId !== undefined && leftVillageThisYear.has(c.partnerId));
      const reason = died ? "died-same-year" : left ? "left-village-same-year" : undefined;
      if (reason) marriageFunnelDebug.y1LosesTo[reason] = (marriageFunnelDebug.y1LosesTo[reason] ?? 0) + 1;
    }
  }
  const socialCandidates = candidates.filter((c) => !goneThisYear(c.personId) && (!c.partnerId || !goneThisYear(c.partnerId)));
  // Questions read CURRENT people after biology and leyrwite, in original candidate order.
  const questions = socialCandidates.map((c) => buildQuestion(c, year, config, people));
  const forcedFlags = socialCandidates.map((c) => overrideFor(overrides, c.kind, c.personId, isOverrideYear, c.partnerId));
  const fallbackFlags = socialCandidates.map((c, i) => {
    if (forcedFlags[i] || !options.protagonistId) return false;
    const aboutProtagonist = c.personId === options.protagonistId || c.partnerId === options.protagonistId;
    return !aboutProtagonist && counters.decisionCalls >= context.decisionBudget;
  });

  // The entire eligible D1 pool rides along speculatively, possibly across parent batches.
  let d1Candidates: LegacySocialBatchOutput<C>["d1Candidates"] = [];
  if (options.protagonistId && !overrideFor(overrides, "D1", options.protagonistId, isOverrideYear)) {
    const protagonist = people[options.protagonistId];
    if (protagonist && (protagonist.deathYear === undefined || protagonist.deathYear === year)) {
      d1Candidates = buildDailyLifeVignetteCandidates(protagonist, year, seed, people, events, townEvent).map((c) => ({ ...c, question: buildQuestion(c.descriptor, year, config, people) }));
    }
  }

  const batchable = typeof options.decisionMaker.decideYear === "function";
  const resultByDecisionId = new Map<string, ResolvedDecision>();
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
    counters.decisionCalls += batchesByPerson.size;
    const personIds = Array.from(batchesByPerson.keys());
    // Preserve the empty-circle fast path: without a protagonist, use the main decider.
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
      // Deciders judge; the engine samples exactly once with the original event-pick tuple.
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
        const occurrenceProbability = id === selectedId ? normalizedSelection![id] : undefined;
        resultByDecisionId.set(id,
          deciderSource === "jev" ? { jevRaw, final: jevRaw, source: "jev", occurrenceProbability } : { prior: jevRaw, final: jevRaw, source: "rules", occurrenceProbability });
      }
    });
    // Cross-batch vignette selection retains original union/completion order and RNG tuple.
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
    counters.decisionCalls += questions.filter((_, i) => !forcedFlags[i] && !fallbackFlags[i]).length;
  }
  const resolved = await mapWithConcurrency(questions, concurrencyLimit, async (q, i) => {
    if (forcedFlags[i]) return undefined;
    if (fallbackFlags[i]) {
      const prior = normalizeDistribution(ruleDistribution(q) as Record<string, number>);
      return { prior, final: prior, source: "rules" as DecisionSource };
    }
    if (batchable) return resultByDecisionId.get(q.id);
    return resolveSocialDecision(q, options.decisionMaker, options.engineSource);
  });
  return { year, batchable, socialCandidates, questions, forcedFlags, fallbackFlags, resolved,
    d1Candidates, resultByDecisionId, finalVignetteWinner };
}

interface VitalCandidate {
  readonly kind: string;
  readonly personId: string;
  readonly options: readonly string[];
}

/** Internal borrowed references to the simulation's ONE owned registry and ordered logs.
 * Capture remains a narrow port because the legacy social/vignette catalog stays in simulate.ts.
 * Its closure retains the original protagonist; the typed debug collector is passed unchanged.
 * No completed-run retrofit, cloning, reordering, or historical mind reconstruction occurs here.
 */
export interface LegacyYearContext<C extends VitalCandidate, Debug = unknown> {
  readonly config: WorldConfig;
  readonly people: Record<string, Person>;
  readonly events: Event[];
  readonly decisions: DecisionRecord[];
  readonly originalOverrideYear: number;
  readonly protagonistId: string | undefined;
  /** Live options read for arranged marriage; vital death retains the captured protagonist above. */
  readonly optionsProtagonistId: string | undefined;
  readonly counters: { decisionCalls: number };
  readonly debug: Debug | undefined;
  readonly captureCandidates: (debug: Debug | undefined) => C[];
  readonly resolveBiologyDecision: (descriptor: C, year: number, p: number, seed: string, forced: Override | undefined, selfName: string, townName: string, minted: MintedId) => DecisionRecord;
  readonly mortalityMultiplier: (age: number, sex: Sex, socialClass: SocialClass) => number;
}

/** First annual phase: decay every living mind, THEN capture candidates before biology.
 * Candidate capture also retains its legacy life-state/debug mutations through the owned references.
 */
export function beginLegacyYear<C extends VitalCandidate, Debug>(context: LegacyYearContext<C, Debug>): C[] {
  const { people, captureCandidates } = context;
  // Yearly mind decay (spec step 2): every living person's thoughts lose a
  // year and expire at 0; stress drains ~20%/year (slower for the
  // anxious), rising first with the last year's negative mood. Done
  // before this year's situations are gathered, so an A11 breakdown
  // trigger or an A8 dream check reflects the decayed value for THIS
  // year, not a stale one.
  for (const person of Object.values(people)) {
    if (person.deathYear === undefined) decayMindForYear(person.mind);
  }
  return captureCandidates(context.debug);
}

/** Emit the original town slot followed by independent dated national shocks. */
export function emitLegacyYearShocks<C extends VitalCandidate, Debug>(
  context: LegacyYearContext<C, Debug>,
  year: number,
  townEvent: string | undefined,
): string | undefined {
  const { events } = context;
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
  return townEventId;
}

/** Entire pre-social biology traversal, retaining the original comparator and mutation order.
 * Vital decisions run IN this traversal, not in an upfront pass; school still piggybacks death.
 */
export function resolveLegacyBiology<C extends VitalCandidate, Debug>(
  context: LegacyYearContext<C, Debug>,
  year: number,
  biologyCandidates: C[],
  overrides: readonly Override[],
  townEvent: string | undefined,
  townEventId: string | undefined,
): Set<string> {
  const { config, people, events, decisions, resolveBiologyDecision } = context;
  const seed = config.seed;
  // --- Biology: synchronous, no AI calls ----------------------------------
  // Illness is processed before death for the same person (in `gatherCandidatesForYear`'s
  // sort order, "death" < "illness" alphabetically would be wrong — we sort by kind name,
  // so re-sort biology explicitly: illness first, so a same-year illness can raise the death odds).
  biologyCandidates.sort((a, b) => {
    if (a.personId !== b.personId) return a.kind === "immigration" ? 1 : b.kind === "immigration" ? -1 : a.personId.localeCompare(b.personId);
    return a.kind === "illness" ? -1 : b.kind === "illness" ? 1 : 0;
  });

  const illnessResultByPerson = new Map<string, Event | undefined>();

  const isOverrideYear = year === context.originalOverrideYear;
  // Decision 083: daughters who marry out of the village this year (resolved in this biology loop),
  // so their social candidates, gathered before they left, are dropped below like a same-year death.
  const leftVillageThisYear = new Set<string>();
  for (const descriptor of biologyCandidates) {
    const forced = overrideFor(overrides, descriptor.kind, descriptor.personId, isOverrideYear);
    const minted = mintId(people, descriptor.kind, descriptor.personId, year);
    let record: DecisionRecord;

    if (descriptor.kind === "illness" || descriptor.kind === "death") {
      resolveLegacyVitalDecision(context, descriptor, year, forced, minted, illnessResultByPerson, townEventId, townEvent);
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
    } else if (descriptor.kind === "arranged-match") {
      // Decision 083: fires straight to a marriage — no courtship phase at all, unlike every other
      // Y1/A1-driven marriage. An arranged match IS the decision (made by her family, off-screen),
      // not a suitor she spends years courting.
      const p = ARRANGED_GENTRY_MATCH_PROBABILITY;
      record = resolveBiologyDecision(descriptor, year, p, seed, forced, people[descriptor.personId]!.name, config.town.name, minted);
      const resultingEventIds: string[] = [];
      if (record.chosen === "arrange") {
        const daughter = people[descriptor.personId]!;
        // Decision 083: a villager's daughter marries OUT — her suitor stays an off-screen `away`
        // prop and she moves to his manor, so the village never gains a new gentry household
        // (letting suitors move in multiplied the class: literacy 12.9%, adult gentry -9 years).
        // Only the protagonist stays home, so the match never writes her out of her own story.
        const marriesOut = descriptor.personId !== context.optionsProtagonistId;
        const suitor = spawnGentrySuitor(seed, year, daughter.id, people, marriesOut);
        people[suitor.id] = suitor;
        // Read each lifeState BEFORE setting spouseId below (same ordering reason as A1's own
        // "propose" case above — `ensureLifeState` derives a missing state from `spouseId`).
        const daughterState = ensureLifeState(daughter, events);
        const suitorState = ensureLifeState(suitor, events);
        daughter.spouseId = suitor.id;
        suitor.spouseId = daughter.id;
        daughter.lifeState = applyLifeTransition(daughterState, { axis: "marital", to: "married", partnerId: suitor.id }, year);
        suitor.lifeState = applyLifeTransition(suitorState, { axis: "marital", to: "married", partnerId: daughter.id }, year);
        // Both spouses are gentry by construction (`spawnGentrySuitor` always mints gentry) — no
        // merchet (decision 080's `classesAtMarriage` mechanism), since merchet is an unfree-tenant
        // due, and gentry are free (`isUnfree` is always false for this class).
        const classesAtMarriage: Record<string, SocialClass> = { [daughter.id]: "gentry", [suitor.id]: "gentry" };
        const event = pushEvent(events, year, "marriage", [daughter.id, suitor.id], { classesAtMarriage, arranged: true }, []);
        resultingEventIds.push(event.id);
        if (marriesOut) {
          const dest = pickAwayDestination(seed, year);
          daughter.lifeState = applyLifeTransition(ensureLifeState(daughter, events), { axis: "residence", to: "away", place: dest.full }, year);
          const move = pushEvent(events, year, "move", [daughter.id], { away: true, destination: dest.full, arranged: true }, [event.id]);
          resultingEventIds.push(move.id);
          leftVillageThisYear.add(daughter.id);
        }
        for (const [self, other] of [[daughter, suitor] as const, [suitor, daughter] as const]) {
          pushThought(self.mind, "joy", `marrying ${other.name}`, 70, 6, year, "lovePropensity", other.id);
          const core = addMemory(seed, self.id, year, self.mind, `married ${other.name} in ${year}`, "joy", other.id);
          if (core) applyCoreMemoryShift(seed, self.id, year, self.mind, "trust", 1);
          updateRelationship(self.mind, other.id, other.mind.values, 40, "spouse");
        }
      }
      record = { ...record, resultingEventIds };
      {
        const pushed = record.chosen === "arrange" || p >= RECORD_THRESHOLD || record.source === "forced";
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
  return leftVillageThisYear;
}

/** Present fines before the caller's social debug/filter pass, on the original dedicated key. */
export function presentLegacyLeyrwite<C extends VitalCandidate, Debug>(context: LegacyYearContext<C, Debug>, year: number): void {
  const { people, events } = context;
  const seed = context.config.seed;
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
}

function baseIllnessChance(age: number): number {
  if (age < 5) return 0.012;
  if (age < 50) return 0.007;
  if (age < 70) return 0.02;
  return 0.05;
}

/** Resolve only illness/death at their existing position in the sorted biology traversal.
 * The biology phase interleaves other biology kinds and the school event. Childbirth death remains
 * in the social apply loop, sharing the exact same survivor mechanics rather than a later pass.
 */
export function resolveLegacyVitalDecision<C extends VitalCandidate, Debug>(
  context: LegacyYearContext<C, Debug>,
  descriptor: C,
  year: number,
  forced: Override | undefined,
  minted: MintedId,
  illnessResultByPerson: Map<string, Event | undefined>,
  townEventId: string | undefined,
  townEvent: string | undefined,
): void {
  const { config, people, events, decisions, protagonistId, resolveBiologyDecision } = context;
  const seed = config.seed;
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
    const shockMultiplier = context.mortalityMultiplier(age, person.sex, socialClass);
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
  }
}

import { ageInYear, classMortalityMultiplier, deathProbabilityAtAge } from "./actuarial";
import type { MintedId } from "./decision-id";
import type { DecisionMaker, DecisionQuestion, DecisionRecord, DecisionSource, Distribution, PersonYearSituation } from "./decisions";
import { mapWithConcurrency } from "./concurrency";
import { decisionFragility, isSurprise, keyedDraw, normalizeDistribution, NOT_FRAGILE, sampleGumbelMax } from "./rng";
import { article } from "./narrate";
import type { Locale } from "./locale";
import { FALLBACK_CLASS } from "./period/classes";
import { ruleDistribution } from "./rule-heuristics";
import { storyCircle } from "./story-circle";
import type { Vignette } from "./vignettes";
import type { YearSnapshot } from "./types";
import type { Facet } from "./mind";
import { relationshipTargetId } from "./legacy-year-mechanics";
import { activeFeudPair, hasMovedAway, isAlive, pairKey, recentUnresolvedBreakup } from "./events";
import { commitId, conceptionProbability, dreamGoalSatisfiedBy, fertilityDampingFactor, levyClassMultiplier, mintId, overrideFor, pickAwayDestination, pushEvent, resolveCourtshipOnDeath, resolveWidowhood, school, spawnAwayPerson, spawnChild, spawnGentrySuitor, spawnImmigrant } from "./legacy-year-mechanics";
import { applyLifeTransition, ensureLifeState } from "./life-state";
import { addMemory, applyCoreMemoryShift, decayMindForYear, DREAM_GOALS, dreamGerund, pushThought, updateRelationship } from "./mind";
import { determineDeathCause, type MortalityContext } from "./mortality";
import { ARRANGED_GENTRY_MATCH_PROBABILITY, IMMIGRATION_ANNUAL_PROBABILITY, IMMIGRATION_ANNUAL_PROBABILITY_POST_PLAGUE, IMMIGRATION_POST_PLAGUE_END_YEAR, IMMIGRATION_POST_PLAGUE_YEAR, RETURN_HOME_PROBABILITY } from "./params/demography";
import { blackDeathMortalityForYear, datedNationalEventTypesForYear, isHundredYearsWarLevyYear, secondPestilenceMortalityForYear } from "./period/events";
import { isLeyrwiteEligible, isUnfree, manorialFinePayload, shouldPresentLeyrwite } from "./period/markers";
import type { Event, JsonValue, Job, Override, Person, Sex, SocialClass, WorldConfig } from "./types";
import type { DecisionOption } from "./decisions";

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

/** Aligned arrays are consumed by the synchronous ordered application phase. D1 stays speculative:
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

export interface LegacySocialApplyCandidate extends SocialCandidate {
  readonly opportunityJob?: string;
  readonly breakdownKind?: string;
  readonly townEventType?: string;
  readonly extra?: Record<string, JsonValue>;
}

/** The live outcome collector is structural: the kernel never imports simulate's catalog. */
export interface LegacySocialApplyContext<C extends LegacySocialApplyCandidate> {
  readonly config: WorldConfig;
  readonly people: Record<string, Person>;
  readonly events: Event[];
  readonly decisions: DecisionRecord[];
  readonly protagonistId: string | undefined;
  readonly marriageFunnelDebug: {
    y1WonDraw: number;
    readonly y1Outcomes: { encourage: number; decline: number; wait: number };
    romancesCreated: number;
    a1WonDraw: number;
    readonly a1Outcomes: { propose: number; delay: number; "end-it": number };
    married: number;
  } | undefined;
  readonly inMarriageFunnelCohort: (person: Person, startYear: number) => boolean;
  readonly optionLabel: (kind: string, optionId: string, selfName: string, otherName?: string, opportunityJob?: string, sex?: Sex) => string;
  readonly questionText: (locale: Locale, kind: string, otherName?: string, townName?: string, opportunityJob?: string, breakdownKind?: string, townEventType?: C["townEventType"]) => string;
}

/** Decision 051: maternal mortality per birth (research.md, "Maternal mortality" — Schofield 1986's Elizabethan 9.3/1000 anchor, ~0.9-1.0%; applied across the whole 1498-1558 window with low confidence, since the source is just after it). */
const MATERNAL_DEATH_PROBABILITY = 0.0095;

/** Apply every resolved candidate in INPUT order, never asynchronous completion order.
 * Own all effects here; catalog ports supply words only. Mint/sample/invariant/guard and
 * unconditional record/commit remain interleaved with births and immediate death cleanup.
 */
export function applyLegacySocialBatch<C extends LegacySocialApplyCandidate>(
  context: LegacySocialApplyContext<C>,
  output: LegacySocialBatchOutput<C>,
  townEventId: string | undefined,
): void {
  const { config, people, events, decisions, protagonistId, marriageFunnelDebug,
    inMarriageFunnelCohort, optionLabel, questionText } = context;
  const { year, socialCandidates, forcedFlags, fallbackFlags, batchable, resolved } = output;
  const seed = config.seed;
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
            // Decision 047's rule, for a branch it missed: a protagonist's choice that changes nothing
            // is still a story beat, so it gets a reflection instead of leaving the year silent.
            if (person.id === protagonistId) {
              const event = pushEvent(events, year, "reflection", [person.id], { note: "kept-chasing-a-dream", goal: person.mind.dream.goal }, []);
              resultingEventIds.push(event.id);
            }
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
}

export interface LegacyPublicationState {
  readonly people: Record<string, Person>;
  readonly events: Event[];
  readonly decisions: DecisionRecord[];
}

/** Publication is detached, not frozen; never clone the working registry between phases. */
export function captureLegacyYear(ownedPublicationState: LegacyPublicationState, year: number): YearSnapshot {
  const { people, events, decisions } = ownedPublicationState;
  return { year, people: structuredClone(people), events: structuredClone(events), decisions: structuredClone(decisions) };
}

/** Structural D1 catalog shape; the kernel has no dependency on simulate, even for types. */
export interface LegacyD1Descriptor {
  readonly decisionId: string;
  readonly kind: string;
  readonly personId: string;
  readonly partnerId?: string;
  readonly options: readonly string[];
  readonly extra?: Record<string, JsonValue>;
}

export interface LegacyFinalizeContext<TownEvent extends string = string> extends LegacyPublicationState {
  readonly config: WorldConfig;
  readonly counters: { decisionCalls: number };
  readonly originalOverrideYear: number;
  readonly options: LegacySocialBatchContext<SocialCandidate>["options"];
  readonly buildQuestion: (descriptor: LegacyD1Descriptor, year: number, config: WorldConfig, people: Record<string, Person>) => DecisionQuestion;
  readonly buildDailyLifeVignetteDescriptor: (person: Person, year: number, seed: string, people: Readonly<Record<string, Person>>, events: readonly Event[], townEvent: TownEvent | undefined) => LegacyDailyLifeCandidate<LegacyD1Descriptor>;
  readonly getVignetteForOption: (option: string) => Vignette | undefined;
  readonly optionLabel: LegacySocialApplyContext<LegacySocialApplyCandidate>["optionLabel"];
  readonly resolveSocialDecision: LegacySocialBatchContext<SocialCandidate>["resolveSocialDecision"];
}

/** Actual D1 selection, sampling, Mind effects and slot commit, not an outcome callback shell. */
async function resolveDailyLifeVignette<C extends LegacyD1Descriptor, TownEvent extends string>(
  context: LegacyFinalizeContext<TownEvent>,
  protagonist: Person,
  year: number,
  townEventType: TownEvent | undefined,
  overrides: readonly Override[],
  d1Candidates: readonly LegacyDailyLifeCandidate<C>[],
  finalVignetteWinner: string | undefined,
  preFetched?: ResolvedDecision,
): Promise<{ decision: DecisionRecord; wasRealCall: boolean }> {
  const { config, people, events, options: liveOptions, buildQuestion,
    buildDailyLifeVignetteDescriptor, getVignetteForOption, optionLabel, resolveSocialDecision } = context;
  const { decisionMaker, engineSource } = liveOptions;
  const seed = config.seed;
  const decisionId = `D1:${protagonist.id}:${year}`;
  const forced = overrideFor(overrides, "D1", protagonist.id, year === context.originalOverrideYear);

  let vignette: Vignette;
  let deciderId: string;
  if (forced) {
    // Forced option ownership takes precedence over the speculative winner.
    vignette = getVignetteForOption(forced.optionId) ?? d1Candidates[0]?.vignette ?? buildDailyLifeVignetteDescriptor(protagonist, year, seed, people, events, townEventType).vignette;
    deciderId = vignette.decidedByParent ? (relationshipTargetId("parent", protagonist, people) ?? protagonist.id) : protagonist.id;
  } else {
    const winner = finalVignetteWinner ? d1Candidates.find((c) => c.descriptor.decisionId === finalVignetteWinner) : undefined;
    if (winner) {
      vignette = winner.vignette;
      deciderId = winner.deciderId;
    } else {
      const picked = buildDailyLifeVignetteDescriptor(protagonist, year, seed, people, events, townEventType);
      vignette = picked.vignette;
      deciderId = picked.deciderId;
    }
  }

  const options = Object.keys(vignette.outcomes);
  const descriptor: LegacyD1Descriptor = {
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
  // Credit the parent decider, but the protagonist lives the thought, memory and relationship.
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
  // Mint the protagonist's slot even when a parent made the call; occurrence is unconditional.
  const minted = mintId(people, "D1", protagonist.id, year);
  commitId(people, events, protagonist.id, minted, true);
  const decision: DecisionRecord = {
    id: minted.id,
    personId: deciderId,
    partnerId: descriptor.partnerId,
    year,
    kind: "D1",
    // Persist English model-facing text; reader-facing narration is localized separately.
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

/** The quiet-year guard runs after all outcomes, then publishes their CURRENT complete state. */
export async function finalizeLegacyYear<C extends LegacyD1Descriptor, TownEvent extends string>(
  context: LegacyFinalizeContext<TownEvent>,
  batchOutput: LegacySocialBatchOutput<C>,
  townEvent: TownEvent | undefined,
  overrides: readonly Override[],
): Promise<YearSnapshot> {
  const { people, events, decisions, counters, options } = context;
  const { year, d1Candidates, resultByDecisionId, finalVignetteWinner } = batchOutput;
  if (options.protagonistId) {
    const protagonist = people[options.protagonistId];
    if (protagonist && (protagonist.deathYear === undefined || protagonist.deathYear === year)) {
      const hasOwnEventThisYear = events.some((e) => e.year === year && e.actors.includes(protagonist.id));
      if (!hasOwnEventThisYear) {
        const preFetched = finalVignetteWinner ? resultByDecisionId.get(finalVignetteWinner) : undefined;
        const { decision, wasRealCall } = await resolveDailyLifeVignette(context, protagonist, year, townEvent, overrides, d1Candidates, finalVignetteWinner, preFetched);
        decisions.push(decision);
        if (wasRealCall) counters.decisionCalls += 1;
      }
    }
  }
  return captureLegacyYear(context, year);
}

export type LegacyRunContext<C extends LegacySocialApplyCandidate, Debug> =
  LegacySocialBatchContext<C, NonNullable<C["townEventType"]>> & LegacySocialApplyContext<C> &
  LegacyFinalizeContext<NonNullable<C["townEventType"]>> & {
    readonly debug: Debug | undefined;
    readonly protagonistId: string | undefined;
    readonly captureCandidates: (year: number, debug: Debug | undefined) => C[];
    readonly resolveBiologyDecision: LegacyYearContext<C, Debug>["resolveBiologyDecision"];
    readonly townEventForYear: (seed: string, year: number) => NonNullable<C["townEventType"]> | undefined;
    readonly mortalityMultiplier: (townEvent: NonNullable<C["townEventType"]> | undefined, age: number, sex: Sex, socialClass: SocialClass) => number;
    readonly isSocialKind: (kind: string) => boolean;
    readonly overrides: readonly Override[];
  };

/** Borrow the same live registry/logs/options/counter/debug; own the actual ordered annual phases. */
export async function runLegacyYear<C extends LegacySocialApplyCandidate, Debug>(
  context: LegacyRunContext<C, Debug>,
  year: number,
): Promise<YearSnapshot> {
  // Lookup stays AFTER decay/capture/partition, as before. The closure binds THIS year's shock.
  const yearContext: LegacyYearContext<C, Debug> = {
    ...context,
    get optionsProtagonistId() { return context.options.protagonistId; },
    captureCandidates: (debug) => context.captureCandidates(year, debug),
    mortalityMultiplier: (age, sex, socialClass) => context.mortalityMultiplier(townEvent, age, sex, socialClass),
  };
  const candidates = beginLegacyYear(yearContext);
  const biologyCandidates = candidates.filter((c) => c.kind === "illness" || c.kind === "death" || c.kind === "immigration" || c.kind === "levy" || c.kind === "away-arrival" || c.kind === "return" || c.kind === "arranged-match");
  // D1 is speculative in batches but has its dedicated quiet-year application, not generic apply.
  const pendingSocialCandidates = candidates.filter((c) => context.isSocialKind(c.kind) && c.kind !== "D1");
  const townEvent = context.townEventForYear(context.config.seed, year);
  const townEventId = emitLegacyYearShocks(yearContext, year, townEvent);
  const leftVillageThisYear = resolveLegacyBiology(yearContext, year, biologyCandidates, context.overrides, townEvent, townEventId);
  presentLegacyLeyrwite(yearContext, year);
  const output = await resolveLegacySocialBatch(context, year, pendingSocialCandidates, context.overrides, leftVillageThisYear, townEvent);
  applyLegacySocialBatch(context, output, townEventId);
  return finalizeLegacyYear(context, output, townEvent, context.overrides);
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

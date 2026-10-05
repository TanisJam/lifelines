import { ageInYear, classMortalityMultiplier, deathProbabilityAtAge } from "./actuarial";
import type { MintedId } from "./decision-id";
import type { DecisionRecord } from "./decisions";
import { activeFeudPair, hasMovedAway } from "./events";
import { commitId, pushEvent, resolveCourtshipOnDeath, resolveWidowhood } from "./legacy-year-mechanics";
import { decayMindForYear } from "./mind";
import { determineDeathCause, type MortalityContext } from "./mortality";
import { blackDeathMortalityForYear, secondPestilenceMortalityForYear } from "./period/events";
import { isUnfree, manorialFinePayload } from "./period/markers";
import type { Event, JsonValue, Override, Person, Sex, SocialClass, WorldConfig } from "./types";

const RECORD_THRESHOLD = 0.05;

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

function baseIllnessChance(age: number): number {
  if (age < 5) return 0.012;
  if (age < 50) return 0.007;
  if (age < 70) return 0.02;
  return 0.05;
}

/** Resolve only illness/death at their existing position in the sorted biology traversal.
 * The caller still interleaves other biology kinds and the school event. Childbirth death remains
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

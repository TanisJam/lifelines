import type { BranchInfo, Chronicle, ChronicleEntry, EntryLevel, LifeScene, LifeSex, PersonLink, PersonSheet, ProtagonistInfo, Turn, TurnOption } from "@/contracts/life";
import { ageInYear } from "@/domain/actuarial";
import { isRealTurn } from "@/domain/chronicle-view";
import type { DecisionRecord } from "@/domain/decisions";
import { eventTimes } from "@/domain/month";
import { DEFAULT_LOCALE, type Locale } from "@/domain/locale";
import { DEATH_CAUSE_PHRASE, type DeathCause } from "@/domain/mortality";
import { renderPortrait } from "@/domain/mind";
import { deathCauseDisplay, familyRelation, lifeSummary, narratePersonTimeline, type NarratedEvent } from "@/domain/narrate";
import type { Event, Person } from "@/domain/types";
import { causeNounPhrase } from "@/server/chronicle-data";
import { getDecisionMaker } from "@/server/decision-engine";
import { sceneForBranch } from "@/server/life-scene";
import { getLatestBranch, getLifeBranch, listLifeBranches } from "@/server/life-store";

const PROTAGONIST_ID = "protagonist";

/** Kinds that read as "a major life event without an editable choice" (ui-ux-handoff.md §7, level 2) when they don't already carry a real turn. */
const LEVEL_2_KINDS = new Set(["marriage", "breakdown", "town", "levy", "dream"]);

const CHANCE_KINDS = new Set(["illness", "death", "immigration"]);

function markLinks(text: string, candidateIds: readonly string[], people: Readonly<Record<string, Person>>, excludeId: string): { text: string; links: PersonLink[] } {
  const links: PersonLink[] = [];
  let marked = text;
  for (const id of new Set(candidateIds)) {
    if (id === excludeId) continue;
    const person = people[id];
    if (!person || !marked.includes(person.name)) continue;
    marked = marked.split(person.name).join(`{{${id}}}`);
    links.push({ personId: id, name: person.name });
  }
  return { text: marked, links };
}

function deciderFor(decision: DecisionRecord, people: Readonly<Record<string, Person>>, protagonistSex: LifeSex): { decidedBy: string; deciderId: string } {
  if (decision.kind === "levy") return { decidedBy: "The lord's demand", deciderId: "lord" };
  if (CHANCE_KINDS.has(decision.kind)) return { decidedBy: "Chance", deciderId: "chance" };
  if (decision.personId === PROTAGONIST_ID) return { decidedBy: protagonistSex === "f" ? "Her choice" : "His choice", deciderId: "self" };
  const person = people[decision.personId];
  return { decidedBy: person ? `${person.name}'s choice` : "Their choice", deciderId: decision.personId };
}

function whyPhraseFor(decision: DecisionRecord, deciderId: string, people: Readonly<Record<string, Person>>, protagonistSex: LifeSex): string {
  if (decision.source === "forced") return "This is how it happened, after the change.";
  const chance = deciderId === "chance" || deciderId === "lord";
  const pronoun = deciderId === "self" ? (protagonistSex === "f" ? "She" : "He") : chance ? "It" : (people[deciderId]?.sex ?? "f") === "f" ? "She" : "He";
  if (decision.surprise) return chance ? "It could easily have gone otherwise." : `${pronoun} could easily have chosen otherwise.`;
  if (!chance && decision.fragility < 1) return `${pronoun} almost chose otherwise.`;
  const chosenProb = decision.final[decision.chosen] ?? 0;
  if (chosenProb >= 0.9) return "There was little doubt about it.";
  return chance ? "The odds were real, either way." : "It was a real choice, weighed carefully.";
}

function buildTurn(decision: DecisionRecord, people: Readonly<Record<string, Person>>, protagonistSex: LifeSex): Turn {
  const options: TurnOption[] = decision.options.map((o) => ({ optionId: o.id, label: o.label }));
  const chosen = options.find((o) => o.optionId === decision.chosen) ?? options[0]!;
  const alternatives = options.filter((o) => o.optionId !== decision.chosen);
  const { decidedBy, deciderId } = deciderFor(decision, people, protagonistSex);
  return {
    decisionId: decision.id,
    decidedBy,
    deciderId,
    chosen,
    alternatives,
    whyPhrase: whyPhraseFor(decision, deciderId, people, protagonistSex),
    probabilities: decision.final,
    occurrenceProbability: decision.occurrenceProbability,
  };
}

function levelFor(event: Event, decision: DecisionRecord | undefined, isProtagonistDeath: boolean, significance: number): EntryLevel {
  if (isProtagonistDeath) return 3;
  if (decision && isRealTurn(decision)) return 3;
  // Decision 042: a `D1` everyday-life vignette is level 1 by default, and level 3 (a turn) only
  // when it passes `isRealTurn` above — never bumped to level 2 by significance the way other kinds
  // can be, so an ordinary year doesn't masquerade as "a major event without an editable choice".
  if (event.kind === "vignette") return 1;
  if (LEVEL_2_KINDS.has(event.kind)) return 2;
  if (event.kind === "death") return 2; // a family member's death, not the protagonist's own
  if (event.kind === "birth" && event.actors[0] !== PROTAGONIST_ID) return 2; // a child is born
  if (significance >= 0.75) return 2;
  return 1;
}

function buildEpilogue(protagonist: Person, people: Readonly<Record<string, Person>>, townName: string): string[] {
  const lines: string[] = [];
  if (protagonist.spouseId) {
    const spouse = people[protagonist.spouseId];
    if (spouse && spouse.deathYear === undefined) lines.push(`${spouse.name} lived on in ${townName}, after ${protagonist.sex === "f" ? "her" : "his"} passing.`);
  }
  const livingChildren = Object.values(people).filter((c) => (c.motherId === protagonist.id || c.fatherId === protagonist.id) && c.deathYear === undefined);
  if (livingChildren.length > 0) lines.push(livingChildren.length === 1 ? "One child carried the family name forward." : `${livingChildren.length} children carried the family name forward.`);
  return lines;
}

function buildCast(protagonist: Person, people: Readonly<Record<string, Person>>): Chronicle["cast"] {
  const cast: { personId: string; name: string; relation: string }[] = [];
  const seen = new Set<string>();
  const push = (id: string | undefined, relation: string) => {
    if (!id || seen.has(id) || !people[id]) return;
    seen.add(id);
    cast.push({ personId: id, name: people[id]!.name, relation });
  };
  if (protagonist.spouseId) push(protagonist.spouseId, familyRelation(protagonist, people[protagonist.spouseId]!) ?? "spouse");
  push(protagonist.motherId, "mother");
  push(protagonist.fatherId, "father");
  for (const person of Object.values(people)) {
    if (person.motherId === protagonist.id || person.fatherId === protagonist.id) push(person.id, person.sex === "m" ? "son" : "daughter");
  }
  for (const rel of protagonist.mind.relationships) push(rel.personId, rel.bond);
  return cast;
}

/**
 * One narrated event → one `ChronicleEntry` (round 9 `buildLifeChronicle`'s original inline
 * `.map()` body, extracted round 13 — incremental-simulation capability — so live SSE ticks and
 * the authoritative chronicle share this exact transform instead of two copies drifting apart).
 */
function buildEntryFromNarrated(
  narrated: NarratedEvent,
  events: readonly Event[],
  people: Readonly<Record<string, Person>>,
  decisionByEventId: ReadonlyMap<string, DecisionRecord>,
  protagonistId: string,
  protagonistSex: LifeSex,
  timeline: readonly NarratedEvent[],
  times: ReadonlyMap<string, number>,
  sceneIds: ReadonlySet<string>,
): ChronicleEntry {
  const { event, title, prose, significance } = narrated;
  const decision = decisionByEventId.get(event.id);
  const isProtagonistDeath = event.kind === "death" && event.actors[0] === protagonistId;
  const { text: markedProse, links } = markLinks(prose, event.actors, people, protagonistId);

  const causeEvent = event.causes
    .map((id) => events.find((e) => e.id === id))
    .find((e): e is Event => !!e && e.year < event.year);
  const causePhrase = causeEvent ? causeNounPhrase(causeEvent, protagonistId, people) : null;
  const cause = causePhrase ? { entryId: timeline.some((t) => t.event.id === causeEvent!.id) ? causeEvent!.id : undefined, phrase: causePhrase, year: causeEvent!.year } : undefined;

  const turn = decision && (isProtagonistDeath || isRealTurn(decision)) ? buildTurn(decision, people, protagonistSex) : undefined;

  return {
    id: event.id,
    year: event.year,
    level: levelFor(event, decision, isProtagonistDeath, significance),
    kind: event.kind,
    title,
    prose: markedProse,
    links,
    cause,
    turn,
    at: times.get(event.id) ?? event.year,
    who: event.actors.filter((id) => sceneIds.has(id)),
  };
}

/**
 * Incremental-simulation capability, design decision 9: provisional per-year tick entries for
 * live SSE — narrated with heuristic significance ONLY (no `decisionMaker` passed to
 * `narratePersonTimeline`, so its `significance()` — the Jev call — never runs mid-simulation).
 * The authoritative chronicle, built once the life has ended via `buildLifeChronicle` (which DOES
 * pass `getDecisionMaker()`), is what `done` carries; these entries are a fast preview only.
 */
export async function buildProvisionalTickEntries(
  protagonistId: string,
  year: number,
  events: readonly Event[],
  people: Readonly<Record<string, Person>>,
  decisions: readonly DecisionRecord[],
  protagonistSex: LifeSex,
  seed: string,
  townName: string,
  locale: Locale,
  scene: LifeScene,
): Promise<ChronicleEntry[]> {
  const yearEvents = events.filter((e) => e.year === year);
  const timeline = await narratePersonTimeline(protagonistId, events, people, undefined, 8, seed, townName, locale, yearEvents);

  const decisionByEventId = new Map<string, DecisionRecord>();
  for (const decision of decisions) for (const eventId of decision.resultingEventIds) decisionByEventId.set(eventId, decision);

  // Months only depend on a year's own events, so times from this year alone match the final chronicle's.
  const times = eventTimes(seed, yearEvents, protagonistId);
  const sceneIds = new Set(scene.people.map((p) => p.id));
  return timeline.map((narrated) => buildEntryFromNarrated(narrated, events, people, decisionByEventId, protagonistId, protagonistSex, timeline, times, sceneIds));
}

export interface ChronicleResult {
  readonly data?: Chronicle;
  readonly error?: string;
  readonly status?: 404 | 500;
}

/**
 * Assembles the contract's `Chronicle` for one life/branch (round 9, decision 034) — the
 * protagonist-only counterpart to `chronicle-data.ts#getChronicleData`. Reuses every reusable
 * piece (`narratePersonTimeline`, `causeNounPhrase`, `lifeSummary`, `familyRelation`) rather than
 * re-deriving prose from scratch, and adds: `{{personId}}` link marking, `Turn` construction from
 * `DecisionRecord`s (with the protagonist's death forced to level 3 regardless of `isRealTurn`),
 * and deterministic period summaries for quiet stretches.
 */
/**
 * Decision 059: `locale` defaults to English (byte-identical to this function's pre-059 behavior)
 * and flows into every narration call below — the reader-facing prose/title/summary re-derive fresh
 * from structured events per the requested locale, exactly like the pre-059 English-only path did
 * for a single implicit locale. `error` strings below stay English regardless (a small, disclosed
 * gap — see docs/decisions.md's "059" entry): they're operational/debug text, not narrative prose.
 */
export async function buildLifeChronicle(lifeId: string, branchIdParam?: string, locale: Locale = DEFAULT_LOCALE): Promise<ChronicleResult> {
  const branch = branchIdParam ? getLifeBranch(lifeId, branchIdParam) : getLatestBranch(lifeId);
  if (!branch) return { error: "Life not found.", status: 404 };

  const people = branch.result.people;
  const protagonist = people[PROTAGONIST_ID];
  if (!protagonist) return { error: "Protagonist not found in this life.", status: 500 };
  if (protagonist.deathYear === undefined) return { error: "This life has not yet ended.", status: 500 };

  const townName = branch.result.config.town.name;
  const seed = branch.result.config.seed;
  const events = branch.result.events;
  const decisions = branch.result.decisions;

  const decisionByEventId = new Map<string, DecisionRecord>();
  for (const decision of decisions) for (const eventId of decision.resultingEventIds) decisionByEventId.set(eventId, decision);

  const timeline = await narratePersonTimeline(PROTAGONIST_ID, events, people, getDecisionMaker(), 8, seed, townName, locale);

  const deathEvent = events.find((e) => e.kind === "death" && e.actors[0] === PROTAGONIST_ID);
  const causeCode = deathEvent && typeof deathEvent.payload.cause === "string" ? (deathEvent.payload.cause as DeathCause) : undefined;
  const causeOfDeath = causeCode && causeCode in DEATH_CAUSE_PHRASE ? deathCauseDisplay(locale, causeCode) : locale === "es" ? "mala fortuna" : "misfortune";

  const scene = sceneForBranch(branch);
  const times = eventTimes(seed, events, PROTAGONIST_ID);
  const sceneIds = new Set(scene.people.map((p) => p.id));
  const entries: ChronicleEntry[] = timeline.map((narrated) => buildEntryFromNarrated(narrated, events, people, decisionByEventId, PROTAGONIST_ID, protagonist.sex, timeline, times, sceneIds));

  // Decision 042 supersedes decision 038's period-summary rule for the protagonist: `simulate.ts`
  // now guarantees at least one event per year of their life (the `D1` everyday-life vignette,
  // when nothing else happened), so a multi-year "quiet years passed" gap can no longer occur here
  // — sorting by year is all that's left to do.
  const sorted = [...entries].sort((a, b) => a.year - b.year);

  const summaryRaw = lifeSummary(protagonist, people, events, townName, locale);
  const { text: summary, links: summaryLinks } = markLinks(summaryRaw, Object.keys(people), people, PROTAGONIST_ID);

  const protagonistInfo: ProtagonistInfo = {
    name: protagonist.name,
    sex: protagonist.sex,
    birthYear: protagonist.birthYear,
    deathYear: protagonist.deathYear,
    ageAtDeath: ageInYear(protagonist.birthYear, protagonist.deathYear),
    causeOfDeath,
  };

  const branches: BranchInfo[] = listLifeBranches(lifeId).map((b) => ({
    branchId: b.id,
    label: b.label,
    parentBranchId: b.parentBranchId ?? null,
    forkYear: b.forkYear ?? null,
  }));

  const chronicle: Chronicle = {
    lifeId,
    branchId: branch.id,
    villageName: townName,
    protagonist: protagonistInfo,
    summary,
    summaryLinks,
    epilogue: buildEpilogue(protagonist, people, townName),
    entries: sorted,
    branches,
    cast: buildCast(protagonist, people),
    scene,
  };

  return { data: chronicle };
}

export interface PersonSheetResult {
  readonly data?: PersonSheet;
  readonly error?: string;
  readonly status?: 404 | 500;
}

/** `GET /api/lives/:lifeId/people/:personId?branchId=` — a read-only side sheet, from the protagonist's point of view. */
export async function buildPersonSheet(lifeId: string, personId: string, branchIdParam?: string, locale: Locale = DEFAULT_LOCALE): Promise<PersonSheetResult> {
  const branch = branchIdParam ? getLifeBranch(lifeId, branchIdParam) : getLatestBranch(lifeId);
  if (!branch) return { error: "Life not found.", status: 404 };

  const people = branch.result.people;
  const protagonist = people[PROTAGONIST_ID];
  const person = people[personId];
  if (!protagonist || !person) return { error: "Person not found.", status: 404 };

  const relation =
    personId === PROTAGONIST_ID
      ? "self"
      : (familyRelation(protagonist, person) ?? protagonist.mind.relationships.find((r) => r.personId === personId)?.bond ?? "acquaintance");

  const timeline = await narratePersonTimeline(personId, branch.result.events, people, getDecisionMaker(), 8, branch.result.config.seed, branch.result.config.town.name, locale);
  const moments = [...timeline]
    .sort((a, b) => b.significance - a.significance)
    .slice(0, 5)
    .sort((a, b) => a.event.year - b.event.year)
    .map((t) => ({ year: t.event.year, title: t.title }));

  return {
    data: {
      personId,
      name: person.name,
      relation,
      birthYear: person.birthYear,
      deathYear: person.deathYear ?? null,
      job: person.job !== "none" ? person.job : null,
      blurb: renderPortrait(person.name, person.mind, (id) => people[id]?.name ?? id),
      moments,
    },
  };
}

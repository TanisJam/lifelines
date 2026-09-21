import type { BranchInfo, Chronicle, ChronicleEntry, EntryLevel, LifeSex, PersonLink, PersonSheet, ProtagonistInfo, Turn, TurnOption } from "@/contracts/life";
import { ageInYear } from "@/domain/actuarial";
import { isRealTurn } from "@/domain/chronicle-view";
import type { DecisionRecord } from "@/domain/decisions";
import { DEATH_CAUSE_PHRASE, type DeathCause } from "@/domain/mortality";
import { renderPortrait } from "@/domain/mind";
import { article, familyRelation, lifeSummary, narratePersonTimeline } from "@/domain/narrate";
import type { Event, EventKind, Job, Person } from "@/domain/types";
import { causeNounPhrase } from "@/server/chronicle-data";
import { getDecisionMaker } from "@/server/decision-engine";
import { getLatestBranch, getLifeBranch, listLifeBranches, type LifeBranchRecord } from "@/server/life-store";

const PROTAGONIST_ID = "protagonist";

/** A gap of at least this many years with no protagonist chronicle entry becomes one `period` summary. */
const PERIOD_GAP_THRESHOLD_YEARS = 5;

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
  };
}

function levelFor(event: Event, decision: DecisionRecord | undefined, isProtagonistDeath: boolean, significance: number): EntryLevel {
  if (isProtagonistDeath) return 3;
  if (decision && isRealTurn(decision)) return 3;
  if (LEVEL_2_KINDS.has(event.kind)) return 2;
  if (event.kind === "death") return 2; // a family member's death, not the protagonist's own
  if (event.kind === "birth" && event.actors[0] !== PROTAGONIST_ID) return 2; // a child is born
  if (significance >= 0.75) return 2;
  return 1;
}

/** A flavor noun for where each trade's day-to-day work happens — used to give a working-years period title some texture instead of just naming the job. */
const JOB_PLACE_NOUN: Partial<Record<Job, string>> = {
  blacksmith: "the forge",
  healer: "the healer's house",
  merchant: "the trading post",
  scholar: "the scriptorium",
  guard: "the watch",
  fisher: "the docks",
  innkeeper: "the inn",
  weaver: "the loom",
  farmer: "the fields",
};

/** The place name to use for a given year: the destination name once away (decision 040's move-away payload may carry the one-time "Name, a kind" introduction — this strips it back to the bare name for a repeat reference), the home town otherwise. */
function placeNameAt(events: readonly Event[], year: number, homeTownName: string): string {
  const moves = events
    .filter((e) => e.kind === "move" && e.actors[0] === PROTAGONIST_ID && e.year <= year)
    .sort((a, b) => b.year - a.year);
  const last = moves[0];
  if (last && last.payload.away === true) {
    const destination = typeof last.payload.destination === "string" ? last.payload.destination : "a distant town";
    return destination.split(",")[0]!.trim();
  }
  return homeTownName;
}

/**
 * A narrative title for a quiet stretch (decision 040 fix — the reported bug: a bare "1519–1580"
 * with nothing behind it). Deterministic from the protagonist's life stage, trade and place at the
 * stretch's START, never the year range itself.
 */
function periodTitle(startAge: number, job: Job, placeName: string): string {
  if (startAge < 6) return `Early childhood in ${placeName}`;
  if (startAge < 13) return `Childhood in ${placeName}`;
  if (startAge < 20) return `Youth in ${placeName}`;
  if (job !== "none") return `Years at ${JOB_PLACE_NOUN[job] ?? "the trade"} in ${placeName}`;
  if (startAge >= 60) return `Old age in ${placeName}`;
  return `Quiet years in ${placeName}`;
}

/** One extra sentence built from whichever low-significance event kinds actually happened during the gap (dropped from the main timeline for being too quiet to stand alone on their own) — deterministic on presence, not narrated per-event, to stay template-based (decision 001). */
function periodDetailSentence(stretchEvents: readonly Event[], subject: string): string {
  const kindOrder: readonly EventKind[] = ["illness", "job", "feud", "breakdown", "dream", "reflection", "town"];
  const present = kindOrder.find((k) => stretchEvents.some((e) => e.kind === k));
  if (!present) return "";
  const possessive = subject === "she" ? "her" : "his";
  const phrase: Partial<Record<EventKind, string>> = {
    illness: "a spell of illness came and went",
    job: `${possessive} trade shifted a little, without much notice`,
    feud: "a quarrel or two flared and cooled",
    breakdown: "the weight of it all pressed hard for a time",
    dream: "old hopes stirred and settled again",
    reflection: `${subject} kept mostly to ${possessive} own thoughts`,
    town: "the town had its own small troubles",
  };
  const text = phrase[present];
  return text ? ` Otherwise, ${text}.` : "";
}

function buildPeriodEntry(startYear: number, endYear: number, branch: LifeBranchRecord, townName: string, events: readonly Event[]): ChronicleEntry | undefined {
  const snapshot = branch.snapshots.get(startYear) ?? branch.snapshots.get(startYear - 1);
  const protagonist = snapshot?.people[PROTAGONIST_ID];
  if (!protagonist) return undefined;
  const span = endYear - startYear + 1;
  const subject = protagonist.sex === "f" ? "she" : "he";
  const startAge = ageInYear(protagonist.birthYear, startYear);
  const placeName = placeNameAt(events, startYear, townName);
  const jobPhrase = protagonist.job !== "none" ? `, working as ${article(protagonist.job)} ${protagonist.job}` : "";
  const spouse = protagonist.spouseId ? snapshot!.people[protagonist.spouseId] : undefined;
  const links: PersonLink[] = [];
  let marriedPhrase = "";
  if (spouse) {
    marriedPhrase = `, married to {{${spouse.id}}}`;
    links.push({ personId: spouse.id, name: spouse.name });
  }
  const stretchEvents = events.filter((e) => e.year >= startYear && e.year <= endYear && e.actors.includes(PROTAGONIST_ID));
  return {
    id: `period:${startYear}-${endYear}`,
    year: startYear,
    endYear,
    level: 1,
    kind: "period",
    title: periodTitle(startAge, protagonist.job, placeName),
    prose: `${span} quiet year${span === 1 ? "" : "s"} passed in ${placeName}${jobPhrase ? `; ${subject}${jobPhrase}` : ""}${marriedPhrase}.${periodDetailSentence(stretchEvents, subject)}`,
    links,
  };
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
export async function buildLifeChronicle(lifeId: string, branchIdParam?: string): Promise<ChronicleResult> {
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

  const timeline = await narratePersonTimeline(PROTAGONIST_ID, events, people, getDecisionMaker(), 8, seed, townName);

  const deathEvent = events.find((e) => e.kind === "death" && e.actors[0] === PROTAGONIST_ID);
  const causeCode = deathEvent && typeof deathEvent.payload.cause === "string" ? (deathEvent.payload.cause as DeathCause) : undefined;
  const causeOfDeath = causeCode && causeCode in DEATH_CAUSE_PHRASE ? DEATH_CAUSE_PHRASE[causeCode] : "misfortune";

  const entries: ChronicleEntry[] = timeline.map(({ event, title, prose, significance }) => {
    const decision = decisionByEventId.get(event.id);
    const isProtagonistDeath = event.kind === "death" && event.actors[0] === PROTAGONIST_ID;
    const { text: markedProse, links } = markLinks(prose, event.actors, people, PROTAGONIST_ID);

    const causeEvent = event.causes
      .map((id) => events.find((e) => e.id === id))
      .find((e): e is Event => !!e && e.year < event.year);
    const causePhrase = causeEvent ? causeNounPhrase(causeEvent, PROTAGONIST_ID, people) : null;
    const cause = causePhrase ? { entryId: timeline.some((t) => t.event.id === causeEvent!.id) ? causeEvent!.id : undefined, phrase: causePhrase, year: causeEvent!.year } : undefined;

    const turn = decision && (isProtagonistDeath || isRealTurn(decision)) ? buildTurn(decision, people, protagonist.sex) : undefined;

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
    };
  });

  const sorted = [...entries].sort((a, b) => a.year - b.year);
  const withPeriods: ChronicleEntry[] = [];
  for (let i = 0; i < sorted.length; i++) {
    withPeriods.push(sorted[i]!);
    const next = sorted[i + 1];
    if (!next) continue;
    const gapStart = sorted[i]!.year + 1;
    const gapEnd = next.year - 1;
    if (gapEnd - gapStart + 1 >= PERIOD_GAP_THRESHOLD_YEARS) {
      const period = buildPeriodEntry(gapStart, gapEnd, branch, townName, events);
      if (period) withPeriods.push(period);
    }
  }
  withPeriods.sort((a, b) => a.year - b.year);

  const summaryRaw = lifeSummary(protagonist, people, events, townName);
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
    entries: withPeriods,
    branches,
    cast: buildCast(protagonist, people),
  };

  return { data: chronicle };
}

export interface PersonSheetResult {
  readonly data?: PersonSheet;
  readonly error?: string;
  readonly status?: 404 | 500;
}

/** `GET /api/lives/:lifeId/people/:personId?branchId=` — a read-only side sheet, from the protagonist's point of view. */
export async function buildPersonSheet(lifeId: string, personId: string, branchIdParam?: string): Promise<PersonSheetResult> {
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

  const timeline = await narratePersonTimeline(personId, branch.result.events, people, getDecisionMaker(), 8, branch.result.config.seed, branch.result.config.town.name);
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

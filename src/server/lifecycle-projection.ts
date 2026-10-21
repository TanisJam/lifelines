/**
 * Read-side projection for new-engine lives (RI1b, spec S8): a trusted, FULLY REGENERATED lifecycle
 * capsule becomes the view model the existing routes already render.
 *
 * DERIVED VIEW ONLY — NEVER AUTHORITY. A projection is never persisted, stored, cached or read
 * back as truth, and no caller may treat one as a certificate of what happened. Authority is the
 * lifecycle capsule: cold admission and full replay of that capsule (the repository's `load`, the
 * capsule module's admission) regenerate every year and refuse a payload that disagrees. This
 * module is deliberately handed only the regenerated pair (`genesis`, `output`) and no manifest or
 * digest, so it cannot verify, recompute or defer to one: it maps what admission already produced.
 * A projection of a source that regeneration would refuse is therefore worth nothing as evidence.
 *
 * PURE and DETERMINISTIC. No I/O, no database, no clock, no randomness, no global state, no
 * caching, and the input is never mutated or frozen. Every helper it calls is a pure domain or
 * pure server derivation: narration is the deterministic (no decision-adapter) path, months are
 * seeded, the scene tracker is an in-memory builder, and `life-chronicle`/`life-scene` are read
 * only for those pure builders — no store, no database and no adapter is reached from here.
 *
 * Ordering follows the trusted output's own traversal order. Events are consumed in the trusted log
 * order and journal years in the trusted journal order; the only ordering applied is the app's own
 * view rule (narrated entries ordered by the moment derived from `(seed, events)`, stable for
 * ties), reused from `life-chronicle`.
 */
import type { Chronicle, ChronicleEntry, LifeScene, PersonLink, PersonSheet, ProtagonistInfo } from "@/contracts/life";
import type { LifecycleProjection, LifecycleTickView, LifecycleViewGap, LifecycleViewIdentity } from "@/contracts/lifecycle";
import { ageInYear } from "@/domain/actuarial";
import type { DecisionRecord } from "@/domain/decisions";
import type { LifecycleCapsule } from "@/domain/e-lifecycle-capsule";
import { LIFECYCLE_GENESIS_VERSIONS } from "@/domain/e-lifecycle-genesis";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@/domain/locale";
import { renderPortrait } from "@/domain/mind";
import { DEATH_CAUSE_PHRASE, type DeathCause } from "@/domain/mortality";
import { deathCauseDisplay, familyRelation, lifeSummary, narratePersonTimeline } from "@/domain/narrate";
import { deriveLifeScene } from "@/domain/scene";
import type { Event, Person, WorldConfig, YearSnapshot } from "@/domain/types";
import { buildEpilogue, buildProvisionalTickEntries, finishAtDeath } from "./life-chronicle";
import { createSceneTracker } from "./life-scene";

/**
 * The trusted pair a projection accepts. Deliberately narrower than `LifecycleCapsule`: no
 * manifest and no digest, because a projection never checks, recomputes or trusts one. `genesis`
 * supplies the immutable world origin (seed, town name) that the output does not repeat; both are
 * produced by the same regeneration, so neither is a second source of truth.
 */
export interface LifecycleProjectionSource {
  readonly genesis: LifecycleCapsule["genesis"];
  readonly output: LifecycleCapsule["output"];
}

export interface ProjectLifecycleChronicleInput {
  readonly source: LifecycleProjectionSource;
  /** The route's own identity; copied verbatim, never derived and never authoritative. */
  readonly identity: LifecycleViewIdentity;
  readonly locale?: Locale;
}

export interface ProjectLifecycleTickInput {
  readonly source: LifecycleProjectionSource;
  /** One regenerated journal year — the year this tick reports. */
  readonly year: number;
  readonly locale?: Locale;
}

export interface ProjectLifecyclePersonSheetInput {
  readonly source: LifecycleProjectionSource;
  readonly personId: string;
  readonly locale?: Locale;
}

export interface ProjectLifecycleProtagonistInput {
  readonly source: LifecycleProjectionSource;
  readonly locale?: Locale;
}

interface TrustedYear {
  readonly year: number;
  readonly snapshot: YearSnapshot;
}

interface Trusted {
  readonly genesis: LifecycleCapsule["genesis"];
  readonly output: LifecycleCapsule["output"];
  readonly config: WorldConfig;
  readonly people: Readonly<Record<string, Person>>;
  readonly events: readonly Event[];
  readonly decisions: readonly DecisionRecord[];
  readonly protagonistId: string;
  readonly protagonist: Person;
  readonly journal: readonly TrustedYear[];
}

// --- Admission -----------------------------------------------------------------------------------

function fail(message: string): never {
  throw new Error(`Lifecycle projection: ${message}`);
}

function requireRecord(value: unknown, what: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(`${what} must be a plain record`);
  return value as Record<string, unknown>;
}

function requireArray(value: unknown, what: string): readonly unknown[] {
  if (!Array.isArray(value)) fail(`${what} must be an array`);
  return value as readonly unknown[];
}

function requireText(value: unknown, what: string): string {
  if (typeof value !== "string" || value.length === 0) fail(`${what} must be a non-empty string`);
  return value;
}

function requireInteger(value: unknown, what: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || Object.is(value, -0)) fail(`${what} must be a safe integer`);
  return value;
}

function admitEvent(value: unknown, what: string): Event {
  const event = requireRecord(value, what);
  requireText(event.id, `${what}.id`);
  requireInteger(event.year, `${what}.year`);
  requireText(event.kind, `${what}.kind`);
  requireArray(event.actors, `${what}.actors`);
  requireArray(event.causes, `${what}.causes`);
  requireRecord(event.payload, `${what}.payload`);
  return value as Event;
}

function admitYearSnapshot(year: number, owned: unknown, what: string): YearSnapshot {
  const record = requireRecord(owned, what);
  requireRecord(record.people, `${what}.people`);
  requireArray(record.events, `${what}.events`);
  requireArray(record.decisions, `${what}.decisions`);
  return {
    year,
    people: record.people as Readonly<Record<string, Person>>,
    events: record.events as readonly Event[],
    decisions: record.decisions as readonly DecisionRecord[],
  };
}

/**
 * Recognizes the trusted lifecycle pair by version and shape. This is version recognition, not
 * authority: no digest is read, no year is replayed and no semantic regeneration is repeated —
 * that already happened before the caller had this pair.
 */
function admitSource(value: unknown): Trusted {
  const source = requireRecord(value, "projection source");
  const genesisRecord = requireRecord(source.genesis, "source.genesis");
  const outputRecord = requireRecord(source.output, "source.output");
  const genesisVersions = requireRecord(genesisRecord.versions, "source.genesis.versions");
  if (genesisVersions.schema !== LIFECYCLE_GENESIS_VERSIONS.schema) fail("source.genesis is not a recognized lifecycle genesis");
  const outputVersions = requireRecord(outputRecord.versions, "source.output.versions");
  if (outputVersions.schema !== LIFECYCLE_GENESIS_VERSIONS.schema) fail("source.output is not a recognized lifecycle runtime output");

  const protagonistId = requireText(outputRecord.protagonistId, "source.output.protagonistId");
  if (requireText(genesisRecord.protagonistId, "source.genesis.protagonistId") !== protagonistId) {
    fail("source.genesis and source.output disagree about the protagonist");
  }

  const initial = requireRecord(genesisRecord.initial, "source.genesis.initial");
  const configRecord = requireRecord(initial.config, "source.genesis.initial.config");
  const town = requireRecord(configRecord.town, "source.genesis.initial.config.town");
  const config: WorldConfig = Object.freeze({
    seed: requireText(configRecord.seed, "source.genesis.initial.config.seed"),
    startYear: requireInteger(configRecord.startYear, "source.genesis.initial.config.startYear"),
    endYear: requireInteger(configRecord.endYear, "source.genesis.initial.config.endYear"),
    town: Object.freeze({ name: requireText(town.name, "source.genesis.initial.config.town.name") }),
  });

  if (outputRecord.status !== "complete" && outputRecord.status !== "incomplete") {
    fail('source.output.status must be "complete" or "incomplete"');
  }
  const frontier = requireInteger(outputRecord.frontier, "source.output.frontier");
  const owned = requireRecord(outputRecord.owned, "source.output.owned");
  const people = requireRecord(owned.people, "source.output.owned.people");
  const events = requireArray(owned.events, "source.output.owned.events").map((event, index) => admitEvent(event, `source.output.owned.events[${index}]`));
  requireArray(owned.decisions, "source.output.owned.decisions");
  const protagonist = requireRecord(people[protagonistId], `source.output.owned.people[${protagonistId}]`);
  if (protagonist.sex !== "f" && protagonist.sex !== "m") fail("the protagonist's sex must be \"f\" or \"m\"");
  requireInteger(protagonist.birthYear, "the protagonist's birthYear");
  requireRecord(protagonist.mind, "the protagonist's mind");

  // Journal order is the trusted traversal order and is never re-sorted here; a gap or a ragged
  // frontier means this pair is not a regenerated lifecycle output.
  const journal = requireArray(outputRecord.journal, "source.output.journal").map((entry, index) => {
    const record = requireRecord(entry, `source.output.journal[${index}]`);
    const year = requireInteger(record.year, `source.output.journal[${index}].year`);
    const final = requireRecord(record.final, `source.output.journal[${index}].final`);
    return { year, snapshot: admitYearSnapshot(year, final.owned, `source.output.journal[${index}].final.owned`) };
  });
  for (let index = 1; index < journal.length; index++) {
    if (journal[index]!.year !== journal[index - 1]!.year + 1) fail("source.output.journal years must be contiguous in traversal order");
  }
  if ((journal.at(-1)?.year ?? config.startYear - 1) !== frontier) fail("source.output.frontier disagrees with the journal");

  return {
    genesis: source.genesis as LifecycleCapsule["genesis"],
    output: source.output as LifecycleCapsule["output"],
    config, people: people as Readonly<Record<string, Person>>, events,
    decisions: owned.decisions as readonly DecisionRecord[],
    protagonistId, protagonist: protagonist as unknown as Person, journal,
  };
}

function admitIdentity(value: unknown): LifecycleViewIdentity {
  const identity = requireRecord(value, "view identity");
  return {
    lifeId: requireText(identity.lifeId, "identity.lifeId"),
    branchId: requireText(identity.branchId, "identity.branchId"),
  };
}

function admitLocale(value: unknown): Locale {
  if (value === undefined) return DEFAULT_LOCALE;
  if (typeof value !== "string" || !isLocale(value)) fail('locale must be one of the supported locales ("en", "es")');
  return value;
}

// --- Gaps ----------------------------------------------------------------------------------------

const IDENTITY_REASON = "The fully regenerated lifecycle output carries no persistence identity: its genesis digest and protagonist id identify a simulation, not a stored (life, branch) pair, and it holds no life or branch record.";

function chronicleGaps(): LifecycleViewGap[] {
  return [
    { field: "chronicle.lifeId", reason: IDENTITY_REASON, representation: "Copied verbatim from the caller's LifecycleViewIdentity (the route's own URL identity). Never derived and never authoritative." },
    { field: "chronicle.branchId", reason: IDENTITY_REASON, representation: "Copied verbatim from the caller's LifecycleViewIdentity (the route's own URL identity). Never derived and never authoritative." },
    {
      field: "chronicle.branches",
      reason: "The trusted output is one linear life: it carries no branch record, label, parent branch or fork year, and a lifecycle binding is immutable per (life, branch).",
      representation: "An empty array, so the view offers no branch switcher instead of an invented \"Original life\" label or fork year.",
    },
    {
      field: "chronicle.entries[].level",
      reason: "The legacy chronicle asks the decision adapter for an event's significance, which is I/O and impossible in a pure projection. The trusted output carries an event's own significance only when the regenerated year recorded one.",
      representation: "The trusted event's own significance when present, else the deterministic rule heuristic. A non-turn level can therefore differ from a legacy chronicle's.",
    },
  ];
}

function tickGaps(): LifecycleViewGap[] {
  return [{
    field: "tick.entries[].level",
    reason: "The legacy tick scores significance through the decision adapter, which is I/O and impossible in a pure projection. The trusted output carries an event's own significance only when the regenerated year recorded one.",
    representation: "The trusted event's own significance when present, else the deterministic rule heuristic. A non-turn level can therefore differ from a legacy tick's.",
  }];
}

function protagonistGaps(): LifecycleViewGap[] {
  return [];
}

function personSheetGaps(): LifecycleViewGap[] {
  return [{
    field: "personSheet.moments",
    reason: "Moments are ranked by significance, which the legacy path fills from the decision adapter (I/O). The trusted output carries an event's own significance only when the regenerated year recorded one.",
    representation: "Ranked by the trusted event significance or the deterministic rule heuristic, then by year: the five moments can differ from a legacy sheet's.",
  }];
}

// --- Derivation ----------------------------------------------------------------------------------

/**
 * The night-sky scene from the trusted journal, observed in its own order. Given `through`, the
 * scene is that year's own state — the state the year carried, never a later one — so an early
 * tick's sky cannot know a death (or a bond) that has not happened yet. Without `through` it is
 * the whole-life scene from the final output, which is the same state as the last journal year.
 */
function sceneOf(trusted: Trusted, through?: number): LifeScene {
  const tracker = createSceneTracker({ seed: trusted.config.seed, protagonistId: trusted.protagonistId });
  let latest: TrustedYear | undefined;
  for (const year of trusted.journal) {
    if (through !== undefined && year.year > through) break;
    tracker.observe(year.snapshot);
    latest = year;
  }
  const endState = through === undefined
    ? { people: trusted.people, events: trusted.events }
    : latest === undefined
      ? undefined
      : { people: latest.snapshot.people, events: latest.snapshot.events };
  if (endState !== undefined) return tracker.scene(endState);
  return deriveLifeScene({
    seed: trusted.config.seed, people: trusted.people, events: trusted.events, protagonistId: trusted.protagonistId,
    ...(through !== undefined ? { through } : {}),
  });
}

/** Legacy `markLinks`: the summary's own text, with `{{personId}}` markers for the people it names. */
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

/** Legacy left-rail cast, in the same order: spouse, mother, father, children, then bonds. */
function castOf(protagonist: Person, people: Readonly<Record<string, Person>>): Chronicle["cast"] {
  const cast: { personId: string; name: string; relation: string }[] = [];
  const seen = new Set<string>();
  const push = (id: string | undefined, relation: string): void => {
    if (!id || seen.has(id)) return;
    const person = people[id];
    if (!person) return;
    seen.add(id);
    cast.push({ personId: id, name: person.name, relation });
  };
  const spouse = protagonist.spouseId ? people[protagonist.spouseId] : undefined;
  if (spouse) push(spouse.id, familyRelation(protagonist, spouse) ?? "spouse");
  push(protagonist.motherId, "mother");
  push(protagonist.fatherId, "father");
  for (const person of Object.values(people)) {
    if (person.motherId === protagonist.id || person.fatherId === protagonist.id) push(person.id, person.sex === "m" ? "son" : "daughter");
  }
  for (const relationship of protagonist.mind.relationships) push(relationship.personId, relationship.bond);
  return cast;
}

/**
 * A cause carried by an event, linked to its own entry when that entry is part of this chronicle.
 * The per-year narration that builds entries sees only that year's timeline, so a cause from an
 * earlier year arrives unlinked; the link target is still exactly the trusted event the legacy
 * whole-life path would have linked, so it is recovered from the trusted log, never invented.
 */
function withCauseLinks(entries: readonly ChronicleEntry[], events: readonly Event[]): ChronicleEntry[] {
  const byId = new Map(events.map((event) => [event.id, event]));
  const entryIds = new Set(entries.map((entry) => entry.id));
  return entries.map((entry) => {
    const cause = entry.cause;
    if (!cause || cause.entryId !== undefined) return entry;
    const event = byId.get(entry.id);
    if (!event) return entry;
    const causeEvent = event.causes.map((id) => byId.get(id)).find((candidate) => candidate !== undefined && candidate.year < event.year);
    if (!causeEvent || !entryIds.has(causeEvent.id)) return entry;
    return { ...entry, cause: { entryId: causeEvent.id, phrase: cause.phrase, year: cause.year } };
  });
}

/** Every narrated protagonist entry, built year by year from the trusted log. */
async function chronicleEntries(trusted: Trusted, scene: LifeScene, locale: Locale): Promise<ChronicleEntry[]> {
  const years = new Set<number>();
  for (const event of trusted.events) if (event.actors.includes(trusted.protagonistId)) years.add(event.year);
  const entries: ChronicleEntry[] = [];
  for (const year of years) {
    entries.push(...await buildProvisionalTickEntries(
      trusted.protagonistId, year, trusted.events, trusted.people, trusted.decisions,
      trusted.protagonist.sex, trusted.config.seed, trusted.config.town.name, locale, scene,
    ));
  }
  return withCauseLinks(entries, trusted.events);
}

function protagonistInfoOf(trusted: Trusted, locale: Locale): ProtagonistInfo {
  const { protagonist } = trusted;
  const deathYear = protagonist.deathYear;
  if (deathYear === undefined) fail("this life has not ended, so it has no protagonist death year");
  const deathEvent = trusted.events.find((event) => event.kind === "death" && event.actors[0] === trusted.protagonistId);
  const causeCode = deathEvent && typeof deathEvent.payload.cause === "string" ? deathEvent.payload.cause as DeathCause : undefined;
  const causeOfDeath = causeCode && causeCode in DEATH_CAUSE_PHRASE ? deathCauseDisplay(locale, causeCode) : locale === "es" ? "mala fortuna" : "misfortune";
  return {
    name: protagonist.name,
    sex: protagonist.sex,
    birthYear: protagonist.birthYear,
    deathYear,
    ageAtDeath: ageInYear(protagonist.birthYear, deathYear),
    causeOfDeath,
  };
}

// --- Projections ---------------------------------------------------------------------------------

/** The protagonist block alone, for the listing route: no narration, no scene, no gaps. */
export function projectLifecycleProtagonist(input: ProjectLifecycleProtagonistInput): LifecycleProjection<ProtagonistInfo> {
  const root = requireRecord(input, "protagonist projection input");
  const locale = admitLocale(root.locale);
  const trusted = admitSource(root.source);
  if (trusted.output.status !== "complete") fail("this life has not ended; the protagonist block requires a completed regeneration");
  return { view: protagonistInfoOf(trusted, locale), gaps: protagonistGaps() };
}

/** The full chronicle the existing read route serves, derived from the trusted pair and nothing else. */
export async function projectLifecycleChronicle(input: ProjectLifecycleChronicleInput): Promise<LifecycleProjection<Chronicle>> {
  const root = requireRecord(input, "chronicle projection input");
  const identity = admitIdentity(root.identity);
  const locale = admitLocale(root.locale);
  const trusted = admitSource(root.source);
  if (trusted.output.status !== "complete") fail("this life has not ended; a chronicle view requires a completed regeneration");
  const protagonist = protagonistInfoOf(trusted, locale);

  const scene = sceneOf(trusted);
  const deathEventId = trusted.events.find((event) => event.kind === "death" && event.actors[0] === trusted.protagonistId)?.id;
  const entries = finishAtDeath(await chronicleEntries(trusted, scene, locale), deathEventId);
  const summaryRaw = lifeSummary(trusted.protagonist, trusted.people, trusted.events, trusted.config.town.name, locale);
  const summary = markLinks(summaryRaw, Object.keys(trusted.people), trusted.people, trusted.protagonistId);

  return {
    view: {
      lifeId: identity.lifeId,
      branchId: identity.branchId,
      villageName: trusted.config.town.name,
      protagonist,
      summary: summary.text,
      summaryLinks: summary.links,
      epilogue: buildEpilogue(trusted.protagonist, trusted.people, trusted.config.town.name, locale),
      entries,
      branches: [],
      cast: castOf(trusted.protagonist, trusted.people),
      scene,
    },
    gaps: chronicleGaps(),
  };
}

/** One SSE `tick` payload: that year's protagonist entries and the scene as of that year. */
export async function projectLifecycleTick(input: ProjectLifecycleTickInput): Promise<LifecycleProjection<LifecycleTickView>> {
  const root = requireRecord(input, "tick projection input");
  const locale = admitLocale(root.locale);
  const trusted = admitSource(root.source);
  const year = requireInteger(root.year, "tick year");
  if (!trusted.journal.some((entry) => entry.year === year)) fail(`year ${year} is not a regenerated lifecycle year`);

  const scene = sceneOf(trusted, year);
  const entries = await buildProvisionalTickEntries(
    trusted.protagonistId, year, trusted.events, trusted.people, trusted.decisions,
    trusted.protagonist.sex, trusted.config.seed, trusted.config.town.name, locale, scene,
  );
  return { view: { year, entries, scene }, gaps: tickGaps() };
}

/** The read-only side sheet for one person of a new-engine life. */
export async function projectLifecyclePersonSheet(input: ProjectLifecyclePersonSheetInput): Promise<LifecycleProjection<PersonSheet>> {
  const root = requireRecord(input, "person sheet projection input");
  const locale = admitLocale(root.locale);
  const trusted = admitSource(root.source);
  const personId = requireText(root.personId, "person id");
  const person = trusted.people[personId];
  if (!person) fail(`person ${personId} is not in the regenerated lifecycle output`);

  const relation = personId === trusted.protagonistId
    ? "self"
    : familyRelation(trusted.protagonist, person)
      ?? trusted.protagonist.mind.relationships.find((relationship) => relationship.personId === personId)?.bond
      ?? "acquaintance";
  const timeline = await narratePersonTimeline(
    personId, trusted.events, trusted.people, undefined, 8, trusted.config.seed, trusted.config.town.name, locale,
  );
  const moments = [...timeline]
    .sort((left, right) => right.significance - left.significance)
    .slice(0, 5)
    .sort((left, right) => left.event.year - right.event.year)
    .map((narrated) => ({ year: narrated.event.year, title: narrated.title }));

  return {
    view: {
      personId,
      name: person.name,
      relation,
      birthYear: person.birthYear,
      deathYear: person.deathYear ?? null,
      job: person.job !== "none" ? person.job : null,
      blurb: renderPortrait(person.name, person.mind, (id) => trusted.people[id]?.name ?? id),
      moments,
    },
    gaps: personSheetGaps(),
  };
}

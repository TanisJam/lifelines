import { ageInYear } from "./actuarial";
import { candidateMatchesSubject, decisionSubject, type MintedId, mintDecisionId } from "./decision-id";
import { activeRomancePairs, makeEventId } from "./events";
import { advanceSlot, applyLifeTransition, EMPTY_SLOTS, ensureLifeState } from "./life-state";
import { addMemory, createMind, pushThought, type DreamGoal } from "./mind";
import { CONCEPTION_PROBABILITY_BANDS, FERTILITY_DAMPING_FLOOR, VILLAGE_CARRYING_CAPACITY_RATIO } from "./params/demography";
import { FEMALE_NAMES, MALE_NAMES, pickName, SURNAMES } from "./names";
import { FALLBACK_CLASS } from "./period/classes";
import { keyedDraw, keyedRng } from "./rng";
import { TRAIT_POOL, type Event, type EventKind, type JsonValue, type Override, type Person, type Sex, type SocialClass, type Trait } from "./types";
import { isLiterate, pickCommonClass, pickJobForClass, pickTraits } from "./worldgen";

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

/**
 * Whether `goal` is already backed by a real event on `personId`'s own log
 * — the gate for A8's "push-harder" outcome (decision 023, "dream realized
 * without the act"): the underlying act has to have actually happened
 * (a real move, a real marriage/child, a real career change) before code
 * will let Jev's "push harder" roll flip the dream to realized.
 */
export function dreamGoalSatisfiedBy(goal: DreamGoal, events: readonly Event[], personId: string): boolean {
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

/** The kind of settlement a protagonist who leaves home might settle in (decision 040). */
const SETTLEMENT_KINDS = ["market town", "port town", "city"] as const;

/**
 * Deterministically names the place a protagonist settles after leaving home (decision 040) —
 * keyed by seed + the year they left, reusing the `SURNAMES` pool (already town-name-shaped) so
 * no new name list is needed. `full` is the one-time introduction ("Millbrook, a market town");
 * `name` alone is used for every later reference.
 */
export function pickAwayDestination(seed: string, year: number): { name: string; kind: string; full: string } {
  const nameIdx = Math.floor(keyedDraw(seed, "away-destination", year, "name") * SURNAMES.length);
  const kindIdx = Math.floor(keyedDraw(seed, "away-destination", year, "kind") * SETTLEMENT_KINDS.length);
  const name = SURNAMES[nameIdx]!;
  const kind = SETTLEMENT_KINDS[kindIdx]!;
  return { name, kind, full: `${name}, a ${kind}` };
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
export function levyClassMultiplier(socialClass: SocialClass): number {
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
export function overrideFor(overrides: readonly Override[], kind: string, subject: string, isOverrideYear: boolean, partnerId?: string): Override | undefined {
  if (!isOverrideYear) return undefined;
  return overrides.find((o) => {
    const parsed = decisionSubject(o.decisionId);
    return parsed.kind === kind && candidateMatchesSubject(parsed.subject, subject, partnerId);
  });
}

/**
 * Decision 057: replaces the old universal age-6 `school` event. `literate` is decided once, at
 * birth (`worldgen.ts#isLiterate`, keyed by class and sex per research.md's literacy table) — this
 * only decides WHEN the (already-determined) literate ones are taught, at age 7, and only pushes an
 * event for them. Everyone else simply never gets a `school` event, which is the period-faithful
 * default (research.md: labourers ~5-10% literate, ~90% of women illiterate overall).
 */
export function school(events: Event[], people: Record<string, Person>, personId: string, year: number): void {
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

export function spawnImmigrant(seed: string, year: number, people: Readonly<Record<string, Person>>): Person {
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

/**
 * An off-screen gentry suitor arriving via an arranged marriage (decision 083) — same shape as
 * `spawnImmigrant`, but ALWAYS gentry: this is the one deliberate, narrow exception to decision 049's
 * "an immigrant never produces gentry" (that decision's own reasoning was about the GENERAL
 * immigration pool having no sourced gentry-share figure, not about this specific, rare, plot-driven
 * arranged-match mechanism — see decision 083's own doc comment). Content-derived id
 * (`gentry-suitor-<brideId>-<year>`, unique per arranged match).
 * Age band (20s, per research.md's 14th c. gentry-men-marry-later anchor already cited by
 * `MARRIAGE_FLOORS`'s own doc comment) is narrower than a common immigrant's 18-31, since an arranged
 * match specifically seeks an established heir, not a young laborer looking for work.
 */
export function spawnGentrySuitor(seed: string, year: number, brideId: string, people: Readonly<Record<string, Person>>, offScreen: boolean): Person {
  // Keyed by the bride as well as the year, so two arranged matches in one year never share an id.
  const newId = `gentry-suitor-${brideId}-${year}`;
  const sex: Sex = "m";
  const age = 20 + Math.floor(keyedRng(seed, newId, year, "age")() * 8); // 20-27
  const birthYear = year - age;
  const nameIndex = Math.floor(keyedRng(seed, newId, year, "name")() * 20);
  const surnameIndex = Math.floor(keyedRng(seed, newId, year, "surname")() * 20);
  const surname = pickName(sex, 0, surnameIndex).split(" ")[1]!;
  const existingNames = new Set(Object.values(people).map((p) => p.name));
  const first = uniqueFirstName(existingNames, sex, nameIndex, surname);
  const name = `${first} ${surname}`;
  const traits = pickTraits(keyedRng(seed, newId, year, "traits"), 3);
  const socialClass: SocialClass = "gentry";
  const job = pickJobForClass(socialClass, keyedRng(seed, newId, year, "job"));
  const literate = isLiterate(seed, newId, birthYear, sex, socialClass);
  const mind = createMind(seed, newId, birthYear, []);
  return { id: newId, name, sex, birthYear, traits, job, founder: false, mind, socialClass, literate, ...(offScreen ? { away: true } : {}) };
}

/** A lightweight newcomer met in the protagonist's away catalog (decision 040) — deterministic and content-derived (`away-<year>`), same shape as `spawnImmigrant`, tagged `away: true` so it never joins the home village's own pools. */
export function spawnAwayPerson(seed: string, year: number, people: Readonly<Record<string, Person>>): Person {
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

export function spawnChild(seed: string, year: number, mother: Person, father: Person, people: Readonly<Record<string, Person>>): Person {
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

// Shared by the annual vital phase and interleaved social/childbirth outcomes.
// These helpers mutate the caller-owned registry and logs; they never clone/backfill them.
export function pushEvent(events: Event[], year: number, kind: EventKind, actors: readonly string[], payload: Record<string, JsonValue>, causes: readonly string[]): Event {
  const event: Event = { id: makeEventId(events, year, kind, actors), year, kind, actors, payload, causes };
  events.push(event);
  return event;
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
export function resolveWidowhood(
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
export function resolveCourtshipOnDeath(events: Event[], people: Record<string, Person>, deceased: Person, year: number, deathEventId: string): readonly string[] {
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
 * Peeks the next id for `(kind, subject)` without mutating anything — safe to call before deciding
 * whether the resulting decision will actually be recorded (biology's `RECORD_THRESHOLD` gate runs
 * AFTER this). `subject === "world"` (immigration) needs no `people` lookup at all (see
 * `mintDecisionId`).
 */
export function mintId(people: Readonly<Record<string, Person>>, kind: string, subject: string, year: number): MintedId {
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
export function commitId(people: Record<string, Person>, events: readonly Event[], subject: string, minted: MintedId, occurred: boolean): void {
  if (subject === "world") return;
  const person = people[subject];
  if (!person) return;
  const state = ensureLifeState(person, events);
  person.lifeState = { ...state, slots: advanceSlot(state.slots, minted.key, occurred) };
}

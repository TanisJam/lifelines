import type { DecisionMaker, DecisionQuestion } from "./decisions";
import { makeEventId } from "./events";
import { createMind, VALUES, type ValueName } from "./mind";
import { keyedRng, sampleGumbelMax } from "./rng";
import { pickUniqueName } from "./names";
import { JOB_POOL, TRAIT_POOL, type Event, type EventKind, type Job, type JsonValue, type Person, type Sex, type Trait, type WorldConfig } from "./types";

function pushEvent(events: Event[], year: number, kind: EventKind, actors: readonly string[], payload: Record<string, JsonValue>): Event {
  const event: Event = { id: makeEventId(events, year, kind, actors), year, kind, actors, payload, causes: [] };
  events.push(event);
  return event;
}

/**
 * A founder couple starts the world already married with grown children —
 * there was never an in-sim courtship to log. Without a backfilled event,
 * their chronicle just... starts, with no record of how they got there
 * (round 5 fix, decision 026 — "Orla is 'Married to Merric', but her
 * chronicle has no courtship, marriage or children"). The exact marriage
 * year is invented (nothing tracks it precisely for a founder), so it's
 * bounded to be AFTER both turned 18 and AT OR BEFORE their earliest
 * child's actual birth year — never something the rest of the log could
 * contradict.
 */
function estimateMarriageYear(seed: string, mother: Person, father: Person, children: readonly Person[], startYear: number): number {
  const bothAdultsBy = Math.max(mother.birthYear, father.birthYear) + 18;
  const mustBeMarriedBy = children.length > 0 ? Math.min(...children.map((c) => c.birthYear)) : startYear;
  const lo = Math.min(bothAdultsBy, mustBeMarriedBy);
  const hi = Math.max(lo, mustBeMarriedBy);
  const rng = keyedRng(seed, mother.id, startYear, "marriage-year-backfill");
  return lo + Math.floor(rng() * (hi - lo + 1));
}

/**
 * "Let fate decide" (round 10, decision 041): rather than a code-side keyed
 * coin flip blind to the name, asks the DecisionMaker (kind `SEX1`) whether
 * a name like this, in a medieval European village, is more likely a girl or
 * a boy — then samples that distribution with the same keyed Gumbel-max
 * helper every other decision uses, keyed by (seed, "protagonist",
 * startYear, "SEX1") so a re-run with the same seed and name is
 * deterministic. Called BEFORE `generateWorld` (there is no protagonist, and
 * no `PersonMind`, yet) — the question id is content-derived from the
 * (lowercased) name alone, so it's cached across runs regardless of seed. A
 * clearly gendered name then almost always gets the expected sex under Jev;
 * an ambiguous one is a real coin flip. Never recorded as a `DecisionRecord`
 * — the birth stays immutable and un-forkable, same as before this change.
 */
export async function resolveProtagonistSex(decisionMaker: DecisionMaker, seed: string, name: string, startYear: number): Promise<Sex> {
  const question: DecisionQuestion = {
    id: `sex1:${name.trim().toLowerCase()}`,
    kind: "SEX1",
    personId: "protagonist",
    year: startYear,
    state: { name, setting: "a medieval European village, around 1500" },
    options: ["f", "m"],
  };
  const distribution = await decisionMaker.decide(question);
  const { chosen } = sampleGumbelMax(distribution, seed, "protagonist", startYear, "SEX1");
  return chosen as Sex;
}

export interface GenerateWorldOptions {
  readonly seed: string;
  readonly townName?: string;
  readonly startYear?: number;
  readonly endYear?: number;
  /** Number of ADULT founders (couples + singles + elders). Children born into founder couples are extra. */
  readonly founderCount?: number;
  /**
   * Round 9 (decision 034, the single-life pivot): when set, one extra child — the protagonist,
   * always id `"protagonist"` — is born into the first founder couple at exactly `startYear` (age
   * 0). Their birth is a REAL `birth` event but deliberately NOT decision-backed (no `A2`
   * candidate, no `DecisionRecord`) — it can never be forked, which is what "their birth is
   * immutable" means in practice, and it also sidesteps decision 033's "un-birth" edge case for
   * the one person the whole app is now built around. `sex: "random"` rolls it via the keyed RNG.
   */
  readonly protagonist?: { readonly name: string; readonly sex: Sex | "random" };
}

const DEFAULT_START_YEAR = 1500;
const DEFAULT_END_YEAR = 1575; // 75 years, within the 60-80 spec range
const DEFAULT_FOUNDER_COUNT = 18; // adult founders; +children brings the initial population to ~20-24

const TOWN_NAME_ADJECTIVES = ["Millbrook", "Ashford", "Wren's Hollow", "Stonebridge", "Fenmoor", "Oakhaven", "Raven's Reach", "Thistlewick"] as const;

export function pickTraits(rng: () => number, count: number): Trait[] {
  const pool = [...TRAIT_POOL];
  const picked: Trait[] = [];
  for (let i = 0; i < count && pool.length > 0; i++) {
    const idx = Math.floor(rng() * pool.length);
    picked.push(pool.splice(idx, 1)[0]!);
  }
  return picked;
}

export function pickJob(rng: () => number): Job {
  const workingJobs = JOB_POOL.filter((j) => j !== "none");
  return workingJobs[Math.floor(rng() * workingJobs.length)]!;
}

/**
 * A shared value lean for one household (worldgen coherence: "a family has shared values").
 * Children inherit it again anyway via parent-blending in `createMind`, but this also gives a
 * founding couple's own minds a coherent starting lean rather than being fully independent
 * random draws.
 *
 * Round 6 fix (decision 028, "population decline is systematic"): `family` is deliberately
 * EXCLUDED from the biasable pool. The real cause, traced with a live seed (`chronicle-3`):
 * BOTH founders in a couple share the same `familyIndex`, so when the random 1-2 biased values
 * happened to include `family`, an entire founding couple (and, via parent-blending, their whole
 * line) could land near the value's hard floor (-50) purely by chance — e.g. Quilla Greyhollow's
 * `family: -49`, which then made every one of her A2 decisions a near-certain, entirely FAITHFUL
 * "refuse" (jevRaw try ≈ 0.02). Jev was answering correctly for who she was; the bug was that
 * worldgen could hand an entire town's founding family a coin-flip chance at being almost
 * maximally anti-family, which is a demographic risk no amount of A2 wording or state can offset
 * without literally overriding Jev's answer (which decision 016 forbids). Every other value can
 * still bias just as strongly — this only removes the one value whose extreme happens to gate
 * reproduction town-wide.
 */
const BIASABLE_VALUES: readonly ValueName[] = VALUES.filter((v) => v !== "family");

function familyValueBias(seed: string, familyIndex: number, startYear: number): Partial<Record<ValueName, number>> {
  const rng = keyedRng(seed, "world", startYear, `family-bias-${familyIndex}`);
  const bias: Partial<Record<ValueName, number>> = {};
  const biasedCount = 1 + Math.floor(rng() * 2); // 1-2 strongly shared values per family
  const pool = [...BIASABLE_VALUES];
  for (let i = 0; i < biasedCount && pool.length > 0; i++) {
    const idx = Math.floor(rng() * pool.length);
    const value = pool.splice(idx, 1)[0]!;
    bias[value] = Math.round((rng() - 0.5) * 80); // a strong lean, +/-40
  }
  return bias;
}

/**
 * How many adult founders go into each family role. Deliberately NOT one
 * flat pool of unrelated adults: the original design (everyone an
 * unattached adult, ages 16-55, all unrelated) meant marriages had to be
 * decided from scratch by the DecisionMaker before any child could ever be
 * conceived, and if that adapter is even mildly conservative about
 * "accept-partner", the whole timeline can run dry — no marriages, no
 * children, no second generation, no causal web for edits to ripple
 * through. Seeding several already-married couples with existing children
 * (ages 0-15) guarantees a multi-generational town regardless of how the
 * configured DecisionMaker happens to answer romance questions: those kids
 * grow up, become adults, and get their own life decisions over the
 * simulated decades no matter what.
 */
function familyShape(founderCount: number): { coupleCount: number; singleCount: number; elderCount: number } {
  const coupleCount = Math.max(2, Math.round(founderCount * 0.22));
  const singleCount = Math.max(2, Math.round(founderCount * 0.35));
  const elderCount = Math.max(1, founderCount - coupleCount * 2 - singleCount);
  return { coupleCount, singleCount, elderCount };
}

/**
 * Deterministically generates a starting cast — several founder couples
 * with children already at various ages, a pool of unattached singles to
 * keep the romance pool alive early on, and a couple of elders — plus a
 * world config, from a seed string. Every random choice goes through the
 * keyed RNG so the same seed always yields the same town.
 */
export function generateWorld(options: GenerateWorldOptions): { config: WorldConfig; people: Record<string, Person>; events: Event[] } {
  const startYear = options.startYear ?? DEFAULT_START_YEAR;
  const endYear = options.endYear ?? DEFAULT_END_YEAR;
  const founderCount = options.founderCount ?? DEFAULT_FOUNDER_COUNT;
  const seed = options.seed;

  const nameRng = keyedRng(seed, "world", startYear, "town-name");
  const townName = options.townName ?? TOWN_NAME_ADJECTIVES[Math.floor(nameRng() * TOWN_NAME_ADJECTIVES.length)]!;

  const config: WorldConfig = { seed, startYear, endYear, town: { name: townName } };
  const people: Record<string, Person> = {};
  const events: Event[] = [];

  const familyRng = keyedRng(seed, "world", startYear, "families");
  const familyCount = Math.max(3, Math.ceil(founderCount / 4));
  const familySurnameIndices = Array.from({ length: familyCount }, () => Math.floor(familyRng() * 20));

  let nextIndex = 1;
  function nextId(): string {
    const id = `p${String(nextIndex).padStart(3, "0")}`;
    nextIndex += 1;
    return id;
  }

  function makeAdult(sex: Sex, ageMin: number, ageMax: number, familyIndex: number, founder = true): Person {
    const id = nextId();
    const ageRng = keyedRng(seed, id, startYear, "age");
    const age = ageMin + Math.floor(ageRng() * (ageMax - ageMin + 1));
    const birthYear = startYear - age;
    const nameIdxRng = keyedRng(seed, id, startYear, "name");
    const nameIndex = Math.floor(nameIdxRng() * 20);
    const surnameIndex = familySurnameIndices[familyIndex % familyCount]!;
    const existingNames = new Set(Object.values(people).map((p) => p.name));
    const name = pickUniqueName(existingNames, sex, nameIndex, surnameIndex);
    const traits = pickTraits(keyedRng(seed, id, startYear, "traits"), 3);
    const job = age >= 16 ? pickJob(keyedRng(seed, id, startYear, "job")) : "none";
    const bias = familyValueBias(seed, familyIndex, startYear);
    const mind = createMind(seed, id, birthYear, [], bias);
    const person: Person = { id, name, sex, birthYear, traits, job, founder, mind };
    people[id] = person;
    return person;
  }

  function makeChild(mother: Person, father: Person, familyIndex: number, maxAge: number): Person {
    const id = nextId();
    const ageRng = keyedRng(seed, id, startYear, "age");
    const age = Math.floor(ageRng() * Math.max(1, maxAge + 1)); // 0..maxAge: already growing up when the town is founded
    const birthYear = startYear - age;
    const sex: Sex = keyedRng(seed, id, startYear, "sex")() < 0.5 ? "f" : "m";
    const nameIndex = Math.floor(keyedRng(seed, id, startYear, "name")() * 20);
    const surnameIndex = familySurnameIndices[familyIndex % familyCount]!;
    const existingNames = new Set(Object.values(people).map((p) => p.name));
    const name = pickUniqueName(existingNames, sex, nameIndex, surnameIndex);
    const traits = pickTraits(keyedRng(seed, id, startYear, "traits"), 3);
    const job = age >= 16 ? pickJob(keyedRng(seed, id, startYear, "job")) : "none";
    const mind = createMind(seed, id, birthYear, [mother.mind, father.mind]);
    const person: Person = { id, name, sex, birthYear, traits, job, motherId: mother.id, fatherId: father.id, founder: false, mind };
    people[id] = person;
    return person;
  }

  const shape = familyShape(founderCount);
  let familyIndex = 0;

  // Founder couples: age brackets shared by both partners (within a few years of
  // each other), each with zero to three children already growing up.
  for (let c = 0; c < shape.coupleCount; c++) {
    const bracketRng = keyedRng(seed, "world", startYear, `couple-bracket-${c}`);
    const bracket = bracketRng();
    const [ageMin, ageMax] = bracket < 0.35 ? [22, 32] : bracket < 0.75 ? [30, 45] : [42, 60];

    const wifeFirst: Sex = c % 2 === 0 ? "f" : "m";
    const first = makeAdult(wifeFirst, ageMin, ageMax, familyIndex);
    const second = makeAdult(wifeFirst === "f" ? "m" : "f", ageMin, ageMax, familyIndex);
    first.spouseId = second.id;
    second.spouseId = first.id;
    const mother = first.sex === "f" ? first : second;
    const father = first.sex === "m" ? first : second;

    const kidRng = keyedRng(seed, mother.id, startYear, "kid-count")();
    const kidCount = kidRng < 0.15 ? 0 : kidRng < 0.65 ? 1 : kidRng < 0.92 ? 2 : 3;
    // Bound child ages so they're plausible for the mother's age (she must have been >=17 at the birth), capped at 15 (still growing up at world start).
    const motherAgeAtStart = startYear - mother.birthYear;
    const maxChildAge = Math.min(15, motherAgeAtStart - 17);
    const children: Person[] = [];
    for (let k = 0; k < kidCount && maxChildAge >= 0; k++) {
      children.push(makeChild(mother, father, familyIndex, maxChildAge));
    }

    // Round 9 (decision 034): the protagonist is born into the FIRST founder couple, right here,
    // before the marriage/birth backfill below so their own birth event sorts correctly alongside
    // any older siblings.
    if (options.protagonist && c === 0) {
      const sexRng = keyedRng(seed, "protagonist", startYear, "sex");
      const sex: Sex = options.protagonist.sex === "random" ? (sexRng() < 0.5 ? "f" : "m") : options.protagonist.sex;
      const mind = createMind(seed, "protagonist", startYear, [mother.mind, father.mind]);
      const protagonist: Person = { id: "protagonist", name: options.protagonist.name, sex, birthYear: startYear, traits: [], job: "none", motherId: mother.id, fatherId: father.id, founder: false, mind };
      people["protagonist"] = protagonist;
      children.push(protagonist);
    }

    // Backfilled events (decision 026): a founder couple's marriage, and each existing child's
    // birth, so their chronicle doesn't just start mid-story with no record of how they got there.
    // The protagonist's OWN birth is real, not backfilled (it happens at `startYear`, the world's
    // very first simulated year) — `backfilled` stays false/absent for it, distinguishing "this
    // really happened in the log" from "we invented a date for something that predates the sim".
    const marriageYear = estimateMarriageYear(seed, mother, father, children, startYear);
    pushEvent(events, marriageYear, "marriage", [mother.id, father.id], { backfilled: true });
    for (const child of children.sort((a, b) => a.birthYear - b.birthYear)) {
      const backfilled = child.id !== "protagonist";
      pushEvent(events, child.birthYear, "birth", [child.id, mother.id, father.id], backfilled ? { backfilled: true } : {});
    }

    familyIndex += 1;
  }

  // Unattached singles: keeps the romance pool alive from year one, spread young-to-mid adult.
  for (let s = 0; s < shape.singleCount; s++) {
    const sex: Sex = s % 2 === 0 ? "f" : "m";
    makeAdult(sex, 18, 38, familyIndex);
    familyIndex += 1;
  }

  // Elders: town texture, occasional illness/death flavor, sometimes unattached.
  for (let e = 0; e < shape.elderCount; e++) {
    const sex: Sex = e % 2 === 0 ? "m" : "f";
    makeAdult(sex, 55, 72, familyIndex);
    familyIndex += 1;
  }

  return { config, people, events };
}

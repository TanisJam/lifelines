import type { DecisionMaker, DecisionQuestion } from "./decisions";
import { makeEventId } from "./events";
import { createMind, VALUES, type ValueName } from "./mind";
import { pickUniqueName } from "./names";
import { FALLBACK_CLASS } from "./period/classes";
import { famineClaimedChildhood, famineDeathYear, FAMINE_MARKER_YEAR, MURRAIN_MARKER_CLASSES, MURRAIN_WINDOW, survivedFamineAsChild } from "./period/events";
import { isLiterate } from "./period/literacy";
import { keyedRng, sampleGumbelMax } from "./rng";
import { JOB_POOL, TRAIT_POOL, type Event, type EventKind, type Job, type JsonValue, type Person, type Sex, type SocialClass, type Trait, type WorldConfig } from "./types";

/** Re-exported so existing callers (`simulate.ts`) keep importing literacy alongside the other worldgen helpers — the actual rates/gate now live in `period/literacy.ts` (decision 063). */
export { isLiterate };

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
 * a name like this, in an English village around 1500, is more likely a girl or
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
    state: { name, setting: "an English village, around 1500" },
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

// Round 13 (decision 048): anchored to England's own well-measured window, per research.md's
// "Life by social class, 1498-1558" ("England is the only region with continuous quantitative data
// for the window"). 1498-1558 is 60 years, at the low end of the 60-80 spec range.
const DEFAULT_START_YEAR = 1498;
const DEFAULT_END_YEAR = 1558;
const DEFAULT_FOUNDER_COUNT = 18; // adult founders; +children brings the initial population to ~20-24

/** Plausible early Tudor English village names — invented but period-flavored, not fantasy-style. */
const TOWN_NAME_ADJECTIVES = ["Ashby", "Thornbury", "Coldharbour", "Wickham", "Langley", "Middleton", "Stoke Parva", "Netherfield"] as const;

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
 * Decision 049 (renamed 1:1 by decision 063 for the 1327-1361 period): jobs are class-bound.
 * Grounded in research.md's economy synthesis (§2, "Occupations and inheritance of trade") —
 * cottars (was labourer) had no transmissible trade, villeins/freeholders (was husbandmen/yeomen)
 * farmed their holding, artisans covered the village's attested trades (smith, carpenter, weaver,
 * miller, baker, tanner — plus `healer`, "wise woman"/barber-surgeon flavor, folded in here rather
 * than given its own class), merchants ran trade/inns, clergy meant the one parish priest, and
 * gentry held land.
 */
export const JOB_POOL_BY_CLASS: Readonly<Record<SocialClass, readonly Job[]>> = {
  cottar: ["labourer", "shepherd"],
  villein: ["farmer"],
  freeholder: ["farmer"],
  artisan: ["blacksmith", "carpenter", "weaver", "miller", "baker", "tanner", "healer"],
  merchant: ["merchant", "innkeeper"],
  clergy: ["priest"],
  gentry: ["landholder"],
};

/**
 * A random job from `socialClass`'s own pool — the class-bound replacement for the old flat
 * `pickJob`. Defensive `?? JOB_POOL_BY_CLASS[FALLBACK_CLASS]` (decision 063 follow-up, CRITICAL fix)
 * — same rationale as `simulate.ts#minMarriageAge`/`actuarial.ts#classMortalityMultiplier`.
 */
export function pickJobForClass(socialClass: SocialClass, rng: () => number): Job {
  const pool = JOB_POOL_BY_CLASS[socialClass] ?? JOB_POOL_BY_CLASS[FALLBACK_CLASS];
  return pool[Math.floor(rng() * pool.length)]!;
}

/**
 * Founder/immigrant class shares (decision 049, renamed by decision 063). `cottar` (was `labourer`;
 * Wrightson, ~25% of rural population) and `villein` (was `husbandman`; 40-50% inferred midpoint,
 * research.md §1 "Social structure...Synthesis") are sourced; `freeholder` (was `yeoman`)/`artisan`/
 * `merchant` shares are TUNABLE DESIGN DEFAULTS, not sourced figures — no village-level census for
 * these three was located in the research pass. `clergy` (exactly one parish priest) and `gentry`
 * (1-2 households) are assigned structurally, not by this weighted draw — see
 * `assignFounderClasses`.
 */
const COMMON_CLASS_WEIGHTS: readonly (readonly [SocialClass, number])[] = [
  ["cottar", 0.25],
  ["villein", 0.45],
  ["freeholder", 0.1],
  ["artisan", 0.12],
  ["merchant", 0.08],
];

/** Draws one of the five "common" classes (everything but clergy/gentry) from `COMMON_CLASS_WEIGHTS`. */
export function pickCommonClass(rng: () => number): SocialClass {
  const draw = rng();
  let cumulative = 0;
  for (const [socialClass, weight] of COMMON_CLASS_WEIGHTS) {
    cumulative += weight;
    if (draw < cumulative) return socialClass;
  }
  return COMMON_CLASS_WEIGHTS[COMMON_CLASS_WEIGHTS.length - 1]![0];
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

  function makeAdult(sex: Sex, ageMin: number, ageMax: number, familyIndex: number, socialClass: SocialClass, founder = true): Person {
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
    const job = age >= 16 ? pickJobForClass(socialClass, keyedRng(seed, id, startYear, "job")) : "none";
    const literate = isLiterate(seed, id, birthYear, sex, socialClass);
    const bias = familyValueBias(seed, familyIndex, startYear);
    const mind = createMind(seed, id, birthYear, [], bias);
    const person: Person = { id, name, sex, birthYear, traits, job, founder, mind, socialClass, literate };
    people[id] = person;
    // Engine life course PR5: the Great Famine is pre-window backstory only (the run starts 1327,
    // 5 years after it ends) — every adult founder was born well before 1310, so they were all old
    // enough to remember living through it (design: "backfilled period-marker for founders aged
    // >=5 in 1315"). A backstory-only marker, never an in-sim mortality effect.
    if (survivedFamineAsChild(birthYear)) {
      pushEvent(events, FAMINE_MARKER_YEAR, "period-marker", [id], { marker: "great-famine", role: "survivor" });
    }
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
    // Decision 056: a child inherits its class from the father (mother if the father is unknown —
    // not reachable here, since a founder child always has both parents, but kept symmetric with
    // `spawnChild` in simulate.ts). Founder children are always under 16 (see `maxChildAge` below),
    // so `job` stays "none" regardless of class — the class-bound pool only matters once A3/AP1 fire.
    const socialClass = father.socialClass ?? mother.socialClass ?? "cottar";
    const job = age >= 16 ? pickJobForClass(socialClass, keyedRng(seed, id, startYear, "job")) : "none";
    const literate = isLiterate(seed, id, birthYear, sex, socialClass);
    const mind = createMind(seed, id, birthYear, [mother.mind, father.mind]);
    const person: Person = { id, name, sex, birthYear, traits, job, motherId: mother.id, fatherId: father.id, founder: false, mind, socialClass, literate };
    // Engine life course PR5: a founder child born within the Great Famine's 1305-22 cohort window
    // has a documented chance of never having survived it — a dead sibling in the family's own
    // pre-window backstory, not an in-sim event (the run starts 1327, after the famine ends). A
    // NEW, dedicated keyed draw (`famineClaimedChildhood`), so it never perturbs this child's own
    // age/name/traits/job/literacy draws, nor any other person's.
    if (famineClaimedChildhood(seed, id, birthYear)) {
      person.deathYear = famineDeathYear(seed, id, birthYear);
    }
    people[id] = person;
    return person;
  }

  const shape = familyShape(founderCount);
  let familyIndex = 0;

  // Decision 049: structural roles decided BEFORE the founder loops below, so `makeAdult` can draw
  // a class-bound job at creation time instead of a class being bolted on afterward.
  //  - Clergy: exactly one parish priest per village (research.md, "roughly one parish priest per
  //    village/parish — structural, not a population %"). Priests were male and celibate, so this
  //    is drawn from the UNATTACHED SINGLES only, never a couple — specifically the first male
  //    single (`s === 1`; singles alternate f/m starting with f), so it never collides with a
  //    married founder. Skipped for a tiny `singleCount` (< 2) as a documented edge case.
  //  - Gentry: 1-2 households (research.md: "gentry under 5%", "1-2 gentry households" as a
  //    structural default), drawn from the COUPLES only (a gentry "household" implies an estate a
  //    family holds, not a lone adult) via a keyed rejection sample.
  const clergySingleIndex = shape.singleCount > 1 ? 1 : undefined;
  const gentryCountRng = keyedRng(seed, "world", startYear, "gentry-count");
  const gentryCount = Math.min(shape.coupleCount, 1 + (gentryCountRng() < 0.5 ? 0 : 1));
  const gentryCoupleIndices = new Set<number>();
  if (shape.coupleCount > 0) {
    const gentryPickRng = keyedRng(seed, "world", startYear, "gentry-pick");
    while (gentryCoupleIndices.size < gentryCount) {
      gentryCoupleIndices.add(Math.floor(gentryPickRng() * shape.coupleCount));
    }
  }

  // Founder couples: age brackets shared by both partners (within a few years of
  // each other), each with zero to three children already growing up.
  for (let c = 0; c < shape.coupleCount; c++) {
    const bracketRng = keyedRng(seed, "world", startYear, `couple-bracket-${c}`);
    const bracket = bracketRng();
    const [ageMin, ageMax] = bracket < 0.35 ? [22, 32] : bracket < 0.75 ? [30, 45] : [42, 60];

    const coupleClass: SocialClass = gentryCoupleIndices.has(c) ? "gentry" : pickCommonClass(keyedRng(seed, "world", startYear, `family-class-${familyIndex}`));

    const wifeFirst: Sex = c % 2 === 0 ? "f" : "m";
    const first = makeAdult(wifeFirst, ageMin, ageMax, familyIndex, coupleClass);
    const second = makeAdult(wifeFirst === "f" ? "m" : "f", ageMin, ageMax, familyIndex, coupleClass);
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
      // Decision 056: inherits the father's class (mother's, if the father were unknown).
      const protagonistClass = father.socialClass ?? mother.socialClass ?? "cottar";
      const literate = isLiterate(seed, "protagonist", startYear, sex, protagonistClass);
      const protagonist: Person = {
        id: "protagonist",
        name: options.protagonist.name,
        sex,
        birthYear: startYear,
        traits: [],
        job: "none",
        motherId: mother.id,
        fatherId: father.id,
        founder: false,
        mind,
        socialClass: protagonistClass,
        literate,
      };
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
      // Engine life course PR5: a famine-claimed child (see `makeChild`) gets its own backfilled
      // death, same pre-window backstory convention as the birth/marriage backfills above.
      if (child.deathYear !== undefined) {
        pushEvent(events, child.deathYear, "death", [child.id], { age: child.deathYear - child.birthYear, awayFromTown: false, cause: "great-famine", backfilled: true });
      }
    }

    // Engine life course PR5's murrain backstory marker (design's markers table: "villein/freeholder
    // founder households get a backstory marker") — the cattle murrain (1319-21) acted on FOOD, not
    // people directly (`MURRAIN_HUMAN_MULTIPLIER`), so this is narrative-only, no mortality effect.
    // Gated on `survivedFamineAsChild` (born by 1310) so it only fires for a founding generation old
    // enough to have actually lived through 1319-21 — a simulation started far from 1327 (e.g. the
    // Tudor-era default) never sees it, exactly like the famine survivor marker above.
    if (MURRAIN_MARKER_CLASSES.has(coupleClass) && (survivedFamineAsChild(mother.birthYear) || survivedFamineAsChild(father.birthYear))) {
      pushEvent(events, MURRAIN_WINDOW.start + 1, "period-marker", [mother.id, father.id], { marker: "cattle-murrain" });
    }

    familyIndex += 1;
  }

  // Unattached singles: keeps the romance pool alive from year one, spread young-to-mid adult.
  for (let s = 0; s < shape.singleCount; s++) {
    const sex: Sex = s % 2 === 0 ? "f" : "m";
    const socialClass: SocialClass = s === clergySingleIndex ? "clergy" : pickCommonClass(keyedRng(seed, "world", startYear, `family-class-${familyIndex}`));
    makeAdult(sex, 18, 38, familyIndex, socialClass);
    familyIndex += 1;
  }

  // Elders: town texture, occasional illness/death flavor, sometimes unattached.
  for (let e = 0; e < shape.elderCount; e++) {
    const sex: Sex = e % 2 === 0 ? "m" : "f";
    const socialClass = pickCommonClass(keyedRng(seed, "world", startYear, `family-class-${familyIndex}`));
    makeAdult(sex, 55, 72, familyIndex, socialClass);
    familyIndex += 1;
  }

  return { config, people, events };
}

import { keyedRng } from "./rng";
import type { JsonValue } from "./types";

/**
 * The DF-inspired inner-life model (round 4, docs/mind-model.md). Code
 * owns every write to a `PersonMind` — thoughts decay on a schedule,
 * memories are promoted to core deterministically, relationships drift by
 * fixed rules. Jev never writes to a mind; it only reads one (as JSON plus
 * a prose portrait) to answer a situation. Scaled down from DF's ~50
 * facets / ~33 values / 100+ emotions to fit in roughly 1-2k tokens of Jev
 * state, per the spec's explicit "shape, not size" framing.
 */

export const FACETS = ["bravery", "anxiety", "anger", "lovePropensity", "ambition", "greed", "altruism", "gregariousness", "perseverance", "trust", "stressVulnerability", "curiosity"] as const;
export type Facet = (typeof FACETS)[number];

export const VALUES = ["family", "tradition", "craft", "law", "independence", "faith", "wealth"] as const;
export type ValueName = (typeof VALUES)[number];

export const DREAM_GOALS = ["start a family", "master a craft", "leave for the city", "found something lasting"] as const;
export type DreamGoal = (typeof DREAM_GOALS)[number];
export type DreamStatus = "pursuing" | "realized" | "abandoned";

/**
 * Gerund/noun-phrase form of each dream goal, for prose that needs a phrase
 * to follow "dreamed of", "the dream of", "chasing", etc. — the raw
 * `DreamGoal` strings are imperative-ish ("leave for the city") and read as
 * broken grammar in that position ("dreamed of leave for the city"; round 5
 * fix, decision 023). `dream.goal` itself keeps the raw form (it's also
 * used as a plain identifier for matching against real events — see
 * `dreamGoalSatisfiedBy` in simulate.ts); only rendering goes through this.
 */
export const DREAM_GERUNDS: Record<DreamGoal, string> = {
  "start a family": "starting a family",
  "master a craft": "mastering a craft",
  "leave for the city": "leaving for the city",
  "found something lasting": "founding something lasting",
};

export function dreamGerund(goal: DreamGoal): string {
  return DREAM_GERUNDS[goal];
}

export interface Dream {
  readonly goal: DreamGoal;
  status: DreamStatus;
  readonly since: number;
}

export interface Need {
  readonly name: string;
  met: number; // 0-100
}

export interface Thought {
  readonly emotion: string;
  readonly cause: string;
  intensity: number; // 0-100
  yearsLeft: number;
  readonly year: number;
  readonly personId?: string;
}

export interface Memory {
  readonly year: number;
  readonly text: string;
  readonly emotion: string;
  readonly personId?: string;
  core: boolean;
}

export type Bond = "kin" | "friend" | "lover" | "spouse" | "rival" | "grudge";

export interface Relationship {
  readonly personId: string;
  bond: Bond;
  strength: number; // -100..100
}

export interface PersonMind {
  facets: Record<Facet, number>; // 0-100
  values: Record<ValueName, number>; // -50..50
  dream: Dream;
  needs: Need[]; // 2-3 most unmet
  thoughts: Thought[];
  stress: number; // 0-100, persisted (decays yearly)
  memories: Memory[]; // up to 5
  relationships: Relationship[]; // up to 5, kept sorted by |strength|
}

const NEED_POOL = ["companionship", "achievement", "family", "excitement", "security", "tradition", "independence"] as const;

/** Emotion valence for computing `mood` (spec: "derived: the sum of thought valences"), and for prose adjectives. */
export const EMOTION_VALENCE: Record<string, number> = {
  joy: 1,
  pride: 1,
  love: 1,
  hope: 0.6,
  relief: 0.6,
  contentment: 0.5,
  grief: -1,
  anger: -0.9,
  bitterness: -0.9,
  fear: -0.8,
  shame: -0.7,
  loneliness: -0.6,
  despair: -1,
  betrayal: -1,
  jealousy: -0.7,
};

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/** Deterministic mind creation. `parentMinds` (0, 1, or 2) blends facets/values with noise (worldgen: children inherit a noisy blend; a family shares value bias via `familyBias`). */
export function createMind(seed: string, personId: string, birthYear: number, parentMinds: readonly PersonMind[] = [], familyBias?: Partial<Record<ValueName, number>>): PersonMind {
  const facets = {} as Record<Facet, number>;
  for (const facet of FACETS) {
    const rng = keyedRng(seed, personId, birthYear, `mind-facet-${facet}`);
    if (parentMinds.length > 0) {
      const avg = parentMinds.reduce((sum, m) => sum + m.facets[facet], 0) / parentMinds.length;
      const noise = (rng() - 0.5) * 40; // +/-20
      facets[facet] = Math.round(clamp(avg + noise, 0, 100));
    } else {
      facets[facet] = Math.round(rng() * 100);
    }
  }

  const values = {} as Record<ValueName, number>;
  for (const value of VALUES) {
    const rng = keyedRng(seed, personId, birthYear, `mind-value-${value}`);
    const bias = familyBias?.[value];
    if (parentMinds.length > 0) {
      const avg = parentMinds.reduce((sum, m) => sum + m.values[value], 0) / parentMinds.length;
      const noise = (rng() - 0.5) * 30; // +/-15
      values[value] = Math.round(clamp(avg + noise, -50, 50));
    } else if (bias !== undefined) {
      const noise = (rng() - 0.5) * 20;
      values[value] = Math.round(clamp(bias + noise, -50, 50));
    } else {
      values[value] = Math.round((rng() - 0.5) * 100);
    }
  }

  const dreamRng = keyedRng(seed, personId, birthYear, "mind-dream");
  const dream: Dream = { goal: DREAM_GOALS[Math.floor(dreamRng() * DREAM_GOALS.length)]!, status: "pursuing", since: birthYear };

  const needRng = keyedRng(seed, personId, birthYear, "mind-needs");
  const pool = [...NEED_POOL];
  const needs: Need[] = [];
  for (let i = 0; i < 3 && pool.length > 0; i++) {
    const idx = Math.floor(needRng() * pool.length);
    const name = pool.splice(idx, 1)[0]!;
    needs.push({ name, met: Math.round(20 + needRng() * 50) });
  }

  return { facets, values, dream, needs, thoughts: [], stress: 0, memories: [], relationships: [] };
}

/** Sum of active thought valences, clamped. "derived: the sum of thought valences" per spec. */
export function computeMood(mind: PersonMind): number {
  const sum = mind.thoughts.reduce((total, t) => total + (EMOTION_VALENCE[t.emotion] ?? 0) * (t.intensity / 100) * 20, 0);
  return Math.round(clamp(sum, -100, 100));
}

/** Pushes one thought, scaling intensity by the relevant facet, and stacking with diminishing returns if the same (emotion, cause) already exists (RimWorld-style). */
export function pushThought(mind: PersonMind, emotion: string, cause: string, baseIntensity: number, yearsLeft: number, year: number, relevantFacet?: Facet, personId?: string): void {
  const facetBoost = relevantFacet ? mind.facets[relevantFacet] / 100 : 0.5;
  const intensity = clamp(baseIntensity * (0.5 + facetBoost), 5, 100);

  const existing = mind.thoughts.find((t) => t.emotion === emotion && t.cause === cause);
  if (existing) {
    existing.intensity = clamp(existing.intensity + intensity * 0.3, 0, 100); // diminishing returns
    existing.yearsLeft = Math.max(existing.yearsLeft, yearsLeft);
  } else {
    mind.thoughts.push({ emotion, cause, intensity, yearsLeft, year, personId });
    if (mind.thoughts.length > 8) mind.thoughts.shift();
  }
}

/** Yearly decay: every thought loses a year and expires at 0; stress drains ~20%/year scaled by anxiety (more anxious = slower drain), and rises with negative mood. */
export function decayMindForYear(mind: PersonMind): void {
  mind.thoughts = mind.thoughts.map((t) => ({ ...t, yearsLeft: t.yearsLeft - 1 })).filter((t) => t.yearsLeft > 0);

  const mood = computeMood(mind);
  if (mood < 0) mind.stress = clamp(mind.stress - mood * 0.3, 0, 100);
  const anxietyFactor = mind.facets.anxiety / 100; // more anxious -> stress lingers longer
  const drainRate = 0.2 * (1 - anxietyFactor * 0.6);
  mind.stress = clamp(mind.stress * (1 - drainRate), 0, 100);
}

/** Writes a memory for a major outcome. Returns whether it was promoted to core (spec: "about 1 in 3"). */
export function addMemory(seed: string, personId: string, year: number, mind: PersonMind, text: string, emotion: string, otherPersonId?: string): boolean {
  const coreRoll = keyedRng(seed, personId, year, `mind-memory-core-${mind.memories.length}`)();
  const core = coreRoll < 1 / 3;
  mind.memories.push({ year, text, emotion, personId: otherPersonId, core });
  if (mind.memories.length > 5) {
    // Drop the oldest non-core memory first; core memories are meant to persist ("why a betrayal at 25 still shows at 60").
    const dropIndex = mind.memories.findIndex((m) => !m.core);
    mind.memories.splice(dropIndex >= 0 ? dropIndex : 0, 1);
  }
  return core;
}

/** A core memory shifts one related facet by +/-2..5 (spec: "the only way the mind rewrites itself"). */
export function applyCoreMemoryShift(seed: string, personId: string, year: number, mind: PersonMind, facet: Facet, direction: 1 | -1): void {
  const rng = keyedRng(seed, personId, year, "mind-core-shift");
  const delta = (2 + Math.floor(rng() * 4)) * direction; // 2..5
  mind.facets[facet] = Math.round(clamp(mind.facets[facet] + delta, 0, 100));
}

/** Moves (or creates) a relationship. Value compatibility sets the drift direction: values far apart push toward a grudge, close values push toward friendship, as in DF. */
export function updateRelationship(mind: PersonMind, otherId: string, otherValues: Record<ValueName, number> | undefined, interactionDelta: number, forcedBond?: Bond): void {
  let rel = mind.relationships.find((r) => r.personId === otherId);
  if (!rel) {
    rel = { personId: otherId, bond: forcedBond ?? "friend", strength: 0 };
    mind.relationships.push(rel);
  }

  let compatibility = 0;
  if (otherValues) {
    let diffSum = 0;
    for (const v of VALUES) diffSum += Math.abs(mind.values[v] - otherValues[v]);
    compatibility = 1 - diffSum / (VALUES.length * 100); // ~[-1, 1], positive = compatible
  }

  rel.strength = Math.round(clamp(rel.strength + interactionDelta + compatibility * 5, -100, 100));
  if (forcedBond) {
    rel.bond = forcedBond;
  } else if (rel.bond !== "kin" && rel.bond !== "spouse") {
    if (rel.strength >= 50) rel.bond = "friend";
    else if (rel.strength <= -50) rel.bond = "grudge";
  }

  mind.relationships.sort((a, b) => Math.abs(b.strength) - Math.abs(a.strength));
  if (mind.relationships.length > 5) mind.relationships.length = 5;
}

// --- Portraits (DF-style band templates) ------------------------------------

const FACET_PHRASES: Record<Facet, { low: string; high: string }> = {
  bravery: { low: "is easily frightened", high: "is fearless in the face of danger" },
  anxiety: { low: "is unshakably calm", high: "is a bundle of nerves" },
  anger: { low: "rarely raises their voice", high: "is quick to anger" },
  lovePropensity: { low: "is guarded with their heart", high: "is always in love with somebody" },
  ambition: { low: "is content with a quiet life", high: "is driven to rise above their station" },
  greed: { low: "gives freely, without counting the cost", high: "hoards every coin" },
  altruism: { low: "looks out for themselves first", high: "would give a stranger the coat off their back" },
  gregariousness: { low: "keeps to themselves", high: "is never happier than in a crowd" },
  perseverance: { low: "gives up at the first setback", high: "does not know how to quit" },
  trust: { low: "is wary of strangers", high: "trusts too easily" },
  stressVulnerability: { low: "takes hardship in stride", high: "is worn thin by hardship" },
  curiosity: { low: "is set in their ways", high: "is endlessly curious" },
};

const VALUE_PHRASES: Record<ValueName, { low: string; high: string }> = {
  family: { low: "cares little for kin", high: "holds family above all" },
  tradition: { low: "scorns the old ways", high: "clings to the old ways" },
  craft: { low: "cares little how well a job is done", high: "takes deep pride in their craft" },
  law: { low: "has little respect for the town's rules", high: "believes firmly in the town's rules" },
  independence: { low: "prefers to lean on others", high: "prizes standing on their own" },
  faith: { low: "puts no stock in providence", high: "trusts in providence above all" },
  wealth: { low: "cares nothing for riches", high: "measures worth in coin" },
};

/** Short adjective/adjective-phrase form of each facet/value band, for a compact "Traits:" line — distinct from `FACET_PHRASES`/`VALUE_PHRASES`'s full sentences used in the portrait. Every band is worded so it can never be picked alongside its own opposite band for the SAME facet (the two bands of one facet are mutually exclusive by construction — see `extremeTraits`), which is what makes this immune to round 5's "cautious, reckless together" bug: that bug came from the OLD `Person.traits` random pool (no exclusivity at all), now replaced by this derivation from the mind (decision 024). */
const SHORT_FACET_WORDS: Record<Facet, { low: string; high: string }> = {
  bravery: { low: "cautious", high: "bold" },
  anxiety: { low: "unshakable", high: "anxious" },
  anger: { low: "even-tempered", high: "hot-tempered" },
  lovePropensity: { low: "guarded", high: "romantic" },
  ambition: { low: "content", high: "ambitious" },
  greed: { low: "generous", high: "greedy" },
  altruism: { low: "self-interested", high: "selfless" },
  gregariousness: { low: "reserved", high: "gregarious" },
  perseverance: { low: "quick to give up", high: "stubborn" },
  trust: { low: "wary", high: "trusting" },
  stressVulnerability: { low: "hardy", high: "easily worn down" },
  curiosity: { low: "set in their ways", high: "curious" },
};

const SHORT_VALUE_WORDS: Record<ValueName, { low: string; high: string }> = {
  family: { low: "aloof from kin", high: "family-minded" },
  tradition: { low: "unsentimental", high: "traditional" },
  craft: { low: "indifferent to craft", high: "craftsmanlike" },
  law: { low: "unruly", high: "law-abiding" },
  independence: { low: "dependent", high: "independent" },
  faith: { low: "irreligious", high: "devout" },
  wealth: { low: "unmaterialistic", high: "acquisitive" },
};

interface ExtremeTrait {
  readonly magnitude: number;
  readonly portraitPhrase: string;
  readonly shortWord: string;
}

/** Ranks every facet/value that's outside the neutral band by how extreme it is, most extreme first. Shared by `renderPortrait` (full sentences) and `traitWords` (short adjectives) so the two always agree on WHICH traits define this person — they just phrase them differently. */
function extremeTraits(mind: PersonMind): ExtremeTrait[] {
  const candidates: ExtremeTrait[] = [];
  for (const facet of FACETS) {
    const v = mind.facets[facet];
    if (v <= 39) candidates.push({ magnitude: 50 - v, portraitPhrase: FACET_PHRASES[facet].low, shortWord: SHORT_FACET_WORDS[facet].low });
    else if (v >= 61) candidates.push({ magnitude: v - 50, portraitPhrase: FACET_PHRASES[facet].high, shortWord: SHORT_FACET_WORDS[facet].high });
  }
  for (const value of VALUES) {
    const v = mind.values[value];
    if (v <= -15) candidates.push({ magnitude: -v, portraitPhrase: VALUE_PHRASES[value].low, shortWord: SHORT_VALUE_WORDS[value].low });
    else if (v >= 15) candidates.push({ magnitude: v, portraitPhrase: VALUE_PHRASES[value].high, shortWord: SHORT_VALUE_WORDS[value].high });
  }
  candidates.sort((a, b) => b.magnitude - a.magnitude);
  return candidates;
}

/**
 * Picks the person's most extreme traits (outside the neutral band) and renders a short DF-style
 * sentence. Neutral (40-60 facets, near-0 values) produces no text for that trait, per spec.
 * `resolveName` looks up the OTHER person's name for the grudge line (round 5 fix: without it,
 * this rendered a raw internal id — "has never forgiven p007" — since `PersonMind` only stores
 * `personId`, never a name, by design; the caller is the one who actually has a people lookup).
 * Optional and defaults to the id itself, so existing callers that can't easily pass one don't break.
 */
export function renderPortrait(name: string, mind: PersonMind, resolveName: (id: string) => string = (id) => id): string {
  const chosen = extremeTraits(mind)
    .slice(0, 3)
    .map((c) => c.portraitPhrase);
  if (chosen.length === 0) return `${name} is even-tempered and unremarkable in their views.`;

  const grudge = mind.relationships.find((r) => r.bond === "grudge" && r.strength <= -60);
  const grudgeText = grudge ? ` ${name} has never forgiven ${resolveName(grudge.personId)} for what passed between them.` : "";

  return `${name} ${chosen.join(", and ")}.${grudgeText}`;
}

/** Short adjective words for a compact "Traits:" display line — up to `count`, most-extreme first, derived from the SAME ranking as `renderPortrait` so the two sections of a person page never contradict each other (round 5 fix for the old random-trait-pool bug — see decision 024). Returns `[]` for a genuinely unremarkable mind (all facets/values in the neutral band). */
export function traitWords(mind: PersonMind, count = 4): string[] {
  return extremeTraits(mind)
    .slice(0, count)
    .map((c) => c.shortWord);
}

/** A compact JSON view of the mind for Jev's state — named fields, not the full internal shape (drops bookkeeping like exact yearsLeft/core flags that don't help a single judgment). */
export function compactMindState(mind: PersonMind): Record<string, JsonValue> {
  return {
    facets: { ...mind.facets },
    values: { ...mind.values },
    dream: { goal: mind.dream.goal, status: mind.dream.status },
    needs: mind.needs.map((n) => `${n.name} (${n.met}% met)`),
    mood: computeMood(mind),
    stress: mind.stress,
    thoughts: mind.thoughts.slice(0, 4).map((t) => `${t.emotion}: ${t.cause}`),
    memories: mind.memories.slice(0, 3).map((m) => m.text),
    relationshipSummary: {
      friends: mind.relationships.filter((r) => r.bond === "friend").length,
      grudges: mind.relationships.filter((r) => r.bond === "grudge" || r.bond === "rival").length,
    },
  };
}

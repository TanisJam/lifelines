import { keyedRng } from "./rng";
import type { Job } from "./types";

/**
 * "At least one entry per year" (round 10, decision 042): when the protagonist has no other
 * situation or event in a simulated year, `simulate.ts` presents ONE everyday-life vignette
 * instead — a real `D1` Jev decision (2-3 options, a first-person question) chosen deterministically
 * from this pool, appropriate to age, place, household, job and the current town event. This is
 * implemented as a single generic `DecisionKind` (`D1`) parameterized by a `vignette` id in the
 * question's `situation` state, per the brief's "don't add dozens of kinds" — everything
 * vignette-specific (eligibility, wording, the two outcomes' prose and mind effects) lives HERE,
 * never in a per-vignette `DecisionKind`.
 */

export interface VignetteContext {
  readonly age: number;
  readonly away: boolean;
  readonly job: Job;
  readonly hasSpouse: boolean;
  readonly hasChild: boolean;
  readonly hasLivingParent: boolean;
  readonly hasLivingSibling: boolean;
  /** From `town.ts#seasonFor` — purely atmospheric elsewhere, but a REAL eligibility input here (a "hard winter" vignette only fires in winter). */
  readonly season: string;
  readonly townEventType?: string;
}

/** Who, if anyone, this outcome nudges a relationship with — resolved to a concrete id by `simulate.ts` (it alone knows the protagonist's actual spouse/parent/sibling/child ids). */
export type VignetteRelationshipTarget = "spouse" | "parent" | "sibling" | "child";

export interface VignetteOutcome {
  readonly emotion: string;
  readonly cause: (name: string, townName: string) => string;
  readonly intensity: number;
  readonly duration: number;
  readonly facet?: string;
  /** Also written to `mind.memories`, not just a decaying thought — for the outcome worth remembering later. */
  readonly memorable?: boolean;
  readonly relationshipTarget?: VignetteRelationshipTarget;
  readonly relationshipDelta?: number;
  readonly prose: (name: string, townName: string) => string;
  readonly optionDescription: string;
}

export interface Vignette {
  readonly id: string;
  readonly title: (townName: string) => string;
  readonly question: (townName: string) => string;
  readonly eligible: (ctx: VignetteContext) => boolean;
  readonly outcomes: Readonly<Record<string, VignetteOutcome>>;
}

function outcome(spec: Omit<VignetteOutcome, "cause" | "prose"> & { readonly cause: string | ((name: string, townName: string) => string); readonly prose: (name: string, townName: string) => string }): VignetteOutcome {
  return { ...spec, cause: typeof spec.cause === "string" ? () => spec.cause as string : spec.cause };
}

export const VIGNETTES: readonly Vignette[] = [
  {
    id: "hard-winter",
    title: () => "A hard winter",
    question: () => "The winter is hard, and a neighbor's family is going hungry. Do I share our grain?",
    eligible: (ctx) => !ctx.away && ctx.season === "the depths of winter",
    outcomes: {
      "share-grain": outcome({
        emotion: "contentment",
        cause: "sharing grain with a hungry neighbor through a hard winter",
        intensity: 35,
        duration: 3,
        facet: "altruism",
        memorable: true,
        prose: (name) => `${name} shared the last of the grain with a hungry neighbor, through a hard winter.`,
        optionDescription: "The winter is hard, but I share what grain we have with the neighbor who's going hungry.",
      }),
      "keep-grain": outcome({
        emotion: "relief",
        cause: "keeping our own grain through a hard winter",
        intensity: 20,
        duration: 2,
        prose: (name) => `${name} kept close to home through a hard winter, grain rationed carefully.`,
        optionDescription: "The winter is hard, and I keep our own grain close rather than risk our own family going hungry.",
      }),
    },
  },
  {
    id: "poor-harvest",
    title: () => "A poor harvest",
    question: () => "The harvest fell short this year. Do I tighten my belt without complaint?",
    eligible: (ctx) => !ctx.away && ctx.season === "the golden days of autumn" && ctx.townEventType !== "harvest",
    outcomes: {
      "tighten-belt": outcome({
        emotion: "regret",
        cause: "tightening the belt after a poor harvest",
        intensity: 20,
        duration: 2,
        facet: "perseverance",
        prose: (name) => `${name} tightened the belt and said nothing, through a poor harvest.`,
        optionDescription: "The harvest fell short, but I tighten my belt and say nothing about it.",
      }),
      "grumble-openly": outcome({
        emotion: "bitterness",
        cause: "grumbling over a poor harvest",
        intensity: 20,
        duration: 2,
        prose: (name) => `${name} grumbled openly about a poor harvest, same as everyone else.`,
        optionDescription: "The harvest fell short, and I grumble openly about it, same as everyone else.",
      }),
    },
  },
  {
    id: "good-harvest",
    title: (townName) => `A good harvest in ${townName}`,
    question: () => "It's been a good harvest this year. Do I give thanks openly at the feast?",
    eligible: (ctx) => !ctx.away && ctx.season === "the golden days of autumn" && ctx.townEventType === "harvest",
    outcomes: {
      "give-thanks": outcome({
        emotion: "joy",
        cause: "giving thanks openly at the harvest feast",
        intensity: 30,
        duration: 2,
        facet: "gregariousness",
        prose: (name, townName) => `${name} gave thanks openly at the harvest feast in ${townName}.`,
        optionDescription: "It's been a good harvest, and I give thanks for it openly, at the feast.",
      }),
      "keep-quiet": outcome({
        emotion: "contentment",
        cause: "a quiet relief at a good harvest",
        intensity: 15,
        duration: 1,
        prose: (name) => `${name} kept the relief of a good harvest quietly, without much fuss.`,
        optionDescription: "It's been a good harvest, but I keep my relief about it quiet, without much fuss.",
      }),
    },
  },
  {
    id: "market-day",
    title: (townName) => `Market day in ${townName}`,
    question: (townName) => `It's market day in ${townName}. Do I haggle hard over the price, or pay what's asked?`,
    eligible: (ctx) => !ctx.away && ctx.age >= 10,
    outcomes: {
      haggle: outcome({
        emotion: "pride",
        cause: "haggling hard at market day",
        intensity: 20,
        duration: 2,
        facet: "greed",
        prose: (name, townName) => `${name} haggled hard at market day in ${townName}, and came away pleased with the bargain.`,
        optionDescription: "It's market day, and I haggle hard over the price.",
      }),
      "pay-fair": outcome({
        emotion: "contentment",
        cause: "paying a fair price without haggling",
        intensity: 15,
        duration: 1,
        facet: "altruism",
        prose: (name, townName) => `${name} paid a fair price without haggling, at market day in ${townName}.`,
        optionDescription: "It's market day, and I pay what's asked without haggling.",
      }),
    },
  },
  {
    id: "learning-a-skill",
    title: () => "Learning the trade",
    question: () => "A parent is teaching me a skill today. Do I pay close attention?",
    eligible: (ctx) => !ctx.away && ctx.age < 13 && ctx.hasLivingParent,
    outcomes: {
      focus: outcome({
        emotion: "pride",
        cause: "paying close attention to a parent's lesson",
        intensity: 25,
        duration: 2,
        facet: "perseverance",
        relationshipTarget: "parent",
        relationshipDelta: 8,
        prose: (name) => `${name} paid close attention as a parent taught an early skill of the trade.`,
        optionDescription: "A parent is teaching me a skill today, and I pay close attention.",
      }),
      "wander-off": outcome({
        emotion: "hope",
        cause: "letting attention wander toward play instead of a lesson",
        intensity: 15,
        duration: 1,
        prose: (name) => `${name} let attention wander, more interested in play than the lesson.`,
        optionDescription: "A parent is teaching me a skill today, but my attention wanders toward play instead.",
      }),
    },
  },
  {
    id: "sibling-quarrel",
    title: () => "A quarrel with a sibling",
    question: () => "A quarrel with a sibling has left things tense. Do I make peace first?",
    eligible: (ctx) => ctx.hasLivingSibling && ctx.age >= 8,
    outcomes: {
      "make-peace": outcome({
        emotion: "relief",
        cause: "making the first move to patch things up with a sibling",
        intensity: 25,
        duration: 2,
        facet: "altruism",
        relationshipTarget: "sibling",
        relationshipDelta: 15,
        prose: (name) => `${name} made the first move to patch things up after a quarrel with a sibling.`,
        optionDescription: "A quarrel with a sibling has left things tense, and I make the first move to patch things up.",
      }),
      "stay-cross": outcome({
        emotion: "bitterness",
        cause: "staying cross with a sibling long after a quarrel",
        intensity: 20,
        duration: 2,
        facet: "anger",
        relationshipTarget: "sibling",
        relationshipDelta: -10,
        prose: (name) => `${name} stayed cross with a sibling long after the quarrel should have passed.`,
        optionDescription: "A quarrel with a sibling has left things tense, and I stay cross rather than make peace.",
      }),
    },
  },
  {
    id: "neighbor-needs-help",
    title: () => "A neighbor in need",
    question: () => "A neighbor could use a hand with hard, unglamorous work. Do I help?",
    eligible: (ctx) => !ctx.away && ctx.age >= 16,
    outcomes: {
      help: outcome({
        emotion: "contentment",
        cause: "helping a neighbor with hard, unglamorous work",
        intensity: 30,
        duration: 3,
        facet: "altruism",
        memorable: true,
        prose: (name) => `${name} spent the day helping a neighbor with hard, unglamorous work.`,
        optionDescription: "A neighbor could use a hand with hard, unglamorous work, and I help.",
      }),
      decline: outcome({
        emotion: "regret",
        cause: "letting a neighbor's request for help go unanswered",
        intensity: 15,
        duration: 1,
        prose: (name) => `${name} had troubles enough of their own, and let a neighbor's request go unanswered.`,
        optionDescription: "A neighbor could use a hand with hard, unglamorous work, but I have troubles enough of my own.",
      }),
    },
  },
  {
    id: "first-glance",
    title: () => "A first glance",
    question: () => "Someone caught my eye today. Do I find a reason to speak with them?",
    eligible: (ctx) => ctx.age >= 14 && ctx.age <= 30 && !ctx.hasSpouse,
    outcomes: {
      approach: outcome({
        emotion: "hope",
        cause: "finding a reason to speak with someone who caught my eye",
        intensity: 25,
        duration: 2,
        facet: "gregariousness",
        prose: (name) => `${name} found a reason to speak with someone who'd caught an eye, if only for a moment.`,
        optionDescription: "Someone caught my eye today, and I find a reason to speak with them.",
      }),
      "hold-back": outcome({
        emotion: "loneliness",
        cause: "saying nothing to someone who caught my eye",
        intensity: 15,
        duration: 1,
        prose: (name) => `${name} noticed someone who caught an eye, and said nothing at all.`,
        optionDescription: "Someone caught my eye today, but I hold back and say nothing.",
      }),
    },
  },
  {
    id: "feast-day",
    title: (townName) => `A feast day in ${townName}`,
    question: (townName) => `It's a feast day in ${townName}. Do I join in the festivities?`,
    // The universal fallback (round 10, decision 042): eligible in every context, so `pickVignette`
    // never comes up empty regardless of age, place, household or season.
    eligible: () => true,
    outcomes: {
      "join-in": outcome({
        emotion: "joy",
        cause: "joining in a feast-day's festivities",
        intensity: 20,
        duration: 2,
        facet: "gregariousness",
        prose: (name, townName) => `${name} joined in the feast-day festivities in ${townName}, if only for an evening.`,
        optionDescription: "It's a feast day, and I join in the festivities.",
      }),
      "keep-to-self": outcome({
        emotion: "loneliness",
        cause: "keeping to home on a feast day",
        intensity: 15,
        duration: 1,
        prose: (name, townName) => `${name} kept to home on a feast day, while ${townName} celebrated without them.`,
        optionDescription: "It's a feast day, but I keep to home rather than join in.",
      }),
    },
  },
  {
    id: "sick-animal",
    title: () => "A sick animal",
    question: () => "One of the animals has fallen sick. Do I sit up nursing it through the night?",
    eligible: (ctx) => !ctx.away && ctx.job === "farmer",
    outcomes: {
      "nurse-it": outcome({
        emotion: "contentment",
        cause: "nursing a sick animal through the night",
        intensity: 20,
        duration: 2,
        facet: "perseverance",
        prose: (name) => `${name} sat up through the night nursing a sick animal back to health.`,
        optionDescription: "One of the animals has fallen sick, and I sit up nursing it through the night.",
      }),
      "let-it-go": outcome({
        emotion: "regret",
        cause: "letting a sick animal go rather than losing sleep over it",
        intensity: 15,
        duration: 1,
        prose: (name) => `${name} let a sick animal go, rather than lose sleep over it.`,
        optionDescription: "One of the animals has fallen sick, and I let it go rather than lose sleep over it.",
      }),
    },
  },
  {
    id: "old-debt",
    title: () => "An old debt",
    question: () => "An old debt has come due. Do I pay it off, even if it costs me?",
    eligible: (ctx) => ctx.age >= 20,
    outcomes: {
      "pay-it-off": outcome({
        emotion: "relief",
        cause: "paying off an old debt whatever it cost",
        intensity: 20,
        duration: 2,
        facet: "perseverance",
        prose: (name) => `${name} paid off an old debt, whatever it cost.`,
        optionDescription: "An old debt has come due, and I pay it off, even if it costs me.",
      }),
      "let-it-ride": outcome({
        emotion: "fear",
        cause: "letting an old debt ride another year",
        intensity: 15,
        duration: 2,
        prose: (name) => `${name} let an old debt ride another year, and felt the weight of it.`,
        optionDescription: "An old debt has come due, and I let it ride another year.",
      }),
    },
  },
  {
    id: "teaching-a-child",
    title: () => "Teaching a child the trade",
    question: () => "A child is old enough to start learning the trade. Do I teach patiently, or push them along briskly?",
    eligible: (ctx) => !ctx.away && ctx.hasChild && ctx.job !== "none",
    outcomes: {
      "teach-patiently": outcome({
        emotion: "contentment",
        cause: "teaching a child the trade patiently",
        intensity: 25,
        duration: 3,
        facet: "altruism",
        memorable: true,
        relationshipTarget: "child",
        relationshipDelta: 10,
        prose: (name) => `${name} taught a child the trade patiently, one small task at a time.`,
        optionDescription: "A child is old enough to start learning the trade, and I teach patiently.",
      }),
      "teach-briskly": outcome({
        emotion: "pride",
        cause: "pushing a child briskly through the first lessons of the trade",
        intensity: 20,
        duration: 2,
        facet: "ambition",
        relationshipTarget: "child",
        relationshipDelta: -2,
        prose: (name) => `${name} pushed a child briskly through the first lessons of the trade.`,
        optionDescription: "A child is old enough to start learning the trade, and I push them along briskly.",
      }),
    },
  },
  {
    id: "aches-of-age",
    title: () => "The aches of age",
    question: () => "The aches of age are catching up. Do I push through the day's work all the same?",
    eligible: (ctx) => ctx.age >= 60,
    outcomes: {
      "push-through": outcome({
        emotion: "pride",
        cause: "pushing through the aches of age to get the work done",
        intensity: 20,
        duration: 2,
        facet: "perseverance",
        prose: (name) => `${name} pushed through the aches of age to get the day's work done.`,
        optionDescription: "The aches of age are catching up, but I push through the day's work all the same.",
      }),
      rest: outcome({
        emotion: "relief",
        cause: "resting instead of fighting through the aches of age",
        intensity: 15,
        duration: 1,
        prose: (name) => `${name} gave in to the aches of age and rested, for once.`,
        optionDescription: "The aches of age are catching up, and I rest instead of pushing through.",
      }),
    },
  },
] as const;

const VIGNETTES_BY_ID = new Map(VIGNETTES.map((v) => [v.id, v]));

export function getVignette(id: string): Vignette | undefined {
  return VIGNETTES_BY_ID.get(id);
}

/** Every vignette's option id -> Jev criteria description, flattened (round 10, decision 042). Option ids are unique across the whole pool. */
export const VIGNETTE_OPTION_DESCRIPTIONS: Readonly<Record<string, string>> = Object.fromEntries(
  VIGNETTES.flatMap((v) => Object.entries(v.outcomes).map(([option, o]) => [option, o.optionDescription])),
);

/**
 * Deterministically picks one eligible vignette for this protagonist-year (keyed RNG, same seed +
 * personId + year always agrees) — `feast-day`'s universal eligibility guarantees this never comes
 * up empty.
 */
export function pickVignette(seed: string, personId: string, year: number, ctx: VignetteContext): Vignette {
  const eligible = VIGNETTES.filter((v) => v.eligible(ctx));
  const pool = eligible.length > 0 ? eligible : VIGNETTES;
  const rng = keyedRng(seed, personId, year, "D1-vignette-pick");
  return pool[Math.floor(rng() * pool.length)]!;
}

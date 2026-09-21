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
  /**
   * Round 10, decision 043: an infant/toddler (age 0-5) can't actually make this call — `simulate.ts`
   * attributes the decision to a living parent instead (mother preferred, then father, same
   * preference `relationshipTargetId("parent", ...)` already uses), exactly like `AP1`'s "other
   * person's decision about the protagonist." The protagonist still lives the outcome (the thought,
   * the memory, the relationship nudge) — only who gets credit as `deciderId` changes.
   */
  readonly decidedByParent?: boolean;
}

function outcome(spec: Omit<VignetteOutcome, "cause" | "prose"> & { readonly cause: string | ((name: string, townName: string) => string); readonly prose: (name: string, townName: string) => string }): VignetteOutcome {
  return { ...spec, cause: typeof spec.cause === "string" ? () => spec.cause as string : spec.cause };
}

export const VIGNETTES: readonly Vignette[] = [
  {
    id: "hard-winter",
    title: () => "A hard winter",
    question: () => "The winter is hard, and a neighbor's family is going hungry. Do I share our grain?",
    eligible: (ctx) => !ctx.away && ctx.age >= 3 && ctx.season === "the depths of winter",
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
    eligible: (ctx) => !ctx.away && ctx.age >= 3 && ctx.season === "the golden days of autumn" && ctx.townEventType !== "harvest",
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
    eligible: (ctx) => !ctx.away && ctx.age >= 3 && ctx.season === "the golden days of autumn" && ctx.townEventType === "harvest",
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
    // Age floor added round 10, decision 043 — self-decided ("do I pay close attention?"), so a
    // toddler too young to actually decide anything shouldn't be offered it; the new `decidedByParent`
    // early-childhood pool covers age 0-5 instead.
    eligible: (ctx) => !ctx.away && ctx.age >= 6 && ctx.age < 13 && ctx.hasLivingParent,
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
    // The universal fallback for anyone past infancy (round 10, decision 042; age floor added round
    // 10, decision 043 — an infant can't decide whether to join a feast). `pickVignette` still never
    // comes up empty for age < 3, thanks to decision 043's `decidedByParent` early-childhood pool.
    eligible: (ctx) => ctx.age >= 3,
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

  // --- Round 10, decision 043: age-appropriate vignettes for a young protagonist -----------------
  // (the pool above skews adult — see decision 042's disclosed gap; a child's life was repeating
  // "Learning the trade"). Three bands, matching the brief: early childhood (0-5, `decidedByParent`
  // — an infant/toddler can't make these calls themselves), childhood (6-12, self-decided in
  // simple terms, same as the existing `learning-a-skill`), and youth (13-19).

  {
    id: "fever-scare",
    title: () => "A fever scare",
    question: () => "A fever came on hard in the night. Do I sit up watching over the cradle, or trust it will pass?",
    eligible: (ctx) => ctx.age <= 5 && ctx.hasLivingParent,
    decidedByParent: true,
    outcomes: {
      "watch-the-night": outcome({
        emotion: "relief",
        cause: "sitting up all night watching over a feverish child",
        intensity: 30,
        duration: 3,
        facet: "altruism",
        memorable: true,
        prose: (name) => `${name} sat up all night watching over a feverish child, until the fever broke.`,
        optionDescription: "A fever came on hard in the night, and I sit up watching over the cradle.",
      }),
      "trust-it-passes": outcome({
        emotion: "hope",
        cause: "trusting a child's fever would pass on its own",
        intensity: 15,
        duration: 2,
        prose: (name) => `${name} trusted the fever would pass on its own, and it did, by morning.`,
        optionDescription: "A fever came on hard in the night, but I trust it will pass on its own.",
      }),
    },
  },
  {
    id: "first-steps",
    title: () => "A first, wobbling step",
    question: () => "The child took a first wobbling step today. Do I make much of it?",
    eligible: (ctx) => ctx.age <= 5 && ctx.hasLivingParent,
    decidedByParent: true,
    outcomes: {
      "make-much-of-it": outcome({
        emotion: "joy",
        cause: "making much of a child's first wobbling step",
        intensity: 30,
        duration: 2,
        facet: "gregariousness",
        memorable: true,
        prose: (name) => `${name} made much of a first wobbling step, delighted, the whole house called to see.`,
        optionDescription: "The child took a first wobbling step today, and I make much of it.",
      }),
      "note-it-quietly": outcome({
        emotion: "contentment",
        cause: "noting a child's first wobbling step quietly",
        intensity: 15,
        duration: 1,
        prose: (name) => `${name} noted a first wobbling step quietly, pleased, and went back to the day's work.`,
        optionDescription: "The child took a first wobbling step today, but I note it quietly and go back to work.",
      }),
    },
  },
  {
    id: "new-sibling",
    title: () => "A new sibling",
    question: () => "There's a new little one in the house now. Do I make room for them gladly?",
    eligible: (ctx) => ctx.age <= 5 && ctx.hasLivingParent,
    decidedByParent: true,
    outcomes: {
      "make-room-gladly": outcome({
        emotion: "contentment",
        cause: "making room gladly for a new little one in the house",
        intensity: 20,
        duration: 2,
        facet: "altruism",
        prose: (name) => `${name} made room gladly for a new little one in the house.`,
        optionDescription: "There's a new little one in the house, and I make room for them gladly.",
      }),
      "mind-the-fuss": outcome({
        emotion: "bitterness",
        cause: "minding the fuss made over a new sibling",
        intensity: 15,
        duration: 2,
        prose: (name) => `${name} minded the fuss over a new sibling, a little put out by it.`,
        optionDescription: "There's a new little one in the house, and I mind the fuss made over them.",
      }),
    },
  },
  {
    id: "lost-in-the-woods",
    title: () => "Lost in the woods",
    question: () => "The child wandered off and was lost near the woods for an hour. Do I forbid wandering after, or let the world stay wide?",
    eligible: (ctx) => ctx.age <= 5 && ctx.hasLivingParent,
    decidedByParent: true,
    outcomes: {
      "forbid-wandering": outcome({
        emotion: "fear",
        cause: "forbidding wandering after a child was lost near the woods",
        intensity: 25,
        duration: 2,
        prose: (name) => `${name} forbade wandering near the woods after that, and kept a closer watch.`,
        optionDescription: "The child was lost near the woods for an hour, and I forbid wandering after that.",
      }),
      "let-the-world-stay-wide": outcome({
        emotion: "relief",
        cause: "letting the world stay wide even after a child went missing near the woods",
        intensity: 20,
        duration: 2,
        facet: "curiosity",
        prose: (name) => `${name} let the world stay wide, relieved to have the child back, unwilling to fence it in.`,
        optionDescription: "The child was lost near the woods for an hour, but I let the world stay wide all the same.",
      }),
    },
  },
  {
    id: "village-festival-childs-eyes",
    title: () => "A village festival, through young eyes",
    question: () => "The village festival dazzled the child completely. Do I let them stay up late taking it all in?",
    eligible: (ctx) => ctx.age <= 5 && ctx.hasLivingParent,
    decidedByParent: true,
    outcomes: {
      "let-them-stay-up": outcome({
        emotion: "joy",
        cause: "letting a dazzled child stay up late for the village festival",
        intensity: 25,
        duration: 2,
        facet: "gregariousness",
        memorable: true,
        prose: (name) => `${name} let the child stay up late, dazzled, taking in every last moment of the village festival.`,
        optionDescription: "The village festival dazzled the child completely, and I let them stay up late taking it in.",
      }),
      "send-them-to-bed": outcome({
        emotion: "contentment",
        cause: "sending a dazzled child off to bed early despite the village festival",
        intensity: 15,
        duration: 1,
        prose: (name) => `${name} sent the child off to bed early, festival or no, and stood watch over an easier sleep.`,
        optionDescription: "The village festival dazzled the child completely, but I send them to bed early all the same.",
      }),
    },
  },
  {
    id: "helping-in-the-fields",
    title: () => "Helping in the fields",
    question: () => "There's work to be done in the fields today. Do I pitch in properly, or slip off to play?",
    eligible: (ctx) => !ctx.away && ctx.age >= 6 && ctx.age <= 12,
    outcomes: {
      "pitch-in": outcome({
        emotion: "pride",
        cause: "pitching in properly with work in the fields",
        intensity: 20,
        duration: 2,
        facet: "perseverance",
        prose: (name) => `${name} pitched in properly in the fields, small hands doing what they could.`,
        optionDescription: "There's work to be done in the fields today, and I pitch in properly.",
      }),
      "slip-off-to-play": outcome({
        emotion: "joy",
        cause: "slipping off to play instead of working in the fields",
        intensity: 15,
        duration: 1,
        prose: (name) => `${name} slipped off to play instead, and no one minded much, this once.`,
        optionDescription: "There's work to be done in the fields today, but I slip off to play instead.",
      }),
    },
  },
  {
    id: "friends-secret",
    title: () => "A friend's secret",
    question: () => "A friend told me a secret and made me swear not to tell. Do I keep it?",
    eligible: (ctx) => ctx.age >= 6 && ctx.age <= 12,
    outcomes: {
      "keep-it": outcome({
        emotion: "pride",
        cause: "keeping a friend's secret, sworn to it",
        intensity: 20,
        duration: 2,
        facet: "altruism",
        prose: (name) => `${name} kept a friend's secret, sworn to it, and never told a soul.`,
        optionDescription: "A friend told me a secret and made me swear not to tell, and I keep it.",
      }),
      "let-it-slip": outcome({
        emotion: "regret",
        cause: "letting a friend's secret slip",
        intensity: 20,
        duration: 2,
        prose: (name) => `${name} let a friend's secret slip, and regretted it after.`,
        optionDescription: "A friend told me a secret and made me swear not to tell, but I let it slip.",
      }),
    },
  },
  {
    id: "scolding-from-the-priest",
    title: () => "A scolding from the priest",
    question: () => "The priest scolded me sharply in front of others today. Do I take it to heart?",
    eligible: (ctx) => !ctx.away && ctx.age >= 6 && ctx.age <= 12,
    outcomes: {
      "take-it-to-heart": outcome({
        emotion: "regret",
        cause: "taking a sharp scolding from the priest to heart",
        intensity: 20,
        duration: 2,
        facet: "perseverance",
        prose: (name) => `${name} took a sharp scolding from the priest to heart, and minded manners closer after.`,
        optionDescription: "The priest scolded me sharply in front of others today, and I take it to heart.",
      }),
      "shrug-it-off": outcome({
        emotion: "bitterness",
        cause: "shrugging off a scolding from the priest",
        intensity: 15,
        duration: 1,
        facet: "anger",
        prose: (name) => `${name} shrugged off the priest's scolding, and was back to old mischief by supper.`,
        optionDescription: "The priest scolded me sharply in front of others today, but I shrug it off.",
      }),
    },
  },
  {
    id: "a-stray-dog",
    title: () => "A stray dog",
    question: () => "A stray dog has been hanging round the house, thin and wary. Do I feed it?",
    eligible: (ctx) => !ctx.away && ctx.age >= 6 && ctx.age <= 12,
    outcomes: {
      "feed-it": outcome({
        emotion: "contentment",
        cause: "feeding a thin, wary stray dog",
        intensity: 20,
        duration: 2,
        facet: "altruism",
        memorable: true,
        prose: (name) => `${name} fed a thin, wary stray dog that had taken to hanging round the house.`,
        optionDescription: "A stray dog has been hanging round the house, thin and wary, and I feed it.",
      }),
      "chase-it-off": outcome({
        emotion: "regret",
        cause: "chasing off a stray dog hanging round the house",
        intensity: 15,
        duration: 1,
        prose: (name) => `${name} chased the stray dog off, though it lingered nearby for days after.`,
        optionDescription: "A stray dog has been hanging round the house, thin and wary, and I chase it off.",
      }),
    },
  },
  {
    id: "a-fight-with-another-child",
    title: () => "A fight with another child",
    question: () => "A fight broke out with another child today. Do I throw the first punch, or walk away?",
    eligible: (ctx) => !ctx.away && ctx.age >= 6 && ctx.age <= 12,
    outcomes: {
      "throw-the-first-punch": outcome({
        emotion: "pride",
        cause: "throwing the first punch in a fight with another child",
        intensity: 20,
        duration: 2,
        facet: "anger",
        prose: (name) => `${name} threw the first punch in a fight with another child, and came home with a bloody lip and swagger both.`,
        optionDescription: "A fight broke out with another child today, and I throw the first punch.",
      }),
      "walk-away": outcome({
        emotion: "relief",
        cause: "walking away from a fight with another child",
        intensity: 15,
        duration: 1,
        facet: "perseverance",
        prose: (name) => `${name} walked away from a fight with another child, though it cost something to do it.`,
        optionDescription: "A fight broke out with another child today, but I walk away from it.",
      }),
    },
  },
  {
    id: "carrying-water-in-winter",
    title: () => "Carrying water in winter",
    question: () => "The well is a long, icy walk away this winter. Do I fetch the water without complaint?",
    eligible: (ctx) => !ctx.away && ctx.age >= 6 && ctx.age <= 12 && ctx.season === "the depths of winter",
    outcomes: {
      "fetch-without-complaint": outcome({
        emotion: "pride",
        cause: "fetching water from the icy well all winter without complaint",
        intensity: 20,
        duration: 2,
        facet: "perseverance",
        prose: (name) => `${name} fetched water from the icy well all winter, without complaint.`,
        optionDescription: "The well is a long, icy walk away this winter, and I fetch the water without complaint.",
      }),
      "grumble-about-it": outcome({
        emotion: "bitterness",
        cause: "grumbling about the long, icy walk to the well",
        intensity: 15,
        duration: 1,
        prose: (name) => `${name} grumbled about the long, icy walk to the well, all winter long.`,
        optionDescription: "The well is a long, icy walk away this winter, and I grumble about it.",
      }),
    },
  },
  {
    id: "first-dance-at-the-feast",
    title: () => "A first dance at the feast",
    question: () => "There's a feast on, and dancing. Do I take the floor?",
    eligible: (ctx) => !ctx.away && ctx.age >= 13 && ctx.age <= 19,
    outcomes: {
      "take-the-floor": outcome({
        emotion: "joy",
        cause: "taking the floor for a first dance at the feast",
        intensity: 25,
        duration: 2,
        facet: "gregariousness",
        memorable: true,
        prose: (name) => `${name} took the floor for a first dance at the feast, nerves and all.`,
        optionDescription: "There's a feast on, and dancing, and I take the floor.",
      }),
      "watch-from-the-edge": outcome({
        emotion: "loneliness",
        cause: "watching the dancing from the edge of the feast",
        intensity: 15,
        duration: 1,
        prose: (name) => `${name} watched the dancing from the edge of the feast, working up the nerve that never quite came.`,
        optionDescription: "There's a feast on, and dancing, but I watch from the edge instead.",
      }),
    },
  },
  {
    id: "a-dare",
    title: () => "A dare",
    question: () => "Friends have dared me to something reckless. Do I go through with it?",
    eligible: (ctx) => !ctx.away && ctx.age >= 13 && ctx.age <= 19,
    outcomes: {
      "go-through-with-it": outcome({
        emotion: "pride",
        cause: "going through with a reckless dare",
        intensity: 25,
        duration: 2,
        facet: "ambition",
        memorable: true,
        prose: (name) => `${name} went through with a reckless dare, and dined out on the story after.`,
        optionDescription: "Friends have dared me to something reckless, and I go through with it.",
      }),
      "back-down": outcome({
        emotion: "relief",
        cause: "backing down from a reckless dare",
        intensity: 15,
        duration: 1,
        prose: (name) => `${name} backed down from a reckless dare, and took some ribbing for it.`,
        optionDescription: "Friends have dared me to something reckless, but I back down.",
      }),
    },
  },
  {
    id: "work-alongside-a-master",
    title: () => "Work alongside a master",
    question: () => "A master craftsman has taken me on for the day. Do I work hard to impress?",
    eligible: (ctx) => !ctx.away && ctx.age >= 13 && ctx.age <= 19 && ctx.job !== "none",
    outcomes: {
      "work-hard-to-impress": outcome({
        emotion: "pride",
        cause: "working hard alongside a master craftsman to impress",
        intensity: 20,
        duration: 2,
        facet: "ambition",
        prose: (name) => `${name} worked hard alongside a master craftsman, hoping to impress.`,
        optionDescription: "A master craftsman has taken me on for the day, and I work hard to impress.",
      }),
      "keep-to-the-minimum": outcome({
        emotion: "contentment",
        cause: "keeping to the minimum of what was asked, working alongside a master craftsman",
        intensity: 15,
        duration: 1,
        prose: (name) => `${name} kept to the minimum of what was asked, working alongside a master craftsman for the day.`,
        optionDescription: "A master craftsman has taken me on for the day, but I keep to the minimum of what's asked.",
      }),
    },
  },
  {
    id: "argument-with-a-parent-over-the-future",
    title: () => "An argument over the future",
    question: () => "A parent and I argued sharply over what's to become of me. Do I hold my ground?",
    eligible: (ctx) => ctx.age >= 13 && ctx.age <= 19 && ctx.hasLivingParent,
    outcomes: {
      "hold-my-ground": outcome({
        emotion: "pride",
        cause: "holding ground in a sharp argument with a parent over the future",
        intensity: 25,
        duration: 3,
        facet: "ambition",
        relationshipTarget: "parent",
        relationshipDelta: -5,
        prose: (name) => `${name} held ground in a sharp argument with a parent over what's to become of them.`,
        optionDescription: "A parent and I argued sharply over what's to become of me, and I hold my ground.",
      }),
      "back-down-for-peace": outcome({
        emotion: "relief",
        cause: "backing down for the sake of peace, in an argument with a parent over the future",
        intensity: 15,
        duration: 2,
        relationshipTarget: "parent",
        relationshipDelta: 5,
        prose: (name) => `${name} backed down for the sake of peace, in an argument with a parent over the future.`,
        optionDescription: "A parent and I argued sharply over what's to become of me, and I back down for peace.",
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
 * up empty. `recentIds` (round 10, decision 043), when given, excludes any vignette used within the
 * last 5 years of this same life — a deterministic exclusion, not a re-roll: if every eligible
 * vignette was recently used, the exclusion is dropped rather than leaving the year without one.
 */
export function pickVignette(seed: string, personId: string, year: number, ctx: VignetteContext, recentIds?: ReadonlySet<string>): Vignette {
  const eligible = VIGNETTES.filter((v) => v.eligible(ctx));
  const notRecentlyUsed = recentIds ? eligible.filter((v) => !recentIds.has(v.id)) : eligible;
  const pool = notRecentlyUsed.length > 0 ? notRecentlyUsed : eligible.length > 0 ? eligible : VIGNETTES;
  const rng = keyedRng(seed, personId, year, "D1-vignette-pick");
  return pool[Math.floor(rng() * pool.length)]!;
}

import type { Locale } from "./locale";
import { keyedRng } from "./rng";
import type { Job, SocialClass } from "./types";

/**
 * "At least one entry per year" (round 10, decision 042): when the protagonist has no other
 * situation or event in a simulated year, `simulate.ts` presents ONE everyday-life vignette
 * instead — a real `D1` Jev decision (2-3 options, a first-person question) chosen deterministically
 * from this pool, appropriate to age, place, household, job and the current town event. This is
 * implemented as a single generic `DecisionKind` (`D1`) parameterized by a `vignette` id in the
 * question's `situation` state, per the brief's "don't add dozens of kinds" — everything
 * vignette-specific (eligibility, wording, the two outcomes' prose and mind effects) lives HERE,
 * never in a per-vignette `DecisionKind`.
 *
 * Decision 059: `title`/`question`/an outcome's `prose` all take a `Locale` as their first argument
 * and pick between an English and a Spanish template — the display half of this file. `cause` and
 * `optionDescription` stay English-only: `cause` is only ever read back by `narrateThought`/
 * `narrateMemory` (neither is wired into a page yet — a disclosed gap, not a regression), and
 * `optionDescription` is Jev's own criteria text (`jev-decision-maker.ts`), which per this batch's
 * brief stays English regardless of locale, the same as every other model-facing string.
 */

export interface VignetteContext {
  readonly age: number;
  readonly away: boolean;
  readonly job: Job;
  /** Decision 049: exposed so a vignette's `eligible` can be class-aware — none currently is, but this keeps that door open for later content. */
  readonly socialClass: SocialClass;
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

/** Decision 059: the single point where a locale picks between an English and a Spanish value — same helper as `narrate.ts`'s, duplicated (not imported) to avoid a circular import (`narrate.ts` imports `getVignette` from this file). */
function t<T>(locale: Locale, en: T, es: T): T {
  return locale === "es" ? es : en;
}

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
  readonly prose: (locale: Locale, name: string, townName: string) => string;
  readonly optionDescription: string;
}

export interface Vignette {
  readonly id: string;
  readonly title: (locale: Locale, townName: string) => string;
  readonly question: (locale: Locale, townName: string) => string;
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

function outcome(spec: {
  readonly emotion: string;
  readonly cause: string | ((name: string, townName: string) => string);
  readonly intensity: number;
  readonly duration: number;
  readonly facet?: string;
  readonly memorable?: boolean;
  readonly relationshipTarget?: VignetteRelationshipTarget;
  readonly relationshipDelta?: number;
  readonly prose: (locale: Locale, name: string, townName: string) => string;
  readonly optionDescription: string;
}): VignetteOutcome {
  return { ...spec, cause: typeof spec.cause === "string" ? () => spec.cause as string : spec.cause };
}

/** `t(locale, en, es)`-backed `title`/`question` builder shared by every vignette below — both ignore `townName` unless noted otherwise, same as the original English-only definitions did. */
function fixed(en: string, es: string): (locale: Locale, townName: string) => string {
  return (locale) => t(locale, en, es);
}

export const VIGNETTES: readonly Vignette[] = [
  {
    id: "hard-winter",
    title: fixed("A hard winter", "Un invierno duro"),
    question: fixed(
      "The winter is hard, and a neighbor's family is going hungry. Do I share our grain?",
      "El invierno es duro, y la familia de un vecino pasa hambre. ¿Comparto nuestro grano?",
    ),
    eligible: (ctx) => !ctx.away && ctx.age >= 3 && ctx.season === "the depths of winter",
    outcomes: {
      "share-grain": outcome({
        emotion: "contentment",
        cause: "sharing grain with a hungry neighbor through a hard winter",
        intensity: 35,
        duration: 3,
        facet: "altruism",
        memorable: true,
        prose: (locale, name) =>
          t(locale, `${name} shared the last of the grain with a hungry neighbor, through a hard winter.`, `${name} compartió el último grano con un vecino hambriento, durante un invierno duro.`),
        optionDescription: "The winter is hard, but I share what grain we have with the neighbor who's going hungry.",
      }),
      "keep-grain": outcome({
        emotion: "relief",
        cause: "keeping our own grain through a hard winter",
        intensity: 20,
        duration: 2,
        prose: (locale, name) => t(locale, `${name} kept close to home through a hard winter, grain rationed carefully.`, `${name} se mantuvo cerca de casa durante un invierno duro, racionando el grano con cuidado.`),
        optionDescription: "The winter is hard, and I keep our own grain close rather than risk our own family going hungry.",
      }),
    },
  },
  {
    id: "poor-harvest",
    title: fixed("A poor harvest", "Una mala cosecha"),
    question: fixed("The harvest fell short this year. Do I tighten my belt without complaint?", "Este año la cosecha fue escasa. ¿Me aprieto el cinturón sin quejarme?"),
    eligible: (ctx) => !ctx.away && ctx.age >= 3 && ctx.season === "the golden days of autumn" && ctx.townEventType !== "harvest",
    outcomes: {
      "tighten-belt": outcome({
        emotion: "regret",
        cause: "tightening the belt after a poor harvest",
        intensity: 20,
        duration: 2,
        facet: "perseverance",
        prose: (locale, name) => t(locale, `${name} tightened the belt and said nothing, through a poor harvest.`, `${name} se apretó el cinturón y no dijo nada, tras una mala cosecha.`),
        optionDescription: "The harvest fell short, but I tighten my belt and say nothing about it.",
      }),
      "grumble-openly": outcome({
        emotion: "bitterness",
        cause: "grumbling over a poor harvest",
        intensity: 20,
        duration: 2,
        prose: (locale, name) => t(locale, `${name} grumbled openly about a poor harvest, same as everyone else.`, `${name} se quejó abiertamente de la mala cosecha, igual que todos los demás.`),
        optionDescription: "The harvest fell short, and I grumble openly about it, same as everyone else.",
      }),
    },
  },
  {
    id: "good-harvest",
    title: (locale, townName) => t(locale, `A good harvest in ${townName}`, `Una buena cosecha en ${townName}`),
    question: fixed("It's been a good harvest this year. Do I give thanks openly at the feast?", "Este año la cosecha ha sido buena. ¿Doy gracias abiertamente en la fiesta?"),
    eligible: (ctx) => !ctx.away && ctx.age >= 3 && ctx.season === "the golden days of autumn" && ctx.townEventType === "harvest",
    outcomes: {
      "give-thanks": outcome({
        emotion: "joy",
        cause: "giving thanks openly at the harvest feast",
        intensity: 30,
        duration: 2,
        facet: "gregariousness",
        prose: (locale, name, townName) => t(locale, `${name} gave thanks openly at the harvest feast in ${townName}.`, `${name} dio gracias abiertamente en la fiesta de la cosecha en ${townName}.`),
        optionDescription: "It's been a good harvest, and I give thanks for it openly, at the feast.",
      }),
      "keep-quiet": outcome({
        emotion: "contentment",
        cause: "a quiet relief at a good harvest",
        intensity: 15,
        duration: 1,
        prose: (locale, name) => t(locale, `${name} kept the relief of a good harvest quietly, without much fuss.`, `${name} guardó en silencio el alivio de una buena cosecha, sin mucho alboroto.`),
        optionDescription: "It's been a good harvest, but I keep my relief about it quiet, without much fuss.",
      }),
    },
  },
  {
    id: "market-day",
    title: (locale, townName) => t(locale, `Market day in ${townName}`, `Día de mercado en ${townName}`),
    question: (locale, townName) => t(locale, `It's market day in ${townName}. Do I haggle hard over the price, or pay what's asked?`, `Es día de mercado en ${townName}. ¿Regateo con fuerza el precio, o pago lo que piden?`),
    eligible: (ctx) => !ctx.away && ctx.age >= 10,
    outcomes: {
      haggle: outcome({
        emotion: "pride",
        cause: "haggling hard at market day",
        intensity: 20,
        duration: 2,
        facet: "greed",
        prose: (locale, name, townName) => t(locale, `${name} haggled hard at market day in ${townName}, and came away pleased with the bargain.`, `${name} regateó con fuerza en el día de mercado en ${townName}, y quedó satisfech${name.endsWith("a") ? "a" : "o"} con el trato.`),
        optionDescription: "It's market day, and I haggle hard over the price.",
      }),
      "pay-fair": outcome({
        emotion: "contentment",
        cause: "paying a fair price without haggling",
        intensity: 15,
        duration: 1,
        facet: "altruism",
        prose: (locale, name, townName) => t(locale, `${name} paid a fair price without haggling, at market day in ${townName}.`, `${name} pagó un precio justo sin regatear, en el día de mercado en ${townName}.`),
        optionDescription: "It's market day, and I pay what's asked without haggling.",
      }),
    },
  },
  {
    id: "learning-a-skill",
    title: fixed("Learning the trade", "Aprendiendo el oficio"),
    question: fixed("A parent is teaching me a skill today. Do I pay close attention?", "Hoy un progenitor me enseña una destreza. ¿Presto mucha atención?"),
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
        prose: (locale, name) => t(locale, `${name} paid close attention as a parent taught an early skill of the trade.`, `${name} prestó mucha atención mientras un progenitor enseñaba las primeras destrezas del oficio.`),
        optionDescription: "A parent is teaching me a skill today, and I pay close attention.",
      }),
      "wander-off": outcome({
        emotion: "hope",
        cause: "letting attention wander toward play instead of a lesson",
        intensity: 15,
        duration: 1,
        prose: (locale, name) => t(locale, `${name} let attention wander, more interested in play than the lesson.`, `${name} dejó volar la atención, más interesad${name.endsWith("a") ? "a" : "o"} en el juego que en la lección.`),
        optionDescription: "A parent is teaching me a skill today, but my attention wanders toward play instead.",
      }),
    },
  },
  {
    id: "sibling-quarrel",
    title: fixed("A quarrel with a sibling", "Una riña con un hermano"),
    question: fixed("A quarrel with a sibling has left things tense. Do I make peace first?", "Una riña con un hermano ha dejado las cosas tensas. ¿Hago las paces primero?"),
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
        prose: (locale, name) => t(locale, `${name} made the first move to patch things up after a quarrel with a sibling.`, `${name} dio el primer paso para arreglar las cosas tras una riña con un hermano.`),
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
        prose: (locale, name) => t(locale, `${name} stayed cross with a sibling long after the quarrel should have passed.`, `${name} siguió enojad${name.endsWith("a") ? "a" : "o"} con un hermano mucho después de que la riña debiera haber pasado.`),
        optionDescription: "A quarrel with a sibling has left things tense, and I stay cross rather than make peace.",
      }),
    },
  },
  {
    id: "neighbor-needs-help",
    title: fixed("A neighbor in need", "Un vecino necesitado"),
    question: fixed("A neighbor could use a hand with hard, unglamorous work. Do I help?", "Un vecino agradecería una mano con un trabajo duro y poco lucido. ¿Ayudo?"),
    eligible: (ctx) => !ctx.away && ctx.age >= 16,
    outcomes: {
      help: outcome({
        emotion: "contentment",
        cause: "helping a neighbor with hard, unglamorous work",
        intensity: 30,
        duration: 3,
        facet: "altruism",
        memorable: true,
        prose: (locale, name) => t(locale, `${name} spent the day helping a neighbor with hard, unglamorous work.`, `${name} pasó el día ayudando a un vecino con un trabajo duro y poco lucido.`),
        optionDescription: "A neighbor could use a hand with hard, unglamorous work, and I help.",
      }),
      decline: outcome({
        emotion: "regret",
        cause: "letting a neighbor's request for help go unanswered",
        intensity: 15,
        duration: 1,
        prose: (locale, name) => t(locale, `${name} had troubles enough of their own, and let a neighbor's request go unanswered.`, `${name} ya tenía bastantes problemas propios, y dejó sin respuesta la petición de un vecino.`),
        optionDescription: "A neighbor could use a hand with hard, unglamorous work, but I have troubles enough of my own.",
      }),
    },
  },
  {
    id: "first-glance",
    title: fixed("A first glance", "Una primera mirada"),
    question: fixed("Someone caught my eye today. Do I find a reason to speak with them?", "Hoy alguien llamó mi atención. ¿Busco una razón para hablar con esa persona?"),
    eligible: (ctx) => ctx.age >= 14 && ctx.age <= 30 && !ctx.hasSpouse,
    outcomes: {
      approach: outcome({
        emotion: "hope",
        cause: "finding a reason to speak with someone who caught my eye",
        intensity: 25,
        duration: 2,
        facet: "gregariousness",
        prose: (locale, name) => t(locale, `${name} found a reason to speak with someone who'd caught an eye, if only for a moment.`, `${name} encontró una razón para hablar con quien le había llamado la atención, aunque solo fuera un momento.`),
        optionDescription: "Someone caught my eye today, and I find a reason to speak with them.",
      }),
      "hold-back": outcome({
        emotion: "loneliness",
        cause: "saying nothing to someone who caught my eye",
        intensity: 15,
        duration: 1,
        prose: (locale, name) => t(locale, `${name} noticed someone who caught an eye, and said nothing at all.`, `${name} se fijó en alguien que le llamó la atención, y no dijo nada en absoluto.`),
        optionDescription: "Someone caught my eye today, but I hold back and say nothing.",
      }),
    },
  },
  {
    id: "feast-day",
    title: (locale, townName) => t(locale, `A feast day in ${townName}`, `Un día de fiesta en ${townName}`),
    question: (locale, townName) => t(locale, `It's a feast day in ${townName}. Do I join in the festivities?`, `Es día de fiesta en ${townName}. ¿Me uno a la celebración?`),
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
        prose: (locale, name, townName) => t(locale, `${name} joined in the feast-day festivities in ${townName}, if only for an evening.`, `${name} se unió a la celebración del día de fiesta en ${townName}, aunque solo fuera por una noche.`),
        optionDescription: "It's a feast day, and I join in the festivities.",
      }),
      "keep-to-self": outcome({
        emotion: "loneliness",
        cause: "keeping to home on a feast day",
        intensity: 15,
        duration: 1,
        prose: (locale, name, townName) => t(locale, `${name} kept to home on a feast day, while ${townName} celebrated without them.`, `${name} se quedó en casa el día de fiesta, mientras ${townName} celebraba sin él o ella.`),
        optionDescription: "It's a feast day, but I keep to home rather than join in.",
      }),
    },
  },
  {
    id: "sick-animal",
    title: fixed("A sick animal", "Un animal enfermo"),
    question: fixed("One of the animals has fallen sick. Do I sit up nursing it through the night?", "Uno de los animales ha enfermado. ¿Me quedo despierto cuidándolo toda la noche?"),
    eligible: (ctx) => !ctx.away && ctx.job === "farmer",
    outcomes: {
      "nurse-it": outcome({
        emotion: "contentment",
        cause: "nursing a sick animal through the night",
        intensity: 20,
        duration: 2,
        facet: "perseverance",
        prose: (locale, name) => t(locale, `${name} sat up through the night nursing a sick animal back to health.`, `${name} se quedó despierto toda la noche cuidando a un animal enfermo hasta que sanó.`),
        optionDescription: "One of the animals has fallen sick, and I sit up nursing it through the night.",
      }),
      "let-it-go": outcome({
        emotion: "regret",
        cause: "letting a sick animal go rather than losing sleep over it",
        intensity: 15,
        duration: 1,
        prose: (locale, name) => t(locale, `${name} let a sick animal go, rather than lose sleep over it.`, `${name} dejó ir a un animal enfermo, antes que perder el sueño por él.`),
        optionDescription: "One of the animals has fallen sick, and I let it go rather than lose sleep over it.",
      }),
    },
  },
  {
    id: "old-debt",
    title: fixed("An old debt", "Una vieja deuda"),
    question: fixed("An old debt has come due. Do I pay it off, even if it costs me?", "Una vieja deuda ha vencido. ¿La pago, aunque me cueste?"),
    eligible: (ctx) => ctx.age >= 20,
    outcomes: {
      "pay-it-off": outcome({
        emotion: "relief",
        cause: "paying off an old debt whatever it cost",
        intensity: 20,
        duration: 2,
        facet: "perseverance",
        prose: (locale, name) => t(locale, `${name} paid off an old debt, whatever it cost.`, `${name} pagó una vieja deuda, costara lo que costara.`),
        optionDescription: "An old debt has come due, and I pay it off, even if it costs me.",
      }),
      "let-it-ride": outcome({
        emotion: "fear",
        cause: "letting an old debt ride another year",
        intensity: 15,
        duration: 2,
        prose: (locale, name) => t(locale, `${name} let an old debt ride another year, and felt the weight of it.`, `${name} dejó pasar otro año con una vieja deuda, y sintió su peso.`),
        optionDescription: "An old debt has come due, and I let it ride another year.",
      }),
    },
  },
  {
    id: "teaching-a-child",
    title: fixed("Teaching a child the trade", "Enseñando el oficio a un hijo"),
    question: fixed("A child is old enough to start learning the trade. Do I teach patiently, or push them along briskly?", "Un hijo ya tiene edad para empezar a aprender el oficio. ¿Le enseño con paciencia, o lo apremio?"),
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
        prose: (locale, name) => t(locale, `${name} taught a child the trade patiently, one small task at a time.`, `${name} enseñó el oficio a un hijo con paciencia, una pequeña tarea a la vez.`),
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
        prose: (locale, name) => t(locale, `${name} pushed a child briskly through the first lessons of the trade.`, `${name} apremió a un hijo en las primeras lecciones del oficio.`),
        optionDescription: "A child is old enough to start learning the trade, and I push them along briskly.",
      }),
    },
  },
  {
    id: "aches-of-age",
    title: fixed("The aches of age", "Los achaques de la edad"),
    question: fixed("The aches of age are catching up. Do I push through the day's work all the same?", "Los achaques de la edad empiezan a pesar. ¿Sigo adelante con el trabajo del día de todos modos?"),
    eligible: (ctx) => ctx.age >= 60,
    outcomes: {
      "push-through": outcome({
        emotion: "pride",
        cause: "pushing through the aches of age to get the work done",
        intensity: 20,
        duration: 2,
        facet: "perseverance",
        prose: (locale, name) => t(locale, `${name} pushed through the aches of age to get the day's work done.`, `${name} siguió adelante pese a los achaques de la edad, para terminar el trabajo del día.`),
        optionDescription: "The aches of age are catching up, but I push through the day's work all the same.",
      }),
      rest: outcome({
        emotion: "relief",
        cause: "resting instead of fighting through the aches of age",
        intensity: 15,
        duration: 1,
        prose: (locale, name) => t(locale, `${name} gave in to the aches of age and rested, for once.`, `${name} cedió a los achaques de la edad y descansó, por una vez.`),
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
    title: fixed("A fever scare", "Un susto de fiebre"),
    question: fixed("A fever came on hard in the night. Do I sit up watching over the cradle, or trust it will pass?", "Una fiebre alta llegó de noche. ¿Me quedo velando la cuna, o confío en que pase?"),
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
        prose: (locale, name) => t(locale, `${name} sat up all night watching over a feverish child, until the fever broke.`, `${name} veló toda la noche a un hijo con fiebre, hasta que esta cedió.`),
        optionDescription: "A fever came on hard in the night, and I sit up watching over the cradle.",
      }),
      "trust-it-passes": outcome({
        emotion: "hope",
        cause: "trusting a child's fever would pass on its own",
        intensity: 15,
        duration: 2,
        prose: (locale, name) => t(locale, `${name} trusted the fever would pass on its own, and it did, by morning.`, `${name} confió en que la fiebre pasaría sola, y así fue, para la mañana.`),
        optionDescription: "A fever came on hard in the night, but I trust it will pass on its own.",
      }),
    },
  },
  {
    id: "first-steps",
    title: fixed("A first, wobbling step", "Un primer paso vacilante"),
    question: fixed("The child took a first wobbling step today. Do I make much of it?", "Hoy el niño dio su primer paso vacilante. ¿Hago una gran celebración de ello?"),
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
        prose: (locale, name) => t(locale, `${name} made much of a first wobbling step, delighted, the whole house called to see.`, `${name} celebró por todo lo alto un primer paso vacilante, encantad${name.endsWith("a") ? "a" : "o"}, y llamó a toda la casa a verlo.`),
        optionDescription: "The child took a first wobbling step today, and I make much of it.",
      }),
      "note-it-quietly": outcome({
        emotion: "contentment",
        cause: "noting a child's first wobbling step quietly",
        intensity: 15,
        duration: 1,
        prose: (locale, name) => t(locale, `${name} noted a first wobbling step quietly, pleased, and went back to the day's work.`, `${name} tomó nota en silencio del primer paso vacilante, complacid${name.endsWith("a") ? "a" : "o"}, y volvió al trabajo del día.`),
        optionDescription: "The child took a first wobbling step today, but I note it quietly and go back to work.",
      }),
    },
  },
  {
    id: "new-sibling",
    title: fixed("A new sibling", "Un nuevo hermano"),
    question: fixed("There's a new little one in the house now. Do I make room for them gladly?", "Ahora hay un pequeño más en casa. ¿Le hago sitio de buen grado?"),
    eligible: (ctx) => ctx.age <= 5 && ctx.hasLivingParent,
    decidedByParent: true,
    outcomes: {
      "make-room-gladly": outcome({
        emotion: "contentment",
        cause: "making room gladly for a new little one in the house",
        intensity: 20,
        duration: 2,
        facet: "altruism",
        prose: (locale, name) => t(locale, `${name} made room gladly for a new little one in the house.`, `${name} le hizo sitio de buen grado al nuevo pequeño de la casa.`),
        optionDescription: "There's a new little one in the house, and I make room for them gladly.",
      }),
      "mind-the-fuss": outcome({
        emotion: "bitterness",
        cause: "minding the fuss made over a new sibling",
        intensity: 15,
        duration: 2,
        prose: (locale, name) => t(locale, `${name} minded the fuss over a new sibling, a little put out by it.`, `${name} llevó mal el alboroto por el nuevo hermano, algo molest${name.endsWith("a") ? "a" : "o"} por ello.`),
        optionDescription: "There's a new little one in the house, and I mind the fuss made over them.",
      }),
    },
  },
  {
    id: "lost-in-the-woods",
    title: fixed("Lost in the woods", "Perdido en el bosque"),
    question: fixed("The child wandered off and was lost near the woods for an hour. Do I forbid wandering after, or let the world stay wide?", "El niño se alejó y estuvo perdido cerca del bosque durante una hora. ¿Prohíbo que vuelva a alejarse, o dejo que el mundo siga siendo grande?"),
    eligible: (ctx) => ctx.age <= 5 && ctx.hasLivingParent,
    decidedByParent: true,
    outcomes: {
      "forbid-wandering": outcome({
        emotion: "fear",
        cause: "forbidding wandering after a child was lost near the woods",
        intensity: 25,
        duration: 2,
        prose: (locale, name) => t(locale, `${name} forbade wandering near the woods after that, and kept a closer watch.`, `${name} prohibió después alejarse cerca del bosque, y vigiló más de cerca.`),
        optionDescription: "The child was lost near the woods for an hour, and I forbid wandering after that.",
      }),
      "let-the-world-stay-wide": outcome({
        emotion: "relief",
        cause: "letting the world stay wide even after a child went missing near the woods",
        intensity: 20,
        duration: 2,
        facet: "curiosity",
        prose: (locale, name) => t(locale, `${name} let the world stay wide, relieved to have the child back, unwilling to fence it in.`, `${name} dejó que el mundo siguiera siendo grande, aliviad${name.endsWith("a") ? "a" : "o"} de recuperar al niño, sin querer encerrarlo.`),
        optionDescription: "The child was lost near the woods for an hour, but I let the world stay wide all the same.",
      }),
    },
  },
  {
    id: "village-festival-childs-eyes",
    title: fixed("A village festival, through young eyes", "Una fiesta del pueblo, con ojos infantiles"),
    question: fixed("The village festival dazzled the child completely. Do I let them stay up late taking it all in?", "La fiesta del pueblo dejó al niño completamente deslumbrado. ¿Le dejo quedarse despierto hasta tarde para disfrutarla?"),
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
        prose: (locale, name) => t(locale, `${name} let the child stay up late, dazzled, taking in every last moment of the village festival.`, `${name} dejó al niño, deslumbrado, quedarse despierto hasta tarde para disfrutar cada momento de la fiesta del pueblo.`),
        optionDescription: "The village festival dazzled the child completely, and I let them stay up late taking it in.",
      }),
      "send-them-to-bed": outcome({
        emotion: "contentment",
        cause: "sending a dazzled child off to bed early despite the village festival",
        intensity: 15,
        duration: 1,
        prose: (locale, name) => t(locale, `${name} sent the child off to bed early, festival or no, and stood watch over an easier sleep.`, `${name} mandó al niño a la cama temprano, fiesta o no, y veló por un sueño más tranquilo.`),
        optionDescription: "The village festival dazzled the child completely, but I send them to bed early all the same.",
      }),
    },
  },
  {
    id: "helping-in-the-fields",
    title: fixed("Helping in the fields", "Ayudando en el campo"),
    question: fixed("There's work to be done in the fields today. Do I pitch in properly, or slip off to play?", "Hoy hay trabajo que hacer en el campo. ¿Arrimo el hombro de verdad, o me escapo a jugar?"),
    eligible: (ctx) => !ctx.away && ctx.age >= 6 && ctx.age <= 12,
    outcomes: {
      "pitch-in": outcome({
        emotion: "pride",
        cause: "pitching in properly with work in the fields",
        intensity: 20,
        duration: 2,
        facet: "perseverance",
        prose: (locale, name) => t(locale, `${name} pitched in properly in the fields, small hands doing what they could.`, `${name} arrimó el hombro de verdad en el campo, con sus manos pequeñas haciendo lo que podían.`),
        optionDescription: "There's work to be done in the fields today, and I pitch in properly.",
      }),
      "slip-off-to-play": outcome({
        emotion: "joy",
        cause: "slipping off to play instead of working in the fields",
        intensity: 15,
        duration: 1,
        prose: (locale, name) => t(locale, `${name} slipped off to play instead, and no one minded much, this once.`, `${name} se escapó a jugar en su lugar, y a nadie le importó demasiado, por esta vez.`),
        optionDescription: "There's work to be done in the fields today, but I slip off to play instead.",
      }),
    },
  },
  {
    id: "friends-secret",
    title: fixed("A friend's secret", "El secreto de un amigo"),
    question: fixed("A friend told me a secret and made me swear not to tell. Do I keep it?", "Un amigo me contó un secreto y me hizo jurar que no lo diría. ¿Lo guardo?"),
    eligible: (ctx) => ctx.age >= 6 && ctx.age <= 12,
    outcomes: {
      "keep-it": outcome({
        emotion: "pride",
        cause: "keeping a friend's secret, sworn to it",
        intensity: 20,
        duration: 2,
        facet: "altruism",
        prose: (locale, name) => t(locale, `${name} kept a friend's secret, sworn to it, and never told a soul.`, `${name} guardó el secreto de un amigo, tal como había jurado, y nunca se lo contó a nadie.`),
        optionDescription: "A friend told me a secret and made me swear not to tell, and I keep it.",
      }),
      "let-it-slip": outcome({
        emotion: "regret",
        cause: "letting a friend's secret slip",
        intensity: 20,
        duration: 2,
        prose: (locale, name) => t(locale, `${name} let a friend's secret slip, and regretted it after.`, `${name} dejó escapar el secreto de un amigo, y después se arrepintió.`),
        optionDescription: "A friend told me a secret and made me swear not to tell, but I let it slip.",
      }),
    },
  },
  {
    id: "scolding-from-the-priest",
    title: fixed("A scolding from the priest", "Una reprimenda del párroco"),
    question: fixed("The priest scolded me sharply in front of others today. Do I take it to heart?", "Hoy el párroco me reprendió con dureza delante de otros. ¿Me lo tomo a pecho?"),
    eligible: (ctx) => !ctx.away && ctx.age >= 6 && ctx.age <= 12,
    outcomes: {
      "take-it-to-heart": outcome({
        emotion: "regret",
        cause: "taking a sharp scolding from the priest to heart",
        intensity: 20,
        duration: 2,
        facet: "perseverance",
        prose: (locale, name) => t(locale, `${name} took a sharp scolding from the priest to heart, and minded manners closer after.`, `${name} se tomó a pecho una dura reprimenda del párroco, y después cuidó mejor sus modales.`),
        optionDescription: "The priest scolded me sharply in front of others today, and I take it to heart.",
      }),
      "shrug-it-off": outcome({
        emotion: "bitterness",
        cause: "shrugging off a scolding from the priest",
        intensity: 15,
        duration: 1,
        facet: "anger",
        prose: (locale, name) => t(locale, `${name} shrugged off the priest's scolding, and was back to old mischief by supper.`, `${name} restó importancia a la reprimenda del párroco, y para la cena ya andaba de nuevo en travesuras.`),
        optionDescription: "The priest scolded me sharply in front of others today, but I shrug it off.",
      }),
    },
  },
  {
    id: "a-stray-dog",
    title: fixed("A stray dog", "Un perro callejero"),
    question: fixed("A stray dog has been hanging round the house, thin and wary. Do I feed it?", "Un perro callejero, flaco y receloso, ronda la casa. ¿Le doy de comer?"),
    eligible: (ctx) => !ctx.away && ctx.age >= 6 && ctx.age <= 12,
    outcomes: {
      "feed-it": outcome({
        emotion: "contentment",
        cause: "feeding a thin, wary stray dog",
        intensity: 20,
        duration: 2,
        facet: "altruism",
        memorable: true,
        prose: (locale, name) => t(locale, `${name} fed a thin, wary stray dog that had taken to hanging round the house.`, `${name} dio de comer a un perro callejero flaco y receloso que rondaba la casa.`),
        optionDescription: "A stray dog has been hanging round the house, thin and wary, and I feed it.",
      }),
      "chase-it-off": outcome({
        emotion: "regret",
        cause: "chasing off a stray dog hanging round the house",
        intensity: 15,
        duration: 1,
        prose: (locale, name) => t(locale, `${name} chased the stray dog off, though it lingered nearby for days after.`, `${name} ahuyentó al perro callejero, aunque este rondó cerca durante días.`),
        optionDescription: "A stray dog has been hanging round the house, thin and wary, and I chase it off.",
      }),
    },
  },
  {
    id: "a-fight-with-another-child",
    title: fixed("A fight with another child", "Una pelea con otro niño"),
    question: fixed("A fight broke out with another child today. Do I throw the first punch, or walk away?", "Hoy estalló una pelea con otro niño. ¿Doy el primer golpe, o me alejo?"),
    eligible: (ctx) => !ctx.away && ctx.age >= 6 && ctx.age <= 12,
    outcomes: {
      "throw-the-first-punch": outcome({
        emotion: "pride",
        cause: "throwing the first punch in a fight with another child",
        intensity: 20,
        duration: 2,
        facet: "anger",
        prose: (locale, name) => t(locale, `${name} threw the first punch in a fight with another child, and came home with a bloody lip and swagger both.`, `${name} dio el primer golpe en una pelea con otro niño, y volvió a casa con el labio partido y aires de bravucón.`),
        optionDescription: "A fight broke out with another child today, and I throw the first punch.",
      }),
      "walk-away": outcome({
        emotion: "relief",
        cause: "walking away from a fight with another child",
        intensity: 15,
        duration: 1,
        facet: "perseverance",
        prose: (locale, name) => t(locale, `${name} walked away from a fight with another child, though it cost something to do it.`, `${name} se alejó de una pelea con otro niño, aunque le costó hacerlo.`),
        optionDescription: "A fight broke out with another child today, but I walk away from it.",
      }),
    },
  },
  {
    id: "carrying-water-in-winter",
    title: fixed("Carrying water in winter", "Acarreando agua en invierno"),
    question: fixed("The well is a long, icy walk away this winter. Do I fetch the water without complaint?", "Este invierno el pozo queda un largo y helado trecho a pie. ¿Voy a por agua sin quejarme?"),
    eligible: (ctx) => !ctx.away && ctx.age >= 6 && ctx.age <= 12 && ctx.season === "the depths of winter",
    outcomes: {
      "fetch-without-complaint": outcome({
        emotion: "pride",
        cause: "fetching water from the icy well all winter without complaint",
        intensity: 20,
        duration: 2,
        facet: "perseverance",
        prose: (locale, name) => t(locale, `${name} fetched water from the icy well all winter, without complaint.`, `${name} acarreó agua del pozo helado durante todo el invierno, sin quejarse.`),
        optionDescription: "The well is a long, icy walk away this winter, and I fetch the water without complaint.",
      }),
      "grumble-about-it": outcome({
        emotion: "bitterness",
        cause: "grumbling about the long, icy walk to the well",
        intensity: 15,
        duration: 1,
        prose: (locale, name) => t(locale, `${name} grumbled about the long, icy walk to the well, all winter long.`, `${name} se quejó del largo y helado camino al pozo, durante todo el invierno.`),
        optionDescription: "The well is a long, icy walk away this winter, and I grumble about it.",
      }),
    },
  },
  {
    id: "first-dance-at-the-feast",
    title: fixed("A first dance at the feast", "Un primer baile en la fiesta"),
    question: fixed("There's a feast on, and dancing. Do I take the floor?", "Hay una fiesta, y baile. ¿Salgo a bailar?"),
    eligible: (ctx) => !ctx.away && ctx.age >= 13 && ctx.age <= 19,
    outcomes: {
      "take-the-floor": outcome({
        emotion: "joy",
        cause: "taking the floor for a first dance at the feast",
        intensity: 25,
        duration: 2,
        facet: "gregariousness",
        memorable: true,
        prose: (locale, name) => t(locale, `${name} took the floor for a first dance at the feast, nerves and all.`, `${name} salió a bailar por primera vez en la fiesta, nervios y todo.`),
        optionDescription: "There's a feast on, and dancing, and I take the floor.",
      }),
      "watch-from-the-edge": outcome({
        emotion: "loneliness",
        cause: "watching the dancing from the edge of the feast",
        intensity: 15,
        duration: 1,
        prose: (locale, name) => t(locale, `${name} watched the dancing from the edge of the feast, working up the nerve that never quite came.`, `${name} miró el baile desde el borde de la fiesta, tratando de reunir un valor que nunca llegó del todo.`),
        optionDescription: "There's a feast on, and dancing, but I watch from the edge instead.",
      }),
    },
  },
  {
    id: "a-dare",
    title: fixed("A dare", "Un desafío"),
    question: fixed("Friends have dared me to something reckless. Do I go through with it?", "Unos amigos me han retado a algo imprudente. ¿Lo hago?"),
    eligible: (ctx) => !ctx.away && ctx.age >= 13 && ctx.age <= 19,
    outcomes: {
      "go-through-with-it": outcome({
        emotion: "pride",
        cause: "going through with a reckless dare",
        intensity: 25,
        duration: 2,
        facet: "ambition",
        memorable: true,
        prose: (locale, name) => t(locale, `${name} went through with a reckless dare, and dined out on the story after.`, `${name} llevó a cabo un desafío imprudente, y después presumió de la historia durante mucho tiempo.`),
        optionDescription: "Friends have dared me to something reckless, and I go through with it.",
      }),
      "back-down": outcome({
        emotion: "relief",
        cause: "backing down from a reckless dare",
        intensity: 15,
        duration: 1,
        prose: (locale, name) => t(locale, `${name} backed down from a reckless dare, and took some ribbing for it.`, `${name} se echó atrás ante un desafío imprudente, y aguantó las burlas por ello.`),
        optionDescription: "Friends have dared me to something reckless, but I back down.",
      }),
    },
  },
  {
    id: "work-alongside-a-master",
    title: fixed("Work alongside a master", "Trabajar junto a un maestro"),
    question: fixed("A master craftsman has taken me on for the day. Do I work hard to impress?", "Un maestro artesano me ha tomado por un día. ¿Trabajo duro para impresionarlo?"),
    eligible: (ctx) => !ctx.away && ctx.age >= 13 && ctx.age <= 19 && ctx.job !== "none",
    outcomes: {
      "work-hard-to-impress": outcome({
        emotion: "pride",
        cause: "working hard alongside a master craftsman to impress",
        intensity: 20,
        duration: 2,
        facet: "ambition",
        prose: (locale, name) => t(locale, `${name} worked hard alongside a master craftsman, hoping to impress.`, `${name} trabajó duro junto a un maestro artesano, con la esperanza de impresionarlo.`),
        optionDescription: "A master craftsman has taken me on for the day, and I work hard to impress.",
      }),
      "keep-to-the-minimum": outcome({
        emotion: "contentment",
        cause: "keeping to the minimum of what was asked, working alongside a master craftsman",
        intensity: 15,
        duration: 1,
        prose: (locale, name) => t(locale, `${name} kept to the minimum of what was asked, working alongside a master craftsman for the day.`, `${name} se limitó a lo mínimo pedido, trabajando junto a un maestro artesano por un día.`),
        optionDescription: "A master craftsman has taken me on for the day, but I keep to the minimum of what's asked.",
      }),
    },
  },
  {
    id: "argument-with-a-parent-over-the-future",
    title: fixed("An argument over the future", "Una discusión sobre el futuro"),
    question: fixed("A parent and I argued sharply over what's to become of me. Do I hold my ground?", "Un progenitor y yo discutimos con dureza sobre mi futuro. ¿Me mantengo en mis trece?"),
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
        prose: (locale, name) => t(locale, `${name} held ground in a sharp argument with a parent over what's to become of them.`, `${name} se mantuvo firme en una dura discusión con un progenitor sobre su futuro.`),
        optionDescription: "A parent and I argued sharply over what's to become of me, and I hold my ground.",
      }),
      "back-down-for-peace": outcome({
        emotion: "relief",
        cause: "backing down for the sake of peace, in an argument with a parent over the future",
        intensity: 15,
        duration: 2,
        relationshipTarget: "parent",
        relationshipDelta: 5,
        prose: (locale, name) => t(locale, `${name} backed down for the sake of peace, in an argument with a parent over the future.`, `${name} cedió por mantener la paz, en una discusión con un progenitor sobre el futuro.`),
        optionDescription: "A parent and I argued sharply over what's to become of me, and I back down for peace.",
      }),
    },
  },
] as const;

const VIGNETTES_BY_ID = new Map(VIGNETTES.map((v) => [v.id, v]));

export function getVignette(id: string): Vignette | undefined {
  return VIGNETTES_BY_ID.get(id);
}

/** Every vignette's option id -> Jev criteria description, flattened (round 10, decision 042). Option ids are unique across the whole pool. English-only, per decision 059: this is model-facing text (`jev-decision-maker.ts`), never shown to the reader. */
export const VIGNETTE_OPTION_DESCRIPTIONS: Readonly<Record<string, string>> = Object.fromEntries(
  VIGNETTES.flatMap((v) => Object.entries(v.outcomes).map(([option, o]) => [option, o.optionDescription])),
);

/**
 * Every eligible vignette for this protagonist-year, after the same 5-year no-repeat exclusion
 * `pickVignette` always applied (round 10, decision 043) — dropped rather than leaving the pool
 * empty if every eligible vignette was recently used. `feast-day`'s near-universal (age >= 3)
 * eligibility guarantees this is never empty for anyone past infancy; below that, the pool falls
 * back to the full, unfiltered `VIGNETTES` list as a last resort so a year is never left without one.
 * Shared by `pickVignette` (legacy single RNG pick, kept for a `DecisionMaker` without `decideYear`)
 * and `simulate.ts`'s `buildDailyLifeVignetteCandidates` (round 12 continuation, decision 046 —
 * hierarchical event selection, which needs the WHOLE pool, not one pre-picked winner).
 */
export function eligibleVignettePool(ctx: VignetteContext, recentIds?: ReadonlySet<string>): readonly Vignette[] {
  const eligible = VIGNETTES.filter((v) => v.eligible(ctx));
  const notRecentlyUsed = recentIds ? eligible.filter((v) => !recentIds.has(v.id)) : eligible;
  return notRecentlyUsed.length > 0 ? notRecentlyUsed : eligible.length > 0 ? eligible : VIGNETTES;
}

/**
 * Deterministically picks one eligible vignette for this protagonist-year (keyed RNG, same seed +
 * personId + year always agrees). Kept only for a `DecisionMaker` that doesn't implement
 * `decideYear` (a minimal test double) — the real batched path (`simulate.ts`,
 * `buildDailyLifeVignetteCandidates`) offers the WHOLE eligible pool to Jev instead (round 12,
 * decision 046).
 */
export function pickVignette(seed: string, personId: string, year: number, ctx: VignetteContext, recentIds?: ReadonlySet<string>): Vignette {
  const pool = eligibleVignettePool(ctx, recentIds);
  const rng = keyedRng(seed, personId, year, "D1-vignette-pick");
  return pool[Math.floor(rng() * pool.length)]!;
}

/** The vignette that owns a given outcome option id — option ids are unique across the whole pool (see `VIGNETTE_OPTION_DESCRIPTIONS`), so this is unambiguous. Used to resolve a forked/overridden `D1` decision's option back to its vignette without re-deriving eligibility (round 12, decision 046). */
export function getVignetteForOption(optionId: string): Vignette | undefined {
  return VIGNETTES.find((v) => optionId in v.outcomes);
}

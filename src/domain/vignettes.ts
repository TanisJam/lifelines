import type { Locale } from "./locale";
import { keyedRng } from "./rng";
import type { Event, Job, SocialClass } from "./types";

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
  readonly prose: (locale: Locale, name: string, townName: string, variant?: number) => string;
  readonly optionDescription: string;
}

export interface Vignette {
  readonly id: string;
  /**
   * How many distinct phrasings this vignette can render (spec S1 of `odd/tasks/chronicle-variation.md`).
   * Absent means 1: `title` and every outcome's `prose` ignore the variant index and behave exactly as
   * they did before variants existed. A vignette is never offered again to the same protagonist once
   * all of its variants have been used (spec S3), so this number is what bounds how often one situation
   * can come back in a single life.
   */
  readonly variants?: number;
  /** `variant` picks one of `variants` phrasings; it is derived from `(seed, id, year)` only (spec S2). Implementations with one phrasing ignore it. */
  readonly title: (locale: Locale, townName: string, variant?: number) => string;
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
  readonly prose: (locale: Locale, name: string, townName: string, variant?: number) => string;
  readonly optionDescription: string;
}): VignetteOutcome {
  return { ...spec, cause: typeof spec.cause === "string" ? () => spec.cause as string : spec.cause };
}

/** `t(locale, en, es)`-backed `title`/`question` builder shared by every vignette below — both ignore `townName` unless noted otherwise, same as the original English-only definitions did. */
function fixed(en: string, es: string): (locale: Locale, townName: string) => string {
  return (locale) => t(locale, en, es);
}

/**
 * The variant a given vignette occurrence renders (spec S2 of `odd/tasks/chronicle-variation.md`).
 *
 * Keyed on HOW MANY TIMES this situation has already happened to this protagonist, not on the
 * year: an occurrence-indexed variant walks 0, 1, 2… so `variants` occurrences use `variants`
 * distinct phrasings. A year-keyed variant was tried first and was wrong — it made a vignette
 * offer exactly one possible phrasing per year, so two occurrences in different years collided
 * on the same phrasing and the pool exhausted long before its content ran out.
 *
 * Still a pure function of the event log (the occurrence count), so the selection path and every
 * read path agree without storing the choice on the event: no persisted-format change, existing
 * stored lives keep their bytes and digests.
 */
export function vignetteVariant(occurrence: number, variants: number): number {
  if (variants <= 1) return 0;
  // Cycles rather than clamps past the end: a life created before phrasings existed (or one that
  // outruns the content) has more occurrences than variants, and cycling spreads those across every
  // phrasing instead of stacking all the overflow on the last one.
  return occurrence % variants;
}

/**
 * How many times this vignette already happened to this life before `event`, in event order.
 * Ordering is `(year, id)` so two vignettes in the same year still have a stable count.
 */
export function vignetteOccurrence(events: readonly Event[], event: Event, vignetteId: string): number {
  let count = 0;
  for (const candidate of events) {
    if (candidate.kind !== "vignette" || String(candidate.payload.vignette ?? "") !== vignetteId) continue;
    if (candidate.year < event.year || (candidate.year === event.year && candidate.id < event.id)) count += 1;
  }
  return count;
}

/**
 * Bilingual phrasing list for one variant-aware slot: `titles[i]`/`titlesEs[i]` are variant `i`.
 * `{town}` is replaced with the town name; `{name}` with the protagonist's. Kept as plain strings so
 * the content stays greppable and reviewable in one place per vignette.
 */
function phrasings(titles: readonly string[], titlesEs: readonly string[]): (locale: Locale, townName: string, variant?: number) => string {
  return (locale, townName, variant = 0) => {
    const index = Math.min(variant, titles.length - 1);
    const raw = t(locale, titles[index]!, titlesEs[index]!);
    return raw.replaceAll("{town}", townName);
  };
}

/** Same as `phrasings`, for an outcome's prose: `{name}` is the protagonist, `{town}` the town. */
function prosePhrasings(phrasingsEn: readonly string[], phrasingsEs: readonly string[]): (locale: Locale, name: string, townName: string, variant?: number) => string {
  return (locale, name, townName, variant = 0) => {
    const index = Math.min(variant, phrasingsEn.length - 1);
    return t(locale, phrasingsEn[index]!, phrasingsEs[index]!).replaceAll("{name}", name).replaceAll("{town}", townName);
  };
}

export const VIGNETTES: readonly Vignette[] = [
  {
    id: "hard-winter",
    variants: 4,
    title: phrasings(
      ["A hard winter", "Grain runs short in a hard winter", "A winter with hunger at the door", "A winter nobody forgets"],
      ["Un invierno duro", "El grano escasea en un invierno duro", "Un invierno con el hambre en la puerta", "Un invierno que nadie olvida"],
    ),
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
        prose: prosePhrasings(
          [
            "{name} shared the last of the grain with a hungry neighbor, through a hard winter.",
            "{name} carried a measure of grain to a neighbor's door in the worst of the winter.",
            "{name} thinned the household's own bread to keep a hungry neighbor alive through the cold.",
            "The house went without supper twice so a neighbor's children could eat.",
          ],
          [
            "{name} compartió el último grano con un vecino hambriento, durante un invierno duro.",
            "{name} llevó una medida de grano a la puerta de un vecino en lo peor del invierno.",
            "{name} racionó el pan de su propia casa para mantener con vida a un vecino hambriento durante el frío.",
            "La casa se quedó sin cena dos veces para que los hijos de un vecino comieran.",
          ],
        ),
        optionDescription: "The winter is hard, but I share what grain we have with the neighbor who's going hungry.",
      }),
      "keep-grain": outcome({
        emotion: "relief",
        cause: "keeping our own grain through a hard winter",
        intensity: 20,
        duration: 2,
        prose: prosePhrasings(
          [
            "{name} kept close to home through a hard winter, grain rationed carefully.",
            "{name} counted the grain every night of a hard winter, and opened the door to no one.",
            "{name} let a hungry neighbor go away empty, and kept the stores for their own.",
            "The grain went into the ground for spring, and no one starved.",
          ],
          [
            "{name} se mantuvo cerca de casa durante un invierno duro, racionando el grano con cuidado.",
            "{name} contó el grano cada noche de un invierno duro, y no le abrió la puerta a nadie.",
            "{name} dejó que un vecino hambriento se fuera con las manos vacías, y guardó las reservas para los suyos.",
            "El grano se guardó para la siembra de primavera, y nadie murió de hambre.",
          ],
        ),
        optionDescription: "The winter is hard, and I keep our own grain close rather than risk our own family going hungry.",
      }),
    },
  },
  {
    id: "poor-harvest",
    variants: 4,
    title: phrasings(
      ["A poor harvest", "The harvest comes in thin", "A thin year in the fields", "A harvest that hardly filled a cart"],
      ["Una mala cosecha", "La cosecha llega escasa", "Un año flaco en el campo", "Una cosecha que apenas llenó un carro"],
    ),
    question: fixed("The harvest fell short this year. Do I tighten my belt without complaint?", "Este año la cosecha fue escasa. ¿Me aprieto el cinturón sin quejarme?"),
    eligible: (ctx) => !ctx.away && ctx.age >= 3 && ctx.season === "the golden days of autumn" && ctx.townEventType !== "harvest",
    outcomes: {
      "tighten-belt": outcome({
        emotion: "regret",
        cause: "tightening the belt after a poor harvest",
        intensity: 20,
        duration: 2,
        facet: "perseverance",
        prose: prosePhrasings(
          [
            "{name} tightened the belt and said nothing, through a poor harvest.",
            "{name} made the bread smaller and the broth thinner, and complained to no one.",
            "{name} counted every sack twice after a poor harvest, and said nothing about the shortfall.",
            "The bread was weighed out smaller each week, and nobody said a word.",
          ],
          [
            "{name} se apretó el cinturón y no dijo nada, tras una mala cosecha.",
            "{name} hizo más pequeño el pan y más claro el caldo, y no se quejó ante nadie.",
            "{name} contó cada saco dos veces tras una mala cosecha, y no dijo nada de lo que faltaba.",
            "El pan se pesó más pequeño cada semana, y nadie dijo una palabra.",
          ],
        ),
        optionDescription: "The harvest fell short, but I tighten my belt and say nothing about it.",
      }),
      "grumble-openly": outcome({
        emotion: "bitterness",
        cause: "grumbling over a poor harvest",
        intensity: 20,
        duration: 2,
        prose: prosePhrasings(
          [
            "{name} grumbled openly about a poor harvest, same as everyone else.",
            "{name} cursed the thin sheaves loud enough for the whole field to hear.",
            "{name} spent the poor harvest complaining at the lord's reeve, and got nothing for it.",
            "The reeve heard the complaints and wrote none of them down.",
          ],
          [
            "{name} se quejó abiertamente de la mala cosecha, igual que todos los demás.",
            "{name} maldijo las gavillas flacas lo bastante alto como para que lo oyera todo el campo.",
            "{name} pasó la mala cosecha quejándose ante el alguacil del señor, y no consiguió nada.",
            "El alguacil oyó las quejas y no anotó ninguna.",
          ],
        ),
        optionDescription: "The harvest fell short, and I grumble openly about it, same as everyone else.",
      }),
    },
  },
  {
    id: "good-harvest",
    variants: 4,
    title: phrasings(
      ["A good harvest in {town}", "A full barn in {town}", "The harvest comes in heavy in {town}", "The barns hold this year"],
      ["Una buena cosecha en {town}", "Un granero lleno en {town}", "La cosecha llega abundante a {town}", "Este año los graneros aguantan"],
    ),
    question: fixed("It's been a good harvest this year. Do I give thanks openly at the feast?", "Este año la cosecha ha sido buena. ¿Doy gracias abiertamente en la fiesta?"),
    eligible: (ctx) => !ctx.away && ctx.age >= 3 && ctx.season === "the golden days of autumn" && ctx.townEventType === "harvest",
    outcomes: {
      "give-thanks": outcome({
        emotion: "joy",
        cause: "giving thanks openly at the harvest feast",
        intensity: 30,
        duration: 2,
        facet: "gregariousness",
        prose: prosePhrasings(
          [
            "{name} gave thanks openly at the harvest feast in {town}.",
            "{name} stood up at the harvest feast in {town} and thanked God and the neighbors both.",
            "{name} brought bread to the harvest feast in {town} and gave thanks with a full voice.",
            "A measure of bread went to the church, and the rest stayed where it was needed.",
          ],
          [
            "{name} dio gracias abiertamente en la fiesta de la cosecha en {town}.",
            "{name} se puso de pie en la fiesta de la cosecha en {town} y dio gracias a Dios y a los vecinos por igual.",
            "{name} llevó pan a la fiesta de la cosecha en {town} y dio gracias con voz entera.",
            "Una medida de pan fue a la iglesia, y el resto se quedó donde hacía falta.",
          ],
        ),
        optionDescription: "It's been a good harvest, and I give thanks for it openly, at the feast.",
      }),
      "keep-quiet": outcome({
        emotion: "contentment",
        cause: "a quiet relief at a good harvest",
        intensity: 15,
        duration: 1,
        prose: prosePhrasings(
          [
            "{name} kept the relief of a good harvest quietly, without much fuss.",
            "{name} walked the full barn once, satisfied, and said nothing to anyone about it.",
            "{name} ate well that autumn and let others do the thanking.",
            "The full barn was counted once and then left alone.",
          ],
          [
            "{name} guardó en silencio el alivio de una buena cosecha, sin mucho alboroto.",
            "{name} recorrió el granero lleno una vez, con satisfacción, y no le dijo nada a nadie.",
            "{name} comió bien aquel otoño y dejó que otros dieran las gracias.",
            "El granero lleno se contó una vez y después se dejó en paz.",
          ],
        ),
        optionDescription: "It's been a good harvest, but I keep my relief about it quiet, without much fuss.",
      }),
    },
  },
  {
    id: "market-day",
    variants: 6,
    title: phrasings(
      ["Market day in {town}", "A market day, and the square full", "Market-day prices in {town}", "The market comes to {town}", "Stalls up in the square", "A market day, and money changing hands"],
      ["Día de mercado en {town}", "Un día de mercado, y la plaza llena", "Los precios del día de mercado en {town}", "El mercado llega a {town}", "Puestos armados en la plaza", "Un día de mercado, y dinero cambiando de manos"],
    ),
    question: (locale, townName) => t(locale, `It's market day in ${townName}. Do I haggle hard over the price, or pay what's asked?`, `Es día de mercado en ${townName}. ¿Regateo con fuerza el precio, o pago lo que piden?`),
    eligible: (ctx) => !ctx.away && ctx.age >= 10,
    outcomes: {
      haggle: outcome({
        emotion: "pride",
        cause: "haggling hard at market day",
        intensity: 20,
        duration: 2,
        facet: "greed",
        prose: prosePhrasings(
          [
            "{name} haggled hard at market day in {town}, and came away pleased with the bargain.",
            "{name} argued a price down to the last penny at market day in {town}, and enjoyed every minute of it.",
            "{name} squeezed a better price out of a market stall in {town} than the seller liked.",
            "{name} spent the market day in {town} haggling, and won more than was strictly fair.",
            "{name} talked a seller down twice and then walked away without buying.",
            "{name} got the better of a bargain at market and made sure the square knew.",
          ],
          [
            "{name} regateó con fuerza en el día de mercado en {town}, y se fue con la sensación de haber ganado.",
            "{name} discutió un precio hasta el último penique en el día de mercado en {town}, y disfrutó cada minuto.",
            "{name} sacó en un puesto de {town} un precio mejor del que al vendedor le gustaba.",
            "{name} pasó el día de mercado en {town} regateando, y ganó más de lo estrictamente justo.",
            "{name} regateó dos veces a un vendedor y después se fue sin comprar.",
            "{name} sacó ventaja en un trato en el mercado y se aseguró de que la plaza lo supiera.",
          ],
        ),
        optionDescription: "It's market day, and I haggle hard over the price.",
      }),
      "pay-fair": outcome({
        emotion: "contentment",
        cause: "paying a fair price without haggling",
        intensity: 15,
        duration: 1,
        facet: "altruism",
        prose: prosePhrasings(
          [
            "{name} paid a fair price without haggling, at market day in {town}.",
            "{name} paid what was asked at market day in {town}, and did not argue the price.",
            "{name} counted out a fair price at market day in {town}, and let the seller keep their dignity.",
            "{name} went to market day in {town} and paid without haggling, though others did not.",
            "{name} paid what a thing was worth at market day, and no less.",
            "{name} bought plainly and quietly at market day, and was home before dark.",
          ],
          [
            "{name} pagó un precio justo sin regatear, en el día de mercado en {town}.",
            "{name} pagó lo que le pidieron en el día de mercado en {town}, y no discutió el precio.",
            "{name} contó un precio justo en el día de mercado en {town}, y dejó al vendedor con su dignidad.",
            "{name} fue al día de mercado en {town} y pagó sin regatear, aunque otros no lo hicieron.",
            "{name} pagó lo que valía una cosa en el día de mercado, y ni menos.",
            "{name} compró sin adornos y en silencio en el día de mercado, y estuvo en casa antes del anochecer.",
          ],
        ),
        optionDescription: "It's market day, and I pay what's asked without haggling.",
      }),
    },
  },
  {
    id: "learning-a-skill",
    variants: 3,
    title: phrasings(
      ["Learning the trade", "A lesson at the bench", "The first lessons of the trade"],
      ["Aprendiendo el oficio", "Una lección en el banco de trabajo", "Las primeras lecciones del oficio"],
    ),
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
        prose: prosePhrasings(
          [
            "{name} paid close attention as a parent taught an early skill of the trade.",
            "{name} watched a parent's hands and copied them until the motion came right.",
            "{name} asked questions all through a parent's lesson, and remembered the answers.",
          ],
          [
            "{name} prestó mucha atención mientras un progenitor enseñaba las primeras destrezas del oficio.",
            "{name} miró las manos de un progenitor y las imitó hasta que el movimiento salió bien.",
            "{name} hizo preguntas durante toda la lección de un progenitor, y recordó las respuestas.",
          ],
        ),
        optionDescription: "A parent is teaching me a skill today, and I pay close attention.",
      }),
      "wander-off": outcome({
        emotion: "hope",
        cause: "letting attention wander toward play instead of a lesson",
        intensity: 15,
        duration: 1,
        prose: prosePhrasings(
          [
            "{name} let attention wander, more interested in play than the lesson.",
            "{name} slipped away from the lesson at the first chance, and found the other children.",
            "{name} heard a parent's lesson and thought only about the game waiting outside.",
          ],
          [
            "{name} dejó volar la atención, más pendiente del juego que de la lección.",
            "{name} se escapó de la lección a la primera ocasión, y encontró a los otros niños.",
            "{name} oyó la lección de un progenitor y solo pensó en el juego que esperaba afuera.",
          ],
        ),
        optionDescription: "A parent is teaching me a skill today, but my attention wanders toward play instead.",
      }),
    },
  },
  {
    id: "sibling-quarrel",
    variants: 4,
    title: phrasings(
      ["A quarrel with a sibling", "Words sharpened between siblings", "A quarrel that outlasted the day", "A silence between siblings"],
      ["Una riña con un hermano", "Palabras afiladas entre hermanos", "Una riña que duró más que el día", "Un silencio entre hermanos"],
    ),
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
        prose: prosePhrasings(
          [
            "{name} made the first move to patch things up after a quarrel with a sibling.",
            "{name} swallowed pride and spoke first, and the quarrel with a sibling ended there.",
            "{name} brought a small peace offering to a sibling after the quarrel, and there was forgiveness.",
            "The quarrel was patched over bread and salt, and hardly mentioned again.",
          ],
          [
            "{name} dio el primer paso para arreglar las cosas tras una riña con un hermano.",
            "{name} se tragó el orgullo y habló primero, y la riña con un hermano terminó ahí.",
            "{name} llevó un pequeño gesto de paz a un hermano tras la riña, y hubo perdón.",
            "La riña se arregló con pan y sal, y apenas se volvió a mencionar.",
          ],
        ),
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
        prose: prosePhrasings(
          [
            "{name} stayed cross with a sibling long after the quarrel should have passed.",
            "{name} let a quarrel with a sibling harden into weeks of silence.",
            "{name} kept a tally of what a sibling had said, and did not let it go.",
            "Neither of them said the first word, and the winter passed that way.",
          ],
          [
            "{name} mantuvo el enojo con un hermano mucho después de que la riña debiera haber pasado.",
            "{name} dejó que una riña con un hermano se endureciera en semanas de silencio.",
            "{name} llevó la cuenta de lo que un hermano había dicho, y no lo dejó pasar.",
            "Ninguno de los dos dijo la primera palabra, y el invierno pasó así.",
          ],
        ),
        optionDescription: "A quarrel with a sibling has left things tense, and I stay cross rather than make peace.",
      }),
    },
  },
  {
    id: "neighbor-needs-help",
    variants: 6,
    title: phrasings(
      ["A neighbor in need", "A neighbor asks for a hand", "Hard work, and a neighbor who needs it", "A neighbor's trouble, and whether I go", "A hand asked for, and a hand given", "The neighbor's harvest, and my afternoon"],
      ["Un vecino necesitado", "Un vecino pide una mano", "Trabajo duro, y un vecino que lo necesita", "El problema de un vecino, y si voy o no", "Una mano pedida, y una mano dada", "La cosecha del vecino, y mi tarde"],
    ),
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
        prose: prosePhrasings(
          [
            "{name} spent the day helping a neighbor with hard, unglamorous work.",
            "{name} gave a neighbor a full day of hard work, and asked nothing for it.",
            "{name} carried, lifted and hauled for a neighbor until dark, and called it nothing.",
            "{name} showed up for a neighbor's hard day and stayed until the work was done.",
            "{name} gave a neighbor the afternoon and came home with nothing but thanks.",
            "{name} worked a neighbor's field as if it were their own.",
          ],
          [
            "{name} pasó el día ayudando a un vecino con un trabajo duro y poco lucido.",
            "{name} le dio a un vecino un día entero de trabajo duro, y no pidió nada a cambio.",
            "{name} cargó, levantó y acarreó para un vecino hasta el anochecer, y no le dio importancia.",
            "{name} apareció en el día duro de un vecino y se quedó hasta terminar el trabajo.",
            "{name} le dio a un vecino la tarde y volvió a casa solo con agradecimientos.",
            "{name} trabajó el campo de un vecino como si fuera propio.",
          ],
        ),
        optionDescription: "A neighbor could use a hand with hard, unglamorous work, and I help.",
      }),
      decline: outcome({
        emotion: "regret",
        cause: "letting a neighbor's request for help go unanswered",
        intensity: 15,
        duration: 1,
        prose: prosePhrasings(
          [
            "{name} had troubles enough of their own, and let a neighbor's request go unanswered.",
            "{name} heard a neighbor ask for help and pretended not to.",
            "{name} had an excuse ready, and let a neighbor carry the work alone.",
            "{name} turned away from a neighbor's request, and the day sat badly afterwards.",
            "{name} said the work was too much this year, and meant it.",
            "{name} looked at a neighbor's broken fence and went inside.",
          ],
          [
            "{name} ya tenía bastantes problemas propios, y dejó sin respuesta la petición de un vecino.",
            "{name} oyó a un vecino pedir ayuda e hizo como que no.",
            "{name} tenía una excusa lista, y dejó que un vecino cargara solo con el trabajo.",
            "{name} le dio la espalda a la petición de un vecino, y el día se le hizo pesado después.",
            "{name} dijo que este año el trabajo era demasiado, y lo decía en serio.",
            "{name} miró la cerca rota de un vecino y entró en casa.",
          ],
        ),
        optionDescription: "A neighbor could use a hand with hard, unglamorous work, but I have troubles enough of my own.",
      }),
    },
  },
  {
    id: "first-glance",
    variants: 4,
    title: phrasings(
      ["A first glance", "Someone new across the square", "A face worth a second look", "A look across the room"],
      ["Una primera mirada", "Alguien nuevo al otro lado de la plaza", "Un rostro que merece una segunda mirada", "Una mirada al otro lado de la sala"],
    ),
    question: fixed("Someone caught my eye today. Do I find a reason to speak with them?", "Hoy alguien llamó mi atención. ¿Busco una razón para hablar con esa persona?"),
    eligible: (ctx) => ctx.age >= 14 && ctx.age <= 30 && !ctx.hasSpouse,
    outcomes: {
      approach: outcome({
        emotion: "hope",
        cause: "finding a reason to speak with someone who caught my eye",
        intensity: 25,
        duration: 2,
        facet: "gregariousness",
        prose: prosePhrasings(
          [
            "{name} found a reason to speak with someone who'd caught an eye, if only for a moment.",
            "{name} crossed the square to speak to a stranger, and the words came easier than expected.",
            "{name} lingered near someone who'd caught an eye until there was nothing left but to say hello.",
            "A few words at a doorway turned into an hour, and the hour into a habit.",
          ],
          [
            "{name} encontró una razón para hablar con quien le había llamado la atención, aunque solo fuera un momento.",
            "{name} cruzó la plaza para hablar con alguien desconocido, y las palabras salieron más fáciles de lo esperado.",
            "{name} rondó cerca de quien le había llamado la atención hasta que no quedó más que saludar.",
            "Unas palabras en un umbral se volvieron una hora, y la hora se volvió costumbre.",
          ],
        ),
        optionDescription: "Someone caught my eye today, and I find a reason to speak with them.",
      }),
      "hold-back": outcome({
        emotion: "loneliness",
        cause: "saying nothing to someone who caught my eye",
        intensity: 15,
        duration: 1,
        prose: prosePhrasings(
          [
            "{name} noticed someone who caught an eye, and said nothing at all.",
            "{name} watched a stranger from across the square and let the moment pass.",
            "{name} rehearsed a greeting twice and never used it.",
            "The chance was let go by, and remembered for longer than it should have been.",
          ],
          [
            "{name} se fijó en alguien que le llamó la atención, y no dijo nada en absoluto.",
            "{name} miró a alguien desconocido desde el otro lado de la plaza y dejó pasar el momento.",
            "{name} ensayó un saludo dos veces y nunca lo usó.",
            "La ocasión se dejó pasar, y se recordó más tiempo del que debía.",
          ],
        ),
        optionDescription: "Someone caught my eye today, but I hold back and say nothing.",
      }),
    },
  },
  {
    id: "feast-day",
    variants: 6,
    title: phrasings(
      ["A feast day in {town}", "Feast-day bells in {town}", "A feast day, and the town at its loudest", "The long evening of a feast day", "A feast day, and the fires lit", "The feast comes round again"],
      ["Un día de fiesta en {town}", "Campanas de fiesta en {town}", "Un día de fiesta, y el pueblo en su punto más ruidoso", "La larga noche de un día de fiesta", "Un día de fiesta, y los fuegos encendidos", "La fiesta vuelve otra vez"],
    ),
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
        prose: prosePhrasings(
          [
            "{name} joined in the feast-day festivities in {town}, if only for an evening.",
            "{name} walked the feast-day crowd in {town} until the torches burned low.",
            "{name} let the feast day carry the whole day, and came home late and hoarse from talking.",
            "{name} found the feast day's noise a comfort, and stayed out past the bells.",
            "{name} stood at the edge of the feast-day dancing until someone pulled them in.",
            "{name} ate and drank at the feast day until the tables were cleared.",
          ],
          [
            "{name} se unió a la celebración del día de fiesta en {town}, aunque solo fuera por una noche.",
            "{name} recorrió la multitud del día de fiesta en {town} hasta que las antorchas se consumieron.",
            "{name} dejó que el día de fiesta se llevara el día entero, y volvió a casa tarde y ronco de tanto hablar.",
            "{name} encontró consuelo en el ruido del día de fiesta, y se quedó fuera hasta después de las campanas.",
            "{name} se quedó al borde del baile del día de fiesta hasta que alguien lo arrastró adentro.",
            "{name} comió y bebió en el día de fiesta hasta que levantaron las mesas.",
          ],
        ),
        optionDescription: "It's a feast day, and I join in the festivities.",
      }),
      "keep-to-self": outcome({
        emotion: "loneliness",
        cause: "keeping to home on a feast day",
        intensity: 15,
        duration: 1,
        prose: prosePhrasings(
          [
            "{name} kept to home on a feast day, while {town} celebrated without them.",
            "{name} heard the feast day start in {town} and did not go down to it.",
            "{name} kept the door shut through the feast day, and let {town} celebrate without them.",
            "{name} watched the feast-day fires from a distance, and stayed where it was quiet.",
            "{name} found work that needed doing at home, and did it through the feast day.",
            "{name} listened to the feast day from behind a closed door, and let it pass.",
          ],
          [
            "{name} se quedó en casa el día de fiesta, mientras {town} celebraba sin él o ella.",
            "{name} oyó empezar el día de fiesta en {town} y no bajó a él.",
            "{name} mantuvo la puerta cerrada durante el día de fiesta, y dejó que {town} celebrara sin él o ella.",
            "{name} miró los fuegos del día de fiesta desde lejos, y se quedó donde había silencio.",
            "{name} encontró trabajo que hacer en casa, y lo hizo durante todo el día de fiesta.",
            "{name} escuchó el día de fiesta detrás de una puerta cerrada, y lo dejó pasar.",
          ],
        ),
        optionDescription: "It's a feast day, but I keep to home rather than join in.",
      }),
    },
  },
  {
    id: "sick-animal",
    variants: 4,
    title: phrasings(
      ["A sick animal", "A beast down in the byre", "Sickness among the animals", "A beast that will not rise"],
      ["Un animal enfermo", "Una bestia caída en el establo", "Enfermedad entre los animales", "Una bestia que no se levanta"],
    ),
    question: fixed("One of the animals has fallen sick. Do I sit up nursing it through the night?", "Uno de los animales ha enfermado. ¿Me quedo despierto cuidándolo toda la noche?"),
    eligible: (ctx) => !ctx.away && ctx.job === "farmer",
    outcomes: {
      "nurse-it": outcome({
        emotion: "contentment",
        cause: "nursing a sick animal through the night",
        intensity: 20,
        duration: 2,
        facet: "perseverance",
        prose: prosePhrasings(
          [
            "{name} sat up through the night nursing a sick animal back to health.",
            "{name} kept a fire going in the byre and coaxed a sick beast through until morning.",
            "{name} slept in the straw beside a sick animal for three nights, and it lived.",
            "Three nights in the straw, and the beast walked out of the byre on its own.",
          ],
          [
            "{name} se quedó despierto toda la noche cuidando a un animal enfermo hasta que sanó.",
            "{name} mantuvo el fuego encendido en el establo y sacó adelante a una bestia enferma hasta la mañana.",
            "{name} durmió en la paja junto a un animal enfermo durante tres noches, y el animal vivió.",
            "Tres noches en la paja, y la bestia salió sola del establo.",
          ],
        ),
        optionDescription: "One of the animals has fallen sick, and I sit up nursing it through the night.",
      }),
      "let-it-go": outcome({
        emotion: "regret",
        cause: "letting a sick animal go rather than losing sleep over it",
        intensity: 15,
        duration: 1,
        prose: prosePhrasings(
          [
            "{name} let a sick animal go, rather than lose sleep over it.",
            "{name} judged a sick beast not worth the nights, and put it out of mind.",
            "{name} left a sick animal to whatever came, and did not go back to the byre.",
            "The beast was sold cheap rather than watched over, and was someone else's trouble by the week's end.",
          ],
          [
            "{name} dejó ir a un animal enfermo, antes que perder el sueño por él.",
            "{name} consideró que una bestia enferma no valía las noches, y la apartó de su cabeza.",
            "{name} dejó a un animal enfermo a lo que viniera, y no volvió al establo.",
            "La bestia se vendió barata en vez de cuidarla, y para el fin de semana era problema de otro.",
          ],
        ),
        optionDescription: "One of the animals has fallen sick, and I let it go rather than lose sleep over it.",
      }),
    },
  },
  {
    id: "old-debt",
    variants: 6,
    title: phrasings(
      ["An old debt", "An old debt comes due", "The debt that would not die", "A debt, and a reckoning", "The sum still owed", "A debt older than the quarrel"],
      ["Una vieja deuda", "Una vieja deuda vence", "La deuda que no moría", "Una deuda, y un ajuste de cuentas", "La suma todavía debida", "Una deuda más vieja que la riña"],
    ),
    question: fixed("An old debt has come due. Do I pay it off, even if it costs me?", "Una vieja deuda ha vencido. ¿La pago, aunque me cueste?"),
    eligible: (ctx) => ctx.age >= 20,
    outcomes: {
      "pay-it-off": outcome({
        emotion: "relief",
        cause: "paying off an old debt whatever it cost",
        intensity: 20,
        duration: 2,
        facet: "perseverance",
        prose: prosePhrasings(
          [
            "{name} paid off an old debt, whatever it cost.",
            "{name} settled an old debt in full, and slept easier for it.",
            "{name} counted out the last of an old debt and closed the account for good.",
            "{name} paid an old debt down to nothing, and did not complain about the price.",
            "{name} sold a beast to clear an old debt, and did not haggle over the price.",
            "{name} paid an old debt in instalments nobody asked for, and finished it.",
          ],
          [
            "{name} pagó una vieja deuda, costara lo que costara.",
            "{name} saldó una vieja deuda por completo, y desde entonces durmió mejor.",
            "{name} contó hasta el último penique de una vieja deuda y cerró la cuenta para siempre.",
            "{name} pagó una vieja deuda hasta dejarla en nada, y no se quejó del precio.",
            "{name} vendió una bestia para saldar una vieja deuda, y no regateó el precio.",
            "{name} pagó una vieja deuda en cuotas que nadie pidió, y la terminó.",
          ],
        ),
        optionDescription: "An old debt has come due, and I pay it off, even if it costs me.",
      }),
      "let-it-ride": outcome({
        emotion: "fear",
        cause: "letting an old debt ride another year",
        intensity: 15,
        duration: 2,
        prose: prosePhrasings(
          [
            "{name} let an old debt ride another year, and felt the weight of it.",
            "{name} put off an old debt again, and avoided the creditor's street.",
            "{name} promised an old debt would be paid soon, and meant it less than last time.",
            "{name} let an old debt stand another year, and the silence around it grew.",
            "{name} counted the money for an old debt and put it back in the chest.",
            "{name} let an old debt age another year, and stopped mentioning it at all.",
          ],
          [
            "{name} dejó pasar otro año con una vieja deuda, y sintió su peso.",
            "{name} volvió a postergar una vieja deuda, y evitó la calle del acreedor.",
            "{name} prometió que una vieja deuda se pagaría pronto, y lo dijo con menos ganas que la vez anterior.",
            "{name} dejó en pie una vieja deuda otro año más, y el silencio alrededor creció.",
            "{name} contó el dinero para una vieja deuda y lo volvió a guardar en el cofre.",
            "{name} dejó envejecer una vieja deuda otro año, y dejó de mencionarla del todo.",
          ],
        ),
        optionDescription: "An old debt has come due, and I let it ride another year.",
      }),
    },
  },
  {
    id: "teaching-a-child",
    variants: 4,
    title: phrasings(
      ["Teaching a child the trade", "A child's first day at the work", "Handing on the trade", "Showing a child how it is done"],
      ["Enseñando el oficio a un hijo", "El primer día de trabajo de un hijo", "Transmitir el oficio", "Mostrando a un hijo cómo se hace"],
    ),
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
        prose: prosePhrasings(
          [
            "{name} taught a child the trade patiently, one small task at a time.",
            "{name} let a child spoil three good pieces and said nothing about it.",
            "{name} spent the day showing a child the trade slowly, hands over hands.",
            "A child learned the trade at the pace of the work itself, and did not notice the learning.",
          ],
          [
            "{name} enseñó el oficio a un hijo con paciencia, una pequeña tarea a la vez.",
            "{name} dejó que un hijo arruinara tres piezas buenas y no dijo nada al respecto.",
            "{name} pasó el día mostrando el oficio a un hijo despacio, con las manos encima de las suyas.",
            "Un hijo aprendió el oficio al ritmo del trabajo mismo, y no notó que estaba aprendiendo.",
          ],
        ),
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
        prose: prosePhrasings(
          [
            "{name} pushed a child briskly through the first lessons of the trade.",
            "{name} hurried a child through the work, and called the mistakes out loud.",
            "{name} set a child to a full day's work on the first morning, to see what they were made of.",
            "A child was kept at it until the hands knew what the head did not.",
          ],
          [
            "{name} apremió a un hijo en las primeras lecciones del oficio.",
            "{name} apuró a un hijo en el trabajo, y señaló los errores en voz alta.",
            "{name} puso a un hijo a un día entero de trabajo en la primera mañana, para ver de qué estaba hecho.",
            "A un hijo se lo mantuvo en eso hasta que las manos supieron lo que la cabeza no.",
          ],
        ),
        optionDescription: "A child is old enough to start learning the trade, and I push them along briskly.",
      }),
    },
  },
  {
    id: "aches-of-age",
    variants: 6,
    title: phrasings(
      ["The aches of age", "A body slow to wake", "The work, and the years", "The morning after a long life", "A slow start, and the same work", "The years, counted in mornings"],
      ["Los achaques de la edad", "Un cuerpo que tarda en despertar", "El trabajo, y los años", "La mañana después de una vida larga", "Un comienzo lento, y el mismo trabajo", "Los años, contados en mañanas"],
    ),
    question: fixed("The aches of age are catching up. Do I push through the day's work all the same?", "Los achaques de la edad empiezan a pesar. ¿Sigo adelante con el trabajo del día de todos modos?"),
    eligible: (ctx) => ctx.age >= 60,
    outcomes: {
      "push-through": outcome({
        emotion: "pride",
        cause: "pushing through the aches of age to get the work done",
        intensity: 20,
        duration: 2,
        facet: "perseverance",
        prose: prosePhrasings(
          [
            "{name} pushed through the aches of age to get the day's work done.",
            "{name} worked the whole day on a knee that complained with every step.",
            "{name} did the work of a younger person, and paid for it that night.",
            "The day's work was finished by noon, and the afternoon given to the door and the sun.",
            "{name} took the stairs slowly and did the work anyway.",
            "{name} worked through an afternoon that a younger body would have found easy.",
          ],
          [
            "{name} siguió adelante pese a los achaques de la edad, para terminar el trabajo del día.",
            "{name} trabajó todo el día con una rodilla que se quejaba a cada paso.",
            "{name} hizo el trabajo de alguien más joven, y lo pagó esa noche.",
            "El trabajo del día se terminó al mediodía, y la tarde se dio a la puerta y al sol.",
            "{name} subió las escaleras despacio e hizo el trabajo de todos modos.",
            "{name} trabajó una tarde que un cuerpo más joven habría encontrado fácil.",
          ],
        ),
        optionDescription: "The aches of age are catching up, but I push through the day's work all the same.",
      }),
      rest: outcome({
        emotion: "relief",
        cause: "resting instead of fighting through the aches of age",
        intensity: 15,
        duration: 1,
        prose: prosePhrasings(
          [
            "{name} gave in to the aches of age and rested, for once.",
            "{name} sat in the sun through the morning and let the work wait.",
            "{name} handed the harder tasks to someone younger, and did not argue about it.",
            "The body was asked for less, and gave back enough.",
            "{name} let the day go by by the fire, and nothing was lost for it.",
            "{name} asked for help with the lifting, and got it without a fuss.",
          ],
          [
            "{name} cedió a los achaques de la edad y descansó, por una vez.",
            "{name} se quedó al sol durante la mañana y dejó que el trabajo esperara.",
            "{name} le pasó las tareas más duras a alguien más joven, y no discutió al respecto.",
            "Al cuerpo se le pidió menos, y devolvió lo suficiente.",
            "{name} dejó pasar el día junto al fuego, y no se perdió nada por ello.",
            "{name} pidió ayuda para cargar, y la recibió sin alboroto.",
          ],
        ),
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
    variants: 3,
    title: phrasings(
      ["A fever scare", "A child burning hot in the night", "The fever comes in the dark"],
      ["Un susto de fiebre", "Un hijo ardiendo en la noche", "La fiebre llega en la oscuridad"],
    ),
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
        prose: prosePhrasings(
          [
            "{name} sat up all night watching over a feverish child, until the fever broke.",
            "{name} kept cold cloths coming and did not sleep until the child's skin cooled.",
            "{name} held a feverish child through the dark hours and counted every breath.",
          ],
          [
            "{name} veló toda la noche a un hijo con fiebre, hasta que esta cedió.",
            "{name} renovó los paños fríos sin dormir hasta que la piel del niño se enfrió.",
            "{name} sostuvo a un hijo con fiebre durante las horas oscuras y contó cada respiración.",
          ],
        ),
        optionDescription: "A fever came on hard in the night, and I sit up watching over the cradle.",
      }),
      "trust-it-passes": outcome({
        emotion: "hope",
        cause: "trusting a child's fever would pass on its own",
        intensity: 15,
        duration: 2,
        prose: prosePhrasings(
          [
            "{name} trusted the fever would pass on its own, and it did, by morning.",
            "{name} decided the fever was nothing much, and was proved right by dawn.",
            "{name} slept through the worst of it, trusting the child's body to do its work.",
          ],
          [
            "{name} confió en que la fiebre pasaría sola, y así fue, para la mañana.",
            "{name} decidió que la fiebre no era gran cosa, y el amanecer le dio la razón.",
            "{name} durmió durante lo peor, confiando en que el cuerpo del niño hiciera su trabajo.",
          ],
        ),
        optionDescription: "A fever came on hard in the night, but I trust it will pass on its own.",
      }),
    },
  },
  {
    id: "first-steps",
    variants: 3,
    title: phrasings(
      ["A first, wobbling step", "The child stands", "A first step across the floor"],
      ["Un primer paso vacilante", "El niño se pone de pie", "Un primer paso por el suelo"],
    ),
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
        prose: prosePhrasings(
          [
            "{name} made much of a first wobbling step, delighted, the whole house called to see.",
            "{name} shouted for the household and made everyone watch the child cross the floor.",
            "{name} clapped and laughed at a first wobbling step, and told the neighbors about it for a week.",
          ],
          [
            "{name} celebró por todo lo alto un primer paso vacilante, con alegría, y llamó a toda la casa a verlo.",
            "{name} llamó a gritos a toda la casa e hizo que todos miraran al niño cruzar el suelo.",
            "{name} aplaudió y se rió ante el primer paso vacilante, y se lo contó a los vecinos durante una semana.",
          ],
        ),
        optionDescription: "The child took a first wobbling step today, and I make much of it.",
      }),
      "note-it-quietly": outcome({
        emotion: "contentment",
        cause: "noting a child's first wobbling step quietly",
        intensity: 15,
        duration: 1,
        prose: prosePhrasings(
          [
            "{name} noted a first wobbling step quietly, pleased, and went back to the day's work.",
            "{name} watched the child cross the floor, nodded once, and said nothing about it.",
            "{name} kept the first step to the family, and told no one outside the house.",
          ],
          [
            "{name} tomó nota en silencio del primer paso vacilante, con satisfacción, y volvió al trabajo del día.",
            "{name} miró al niño cruzar el suelo, asintió una vez, y no dijo nada al respecto.",
            "{name} guardó el primer paso para la familia, y no se lo contó a nadie fuera de la casa.",
          ],
        ),
        optionDescription: "The child took a first wobbling step today, but I note it quietly and go back to work.",
      }),
    },
  },
  {
    id: "new-sibling",
    variants: 3,
    title: phrasings(
      ["A new sibling", "A new little one in the house", "The cradle fills again"],
      ["Un nuevo hermano", "Un pequeño más en la casa", "La cuna se vuelve a llenar"],
    ),
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
        prose: prosePhrasings(
          [
            "{name} made room gladly for a new little one in the house.",
            "{name} gave up a corner of the bed and half the blankets without being asked.",
            "{name} carried the new baby round the house proudly, and would not put it down.",
          ],
          [
            "{name} le hizo sitio de buen grado al nuevo pequeño de la casa.",
            "{name} cedió un rincón de la cama y la mitad de las mantas sin que se lo pidieran.",
            "{name} paseó al recién nacido por la casa con orgullo, y no quería soltarlo.",
          ],
        ),
        optionDescription: "There's a new little one in the house, and I make room for them gladly.",
      }),
      "mind-the-fuss": outcome({
        emotion: "bitterness",
        cause: "minding the fuss made over a new sibling",
        intensity: 15,
        duration: 2,
        prose: prosePhrasings(
          [
            "{name} minded the fuss over a new sibling, a little put out by it.",
            "{name} found the new baby loud, and said so where the parents could hear.",
            "{name} kept to the far side of the room while the household crowded round the cradle.",
          ],
          [
            "{name} llevó mal el alboroto por el nuevo hermano, con cierto fastidio.",
            "{name} encontró ruidoso al recién nacido, y lo dijo donde los padres pudieran oírlo.",
            "{name} se quedó al otro lado de la habitación mientras la casa se apiñaba alrededor de la cuna.",
          ],
        ),
        optionDescription: "There's a new little one in the house, and I mind the fuss made over them.",
      }),
    },
  },
  {
    id: "lost-in-the-woods",
    variants: 3,
    title: phrasings(
      ["Lost in the woods", "An hour missing near the treeline", "The child gone from the door"],
      ["Perdido en el bosque", "Una hora desaparecido junto al linde", "El niño que faltaba de la puerta"],
    ),
    question: fixed("The child wandered off and was lost near the woods for an hour. Do I forbid wandering after, or let the world stay wide?", "El niño se alejó y estuvo perdido cerca del bosque durante una hora. ¿Prohíbo que vuelva a alejarse, o dejo que el mundo siga siendo grande?"),
    eligible: (ctx) => ctx.age <= 5 && ctx.hasLivingParent,
    decidedByParent: true,
    outcomes: {
      "forbid-wandering": outcome({
        emotion: "fear",
        cause: "forbidding wandering after a child was lost near the woods",
        intensity: 25,
        duration: 2,
        prose: prosePhrasings(
          [
            "{name} forbade wandering near the woods after that, and kept a closer watch.",
            "{name} set a boundary at the treeline, and did not let the child cross it alone again.",
            "{name} went white at the memory of it, and made the woods off limits for good.",
          ],
          [
            "{name} prohibió después alejarse cerca del bosque, y vigiló más de cerca.",
            "{name} puso un límite en el linde, y no dejó que el niño lo cruzara solo otra vez.",
            "{name} se quedó sin color al recordarlo, y dejó el bosque prohibido para siempre.",
          ],
        ),
        optionDescription: "The child was lost near the woods for an hour, and I forbid wandering after that.",
      }),
      "let-the-world-stay-wide": outcome({
        emotion: "relief",
        cause: "letting the world stay wide even after a child went missing near the woods",
        intensity: 20,
        duration: 2,
        facet: "curiosity",
        prose: prosePhrasings(
          [
            "{name} let the world stay wide, relieved to have the child back, unwilling to fence it in.",
            "{name} held the child a moment longer, then let it go out again.",
            "{name} decided a scared hour was cheaper than a small life, and said no more about it.",
          ],
          [
            "{name} dejó que el mundo siguiera siendo grande, con alivio por recuperar al niño, sin querer encerrarlo.",
            "{name} retuvo al niño un momento más, y después lo dejó salir de nuevo.",
            "{name} decidió que una hora de miedo era más barata que una vida pequeña, y no dijo nada más.",
          ],
        ),
        optionDescription: "The child was lost near the woods for an hour, but I let the world stay wide all the same.",
      }),
    },
  },
  {
    id: "village-festival-childs-eyes",
    variants: 3,
    title: phrasings(
      ["A village festival, through young eyes", "The festival, and a child who cannot look away", "Lights and noise, and a small face"],
      ["Una fiesta del pueblo, con ojos infantiles", "La fiesta, y un niño que no puede apartar la vista", "Luces y ruido, y una cara pequeña"],
    ),
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
        prose: prosePhrasings(
          [
            "{name} let the child stay up late, dazzled, taking in every last moment of the village festival.",
            "{name} carried a sleeping child home at midnight, still smiling at the noise.",
            "{name} watched the festival through the child's eyes and stayed until the last fire went out.",
          ],
          [
            "{name} dejó al niño, deslumbrado, quedarse despierto hasta tarde para disfrutar cada momento de la fiesta del pueblo.",
            "{name} cargó a un niño dormido hasta casa a medianoche, todavía sonriendo por el ruido.",
            "{name} miró la fiesta a través de los ojos del niño y se quedó hasta que se apagó el último fuego.",
          ],
        ),
        optionDescription: "The village festival dazzled the child completely, and I let them stay up late taking it in.",
      }),
      "send-them-to-bed": outcome({
        emotion: "contentment",
        cause: "sending a dazzled child off to bed early despite the village festival",
        intensity: 15,
        duration: 1,
        prose: prosePhrasings(
          [
            "{name} sent the child off to bed early, festival or no, and stood watch over an easier sleep.",
            "{name} closed the shutters on the festival and put the child down while the drums still played.",
            "{name} said the festival would come again next year, and shut the door on it.",
          ],
          [
            "{name} mandó al niño a la cama temprano, fiesta o no, y veló por un sueño más tranquilo.",
            "{name} cerró los postigos sobre la fiesta y acostó al niño mientras los tambores seguían sonando.",
            "{name} dijo que la fiesta volvería el año siguiente, y le cerró la puerta.",
          ],
        ),
        optionDescription: "The village festival dazzled the child completely, but I send them to bed early all the same.",
      }),
    },
  },
  {
    id: "helping-in-the-fields",
    variants: 3,
    title: phrasings(
      ["Helping in the fields", "Work to be done, and small hands", "A day in the fields"],
      ["Ayudando en el campo", "Trabajo por hacer, y manos pequeñas", "Un día en el campo"],
    ),
    question: fixed("There's work to be done in the fields today. Do I pitch in properly, or slip off to play?", "Hoy hay trabajo que hacer en el campo. ¿Arrimo el hombro de verdad, o me escapo a jugar?"),
    eligible: (ctx) => !ctx.away && ctx.age >= 6 && ctx.age <= 12,
    outcomes: {
      "pitch-in": outcome({
        emotion: "pride",
        cause: "pitching in properly with work in the fields",
        intensity: 20,
        duration: 2,
        facet: "perseverance",
        prose: prosePhrasings(
          [
            "{name} pitched in properly in the fields, small hands doing what they could.",
            "{name} carried sheaves taller than their own head and did not complain once.",
            "{name} worked beside the adults until the light went, and asked to come again.",
          ],
          [
            "{name} arrimó el hombro de verdad en el campo, con sus manos pequeñas haciendo lo que podían.",
            "{name} cargó gavillas más altas que su cabeza y no se quejó ni una vez.",
            "{name} trabajó junto a los adultos hasta que se fue la luz, y pidió volver.",
          ],
        ),
        optionDescription: "There's work to be done in the fields today, and I pitch in properly.",
      }),
      "slip-off-to-play": outcome({
        emotion: "joy",
        cause: "slipping off to play instead of working in the fields",
        intensity: 15,
        duration: 1,
        prose: prosePhrasings(
          [
            "{name} slipped off to play instead, and no one minded much, this once.",
            "{name} was gone before the second row, and came back at supper with muddy knees.",
            "{name} did half the row and then found the other children down by the stream.",
          ],
          [
            "{name} se escapó a jugar en su lugar, y a nadie le importó demasiado, por esta vez.",
            "{name} desapareció antes de la segunda hilera, y volvió a la cena con las rodillas embarradas.",
            "{name} hizo media hilera y después encontró a los otros niños junto al arroyo.",
          ],
        ),
        optionDescription: "There's work to be done in the fields today, but I slip off to play instead.",
      }),
    },
  },
  {
    id: "friends-secret",
    variants: 3,
    title: phrasings(
      ["A friend's secret", "A promise made in the lane", "Something told in confidence"],
      ["El secreto de un amigo", "Una promesa hecha en el callejón", "Algo contado en confianza"],
    ),
    question: fixed("A friend told me a secret and made me swear not to tell. Do I keep it?", "Un amigo me contó un secreto y me hizo jurar que no lo diría. ¿Lo guardo?"),
    eligible: (ctx) => ctx.age >= 6 && ctx.age <= 12,
    outcomes: {
      "keep-it": outcome({
        emotion: "pride",
        cause: "keeping a friend's secret, sworn to it",
        intensity: 20,
        duration: 2,
        facet: "altruism",
        prose: prosePhrasings(
          [
            "{name} kept a friend's secret, sworn to it, and never told a soul.",
            "{name} carried a friend's secret for years and took it to no one.",
            "{name} lied when asked about it, and the secret stayed where it was put.",
          ],
          [
            "{name} guardó el secreto de un amigo, tal como había jurado, y nunca se lo contó a nadie.",
            "{name} cargó el secreto de un amigo durante años y no se lo contó a nadie.",
            "{name} mintió cuando le preguntaron, y el secreto se quedó donde estaba.",
          ],
        ),
        optionDescription: "A friend told me a secret and made me swear not to tell, and I keep it.",
      }),
      "let-it-slip": outcome({
        emotion: "regret",
        cause: "letting a friend's secret slip",
        intensity: 20,
        duration: 2,
        prose: prosePhrasings(
          [
            "{name} let a friend's secret slip, and regretted it after.",
            "{name} told a friend's secret to the first person who asked, and word travelled.",
            "{name} let it out at the well, where nothing stays quiet.",
          ],
          [
            "{name} dejó escapar el secreto de un amigo, y después se arrepintió.",
            "{name} le contó el secreto de un amigo a la primera persona que preguntó, y la noticia corrió.",
            "{name} lo soltó junto al pozo, donde nada queda en silencio.",
          ],
        ),
        optionDescription: "A friend told me a secret and made me swear not to tell, but I let it slip.",
      }),
    },
  },
  {
    id: "scolding-from-the-priest",
    variants: 3,
    title: phrasings(
      ["A scolding from the priest", "A sharp word before the whole church", "The priest's reproach"],
      ["Una reprimenda del párroco", "Una palabra dura delante de toda la iglesia", "El reproche del párroco"],
    ),
    question: fixed("The priest scolded me sharply in front of others today. Do I take it to heart?", "Hoy el párroco me reprendió con dureza delante de otros. ¿Me lo tomo a pecho?"),
    eligible: (ctx) => !ctx.away && ctx.age >= 6 && ctx.age <= 12,
    outcomes: {
      "take-it-to-heart": outcome({
        emotion: "regret",
        cause: "taking a sharp scolding from the priest to heart",
        intensity: 20,
        duration: 2,
        facet: "perseverance",
        prose: prosePhrasings(
          [
            "{name} took a sharp scolding from the priest to heart, and minded manners closer after.",
            "{name} could not meet anyone's eye after the priest's scolding, and kept to the back of the church.",
            "{name} went home straight after the priest's words and did not come out again that day.",
          ],
          [
            "{name} se tomó a pecho una dura reprimenda del párroco, y después cuidó mejor sus modales.",
            "{name} no pudo mirar a nadie a los ojos tras la reprimenda del párroco, y se quedó al fondo de la iglesia.",
            "{name} volvió directo a casa tras las palabras del párroco y no salió de nuevo ese día.",
          ],
        ),
        optionDescription: "The priest scolded me sharply in front of others today, and I take it to heart.",
      }),
      "shrug-it-off": outcome({
        emotion: "bitterness",
        cause: "shrugging off a scolding from the priest",
        intensity: 15,
        duration: 1,
        facet: "anger",
        prose: prosePhrasings(
          [
            "{name} shrugged off the priest's scolding, and was back to old mischief by supper.",
            "{name} mimicked the priest behind the church wall, and got a laugh for it.",
            "{name} decided the priest could scold all he liked, and did exactly as before.",
          ],
          [
            "{name} restó importancia a la reprimenda del párroco, y para la cena ya andaba de nuevo en travesuras.",
            "{name} imitó al párroco detrás del muro de la iglesia, y consiguió una risa a cambio.",
            "{name} decidió que el párroco podía reprender cuanto quisiera, e hizo exactamente lo mismo que antes.",
          ],
        ),
        optionDescription: "The priest scolded me sharply in front of others today, but I shrug it off.",
      }),
    },
  },
  {
    id: "a-stray-dog",
    variants: 3,
    title: phrasings(
      ["A stray dog", "A thin dog at the door", "Something hungry in the yard"],
      ["Un perro callejero", "Un perro flaco en la puerta", "Algo hambriento en el patio"],
    ),
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
        prose: prosePhrasings(
          [
            "{name} fed a thin, wary stray dog that had taken to hanging round the house.",
            "{name} put out scraps every night until the dog stopped flinching.",
            "{name} shared supper with a stray under the table, and was caught doing it.",
          ],
          [
            "{name} dio de comer a un perro callejero flaco y receloso que rondaba la casa.",
            "{name} dejó restos cada noche hasta que el perro dejó de encogerse.",
            "{name} compartió la cena con un callejero bajo la mesa, y lo pillaron haciéndolo.",
          ],
        ),
        optionDescription: "A stray dog has been hanging round the house, thin and wary, and I feed it.",
      }),
      "chase-it-off": outcome({
        emotion: "regret",
        cause: "chasing off a stray dog hanging round the house",
        intensity: 15,
        duration: 1,
        prose: prosePhrasings(
          [
            "{name} chased the stray dog off, though it lingered nearby for days after.",
            "{name} threw a stone at the dog and did not look to see where it went.",
            "{name} shut the gate on a thin dog, and went back inside without a word.",
          ],
          [
            "{name} ahuyentó al perro callejero, aunque este rondó cerca durante días.",
            "{name} le tiró una piedra al perro y no miró hacia dónde fue.",
            "{name} le cerró la puerta a un perro flaco, y volvió adentro sin decir palabra.",
          ],
        ),
        optionDescription: "A stray dog has been hanging round the house, thin and wary, and I chase it off.",
      }),
    },
  },
  {
    id: "a-fight-with-another-child",
    variants: 3,
    title: phrasings(
      ["A fight with another child", "Blood on the lip", "A row in the lane"],
      ["Una pelea con otro niño", "Sangre en el labio", "Una trifulca en el callejón"],
    ),
    question: fixed("A fight broke out with another child today. Do I throw the first punch, or walk away?", "Hoy estalló una pelea con otro niño. ¿Doy el primer golpe, o me alejo?"),
    eligible: (ctx) => !ctx.away && ctx.age >= 6 && ctx.age <= 12,
    outcomes: {
      "throw-the-first-punch": outcome({
        emotion: "pride",
        cause: "throwing the first punch in a fight with another child",
        intensity: 20,
        duration: 2,
        facet: "anger",
        prose: prosePhrasings(
          [
            "{name} threw the first punch in a fight with another child, and came home with a bloody lip and swagger both.",
            "{name} hit first and hit hard, and was pulled off by two adults.",
            "{name} started it, finished it, and would not say who had won.",
          ],
          [
            "{name} dio el primer golpe en una pelea con otro niño, y volvió a casa con el labio partido y aires de bravucón.",
            "{name} golpeó primero y fuerte, y dos adultos tuvieron que separarlo.",
            "{name} empezó la pelea, la terminó, y no quiso decir quién había ganado.",
          ],
        ),
        optionDescription: "A fight broke out with another child today, and I throw the first punch.",
      }),
      "walk-away": outcome({
        emotion: "relief",
        cause: "walking away from a fight with another child",
        intensity: 15,
        duration: 1,
        facet: "perseverance",
        prose: prosePhrasings(
          [
            "{name} walked away from a fight with another child, though it cost something to do it.",
            "{name} turned their back on a challenge in the lane and kept walking.",
            "{name} let the insult stand, and went home with a face still burning.",
          ],
          [
            "{name} se alejó de una pelea con otro niño, aunque le costó hacerlo.",
            "{name} le dio la espalda a un desafío en el callejón y siguió caminando.",
            "{name} dejó pasar el insulto, y volvió a casa con la cara todavía ardiendo.",
          ],
        ),
        optionDescription: "A fight broke out with another child today, but I walk away from it.",
      }),
    },
  },
  {
    id: "carrying-water-in-winter",
    variants: 3,
    title: phrasings(
      ["Carrying water in winter", "The icy walk to the well", "Water from the far well"],
      ["Acarreando agua en invierno", "El camino helado al pozo", "Agua del pozo lejano"],
    ),
    question: fixed("The well is a long, icy walk away this winter. Do I fetch the water without complaint?", "Este invierno el pozo queda un largo y helado trecho a pie. ¿Voy a por agua sin quejarme?"),
    eligible: (ctx) => !ctx.away && ctx.age >= 6 && ctx.age <= 12 && ctx.season === "the depths of winter",
    outcomes: {
      "fetch-without-complaint": outcome({
        emotion: "pride",
        cause: "fetching water from the icy well all winter without complaint",
        intensity: 20,
        duration: 2,
        facet: "perseverance",
        prose: prosePhrasings(
          [
            "{name} fetched water from the icy well all winter, without complaint.",
            "{name} broke the ice at the well every morning and carried it home without a word.",
            "{name} made the walk four times a day and never once asked anyone else to do it.",
          ],
          [
            "{name} acarreó agua del pozo helado durante todo el invierno, sin quejarse.",
            "{name} rompió el hielo del pozo cada mañana y la llevó a casa sin decir palabra.",
            "{name} hizo el camino cuatro veces al día y nunca le pidió a nadie más que lo hiciera.",
          ],
        ),
        optionDescription: "The well is a long, icy walk away this winter, and I fetch the water without complaint.",
      }),
      "grumble-about-it": outcome({
        emotion: "bitterness",
        cause: "grumbling about the long, icy walk to the well",
        intensity: 15,
        duration: 1,
        prose: prosePhrasings(
          [
            "{name} grumbled about the long, icy walk to the well, all winter long.",
            "{name} complained at every trip to the well and made sure the house heard it.",
            "{name} carried the water and a sour face both, every day of the winter.",
          ],
          [
            "{name} se quejó del largo y helado camino al pozo, durante todo el invierno.",
            "{name} se quejó en cada viaje al pozo y se aseguró de que la casa lo oyera.",
            "{name} llevó el agua y también una cara agria, todos los días del invierno.",
          ],
        ),
        optionDescription: "The well is a long, icy walk away this winter, and I grumble about it.",
      }),
    },
  },
  {
    id: "first-dance-at-the-feast",
    variants: 3,
    title: phrasings(
      ["A first dance at the feast", "The floor, and everyone watching", "A hand held out for a dance"],
      ["Un primer baile en la fiesta", "La pista, y todos mirando", "Una mano tendida para bailar"],
    ),
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
        prose: prosePhrasings(
          [
            "{name} took the floor for a first dance at the feast, nerves and all.",
            "{name} danced badly and laughed about it, and did not sit down again.",
            "{name} asked for a dance, was refused once, and asked someone else.",
          ],
          [
            "{name} salió a bailar por primera vez en la fiesta, nervios y todo.",
            "{name} bailó mal y se rió de ello, y no volvió a sentarse.",
            "{name} pidió un baile, recibió una negativa, y se lo pidió a otra persona.",
          ],
        ),
        optionDescription: "There's a feast on, and dancing, and I take the floor.",
      }),
      "watch-from-the-edge": outcome({
        emotion: "loneliness",
        cause: "watching the dancing from the edge of the feast",
        intensity: 15,
        duration: 1,
        prose: prosePhrasings(
          [
            "{name} watched the dancing from the edge of the feast, working up the nerve that never quite came.",
            "{name} stood by the wall with the other watchers and clapped for other people.",
            "{name} went home early, and heard the music from the lane.",
          ],
          [
            "{name} miró el baile desde el borde de la fiesta, tratando de reunir un valor que nunca llegó del todo.",
            "{name} se quedó junto al muro con los demás que miraban, y aplaudió a otros.",
            "{name} volvió a casa temprano, y oyó la música desde el callejón.",
          ],
        ),
        optionDescription: "There's a feast on, and dancing, but I watch from the edge instead.",
      }),
    },
  },
  {
    id: "a-dare",
    variants: 3,
    title: phrasings(
      ["A dare", "Something reckless, and a crowd watching", "The dare, and the choice"],
      ["Un desafío", "Algo imprudente, y un grupo mirando", "El reto, y la decisión"],
    ),
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
        prose: prosePhrasings(
          [
            "{name} went through with a reckless dare, and dined out on the story after.",
            "{name} did the thing, however foolish, and came away with a scar and a following.",
            "{name} jumped, climbed or ran, whichever it was, and did not stop to think first.",
          ],
          [
            "{name} llevó a cabo un desafío imprudente, y después presumió de la historia durante mucho tiempo.",
            "{name} hizo la cosa, por insensata que fuera, y salió con una cicatriz y algo de séquito.",
            "{name} saltó, trepó o corrió, fuera lo que fuera, y no se detuvo a pensar primero.",
          ],
        ),
        optionDescription: "Friends have dared me to something reckless, and I go through with it.",
      }),
      "back-down": outcome({
        emotion: "relief",
        cause: "backing down from a reckless dare",
        intensity: 15,
        duration: 1,
        prose: prosePhrasings(
          [
            "{name} backed down from a reckless dare, and took some ribbing for it.",
            "{name} said no in front of everyone, and the laughter followed for a week.",
            "{name} looked at what was being asked, walked away, and slept well enough.",
          ],
          [
            "{name} se echó atrás ante un desafío imprudente, y aguantó las burlas por ello.",
            "{name} dijo que no delante de todos, y las risas siguieron durante una semana.",
            "{name} miró lo que le pedían, se alejó, y durmió lo bastante bien.",
          ],
        ),
        optionDescription: "Friends have dared me to something reckless, but I back down.",
      }),
    },
  },
  {
    id: "work-alongside-a-master",
    variants: 3,
    title: phrasings(
      ["Work alongside a master", "A day under a master's eye", "The master's bench"],
      ["Trabajar junto a un maestro", "Un día bajo el ojo de un maestro", "El banco del maestro"],
    ),
    question: fixed("A master craftsman has taken me on for the day. Do I work hard to impress?", "Un maestro artesano me ha tomado por un día. ¿Trabajo duro para impresionarlo?"),
    eligible: (ctx) => !ctx.away && ctx.age >= 13 && ctx.age <= 19 && ctx.job !== "none",
    outcomes: {
      "work-hard-to-impress": outcome({
        emotion: "pride",
        cause: "working hard alongside a master craftsman to impress",
        intensity: 20,
        duration: 2,
        facet: "ambition",
        prose: prosePhrasings(
          [
            "{name} worked hard alongside a master craftsman, hoping to impress.",
            "{name} stayed past the light to finish a piece the master had not asked for.",
            "{name} watched every cut the master made and copied it exactly.",
          ],
          [
            "{name} trabajó duro junto a un maestro artesano, con la esperanza de impresionarlo.",
            "{name} se quedó después de que se fuera la luz para terminar una pieza que el maestro no había pedido.",
            "{name} miró cada corte que hacía el maestro y lo copió exactamente.",
          ],
        ),
        optionDescription: "A master craftsman has taken me on for the day, and I work hard to impress.",
      }),
      "keep-to-the-minimum": outcome({
        emotion: "contentment",
        cause: "keeping to the minimum of what was asked, working alongside a master craftsman",
        intensity: 15,
        duration: 1,
        prose: prosePhrasings(
          [
            "{name} kept to the minimum of what was asked, working alongside a master craftsman for the day.",
            "{name} did the task set and not one thing more, and went home at the right hour.",
            "{name} let the master work in silence and stayed out of the way.",
          ],
          [
            "{name} se limitó a lo mínimo pedido, trabajando junto a un maestro artesano por un día.",
            "{name} hizo la tarea encargada y nada más, y se fue a casa a la hora justa.",
            "{name} dejó que el maestro trabajara en silencio y se mantuvo al margen.",
          ],
        ),
        optionDescription: "A master craftsman has taken me on for the day, but I keep to the minimum of what's asked.",
      }),
    },
  },
  {
    id: "argument-with-a-parent-over-the-future",
    variants: 3,
    title: phrasings(
      ["An argument over the future", "Words about what I am to become", "The door, and the argument"],
      ["Una discusión sobre el futuro", "Palabras sobre lo que seré", "La puerta, y la discusión"],
    ),
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
        prose: prosePhrasings(
          [
            "{name} held ground in a sharp argument with a parent over what's to become of them.",
            "{name} said the thing plainly, once, and would not take it back.",
            "{name} stood in the doorway and argued until the house went quiet.",
          ],
          [
            "{name} se mantuvo firme en una dura discusión con un progenitor sobre su futuro.",
            "{name} dijo lo que pensaba con claridad, una vez, y no lo retiró.",
            "{name} se quedó en el umbral y discutió hasta que la casa quedó en silencio.",
          ],
        ),
        optionDescription: "A parent and I argued sharply over what's to become of me, and I hold my ground.",
      }),
      "back-down-for-peace": outcome({
        emotion: "relief",
        cause: "backing down for the sake of peace, in an argument with a parent over the future",
        intensity: 15,
        duration: 2,
        relationshipTarget: "parent",
        relationshipDelta: 5,
        prose: prosePhrasings(
          [
            "{name} backed down for the sake of peace, in an argument with a parent over the future.",
            "{name} let the last word go and went out to do the evening work.",
            "{name} said nothing more, and the argument died where it stood.",
          ],
          [
            "{name} cedió por mantener la paz, en una discusión con un progenitor sobre el futuro.",
            "{name} dejó pasar la última palabra y salió a hacer el trabajo de la tarde.",
            "{name} no dijo nada más, y la discusión murió donde estaba.",
          ],
        ),
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
export function pickVignette(seed: string, personId: string, year: number, ctx: VignetteContext, recentIds?: ReadonlySet<string>, exhaustedIds?: ReadonlySet<string>): Vignette {
  const base = eligibleVignettePool(ctx, recentIds);
  // Spec S3: a vignette whose phrasings this life has all spent is not offered again. Dropped
  // rather than left to shrink the pool to nothing: if every eligible situation is spent, a year
  // still gets an entry (spec S7).
  const available = exhaustedIds ? base.filter((vignette) => !exhaustedIds.has(vignette.id)) : base;
  const pool = available.length > 0 ? available : base;
  const rng = keyedRng(seed, personId, year, "D1-vignette-pick");
  return pool[Math.floor(rng() * pool.length)]!;
}

/** The vignette that owns a given outcome option id — option ids are unique across the whole pool (see `VIGNETTE_OPTION_DESCRIPTIONS`), so this is unambiguous. Used to resolve a forked/overridden `D1` decision's option back to its vignette without re-deriving eligibility (round 12, decision 046). */
export function getVignetteForOption(optionId: string): Vignette | undefined {
  return VIGNETTES.find((v) => optionId in v.outcomes);
}

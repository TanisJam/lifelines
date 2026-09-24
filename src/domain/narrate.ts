import { mapWithConcurrency } from "./concurrency";
import type { DecisionMaker } from "./decisions";
import { hasMovedAway, illnessIdsSubsumedByDeath } from "./events";
import { DEFAULT_LOCALE, type Locale } from "./locale";
import { DREAM_GOALS, dreamGerund, type DreamGoal, type Memory, type PersonMind, type Thought } from "./mind";
import { keyedDraw, keyedRng } from "./rng";
import { DEATH_CAUSE_PHRASE, type DeathCause } from "./mortality";
import { LANDMARK_POOL, pickLandmarkFor, pickLandmarks, seasonFor, type Landmark } from "./town";
import type { Event, Job, Person } from "./types";
import { getVignette } from "./vignettes";

export type { Locale } from "./locale";

/** Landmarks plausible as a place two people would meet — a subset of the town's full landmark set (round 5, decision 026). */
const MEETING_FRIENDLY: ReadonlySet<Landmark> = new Set(["the fairground", "the market square", "the chapel", "the old well"]);

function meetingPlaceFor(seed: string, townName: string, key: string, year: number): Landmark | undefined {
  const candidates = pickLandmarks(seed, townName, LANDMARK_POOL.length).filter((l) => MEETING_FRIENDLY.has(l));
  if (candidates.length === 0) return undefined;
  const rng = keyedRng(seed, key, year, "meeting-place");
  return candidates[Math.floor(rng() * candidates.length)];
}

/**
 * Decision 059: the single point where a locale picks between an English and a Spanish value.
 * Every other function in this file calls `t()` rather than branching on `locale` itself — "select
 * templates per locale" per the proposal, not conditionals sprinkled through the narration logic.
 */
function t<T>(locale: Locale, en: T, es: T): T {
  return locale === "es" ? es : en;
}

/**
 * Spanish display forms for the small, closed vocabularies narration borrows from sibling domain
 * modules (seasons, landmarks, death causes, dream goals, jobs). Those modules keep their canonical
 * ENGLISH string as the structural identifier — it's equality-checked elsewhere (e.g. vignettes.ts's
 * `ctx.season === "the depths of winter"`, `mortality.ts`'s cause codes, `simulate.ts`'s
 * `dreamGoalSatisfiedBy`) — so translating them at the source would silently break that logic.
 * Translation happens only here, at the display boundary, keyed by the untouched English original.
 */
const SEASON_ES: Readonly<Record<string, string>> = {
  "the depths of winter": "lo más crudo del invierno",
  "the first days of spring": "los primeros días de la primavera",
  "high summer": "pleno verano",
  "the golden days of autumn": "los días dorados del otoño",
};

const LANDMARK_ES: Readonly<Record<string, string>> = {
  "the mill": "el molino",
  "the north bridge": "el puente norte",
  "the chapel": "la capilla",
  "the fairground": "el campo de la feria",
  "the market square": "la plaza del mercado",
  "the old well": "el pozo viejo",
  "the granary": "el granero",
  "the tannery": "la curtiduría",
};

const DEATH_CAUSE_ES: Readonly<Record<DeathCause, string>> = {
  "infant-fever": "una fiebre en la infancia",
  "childhood-accident": "un accidente infantil",
  childbirth: "complicaciones del parto",
  plague: "la peste",
  "great-famine": "la Gran Hambruna",
  "black-death": "la peste negra",
  "second-pestilence": "la segunda peste",
  war: "la guerra con una aldea vecina",
  "feud-violence": "la violencia de una vieja rencilla",
  illness: "una enfermedad persistente",
  "old-age": "la vejez",
  misadventure: "la mala fortuna",
};

const DREAM_GERUND_ES: Readonly<Record<DreamGoal, string>> = {
  "start a family": "formar una familia",
  "master a craft": "dominar un oficio",
  "leave for the city": "partir hacia la ciudad",
  "found something lasting": "fundar algo perdurable",
};

const TOWN_EVENT_NOUN_ES: Readonly<Record<string, string>> = {
  plague: "la peste",
  famine: "la hambruna",
  fire: "el incendio",
  festival: "la fiesta",
  conflict: "el conflicto",
  harvest: "la buena cosecha",
  stranger: "la llegada de un forastero",
  "black-death": "la peste negra",
  "second-pestilence": "la segunda peste",
  "hundred-years-war-begins": "la guerra con Francia",
  "ordinance-of-labourers": "la Ordenanza de los Trabajadores",
  "statute-of-labourers": "el Estatuto de los Trabajadores",
};

/** Masculine/feminine noun for each `Job` (plus the `"worker"` fallback `titleFor`/`lifeSummary` use when no job is set), for Spanish sentences that need grammatical agreement with the person's sex — English `article()`/`withArticle()` below need no such split. */
const JOB_ES: Readonly<Record<Job | "worker", { readonly m: string; readonly f: string }>> = {
  labourer: { m: "jornalero", f: "jornalera" },
  shepherd: { m: "pastor", f: "pastora" },
  farmer: { m: "labrador", f: "labradora" },
  blacksmith: { m: "herrero", f: "herrera" },
  carpenter: { m: "carpintero", f: "carpintera" },
  weaver: { m: "tejedor", f: "tejedora" },
  miller: { m: "molinero", f: "molinera" },
  baker: { m: "panadero", f: "panadera" },
  tanner: { m: "curtidor", f: "curtidora" },
  healer: { m: "curandero", f: "curandera" },
  merchant: { m: "mercader", f: "mercadera" },
  innkeeper: { m: "posadero", f: "posadera" },
  priest: { m: "sacerdote", f: "sacerdote" },
  landholder: { m: "terrateniente", f: "terrateniente" },
  none: { m: "sin oficio", f: "sin oficio" },
  worker: { m: "trabajador", f: "trabajadora" },
};

function seasonDisplay(locale: Locale, season: string): string {
  return locale === "es" ? (SEASON_ES[season] ?? season) : season;
}

function landmarkDisplay(locale: Locale, landmark: string): string {
  return locale === "es" ? (LANDMARK_ES[landmark] ?? landmark) : landmark;
}

/** Exported so `causeOfDeath` fields built outside narration proper (the "Your lives" list, `ProtagonistInfo`) can share the same Spanish cause vocabulary as the chronicle itself, instead of duplicating `DEATH_CAUSE_ES`. */
export function deathCauseDisplay(locale: Locale, cause: DeathCause): string {
  return locale === "es" ? DEATH_CAUSE_ES[cause] : DEATH_CAUSE_PHRASE[cause];
}

function dreamGoalDisplay(locale: Locale, goal: DreamGoal): string {
  return locale === "es" ? DREAM_GERUND_ES[goal] : dreamGerund(goal);
}

function townEventNounEs(eventType: string): string {
  return TOWN_EVENT_NOUN_ES[eventType] ?? `lo ocurrido (${eventType})`;
}

/** "un/una {noun}", gender-agreed with `sex` when known (defaulting masculine, standard for an unknown/generic referent in Spanish) — the ES counterpart of `withArticle()` below. */
function withArticleEs(job: string, sex: Person["sex"] | undefined): string {
  const entry = JOB_ES[job as Job | "worker"] ?? JOB_ES.worker;
  const noun = sex === "f" ? entry.f : entry.m;
  const article = noun.endsWith("a") && sex === "f" ? "una" : "un";
  return `${article} ${noun}`;
}

/**
 * Prose is rendered FROM events by templates — never generated by an LLM
 * and never stored. This is the only place strings get assembled for
 * display; everything else in the domain deals with structured events.
 *
 * Each kind has 2-3 phrasings, picked by a keyed RNG draw (namespaced
 * `narrate:<kind>` so it never collides with a simulation decision's RNG
 * key) so the choice is deterministic and stable across renders, but the
 * chronicle doesn't repeat the exact same sentence shape for every
 * marriage in town.
 *
 * Decision 059: every render function here takes an optional trailing `locale` (default `"en"`),
 * and every one of its cases is picked via `t()`/the small `*_ES` lookup tables above — the domain
 * stays a pure function of `(event, people, ..., locale)`, nothing about narration is stored
 * per-locale, exactly like nothing about it was ever stored as prose at all (decision 001).
 */
function name(people: Readonly<Record<string, Person>>, id: string | undefined, locale: Locale = DEFAULT_LOCALE): string {
  if (!id) return t(locale, "someone", "alguien");
  return people[id]?.name ?? id;
}

function pick<T>(seed: string, event: Event, variants: readonly T[]): T {
  if (variants.length === 1) return variants[0]!;
  const key = event.actors.join("-") || event.id;
  const draw = keyedDraw(seed, key, event.year, `narrate:${event.kind}`);
  return variants[Math.floor(draw * variants.length)]!;
}

export function narrateEvent(
  event: Event,
  people: Readonly<Record<string, Person>>,
  seed = "narrate",
  townName = "town",
  allEvents: readonly Event[] = [],
  locale: Locale = DEFAULT_LOCALE,
): string {
  const [a, b] = event.actors;
  const A = name(people, a, locale);
  const B = name(people, b, locale);
  const actorSex = a ? people[a]?.sex : undefined;

  switch (event.kind) {
    case "birth": {
      // Concrete world texture (round 5 pivot, decision 026): a season is purely atmospheric
      // (a deterministic keyed pick, never claimed as having caused anything). A same-year
      // hardship town event is different — it's a REAL simulated event (`allEvents`, passed in
      // by the caller), so referencing it is a real causal coincidence, not invented color —
      // matching the handoff's "born during the winter storm that destroys the northern bridge".
      const season = seasonFor(seed, event.actors.join("-") || event.id, event.year, "birth");
      const sameYearTown = allEvents.find((e) => e.kind === "town" && e.year === event.year && typeof e.payload.eventType === "string");
      if (sameYearTown) {
        const eventType = String(sameYearTown.payload.eventType);
        const landmarks = pickLandmarks(seed, townName);
        const landmark = eventType === "fire" ? pickLandmarkFor(seed, "world", event.year, landmarks) : undefined;
        const hardshipPhrase = t(
          locale,
          landmark ? `the ${eventType} that damaged ${landmark}` : `the ${eventType} that struck ${townName} that year`,
          landmark ? `${townEventNounEs(eventType)} que dañó ${landmarkDisplay(locale, landmark)}` : `${townEventNounEs(eventType)}, que azotó ${townName} ese año`,
        );
        return t(
          locale,
          `${A} was born to ${B} and ${name(people, event.actors[2])}, during ${hardshipPhrase}.`,
          `${A} nació de ${B} y ${name(people, event.actors[2], locale)}, durante ${hardshipPhrase}.`,
        );
      }
      return pick(
        seed,
        event,
        t(
          locale,
          [
            `${A} was born to ${B} and ${name(people, event.actors[2])}, during ${season} of ${event.year}.`,
            `${B} and ${name(people, event.actors[2])} welcomed a child, ${A}, in ${season}.`,
          ],
          [
            `${A} nació de ${B} y ${name(people, event.actors[2], locale)}, durante ${seasonDisplay(locale, season)} de ${event.year}.`,
            `${B} y ${name(people, event.actors[2], locale)} recibieron con alegría a ${A}, en ${seasonDisplay(locale, season)}.`,
          ],
        ),
      );
    }
    case "school": {
      // Decision 057: this event now only fires for the (class/sex-determined) literate few, so the
      // phrasing distinguishes the gentry/merchant grammar-school route from everyone else's parish
      // instruction, per research.md's "Literacy by class and sex" and Economy §"Occupations..." —
      // clergy sons went the same grammar/song-school route as gentry/merchant sons.
      const socialClass = String(event.payload.socialClass ?? "cottar");
      if (socialClass === "gentry" || socialClass === "merchant" || socialClass === "clergy") {
        return t(
          locale,
          `${A} was sent to grammar school to learn ${socialClass === "clergy" ? "letters and the psalter" : "letters"}.`,
          `${A} fue enviad${actorSex === "f" ? "a" : "o"} a la escuela de gramática para aprender ${socialClass === "clergy" ? "las letras y el salterio" : "las letras"}.`,
        );
      }
      return t(locale, `${A} was taught letters by the parish priest.`, `${A} aprendió las letras de manos del párroco.`);
    }
    case "job": {
      if (event.payload.forced)
        return t(locale, `${A} took up work as ${withArticle(String(event.payload.job))}.`, `${A} se puso a trabajar como ${withArticleEs(String(event.payload.job), actorSex)}.`);
      // Round 6 fix (decision 028, "let the prose explain" career changes): a real career CHANGE
      // (not the person's first job) names the years they spent at the old trade, using the
      // previous `job` event on the SAME person's own log — real tenure, not an invented number.
      const priorJob = allEvents
        .filter((e) => e.kind === "job" && e.actors[0] === a && e.year < event.year)
        .sort((x, y) => y.year - x.year)[0];
      if (priorJob) {
        const years = event.year - priorJob.year;
        return t(
          locale,
          `After ${years} year${years === 1 ? "" : "s"} as ${withArticle(String(priorJob.payload.job))}, ${A} became ${withArticle(String(event.payload.job))}.`,
          `Tras ${years} año${years === 1 ? "" : "s"} como ${withArticleEs(String(priorJob.payload.job), actorSex)}, ${A} se convirtió en ${withArticleEs(String(event.payload.job), actorSex)}.`,
        );
      }
      return pick(
        seed,
        event,
        t(
          locale,
          [`${A} became ${withArticle(String(event.payload.job))}.`, `${A} took up the trade of ${String(event.payload.job)}.`],
          [`${A} se convirtió en ${withArticleEs(String(event.payload.job), actorSex)}.`, `${A} tomó el oficio de ${withArticleEs(String(event.payload.job), actorSex)}.`],
        ),
      );
    }
    case "move":
      if (event.payload.arrived)
        return pick(
          seed,
          event,
          t(locale, [`${A} arrived in town and settled in.`, `${A} came to town looking for a new start.`], [`${A} llegó al pueblo y se estableció.`, `${A} llegó al pueblo en busca de un nuevo comienzo.`]),
        );
      if (event.payload.returned) {
        const home = String(event.payload.destination ?? townName);
        return pick(
          seed,
          event,
          t(locale, [`${A} came home to ${home}.`, `${A} returned to ${home}.`], [`${A} volvió a ${home}.`, `${A} regresó a su hogar en ${home}.`]),
        );
      }
      if (event.payload.forced) return t(locale, `${A} left for ${String(event.payload.destination ?? "parts unknown")}.`, `${A} partió hacia ${String(event.payload.destination ?? "tierras desconocidas")}.`);
      return pick(
        seed,
        event,
        t(
          locale,
          [`${A} moved away to ${String(event.payload.destination ?? "parts unknown")}.`, `${A} packed up and left for ${String(event.payload.destination ?? "parts unknown")}.`],
          [`${A} se mudó a ${String(event.payload.destination ?? "tierras desconocidas")}.`, `${A} recogió sus cosas y partió hacia ${String(event.payload.destination ?? "tierras desconocidas")}.`],
        ),
      );
    case "romance": {
      const key = event.actors.join("-") || event.id;
      const season = seasonFor(seed, key, event.year, "romance");
      const place = meetingPlaceFor(seed, townName, key, event.year);
      const placePhrase = place ? t(locale, ` at ${place}`, ` en ${landmarkDisplay(locale, place)}`) : "";
      return pick(
        seed,
        event,
        t(
          locale,
          [`${A} met ${B}${placePhrase} during ${season}, and they began courting.`, `${A} and ${B} started courting, having met${placePhrase} in ${season}.`],
          [
            `${A} conoció a ${B}${placePhrase} durante ${seasonDisplay(locale, season)}, y comenzaron a cortejarse.`,
            `${A} y ${B} comenzaron a cortejarse, tras conocerse${placePhrase} en ${seasonDisplay(locale, season)}.`,
          ],
        ),
      );
    }
    case "marriage":
      if (event.payload.forced) return t(locale, `${A} and ${B} were married.`, `${A} y ${B} se casaron.`);
      return pick(seed, event, t(locale, [`${A} married ${B}.`, `${A} and ${B} were wed.`], [`${A} se casó con ${B}.`, `${A} y ${B} contrajeron matrimonio.`]));
    case "breakup":
      if (event.payload.blocked) return t(locale, `${A} and ${B} never got the chance to marry, and drifted apart.`, `${A} y ${B} nunca llegaron a casarse, y sus caminos se separaron.`);
      return pick(seed, event, t(locale, [`${A} and ${B} broke up.`, `${A} and ${B}'s courtship ended.`], [`${A} y ${B} rompieron.`, `El cortejo entre ${A} y ${B} llegó a su fin.`]));
    case "feud":
      // `escalated` (set by the A6 "sabotage" outcome, simulate.ts) means this is NOT the feud's
      // opening move but another round of an already-ongoing one — must read differently, or a
      // years-long feud reads as "began a bitter feud" over and over (round 4 fix, decision 021).
      if (event.payload.escalated)
        return pick(
          seed,
          event,
          t(locale, [`${A} struck back at ${B}, and the feud deepened.`, `${A} escalated the feud with ${B} further.`], [`${A} tomó represalias contra ${B}, y la rencilla se agravó.`, `${A} avivó aún más la rencilla con ${B}.`]),
        );
      return pick(seed, event, t(locale, [`${A} and ${B} began a bitter feud.`, `A bitter feud broke out between ${A} and ${B}.`], [`${A} y ${B} comenzaron una amarga rencilla.`, `Estalló una amarga rencilla entre ${A} y ${B}.`]));
    case "reconciliation":
      return pick(seed, event, t(locale, [`${A} and ${B} reconciled.`, `${A} and ${B} made peace at last.`], [`${A} y ${B} se reconciliaron.`, `${A} y ${B} hicieron las paces al fin.`]));
    case "illness":
      if (event.payload.recovered) return pick(seed, event, t(locale, [`${A} fell ill, but recovered.`, `${A} took ill for a time, then recovered.`], [`${A} enfermó, pero se recuperó.`, `${A} estuvo enferm${actorSex === "f" ? "a" : "o"} un tiempo, y luego se recuperó.`]));
      return t(locale, `${A} fell ill.`, `${A} enfermó.`);
    case "death": {
      const causeCode = typeof event.payload.cause === "string" ? event.payload.cause : undefined;
      const causePhrase = causeCode && causeCode in DEATH_CAUSE_PHRASE ? deathCauseDisplay(locale, causeCode as DeathCause) : undefined;
      if (event.payload.awayFromTown)
        return t(locale, `Word reached town that ${A} had died elsewhere, at age ${String(event.payload.age)}.`, `Llegó al pueblo la noticia de que ${A} había muerto en tierras lejanas, a los ${String(event.payload.age)} años.`);
      if (causePhrase)
        return pick(
          seed,
          event,
          t(
            locale,
            [`${A} died of ${causePhrase} at age ${String(event.payload.age)}.`, `${A} was taken by ${causePhrase}, at age ${String(event.payload.age)}.`],
            [`${A} murió de ${causePhrase} a los ${String(event.payload.age)} años.`, `${A} fue llevad${actorSex === "f" ? "a" : "o"} por ${causePhrase}, a los ${String(event.payload.age)} años.`],
          ),
        );
      return pick(
        seed,
        event,
        t(locale, [`${A} died at age ${String(event.payload.age)}.`, `${A} passed away at age ${String(event.payload.age)}.`], [`${A} murió a los ${String(event.payload.age)} años.`, `${A} falleció a los ${String(event.payload.age)} años.`]),
      );
    }
    case "widowed": {
      // Decision 054: `A` is the survivor, `B` the spouse who just died (see `simulate.ts`'s death
      // resolution). `keptTrade` (artisan widow's workshop right, research.md's guild rule 9) gets
      // its own line rather than being silently folded into the job event that also fires the same
      // year, so the causal "why does she suddenly have his trade" reads clearly.
      const keptTrade = event.payload.keptTrade === true;
      const survivor = a ? people[a] : undefined;
      const noun = t(locale, survivor?.sex === "m" ? "widower" : "widow", survivor?.sex === "m" ? "viudo" : "viuda");
      const base = pick(
        seed,
        event,
        t(locale, [`${A} was widowed by ${B}'s death.`, `${A} was left a ${noun} when ${B} died.`], [`${A} enviudó con la muerte de ${B}.`, `${A} quedó ${noun} cuando ${B} murió.`]),
      );
      return keptTrade ? `${base} ${t(locale, `${A} kept the workshop going alone.`, `${A} mantuvo el taller en marcha en solitario.`)}` : base;
    }
    case "child":
      return t(locale, `${A} and ${B} decided to have a child.`, `${A} y ${B} decidieron tener un hijo.`);
    case "breakdown": {
      const breakdownKind = String(event.payload.kind ?? t(locale, "a breaking point", "un punto de quiebre"));
      const response = event.payload.response;
      if (response === "master-it") return t(locale, `${A} was pushed to the brink (${breakdownKind}), and mastered it.`, `${A} fue llevad${actorSex === "f" ? "a" : "o"} al límite (${breakdownKind}), y lo superó.`);
      return t(locale, `${A} broke down under the weight of it all (${breakdownKind}).`, `${A} se derrumbó bajo el peso de todo ello (${breakdownKind}).`);
    }
    case "dream": {
      // Round 5 grammar fix (decision 023): `event.payload.goal` is the raw, imperative-ish
      // DreamGoal string ("leave for the city"), kept raw because it's also read back
      // programmatically (`dreamGoalSatisfiedBy` in simulate.ts); only rendering goes through
      // `dreamGerund` to avoid "dreamed of leave for the city".
      const rawGoal = event.payload.goal;
      const isKnownGoal = typeof rawGoal === "string" && (DREAM_GOALS as readonly string[]).includes(rawGoal);
      const goal = isKnownGoal ? dreamGoalDisplay(locale, rawGoal as DreamGoal) : t(locale, String(rawGoal ?? "their dream"), String(rawGoal ?? "su sueño"));
      // Round 7 fix (decision 030): a real pronoun ("her sights"/"his sights"), not singular
      // "their" — sex is always known for a real person. Falls back to "their" only if the actor
      // somehow isn't resolvable (never happens for a real "dream" event, defensive only).
      const dreamer = a ? people[a] : undefined;
      const pronoun = t(locale, dreamer ? possessiveLower(dreamer.sex) : "their", dreamer ? (dreamer.sex === "f" ? "su" : "su") : "su");
      if (event.payload.outcome === "realized") return t(locale, `${A} dreamed of ${goal}, and this dream was realized in ${event.year}.`, `${A} soñaba con ${goal}, y ese sueño se cumplió en ${event.year}.`);
      if (event.payload.outcome === "abandoned") return t(locale, `${A} let go of ${pronoun} dream of ${goal}.`, `${A} dejó ir ${pronoun} sueño de ${goal}.`);
      // Round 7 fix (decision 030, "dream churn is noise"): a dream change now always names WHY
      // (`payload.cause`, set by simulate.ts's A8 "adjust-it" branch — `adjust-it` is only ever
      // offered when there's a real cause, see decision 030) instead of just announcing a new one.
      const cause = typeof event.payload.cause === "string" ? event.payload.cause : undefined;
      if (cause) return t(locale, `After ${cause}, ${A} began to dream of ${goal}.`, `Tras ${cause}, ${A} comenzó a soñar con ${goal}.`);
      return t(locale, `${A} set ${pronoun} sights on a new dream: ${goal}.`, `${A} puso la mira en un nuevo sueño: ${goal}.`);
    }
    case "town": {
      const eventType = String(event.payload.eventType ?? "something");
      const base = t(locale, TOWN_EVENT_NARRATION[eventType] ?? `Something happened in ${townName}: ${eventType}.`, TOWN_EVENT_NARRATION_ES[eventType] ?? `Algo ocurrió en ${townName}: ${eventType}.`);
      if (eventType === "fire") {
        const landmark = pickLandmarkFor(seed, "world", event.year, pickLandmarks(seed, townName));
        return t(locale, `A fire tore through ${landmark}.`, `Un incendio arrasó ${landmarkDisplay(locale, landmark)}.`);
      }
      return base;
    }
    case "reflection": {
      // A generic kind (round 7, decision 030) for internal, non-relational moments that would
      // otherwise be invisible in the chronicle (it reads the EVENT log, not the decision log) —
      // C2's grief, O2's grudge resolution when the rival is already dead or never forgiven, O4's
      // reckoning with mortality, C3's early calling. `note` picks which; `otherName`, when
      // present, is the other party the reflection concerns.
      const note = String(event.payload.note ?? "");
      const other = typeof event.payload.otherName === "string" ? event.payload.otherName : t(locale, "them", "ellos");
      const table = locale === "es" ? REFLECTION_NARRATION_ES : REFLECTION_NARRATION;
      const base = table[note]?.(A, other) ?? t(locale, `${A} sat with their thoughts.`, `${A} se quedó a solas con sus pensamientos.`);
      // Decision 040: a parent's death reaching the away protagonist reads as news from home, not
      // something witnessed firsthand — same grieve/harden/lean-on-family sentence, framed first.
      if (event.payload.awayNews === true) {
        const relative = typeof event.payload.relative === "string" ? event.payload.relative : t(locale, "parent", "el padre o la madre");
        const subjectSex = a ? people[a]?.sex : undefined;
        const pronoun = t(locale, subjectSex ? possessiveLower(subjectSex) : "their", "su");
        return t(locale, `Word came from ${townName} that ${pronoun} ${relative} had died. ${base}`, `Llegó noticia de ${townName} de que había muerto ${pronoun} ${relative}. ${base}`);
      }
      return base;
    }
    case "levy":
      return pick(
        seed,
        event,
        t(
          locale,
          [`The lord levied heavily against ${townName}, and ${A} felt it.`, `The lord's collectors came through ${townName} that year, and ${A} paid the price.`],
          [`El señor impuso un duro tributo sobre ${townName}, y ${A} lo sintió.`, `Los recaudadores del señor pasaron por ${townName} ese año, y ${A} pagó el precio.`],
        ),
      );
    case "vignette": {
      // "At least one entry per year" (round 10, decision 042): a generic D1 decision, with the
      // actual title/prose looked up from the vignette pool (`vignettes.ts`) by `payload.vignette` +
      // `payload.outcome` — never free text stored on the event itself (decision 001).
      const vignette = getVignette(String(event.payload.vignette ?? ""));
      const outcome = vignette?.outcomes[String(event.payload.outcome ?? "")];
      return outcome ? outcome.prose(locale, A, townName) : t(locale, `${A} lived through an ordinary year.`, `${A} vivió un año como cualquier otro.`);
    }
    case "manorial-fine": {
      // Engine life course PR5's manorial dues — restrained, non-graphic copy (design's own
      // leyrwite wording, extended in the same register to the other three fines). The lord is
      // named only as `payee`, never rendered as a person (design decision 10: stays off-stage).
      const fine = String(event.payload.fine ?? "");
      if (fine === "merchet") return t(locale, `${A} paid merchet to marry, and the fine went to the lord.`, `${A} pagó el merchet para casarse, y la multa fue para el señor.`);
      if (fine === "heriot") return t(locale, `On ${A}'s death, the lord took the best beast as heriot.`, `A la muerte de ${A}, el señor se quedó con la mejor bestia como heriot.`);
      if (fine === "chevage") return t(locale, `${A} paid chevage for leave to live away from the manor.`, `${A} pagó el chevage por la licencia de vivir fuera del señorío.`);
      if (fine === "leyrwite") return t(locale, `The manor court fined ${A} for leyrwite, and the fine went to the lord.`, `El tribunal señorial multó a ${A} por leyrwite, y la multa fue para el señor.`);
      return t(locale, `${A} paid a fine to the lord.`, `${A} pagó una multa al señor.`);
    }
    case "period-marker": {
      // Engine life course PR5's pre-window backstory facts — restrained, narrative-only; never a
      // mortality effect by themselves (see `period/events.ts`'s own doc comments).
      const marker = String(event.payload.marker ?? "");
      if (marker === "great-famine") return t(locale, `${A} had lived through the Great Famine as a child.`, `${A} había vivido la Gran Hambruna siendo niñ${actorSex === "f" ? "a" : "o"}.`);
      if (marker === "cattle-murrain") return t(locale, `${A}'s household lost cattle to the murrain of 1319-21.`, `El hogar de ${A} perdió ganado por la peste bovina de 1319-21.`);
      return t(locale, `${A} carried a memory from before.`, `${A} guardaba un recuerdo de antes.`);
    }
    default:
      return `${A}: ${event.kind}.`;
  }
}

/** One prose line per `reflection` note (round 7, decision 030) — a small, closed vocabulary rather than open-ended text, so this stays template-based (decision 001) even though the note itself is a free-ish string tag. */
const REFLECTION_NARRATION: Record<string, (name: string, other: string) => string> = {
  "grieved-openly": (name) => `${name} grieved openly, letting people see it.`,
  hardened: (name) => `${name} hardened themselves and carried on.`,
  "leaned-on-family": (name) => `${name} leaned on what family remained.`,
  "let-go-of-grudge": (name, other) => `${name} finally let go of the old grudge against ${other}, if only within themselves.`,
  "kept-the-grudge": (name, other) => `${name} resolved to take the grudge against ${other} to the grave.`,
  "peace-with-death": (name) => `${name} made peace with the years that were left.`,
  regret: (name) => `${name} dwelled on regrets, with time running short.`,
  "last-wish": (name) => `${name} spoke of one last wish.`,
  "followed-the-family-trade": (name) => `${name} resolved to follow in the family's footsteps.`,
  "sought-an-apprenticeship-elsewhere": (name) => `${name} set out to seek an apprenticeship of their own, away from home.`,
  drifted: (name) => `${name} drifted, not yet sure what to make of themselves.`,
  "competed-with-sibling": (name, other) => `${name} competed with ${other} for attention.`,
  "bonded-with-sibling": (name, other) => `${name} bonded with ${other} instead of competing.`,
  "withdrew-from-sibling": (name) => `${name} withdrew rather than compete for attention at home.`,
  "fought-back-against-bully": (name, other) => `${name} fought back against ${other}.`,
  "endured-the-bully": (name) => `${name} endured the bullying quietly.`,
  "told-an-elder": (name) => `${name} told an elder about the bullying.`,
  "pursued-the-dream-over-trade": (name) => `${name} chose to pursue the dream, whatever it cost the trade.`,
  "stayed-practical": (name) => `${name} set the dream aside and stayed practical.`,
  "opened-up-to-a-friend": (name, other) => `${name} opened up to ${other}, and a real friendship took root.`,
  "kept-their-distance": (name) => `${name} kept a careful distance, and the friendship never quite formed.`,
  "confronted-the-betrayal": (name, other) => `${name} confronted ${other} over the betrayal.`,
  "forgave-the-betrayal": (name, other) => `${name} forgave ${other}, though it was not easily done.`,
  "left-over-the-betrayal": (name, other) => `${name} left ${other} over the betrayal.`,
  "sought-revenge-for-the-betrayal": (name, other) => `${name} sought revenge against ${other}.`,
  "doubled-down-on-faith": (name) => `${name} doubled down on their faith.`,
  "lost-their-faith": (name) => `${name} lost their faith.`,
  "sought-another-path": (name) => `${name} set aside their faith and sought another path.`,
  "resisted-temptation": (name) => `${name} resisted the temptation.`,
  "pursued-an-affair": (name) => `${name} gave in to the temptation.`,
  "took-an-apprentice": (name, other) => `${name} took ${other} on as an apprentice.`,
  "declined-to-mentor": (name) => `${name} declined to take on an apprentice.`,
  "divided-inheritance-eldest": (name) => `${name} left everything to the eldest.`,
  "divided-inheritance-favorite": (name) => `${name} left everything to a favorite.`,
  "split-inheritance": (name) => `${name} split the inheritance evenly.`,
  "inheritance-to-town": (name) => `${name} left the inheritance to the town itself.`,
  "last-attempt-at-dream": (name) => `${name} made one last attempt at the old dream.`,
  "passed-on-dream": (name) => `${name} passed the old dream on to someone else.`,
  "made-peace-with-unrealized-dream": (name) => `${name} made peace with a dream that never came true.`,
  "apprenticed-to-family-trade": (name, other) => `${name} apprenticed ${other} to the family trade.`,
  "sent-away-to-apprentice": (name, other) => `${name} sent ${other} elsewhere to apprentice.`,
  "kept-at-home": (name, other) => `${name} kept ${other} at home a while longer.`,
  "went-on-pilgrimage": (name) => `${name} set out on a pilgrimage.`,
  "stayed-home-from-pilgrimage": (name) => `${name} felt the pull of a pilgrimage, and stayed home all the same.`,
  // Decision 047: the protagonist's "nothing happens" options (declining, waiting, staying) are
  // real story beats now, not silence — reuses this same reflection/note vocabulary rather than a
  // new event kind, since it's exactly the pattern decision 030 established for this purpose.
  "declined-a-suitor": (name, other) => `${name} declined ${other}'s interest.`,
  "stayed-unsure-about-a-suitor": (name, other) => `${name} stayed unsure about ${other}.`,
  "put-off-a-marriage-decision": (name, other) => `${name} put off the decision about marrying ${other}.`,
  "passed-an-opportunity-to-a-friend": (name) => `${name} passed the opportunity to a friend.`,
  "ignored-an-opportunity": (name) => `${name} let the opportunity pass unclaimed.`,
  "kept-chasing-a-dream": (name) => `${name} pushed on toward the dream, still out of reach.`,
  "chose-not-to-have-a-child": (name) => `${name} chose not to have a child that year.`,
  "tried-for-a-child-without-success": (name) => `${name} hoped for a child that year, but it wasn't to be.`,
  "let-go-of-a-slight": (name, other) => `${name} let go of the slight from ${other}.`,
  "silently-resented-someone": (name, other) => `${name} silently resented ${other}.`,
  "let-a-feud-drag-on": (name, other) => `${name} let the feud with ${other} drag on.`,
  "chose-to-stay-home": (name) => `${name} chose to stay, when leaving was on the table.`,
  "helped-during-a-town-event": (name, other) => `${name} pitched in during the ${other}.`,
  "kept-clear-of-a-town-event": (name, other) => `${name} kept clear of the ${other}.`,
  "looked-for-an-advantage-in-a-town-event": (name, other) => `${name} looked for an advantage in the ${other}.`,
};

/** Spanish counterpart of `REFLECTION_NARRATION` above, same keys, same 2-argument `(name, other)` shape. */
const REFLECTION_NARRATION_ES: Record<string, (name: string, other: string) => string> = {
  "grieved-openly": (name) => `${name} lloró abiertamente su pena, sin ocultarla de nadie.`,
  hardened: (name) => `${name} se endureció y siguió adelante.`,
  "leaned-on-family": (name) => `${name} se apoyó en la familia que le quedaba.`,
  "let-go-of-grudge": (name, other) => `${name} por fin dejó ir el viejo rencor hacia ${other}, aunque solo fuera para sus adentros.`,
  "kept-the-grudge": (name, other) => `${name} resolvió llevarse a la tumba el rencor hacia ${other}.`,
  "peace-with-death": (name) => `${name} hizo las paces con los años que le quedaban.`,
  regret: (name) => `${name} se detuvo en sus pesares, con el tiempo cada vez más corto.`,
  "last-wish": (name) => `${name} habló de un último deseo.`,
  "followed-the-family-trade": (name) => `${name} resolvió seguir los pasos de la familia.`,
  "sought-an-apprenticeship-elsewhere": (name) => `${name} partió a buscar un aprendizaje propio, lejos de casa.`,
  drifted: (name) => `${name} anduvo a la deriva, sin saber aún qué hacer de su vida.`,
  "competed-with-sibling": (name, other) => `${name} compitió con ${other} por la atención de la familia.`,
  "bonded-with-sibling": (name, other) => `${name} se unió a ${other} en vez de competir.`,
  "withdrew-from-sibling": (name) => `${name} se retrajo en lugar de competir por la atención en casa.`,
  "fought-back-against-bully": (name, other) => `${name} se defendió de ${other}.`,
  "endured-the-bully": (name) => `${name} soportó el acoso en silencio.`,
  "told-an-elder": (name) => `${name} contó el acoso a un mayor.`,
  "pursued-the-dream-over-trade": (name) => `${name} eligió perseguir el sueño, costara lo que costara al oficio.`,
  "stayed-practical": (name) => `${name} dejó el sueño de lado y se mantuvo práctic${name.endsWith("a") ? "a" : "o"}.`,
  "opened-up-to-a-friend": (name, other) => `${name} se sinceró con ${other}, y nació una amistad verdadera.`,
  "kept-their-distance": (name) => `${name} guardó las distancias, y la amistad nunca llegó a formarse.`,
  "confronted-the-betrayal": (name, other) => `${name} encaró a ${other} por la traición.`,
  "forgave-the-betrayal": (name, other) => `${name} perdonó a ${other}, aunque no fue fácil.`,
  "left-over-the-betrayal": (name, other) => `${name} dejó a ${other} a causa de la traición.`,
  "sought-revenge-for-the-betrayal": (name, other) => `${name} buscó vengarse de ${other}.`,
  "doubled-down-on-faith": (name) => `${name} redobló su fe.`,
  "lost-their-faith": (name) => `${name} perdió la fe.`,
  "sought-another-path": (name) => `${name} dejó de lado su fe y buscó otro camino.`,
  "resisted-temptation": (name) => `${name} resistió la tentación.`,
  "pursued-an-affair": (name) => `${name} cedió a la tentación.`,
  "took-an-apprentice": (name, other) => `${name} tomó a ${other} como aprendiz.`,
  "declined-to-mentor": (name) => `${name} declinó tomar un aprendiz.`,
  "divided-inheritance-eldest": (name) => `${name} lo dejó todo al primogénito.`,
  "divided-inheritance-favorite": (name) => `${name} lo dejó todo a su favorit${name.endsWith("a") ? "a" : "o"}.`,
  "split-inheritance": (name) => `${name} repartió la herencia por igual.`,
  "inheritance-to-town": (name) => `${name} dejó la herencia al propio pueblo.`,
  "last-attempt-at-dream": (name) => `${name} hizo un último intento por el viejo sueño.`,
  "passed-on-dream": (name) => `${name} traspasó el viejo sueño a otra persona.`,
  "made-peace-with-unrealized-dream": (name) => `${name} hizo las paces con un sueño que nunca se cumplió.`,
  "apprenticed-to-family-trade": (name, other) => `${name} puso a ${other} de aprendiz en el oficio familiar.`,
  "sent-away-to-apprentice": (name, other) => `${name} envió a ${other} a aprender el oficio en otro lugar.`,
  "kept-at-home": (name, other) => `${name} mantuvo a ${other} en casa un tiempo más.`,
  "went-on-pilgrimage": (name) => `${name} partió en peregrinación.`,
  "stayed-home-from-pilgrimage": (name) => `${name} sintió la llamada de una peregrinación, y aun así se quedó en casa.`,
  "declined-a-suitor": (name, other) => `${name} rechazó el interés de ${other}.`,
  "stayed-unsure-about-a-suitor": (name, other) => `${name} siguió sin decidirse respecto a ${other}.`,
  "put-off-a-marriage-decision": (name, other) => `${name} postergó la decisión de casarse con ${other}.`,
  "passed-an-opportunity-to-a-friend": (name) => `${name} cedió la oportunidad a un amigo.`,
  "ignored-an-opportunity": (name) => `${name} dejó pasar la oportunidad sin tomarla.`,
  "kept-chasing-a-dream": (name) => `${name} siguió persiguiendo su sueño, todavía fuera de alcance.`,
  "chose-not-to-have-a-child": (name) => `${name} decidió no tener un hijo ese año.`,
  "tried-for-a-child-without-success": (name) => `${name} esperó un hijo ese año, pero no llegó a ser.`,
  "let-go-of-a-slight": (name, other) => `${name} dejó pasar el desaire de ${other}.`,
  "silently-resented-someone": (name, other) => `${name} guardó en silencio rencor hacia ${other}.`,
  "let-a-feud-drag-on": (name, other) => `${name} dejó que la rencilla con ${other} siguiera arrastrándose.`,
  "chose-to-stay-home": (name) => `${name} eligió quedarse, cuando partir era posible.`,
  "helped-during-a-town-event": (name, other) => `${name} arrimó el hombro durante ${other}.`,
  "kept-clear-of-a-town-event": (name, other) => `${name} se mantuvo al margen de ${other}.`,
  "looked-for-an-advantage-in-a-town-event": (name, other) => `${name} buscó sacar ventaja de ${other}.`,
};

/**
 * Third-person narration for a town-level event (round 5, decision 025) — no actors (the event is
 * town-wide), so it doesn't go through the `A`/`B` name substitution the other cases use. Exported
 * for the en/es key-parity test (`narrate.test.ts`), the same convention `period/classes.ts`'s
 * `CLASS_LABEL_EN/ES` already established.
 */
export const TOWN_EVENT_NARRATION: Record<string, string> = {
  plague: "A plague swept through town.",
  famine: "A famine struck the town.",
  fire: "A fire tore through part of town.",
  festival: "The town held a festival.",
  conflict: "A conflict broke out with a neighboring town.",
  harvest: "A bountiful harvest blessed the town.",
  stranger: "A traveling stranger arrived in town.",
  // Engine life course PR5: the period's own two dated shocks, replacing decision 052's Tudor pair.
  "black-death": "The Black Death swept through, and the village mourned for years afterward.",
  "second-pestilence": "A second pestilence came through, and it fell hardest on the young.",
  // PR5's dated national events (research.md's event list), narrative markers only.
  "hundred-years-war-begins": "War with France began, and the Crown's levies followed.",
  "ordinance-of-labourers": "The King's Ordinance tried to hold wages at what they had been before the plague.",
  "statute-of-labourers": "Parliament's Statute confirmed the Ordinance, and forbade leaving one's own village for better wages.",
};

/** Spanish counterpart of `TOWN_EVENT_NARRATION` above, same keys. */
export const TOWN_EVENT_NARRATION_ES: Record<string, string> = {
  plague: "Una peste asoló el pueblo.",
  famine: "Una hambruna golpeó el pueblo.",
  fire: "Un incendio arrasó parte del pueblo.",
  festival: "El pueblo celebró una fiesta.",
  conflict: "Estalló un conflicto con una aldea vecina.",
  harvest: "Una cosecha abundante bendijo al pueblo.",
  stranger: "Un forastero de paso llegó al pueblo.",
  "black-death": "La peste negra asoló el pueblo, y su duelo se sintió durante años.",
  "second-pestilence": "Una segunda peste recorrió el pueblo, y golpeó con más fuerza a los más jóvenes.",
  "hundred-years-war-begins": "Comenzó la guerra con Francia, y con ella llegaron los tributos de la Corona.",
  "ordinance-of-labourers": "La Ordenanza del rey intentó mantener los salarios al nivel de antes de la peste.",
  "statute-of-labourers": "El Estatuto del Parlamento confirmó la Ordenanza, y prohibió abandonar la propia aldea en busca de mejor salario.",
};

/** Adjective form of an emotion, for DF-style "felt X upon Y" sentences. */
const EMOTION_ADJECTIVE: Record<string, string> = {
  joy: "joyful",
  pride: "proud",
  love: "smitten",
  hope: "hopeful",
  relief: "relieved",
  contentment: "content",
  grief: "grief-stricken",
  anger: "furious",
  bitterness: "bitter",
  fear: "afraid",
  shame: "ashamed",
  loneliness: "lonely",
  despair: "despairing",
  betrayal: "betrayed",
  jealousy: "jealous",
  regret: "regretful",
};

/** Spanish counterpart of `EMOTION_ADJECTIVE` above (masculine form; `innerLifeClause` and `narrateThought` agree it with the subject's sex where needed). */
const EMOTION_ADJECTIVE_ES: Record<string, string> = {
  joy: "alegre",
  pride: "orgulloso",
  love: "prendado",
  hope: "esperanzado",
  relief: "aliviado",
  contentment: "satisfecho",
  grief: "consumido por el dolor",
  anger: "furioso",
  bitterness: "amargado",
  fear: "temeroso",
  shame: "avergonzado",
  loneliness: "solitario",
  despair: "desesperado",
  betrayal: "traicionado",
  jealousy: "celoso",
  regret: "pesaroso",
};

function emotionAdjective(locale: Locale, emotion: string, sex?: Person["sex"]): string {
  if (locale !== "es") return EMOTION_ADJECTIVE[emotion] ?? emotion;
  const adjective = EMOTION_ADJECTIVE_ES[emotion] ?? emotion;
  return sex === "f" && adjective.endsWith("o") ? `${adjective.slice(0, -1)}a` : adjective;
}

/**
 * DF-style thought sentences: "felt bitter upon being passed over for
 * miller." A thought whose cause references an earlier memory (matched by
 * `personId` + emotion) is rendered as a revisit: "…felt bitter
 * remembering…" — the past resurfacing, not a fresh event.
 */
export function narrateThought(name: string, thought: Thought, mind: PersonMind, locale: Locale = DEFAULT_LOCALE): string {
  const adjective = emotionAdjective(locale, thought.emotion);
  const isRevisit = mind.memories.some((m) => m.personId === thought.personId && m.emotion === thought.emotion && m.year < thought.year);
  if (isRevisit) {
    const memory = mind.memories.find((m) => m.personId === thought.personId && m.emotion === thought.emotion)!;
    return t(locale, `${name} felt ${adjective} remembering ${thought.cause}, back in ${memory.year}.`, `${name} se sintió ${adjective} al recordar ${thought.cause}, allá por ${memory.year}.`);
  }
  return t(locale, `${name} felt ${adjective} upon ${thought.cause}.`, `${name} se sintió ${adjective} tras ${thought.cause}.`);
}

/** Memories and grudges surfaced for the biography — core memories first (the ones that actually shaped the person, per decision 007/mind-model.md step 4). */
// Memory `text` is always written with its own year already embedded (e.g. "clashed with X in 1533" —
// see the memory-writing call sites in simulate.ts), so the sentence wrapper here must NOT restate the
// year itself, or it reads as "…from 1533: clashed with X in 1533."
export function narrateMemory(name: string, memory: Memory, locale: Locale = DEFAULT_LOCALE): string {
  if (memory.emotion === "betrayal" || memory.emotion === "bitterness") {
    return memory.personId
      ? t(locale, `${name} has never forgiven them: ${memory.text}`, `${name} nunca los ha perdonado: ${memory.text}`)
      : t(locale, `${name} still carries a grudge: ${memory.text}`, `${name} todavía guarda rencor: ${memory.text}`);
  }
  return t(locale, `${name} still remembers: ${memory.text}`, `${name} todavía lo recuerda: ${memory.text}`);
}

export interface NarratedEvent {
  readonly event: Event;
  readonly prose: string;
  readonly significance: number;
  /** A short (3-8 word), title-cased version for a Living Chronicle-style entry heading (round 5 pivot, decision 026) — see `RenderedEvent`. */
  readonly title: string;
}

/** `{ title, prose }` — exactly the shape docs/design/handoff.md's `LifeEvent` wants: a short heading plus the full sentence, both from ONE specific person's point of view. */
export interface RenderedEvent {
  readonly title: string;
  readonly prose: string;
}

export type FamilyRelation = "husband" | "wife" | "mother" | "father" | "son" | "daughter";

/** How `other` relates to `viewer` — spouse, parent or child — or `undefined` if they're not immediate family. Used so a chronicle reads "Her husband Merric died" rather than just "Merric died" on the surviving spouse's own page. Exported for the person-rail UI (round 6), which needs the same relation labels. */
export function familyRelation(viewer: Person, other: Person): FamilyRelation | undefined {
  if (other.id === viewer.spouseId) return other.sex === "m" ? "husband" : "wife";
  if (other.id === viewer.motherId) return "mother";
  if (other.id === viewer.fatherId) return "father";
  if (viewer.id === other.motherId || viewer.id === other.fatherId) return other.sex === "m" ? "son" : "daughter";
  return undefined;
}

const FAMILY_RELATION_ES: Record<FamilyRelation, string> = {
  husband: "esposo",
  wife: "esposa",
  mother: "madre",
  father: "padre",
  son: "hijo",
  daughter: "hija",
};

function relationDisplay(locale: Locale, relation: FamilyRelation): string {
  return locale === "es" ? FAMILY_RELATION_ES[relation] : relation;
}

/**
 * Decision 054: `spouseId` is now cleared the moment a spouse dies (the widowhood bug fix), so by
 * the time a chronicle is rendered, `familyRelation` above no longer finds "husband"/"wife" for a
 * death that just widowed the viewer — `viewer.spouseId` has already moved on to `undefined` (or a
 * later remarriage). The `widowed` event `simulate.ts` pushes in the SAME year as the death is the
 * durable record of who was married to whom at the moment it ended; this checks that instead, for
 * death narration specifically, without changing `familyRelation`'s general (current-state) meaning
 * for other callers (e.g. the person-rail UI).
 */
function wasSpouseAtDeath(viewerId: string, deceasedId: string, allEvents: readonly Event[]): boolean {
  return allEvents.some((e) => e.kind === "widowed" && e.actors[0] === viewerId && e.actors[1] === deceasedId);
}

function possessive(sex: Person["sex"]): "Her" | "His" {
  return sex === "f" ? "Her" : "His";
}

/** Spanish "su" is invariant across gender (unlike English "her"/"his"). */
const POSSESSIVE_ES = "Su";

function possessiveLower(sex: Person["sex"]): "her" | "his" {
  return sex === "f" ? "her" : "his";
}

function subjectPronoun(sex: Person["sex"]): "she" | "he" {
  return sex === "f" ? "she" : "he";
}

function subjectPronounEs(sex: Person["sex"]): "ella" | "él" {
  return sex === "f" ? "ella" : "él";
}

function objectPronoun(sex: Person["sex"]): "her" | "him" {
  return sex === "f" ? "her" : "him";
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * "a" or "an" for a noun — round 8 fix (decision 033, "Becomes a innkeeper"). A plain
 * vowel-letter check is enough for the app's closed, known vocabulary (job names); it isn't a
 * general English article rule (e.g. "a university"), but nothing in `JOB_POOL` or elsewhere this
 * is used needs that.
 */
export function article(noun: string): "a" | "an" {
  return /^[aeiou]/i.test(noun) ? "an" : "a";
}

/** "a/an {noun}" in one call — the common case at every call site below. */
function withArticle(noun: string): string {
  return `${article(noun)} ${noun}`;
}

/**
 * A short title for one event, from `viewerId`'s point of view — e.g. "Her
 * husband dies" rather than "Marries" for someone else's marriage. Covers
 * the kinds a chronicle actually leans on; anything else falls back to a
 * trimmed version of the third-person prose (round 6's Living Chronicle UI
 * is expected to refine titles further — this proves the `{title, prose}`
 * shape works, not final copy for all fifteen event kinds).
 */
function titleFor(event: Event, viewerId: string, people: Readonly<Record<string, Person>>, townName = "town", allEvents: readonly Event[] = [], locale: Locale = DEFAULT_LOCALE): string {
  const [a, b] = event.actors;
  const viewer = people[viewerId];
  const otherId = a === viewerId ? b : a;
  const other = otherId ? people[otherId] : undefined;
  const relation = viewer && other ? familyRelation(viewer, other) : undefined;

  switch (event.kind) {
    case "birth": {
      if (a === viewerId) return t(locale, "Is born", "Nace");
      const child = a ? people[a] : undefined;
      if (child) return t(locale, `${child.sex === "m" ? "Son" : "Daughter"} ${child.name} is born`, `Nace ${child.sex === "m" ? "el hijo" : "la hija"} ${child.name}`);
      return t(locale, "A child is born", "Nace un hijo");
    }
    case "death": {
      if (a === viewerId) return t(locale, "Dies", "Muere");
      // Decision 054: `spouseId` is already cleared by the time this renders (see
      // `wasSpouseAtDeath`'s own doc comment) — fall back to the `widowed` event record so a
      // surviving spouse's title still reads "Husband X dies", not "A death in town".
      const spousalRelation = !relation && other && a && wasSpouseAtDeath(viewerId, a, allEvents) ? (other.sex === "m" ? "husband" : "wife") : undefined;
      const effectiveRelation = relation ?? spousalRelation;
      if (effectiveRelation && other) return t(locale, `${capitalize(effectiveRelation)} ${other.name} dies`, `Muere ${relationDisplay(locale, effectiveRelation)} ${other.name}`);
      return other ? t(locale, `${other.name} dies`, `Muere ${other.name}`) : t(locale, "A death in town", "Una muerte en el pueblo");
    }
    case "marriage":
      return other ? t(locale, `Marries ${other.name}`, `Se casa con ${other.name}`) : t(locale, "Marries", "Se casa");
    case "romance":
      return other ? t(locale, `Meets ${other.name}`, `Conoce a ${other.name}`) : t(locale, "Meets someone", "Conoce a alguien");
    case "breakup":
      return other ? t(locale, `Courtship with ${other.name} ends`, `Termina el cortejo con ${other.name}`) : t(locale, "A courtship ends", "Termina un cortejo");
    case "feud":
      return event.payload.escalated
        ? t(locale, `Feud with ${other?.name ?? "a rival"} deepens`, `Se agrava la rencilla con ${other?.name ?? "un rival"}`)
        : t(locale, `Feud breaks out with ${other?.name ?? "a rival"}`, `Estalla una rencilla con ${other?.name ?? "un rival"}`);
    case "reconciliation":
      return t(locale, `Makes peace with ${other?.name ?? "a rival"}`, `Hace las paces con ${other?.name ?? "un rival"}`);
    case "job":
      return t(locale, `Becomes ${withArticle(String(event.payload.job ?? "worker"))}`, `Se convierte en ${withArticleEs(String(event.payload.job ?? "worker"), viewer?.sex)}`);
    case "school":
      return t(locale, "Learns letters", "Aprende a leer");
    case "move":
      if (event.payload.arrived) return t(locale, "Arrives in town", "Llega al pueblo");
      if (event.payload.returned) {
        const home = String(event.payload.destination ?? townName);
        return t(locale, `Returns to ${home}`, `Vuelve a ${home}`);
      }
      return t(locale, `Leaves for ${String(event.payload.destination ?? "parts unknown")}`, `Parte hacia ${String(event.payload.destination ?? "tierras desconocidas")}`);
    case "illness":
      return event.payload.recovered ? t(locale, "Recovers from illness", "Se recupera de una enfermedad") : t(locale, "Falls ill", "Enferma");
    case "child":
      return t(locale, "Decides to have a child", "Decide tener un hijo");
    case "breakdown":
      return event.payload.response === "master-it"
        ? t(locale, "Overcomes a breaking point", "Supera un punto de quiebre")
        : t(locale, "Reaches a breaking point", "Llega a un punto de quiebre");
    case "dream":
      return event.payload.outcome === "realized"
        ? t(locale, "A dream realized", "Un sueño cumplido")
        : event.payload.outcome === "abandoned"
          ? t(locale, "Lets go of a dream", "Deja ir un sueño")
          : t(locale, "Sets a new dream", "Se traza un nuevo sueño");
    case "town":
      return t(locale, capitalize(String(event.payload.eventType ?? "something happens").replace(/-/g, " ")), capitalize(TOWN_EVENT_TITLE_ES[String(event.payload.eventType ?? "")] ?? "Algo sucede"));
    case "reflection": {
      const note = String(event.payload.note ?? "a quiet moment");
      return t(locale, capitalize(note.replace(/-/g, " ")), capitalize(REFLECTION_TITLE_ES[note] ?? "Un momento de calma"));
    }
    case "levy":
      return t(locale, "The lord's levy", "El tributo del señor");
    case "vignette": {
      const vignette = getVignette(String(event.payload.vignette ?? ""));
      return vignette ? vignette.title(locale, townName) : t(locale, "An ordinary year", "Un año cualquiera");
    }
    case "widowed":
      return t(locale, "Widowed", "Enviudado");
    case "manorial-fine": {
      const fine = String(event.payload.fine ?? "");
      const titles: Record<string, [string, string]> = {
        merchet: ["Pays merchet", "Paga merchet"],
        heriot: ["Heriot is paid to the lord", "Se paga heriot al señor"],
        chevage: ["Pays chevage", "Paga chevage"],
        leyrwite: ["Fined for leyrwite", "Multa por leyrwite"],
      };
      const [en, es] = titles[fine] ?? ["Pays a manorial fine", "Paga una multa señorial"];
      return t(locale, en, es);
    }
    case "period-marker": {
      const marker = String(event.payload.marker ?? "");
      if (marker === "great-famine") return t(locale, "Survived the Great Famine", "Sobrevivió a la Gran Hambruna");
      if (marker === "cattle-murrain") return t(locale, "Lost cattle to the murrain", "Perdió ganado por la peste bovina");
      return t(locale, "A memory from before", "Un recuerdo de antes");
    }
    default:
      return capitalize(String(event.kind));
  }
}

/** Short Spanish titles for `town` event types (mirrors `TOWN_EVENT_NARRATION_ES`'s keys, terser — a chronicle heading, not a full sentence). */
const TOWN_EVENT_TITLE_ES: Record<string, string> = {
  plague: "peste en el pueblo",
  famine: "hambruna en el pueblo",
  fire: "incendio en el pueblo",
  festival: "fiesta del pueblo",
  conflict: "conflicto con una aldea vecina",
  harvest: "buena cosecha",
  stranger: "llega un forastero",
  "black-death": "peste negra",
  "second-pestilence": "segunda peste",
  "hundred-years-war-begins": "guerra con Francia",
  "ordinance-of-labourers": "Ordenanza de los Trabajadores",
  "statute-of-labourers": "Estatuto de los Trabajadores",
};

/** Short Spanish titles for `reflection` notes (mirrors `REFLECTION_NARRATION_ES`'s keys). */
const REFLECTION_TITLE_ES: Record<string, string> = {
  "grieved-openly": "llora su pena abiertamente",
  hardened: "se endurece",
  "leaned-on-family": "se apoya en la familia",
  "let-go-of-grudge": "deja ir un viejo rencor",
  "kept-the-grudge": "se aferra a un rencor",
  "peace-with-death": "hace las paces con la muerte",
  regret: "se detiene en sus pesares",
  "last-wish": "un último deseo",
  "followed-the-family-trade": "sigue el oficio familiar",
  "sought-an-apprenticeship-elsewhere": "busca aprendizaje lejos de casa",
  drifted: "anda a la deriva",
  "competed-with-sibling": "compite con un hermano",
  "bonded-with-sibling": "se une a un hermano",
  "withdrew-from-sibling": "se retrae ante un hermano",
  "fought-back-against-bully": "se defiende de un abusón",
  "endured-the-bully": "soporta el acoso",
  "told-an-elder": "cuenta el acoso a un mayor",
  "pursued-the-dream-over-trade": "persigue el sueño antes que el oficio",
  "stayed-practical": "se mantiene práctico",
  "opened-up-to-a-friend": "se sincera con un amigo",
  "kept-their-distance": "guarda las distancias",
  "confronted-the-betrayal": "encara una traición",
  "forgave-the-betrayal": "perdona una traición",
  "left-over-the-betrayal": "rompe por una traición",
  "sought-revenge-for-the-betrayal": "busca venganza",
  "doubled-down-on-faith": "redobla su fe",
  "lost-their-faith": "pierde la fe",
  "sought-another-path": "busca otro camino",
  "resisted-temptation": "resiste la tentación",
  "pursued-an-affair": "cede a la tentación",
  "took-an-apprentice": "toma un aprendiz",
  "declined-to-mentor": "declina un aprendiz",
  "divided-inheritance-eldest": "deja todo al primogénito",
  "divided-inheritance-favorite": "deja todo a un favorito",
  "split-inheritance": "reparte la herencia",
  "inheritance-to-town": "deja la herencia al pueblo",
  "last-attempt-at-dream": "un último intento",
  "passed-on-dream": "traspasa un sueño",
  "made-peace-with-unrealized-dream": "hace las paces con un sueño incumplido",
  "apprenticed-to-family-trade": "pone a alguien de aprendiz",
  "sent-away-to-apprentice": "envía a alguien a aprender fuera",
  "kept-at-home": "mantiene a alguien en casa",
  "went-on-pilgrimage": "parte en peregrinación",
  "stayed-home-from-pilgrimage": "se queda en casa",
  "declined-a-suitor": "rechaza un pretendiente",
  "stayed-unsure-about-a-suitor": "sigue sin decidirse",
  "put-off-a-marriage-decision": "posterga una decisión de matrimonio",
  "passed-an-opportunity-to-a-friend": "cede una oportunidad",
  "ignored-an-opportunity": "deja pasar una oportunidad",
  "kept-chasing-a-dream": "sigue tras su sueño",
  "chose-not-to-have-a-child": "decide no tener un hijo",
  "tried-for-a-child-without-success": "espera un hijo sin éxito",
  "let-go-of-a-slight": "deja pasar un desaire",
  "silently-resented-someone": "guarda rencor en silencio",
  "let-a-feud-drag-on": "deja que una rencilla se arrastre",
  "chose-to-stay-home": "elige quedarse",
  "helped-during-a-town-event": "ayuda en el pueblo",
  "kept-clear-of-a-town-event": "se mantiene al margen",
  "looked-for-an-advantage-in-a-town-event": "busca una ventaja",
};

/**
 * `{title, prose}` for one event, told from `viewerId`'s perspective — the
 * data shape docs/design/handoff.md's Living Chronicle needs (round 5
 * pivot, decision 026). Prose is `narrateEvent`'s third-person sentence,
 * EXCEPT for a death where the deceased is immediate family of the viewer:
 * that gets a relation-term rewrite ("Her husband Merric died…; she
 * grieved.") instead of just their name, which is what makes every
 * involved person's own chronicle read as being about THEM, not a
 * name-swapped copy of someone else's.
 */
export function narrateEventForViewer(
  event: Event,
  viewerId: string,
  people: Readonly<Record<string, Person>>,
  seed = "narrate",
  townName = "town",
  allEvents: readonly Event[] = [],
  locale: Locale = DEFAULT_LOCALE,
): RenderedEvent {
  const title = titleFor(event, viewerId, people, townName, allEvents, locale);
  const viewer = people[viewerId];
  const [a] = event.actors;

  if (event.kind === "death" && a !== viewerId && viewer) {
    const deceased = a ? people[a] : undefined;
    // Decision 054: see `wasSpouseAtDeath`'s doc comment — `familyRelation` alone misses a spouse
    // once `spouseId` has been cleared by the death itself.
    const relation = deceased ? (familyRelation(viewer, deceased) ?? (a && wasSpouseAtDeath(viewerId, a, allEvents) ? (deceased.sex === "m" ? "husband" : "wife") : undefined)) : undefined;
    if (deceased && relation) {
      const ageStr = typeof event.payload.age === "number" ? t(locale, `, at age ${event.payload.age}`, `, a los ${event.payload.age} años`) : "";
      const awayNote = event.payload.awayFromTown ? t(locale, " (word reached town from afar)", " (la noticia llegó desde lejos)") : "";
      const prose = pick(
        seed,
        event,
        t(
          locale,
          [
            `${possessive(viewer.sex)} ${relation} ${deceased.name} died in ${event.year}${ageStr}${awayNote}; ${subjectPronoun(viewer.sex)} grieved.`,
            `${possessive(viewer.sex)} ${relation} ${deceased.name} passed away in ${event.year}${ageStr}${awayNote}, and the loss stayed with ${objectPronoun(viewer.sex)} for years.`,
          ],
          [
            `${POSSESSIVE_ES} ${relationDisplay(locale, relation)} ${deceased.name} murió en ${event.year}${ageStr}${awayNote}; ${subjectPronounEs(viewer.sex)} lo lloró.`,
            `${POSSESSIVE_ES} ${relationDisplay(locale, relation)} ${deceased.name} falleció en ${event.year}${ageStr}${awayNote}, y la pérdida le acompañó durante años.`,
          ],
        ),
      );
      return { title, prose };
    }
  }

  const prose = narrateEvent(event, people, seed, townName, allEvents, locale);
  return { title, prose: viewer ? prose + innerLifeClause(event, viewer, locale) : prose };
}

/** Event kinds worth an inner-life clause when a matching memory exists — round 6 fix (decision 028, "Ilva's chronicle is a list of facts"). Left off the quieter kinds (school, job, illness-recovered) so it doesn't read as an emotional reaction to everything. */
const INNER_LIFE_KINDS: ReadonlySet<Event["kind"]> = new Set(["dream", "breakdown", "feud", "reconciliation", "marriage", "breakup", "child", "widowed"]);

/**
 * Weaves the person's own mind into a chronicle entry — "…; she felt proud. This would stay with
 * her for years." — by matching the event's year against a memory `addMemory` already wrote at
 * that exact year (simulate.ts writes one for every major outcome). Deterministic and
 * event-backed: never invents a feeling the mind state doesn't already record.
 */
function innerLifeClause(event: Event, viewer: Person, locale: Locale = DEFAULT_LOCALE): string {
  if (!INNER_LIFE_KINDS.has(event.kind)) return "";
  const memory = viewer.mind.memories.find((m) => m.year === event.year);
  if (!memory) return "";
  const adjective = emotionAdjective(locale, memory.emotion, viewer.sex);
  const durability = memory.core ? t(locale, ` This would stay with ${objectPronoun(viewer.sex)} for years.`, ` Esto le acompañaría durante años.`) : "";
  return t(locale, ` ${capitalize(subjectPronoun(viewer.sex))} felt ${adjective}.${durability}`, ` ${capitalize(subjectPronounEs(viewer.sex))} se sintió ${adjective}.${durability}`);
}

/**
 * A deterministic, template-built one-paragraph ending summary — the
 * handoff's "Mara Ashwell died at sixty in Ravenford, surrounded by her
 * children" line. Built entirely from real fields (job, dream status,
 * whether they ever left town for good, living children, cause of death),
 * never generated text (decision 001).
 */
export function lifeSummary(person: Person, people: Readonly<Record<string, Person>>, events: readonly Event[], townName: string, locale: Locale = DEFAULT_LOCALE): string {
  const name = person.name;
  const pronounPossessive = person.sex === "f" ? "her" : "his";
  const subject = subjectPronoun(person.sex);
  const subjectEs = subjectPronounEs(person.sex);

  if (person.deathYear === undefined) {
    const jobClause = person.job !== "none" ? t(locale, ` ${capitalize(subject)} works as ${withArticle(person.job)}.`, ` ${capitalize(subjectEs)} trabaja como ${withArticleEs(person.job, person.sex)}.`) : "";
    return t(locale, `${name} is still living, in ${townName}.${jobClause}`, `${name} sigue con vida, en ${townName}.${jobClause}`);
  }

  const age = person.deathYear - person.birthYear;
  const awayFromTown = hasMovedAway(events, person.id);
  const placeClause = t(locale, awayFromTown ? "far from home" : `in ${townName}`, awayFromTown ? "lejos de su hogar" : `en ${townName}`);
  const livingChildren = Object.values(people).filter((c) => (c.motherId === person.id || c.fatherId === person.id) && c.deathYear === undefined);
  // "Surrounded by" only makes sense when the children are plausibly WITH her — someone who died
  // away from town almost certainly didn't have her Ashford-based children at her side (round 5
  // fix: the screenshot review caught "died... surrounded by her children far from home", which
  // doesn't logically follow — "survived by" makes the same factual claim without implying presence).
  const survivedClause = t(
    locale,
    livingChildren.length > 0 ? `, ${awayFromTown ? "survived by" : "surrounded by"} ${pronounPossessive} ${livingChildren.length === 1 ? "child" : "children"}` : "",
    livingChildren.length > 0 ? `, ${awayFromTown ? "le sobrevivió" : "rodead" + (person.sex === "f" ? "a" : "o") + " por"} ${livingChildren.length === 1 ? "su hijo" : "sus hijos"}` : "",
  );
  const jobClause = t(
    locale,
    person.job !== "none" ? ` ${capitalize(subject)} spent much of ${pronounPossessive} life as ${withArticle(person.job)}.` : "",
    person.job !== "none" ? ` ${capitalize(subjectEs)} pasó buena parte de su vida como ${withArticleEs(person.job, person.sex)}.` : "",
  );
  const leftClause = t(
    locale,
    awayFromTown ? ` ${capitalize(subject)} left ${townName} behind and never returned.` : ` ${capitalize(subject)} never permanently left the town where ${subject} was born.`,
    awayFromTown ? ` ${capitalize(subjectEs)} dejó atrás ${townName} y nunca regresó.` : ` ${capitalize(subjectEs)} nunca abandonó para siempre el pueblo donde nació.`,
  );
  const goal = dreamGoalDisplay(locale, person.mind.dream.goal);
  const dreamClause = t(
    locale,
    person.mind.dream.status === "realized"
      ? ` ${pronounPossessive === "her" ? "Her" : "His"} dream of ${goal} came true.`
      : person.mind.dream.status === "abandoned"
        ? ` ${pronounPossessive === "her" ? "Her" : "His"} dream of ${goal} was let go along the way.`
        : ` ${pronounPossessive === "her" ? "Her" : "His"} dream of ${goal} never came to pass.`,
    person.mind.dream.status === "realized"
      ? ` Su sueño de ${goal} se hizo realidad.`
      : person.mind.dream.status === "abandoned"
        ? ` Su sueño de ${goal} quedó atrás con el paso del tiempo.`
        : ` Su sueño de ${goal} nunca llegó a cumplirse.`,
  );

  return t(locale, `${name} died at ${age}${survivedClause} ${placeClause}.${jobClause}${leftClause}${dreamClause}`, `${name} murió a los ${age}${survivedClause} ${placeClause}.${jobClause}${leftClause}${dreamClause}`);
}

const DEFAULT_SIGNIFICANCE: Record<Event["kind"], number> = {
  birth: 0.7,
  school: 0.15,
  job: 0.35,
  move: 0.55,
  romance: 0.5,
  marriage: 0.85,
  breakup: 0.6,
  feud: 0.55,
  reconciliation: 0.5,
  illness: 0.25,
  death: 1,
  child: 0.4,
  breakdown: 0.65,
  dream: 0.6,
  town: 0.7,
  reflection: 0.45,
  levy: 0.6,
  vignette: 0.2,
  widowed: 0.6,
  "period-marker": 0.35,
  "manorial-fine": 0.5,
};

/**
 * Narrates one person's timeline and scores each event's narrative
 * significance for "story sifting" (highlighting key moments). Significance
 * is computed only for the displayed person's events — bounding the number
 * of extra AI calls this triggers, per the significance budget note in the
 * design brief.
 *
 * Two kinds of events are deliberately left out of the rendered timeline,
 * though they remain in the raw event log and are still walkable through
 * `causes[]`:
 *  - `child` events (the decision to conceive) are folded into the `birth`
 *    event that follows the same year — showing both is redundant ("X and Y
 *    decided to have a child" immediately followed by "Z was born to X and
 *    Y").
 *  - `illness` events that are cited as the cause of a death in the same
 *    log are folded into that death's narration instead of shown as a
 *    separate line.
 */
export async function narratePersonTimeline(
  personId: string,
  events: readonly Event[],
  people: Readonly<Record<string, Person>>,
  decisionMaker?: DecisionMaker,
  concurrencyLimit = 8,
  seed = "narrate",
  townName = "town",
  locale: Locale = DEFAULT_LOCALE,
  /**
   * Incremental-simulation capability: narrate only THIS subset (e.g. one simulated year's new
   * events) while `events` still supplies the full causal/subsumed-illness context — used by
   * `life-chronicle.ts#buildProvisionalTickEntries` for live SSE ticks, which score only the
   * year just simulated rather than re-narrating the whole life so far. Defaults to every one of
   * `events` the caller already filters to `personId` (the original, whole-timeline behavior).
   */
  eventsToScore?: readonly Event[],
): Promise<NarratedEvent[]> {
  const subsumedIllnesses = illnessIdsSubsumedByDeath(events);
  const personEvents = (eventsToScore ?? events)
    .filter((e) => e.actors.includes(personId))
    .filter((e) => e.kind !== "child")
    .filter((e) => !(e.kind === "illness" && subsumedIllnesses.has(e.id)))
    .sort((a, b) => a.year - b.year);

  const scored = await mapWithConcurrency(personEvents, concurrencyLimit, async (event) => {
    const { title, prose } = narrateEventForViewer(event, personId, people, seed, townName, events, locale);
    // A forced event (the edit itself) is always the pivotal moment of that branch's story.
    if (event.payload.forced) return { event, prose, title, significance: 1 };
    if (event.significance !== undefined) return { event, prose, title, significance: event.significance };
    if (decisionMaker?.significance) {
      try {
        const significance = await decisionMaker.significance({ summary: prose, state: { kind: event.kind, year: event.year, payload: event.payload } });
        return { event, prose, title, significance };
      } catch {
        // Fall through to the heuristic on any adapter failure; narration must never hard-fail a page render.
      }
    }
    return { event, prose, title, significance: DEFAULT_SIGNIFICANCE[event.kind] };
  });

  return scored;
}

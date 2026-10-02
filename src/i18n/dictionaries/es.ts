import type { Dictionary } from "../dictionary";

/**
 * Decision 059: neutral, professional Spanish (no regional slang or voseo), in the same
 * period-appropriate storybook register as the English copy — matching the app's early Tudor
 * England setting without translating person or place names. Typed against `Dictionary` (`en.ts`'s
 * inferred shape): a missing or mistyped key here is a `pnpm typecheck` failure, not a silent gap.
 */
import type { LifeSex, RelCode } from "@/contracts/life";

const ORDINALS: readonly (readonly [string, string])[] = [["primer", "primera"], ["segundo", "segunda"], ["tercer", "tercera"], ["cuarto", "cuarta"], ["quinto", "quinta"]];
const ES_RELATION: Record<RelCode, readonly [string, string]> = {
  self: ["ella misma", "él mismo"],
  parent: ["madre", "padre"],
  sibling: ["hermana", "hermano"],
  spouse: ["esposa", "esposo"],
  child: ["hija", "hijo"],
  lover: ["amor", "amor"],
  rival: ["rival", "rival"],
  friend: ["amiga", "amigo"],
  childSpouse: ["nuera", "yerno"],
  grandchild: ["nieta", "nieto"],
};

export const es: Dictionary = {
  meta: {
    title: "Lifelines — un simulador de crónicas",
    description: "Simula las vidas de un pequeño pueblo, año a año, y luego reescribe un momento para ver desplegarse el efecto mariposa.",
  },
  nav: {
    home: "Inicio",
    yourLives: "Tus vidas",
    tagline: "La misma gente. Mañanas más brillantes.",
    footerTagline: "Primero se simula, luego se narra.",
  },
  home: {
    kicker: "Un simulador de vidas",
    description:
      "Nombra a un recién nacido, y observa cómo se escribe una vida entera — año a año, del nacimiento a la muerte — en una aldea medieval. Luego cambia cualquier momento, suyo, de otra persona o del azar, y observa cómo se reescribe el resto de esa vida.",
    nameLabel: "Nombre",
    namePlaceholder: "Elin",
    sexLabel: "Una hija, un hijo, o el destino",
    sexDaughter: "una hija",
    sexSon: "un hijo",
    sexRandom: "que decida el destino",
    hideVillage: "Ocultar aldea",
    chooseVillage: "Elegir una aldea (opcional)",
    villagePlaceholder: "déjalo en blanco para elegir al azar",
    randomize: "Al azar",
    submit: "Escribir su vida",
    yourLivesLink: "Tus vidas",
    nameRequiredError: "Nómbrala, o nómbralo, primero.",
    writtenKicker: "Una vida, escrita",
    writingKicker: (name: string) => `Escribiendo la vida de ${name}…`,
  },
  guard: {
    rateLimited: (retryIn: string) => `Se han escrito demasiadas vidas desde esta conexión hace poco. Vuelve a intentarlo en ${retryIn}.`,
    verificationFailed: "No pudimos verificar que eres humano. Por favor, intenta la verificación de nuevo.",
    retrySeconds: (n: number) => `${n} segundo${n === 1 ? "" : "s"}`,
    retryMinutes: (n: number) => `${n} minuto${n === 1 ? "" : "s"}`,
  },
  lives: {
    kicker: "Cada vida escrita hasta ahora",
    title: "Tus vidas",
    loadError: "No se pudieron cargar tus vidas.",
    loading: "Cargando…",
    empty: "Todavía no hay vidas.",
    entry: (ageAtDeath: number, causeOfDeath: string, branchCount: number) =>
      `Murió a los ${ageAtDeath} años, de ${causeOfDeath}. ${branchCount} ${branchCount === 1 ? "versión" : "versiones"} de esta vida.`,
    writeAnother: "Escribir otra vida",
  },
  life: {
    loadError: "No se pudo cargar esta vida.",
    opening: "Abriendo la crónica…",
  },
  sky: {
    title: (name: string) => `La constelación de ${name}`,
    constellationLabel: (name: string) => `Constelación de las relaciones de ${name}`,
    player: { play: "Reproducir", pause: "Pausar", speed: "Velocidad de reproducción", year: "Año", caption: "Una vida en movimiento" },
    intro: {
      lede: (_sex: LifeSex, village: string) =>
        `Cada estrella es alguien en su vida. Las más brillantes son su círculo de historia, las personas cuyas decisiones moldean su propia historia. Los vínculos aparecen el año en que nacen y se desvanecen cuando terminan. El anillo que rodea el cielo es su vida entera, y las estrellas tenues del fondo son el resto del pueblo de ${village}.`,
      mottoA: "Las personas hacen una vida.",
      mottoB: "El tiempo le da sentido.",
      epitaph: (name: string, born: number, died: number) => `${name}, ${born}–${died}.`,
    },
    now: {
      age: "Edad",
      died: "Murió a los",
      where: (festival: string, village: string) => `${festival} en ${village}`,
    },
    place: {
      souls: "almas en el pueblo",
      circle: () => "en su círculo",
      quote: "Aquí, entre gente corriente, una vida extraordinaria.",
    },
    edge: { quote: "El mismo cielo, un tú distinto.", future: "Futuro aún sin escribir", deeper: "Más hondo en el tiempo" },
    reel: { label: "Crónica", go: "Ir a este momento." },
    plague: { "black-death": "Gran Mortandad", "second-pestilence": "Segunda pestilencia" },
    /** "madre", "segundo esposo": los cónyuges llevan ordinal cuando hay más de uno. */
    relation: (code: RelCode, sex: LifeSex, nth: number, of: number): string => {
      const i = sex === "f" ? 0 : 1;
      const word = ES_RELATION[code]?.[i] ?? String(code);
      return code === "spouse" && of > 1 ? `${ORDINALS[nth - 1]?.[i] ?? `${nth}.º`} ${word}` : word;
    },
    tip: {
      born: (year: number) => `nació en ${year}`,
      lived: (born: number, died: number) => `${born}–${died}`,
      status: (kind: string, sex: LifeSex, age: number) => {
        if (kind === "age") return `${age} años`;
        if (kind === "written") return "Su vida está escrita";
        if (kind === "circle") return "En su círculo de historia";
        if (kind === "deadFamily") return "Fallecido, aún familia";
        return "Fuera de su círculo de historia por ahora";
      },
    },
    legend: {
      label: "Leyenda",
      circle: () => "En su círculo de historia",
      others: (village: string) => `Otros en ${village}`,
      bond: "Relación",
      former: "Vínculo pasado",
      conflict: "Conflicto",
      closing: "Todas nuestras historias comparten el mismo cielo.",
    },
  },
  chronicle: {
    brand: "Lifelines",
    historyToggle: "Historial ▾",
    newLife: "Nueva vida",
    eyebrow: "Una vida ya vivida",
    living: "con vida",
    branchFrom: (year: number) => `Ramal desde ${year}`,
    peopleInThisLife: "Personas en esta vida",
    endOfLife: "Fin de la vida",
    afterDeath: () => "Tras su muerte",
    changeAnEarlierMoment: "Cambiar un momento anterior",
    beginANewLife: "Comenzar una nueva vida",
    thisHistory: "Este historial",
    originalLife: "Vida original",
    footerNote: "Cualquier turno puede cambiarse, y todo lo que sigue puede reescribirse.",
    regenerating: (firstName: string, fromYear: number, nowYear: number) => `Reescribiendo la vida de ${firstName} desde ${fromYear}… ahora en ${nowYear}`,
    changedInYear: (year: number) => `Cambiado en ${year}`,
    firstSimulated: "La vida tal como se simuló por primera vez.",
    changeWhatHappened: "Cambiar lo que ocurrió →",
    follows: (phrase: string, year: number) => `Sigue a ${phrase} (${year})`,
    rewriteIncomplete: "La reescritura no se completó.",
    rewriteFailed: "La reescritura falló.",
    branchLoadError: "No se pudo cargar ese ramal.",
    modal: {
      willBeRewritten: "Todo lo que sigue a este momento será reescrito.",
      howDoesThisUnfold: "¿Cómo se desarrolla este momento?",
      currentHistory: "(Historial actual)",
      rewriting: "Reescribiendo…",
      applyThisChange: "Aplicar este cambio",
      cancel: "Cancelar",
      rippleQuote: "Una sola elección puede repercutir en toda una vida.",
      whyChance: "¿Por qué ocurrió esto?",
      whySelf: (sex: "f" | "m") => `¿Por qué ${sex === "f" ? "ella eligió" : "él eligió"} esto?`,
      whyOther: (name: string) => `¿Por qué ${name} eligió esto?`,
      diverges: "◆ la historia se bifurca aquí",
      original: "ORIGINAL",
      new: "NUEVO",
      history: "Historial",
    },
  },
};

/**
 * Decision 059: the canonical English dictionary — every string here is copied verbatim from the
 * component it was extracted from, so wiring `getDictionary("en")` into a page changes nothing about
 * its rendered output (the existing, English-only tests/screens stay byte-identical). `es.ts` is
 * typed against this file's inferred shape (`Dictionary`, in `../dictionary.ts`), so the two
 * dictionaries can never drift out of key-parity — a missing Spanish key is a compile error, not a
 * runtime gap. Plain, synchronous objects rather than the official guide's per-locale dynamic
 * `import()` (`node_modules/next/dist/docs/01-app/02-guides/internationalization.md`'s
 * `getDictionary`): several of the pages this feeds (`page.tsx`, `lives/page.tsx`, `chronicle.tsx`,
 * `global-header.tsx`) are Client Components (`useState`/`useEffect`), so the guide's
 * server-only-bundle-size rationale doesn't hold here, and at this dictionary's size (roughly 150
 * short strings) the cost of shipping both locales is negligible either way.
 */
export const en = {
  meta: {
    title: "Lifelines — a chronicle simulator",
    description: "Simulate a small town's lives year by year, then rewrite one moment and watch the butterfly effect unfold.",
  },
  nav: {
    home: "Home",
    yourLives: "Your lives",
    tagline: "Same people. Brighter tomorrows.",
    footerTagline: "Simulate first, then describe.",
  },
  home: {
    kicker: "A life simulator",
    description:
      "Name a newborn, and watch one life get written — year by year, birth to death — in a medieval village. Then change any moment, hers or someone else's or chance's, and watch the rest of that life get rewritten.",
    nameLabel: "Name",
    namePlaceholder: "Elin",
    sexLabel: "A daughter, a son, or fate",
    sexDaughter: "a daughter",
    sexSon: "a son",
    sexRandom: "let fate decide",
    hideVillage: "Hide village",
    chooseVillage: "Choose a village (optional)",
    villagePlaceholder: "leave blank to randomize",
    randomize: "Randomize",
    submit: "Write their life",
    yourLivesLink: "Your lives",
    nameRequiredError: "Name her, or him, first.",
    writtenKicker: "A life, written",
    writingKicker: (name: string) => `Writing the life of ${name}…`,
  },
  /** Abuse protection (rate limiting, Turnstile) — shared across every form that starts a simulation, via `src/lib/guard-error.ts#guardErrorMessage`. */
  guard: {
    rateLimited: (retryIn: string) => `Too many lives written from this connection recently. Try again in ${retryIn}.`,
    verificationFailed: "We couldn't verify you're human. Please try the challenge again.",
    retrySeconds: (n: number) => `${n} second${n === 1 ? "" : "s"}`,
    retryMinutes: (n: number) => `${n} minute${n === 1 ? "" : "s"}`,
  },
  lives: {
    kicker: "Every life written so far",
    title: "Your lives",
    loadError: "Couldn't load your lives.",
    loading: "Loading…",
    empty: "No lives yet.",
    entry: (ageAtDeath: number, causeOfDeath: string, branchCount: number) => `Died at ${ageAtDeath}, of ${causeOfDeath}. ${branchCount} ${branchCount === 1 ? "version" : "versions"} of this life.`,
    writeAnother: "Write another life",
  },
  life: {
    loadError: "Couldn't load this life.",
    opening: "Opening the chronicle…",
  },
  sky: {
    title: (name: string) => `The constellation of ${name}`,
    constellationLabel: (name: string) => `Constellation of ${name}'s relationships`,
    player: { play: "Play", pause: "Pause", speed: "Playback speed", year: "Year", caption: "A life in motion" },
  },
  chronicle: {
    brand: "Lifelines",
    historyToggle: "History ▾",
    newLife: "New life",
    eyebrow: "A life already lived",
    living: "living",
    branchFrom: (year: number) => `Branch from ${year}`,
    peopleInThisLife: "People in this life",
    endOfLife: "End of life",
    afterDeath: (sex: "f" | "m") => `After ${sex === "f" ? "her" : "his"} death`,
    changeAnEarlierMoment: "Change an earlier moment",
    beginANewLife: "Begin a new life",
    thisHistory: "This history",
    originalLife: "Original life",
    footerNote: "Change any turn and everything after it can be rewritten.",
    regenerating: (firstName: string, fromYear: number, nowYear: number) => `Rewriting ${firstName}'s life from ${fromYear}… now at ${nowYear}`,
    changedInYear: (year: number) => `Changed in ${year}`,
    firstSimulated: "The life that was first simulated.",
    changeWhatHappened: "Change what happened →",
    follows: (phrase: string, year: number) => `Follows ${phrase} (${year})`,
    rewriteIncomplete: "The rewrite didn't complete.",
    rewriteFailed: "The rewrite failed.",
    branchLoadError: "Couldn't load that branch.",
    modal: {
      willBeRewritten: "Everything after this moment will be rewritten.",
      howDoesThisUnfold: "How does this moment unfold?",
      currentHistory: "(Current history)",
      rewriting: "Rewriting…",
      applyThisChange: "Apply this change",
      cancel: "Cancel",
      rippleQuote: "A single choice can ripple through a lifetime.",
      whyChance: "Why did this happen?",
      whySelf: (sex: "f" | "m") => `Why did ${sex === "f" ? "she" : "he"} choose this?`,
      whyOther: (name: string) => `Why did ${name} choose this?`,
      diverges: "◆ history diverges here",
      original: "ORIGINAL",
      new: "NEW",
      history: "History",
    },
  },
};

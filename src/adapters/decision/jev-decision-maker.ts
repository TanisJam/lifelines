import { TypeSafeClient, choice, score, type ChoiceCriteria } from "@typesafe-ai/sdk";
import type { DecisionMaker, DecisionMakerStats, DecisionQuestion, Distribution } from "@/domain/decisions";
import type { JsonValue } from "@/domain/types";
import { VIGNETTE_OPTION_DESCRIPTIONS } from "@/domain/vignettes";
import { decisionCacheKey, FileBackedCache } from "./cache";

/**
 * A pinned, concrete model version rather than the `jev-latest` alias.
 * `jev-latest` moves when a new release ships, which would change answers
 * behind a fork's back with no code change on our side — exactly what we
 * must avoid for reproducible re-simulation. See the determinism
 * experiment (scripts/determinism.ts) and the README for the numbers that
 * justify this. Overridable via TYPESAFE_MODEL for experimentation.
 */
export const DEFAULT_JEV_MODEL = "jev-1.13.0";

/**
 * Round 4 (docs/mind-model.md): Jev IMPERSONATES the person — no code-side
 * weights, no norm-setting base rates. `self.mind` (facets, values, dream,
 * needs, mood, stress, thoughts, memories) and `self.portrait` (a prose
 * summary of the same) ARE the character; the instructions just point at
 * them and ask "given who you are, what do you do?" instead of describing
 * a population-level tendency the way round 2/3's wording did. Options are
 * criteria text worded in the first person too, matching `situation.question`.
 */
const DECISION_INSTRUCTIONS: Record<DecisionQuestion["kind"], string> = {
  Y1: "You are the person described in 'self' — read self.mind and self.portrait for who you are. Someone ('suitor') has shown romantic interest in you. Given your personality, values, current mood, and any memories or relationships that bear on this, how do you respond?",
  A1: "You are the person in 'self'. You and 'partner' have been courting for self.situation.courtshipYears year(s) (see 'situation'). Given who you are — your values around family and independence, your love propensity, your current mood and memories with them — what do you do about the relationship this year?",
  A3: "You are the person in 'self'. A specific job opportunity has opened up (see 'situation.question' for the role); situation.yearsInCurrentJob is how long you've been at situation.currentJob. Given your ambition, your values (craft, wealth, independence), your dream, and your circumstances, what do you do?",
  A2: "You are the person in 'self', married to 'partner'. You have situation.existingChildren children so far, and situation.fertileYearsLeft childbearing years left biologically. Given how you feel about family, your current relationship, your stress and mood, do you try for a child this year? Answer for yourself, neither assuming you want more children nor that you're done — read your own values and circumstances.",
  Y4: "You are the person in 'self'. 'rival' has slighted you. Given your temperament — your anger, your values, how much you trust people — how do you respond?",
  A6: "You are the person in 'self'. Your feud with 'rival' has dragged on for years. Given your personality and values, what do you do about it now?",
  Y3: "You are the person in 'self'. An opportunity has come up in a distant city. Given your curiosity, your independence, your ties here, and your circumstances, do you leave or stay?",
  A8: "You are the person in 'self'. Your dream (self.mind.dream) is still unrealized. Given your ambition and perseverance, and how your life has gone, what do you do about it?",
  A11: "You are the person in 'self'. The weight of everything has brought you to a breaking point (see 'situation.question' for what kind). Given your perseverance and your usual way of coping, how do you respond?",
  C2: "You are the person in 'self', a child — read self.mind and self.portrait. Your parent ('parent') has just died. Given your temperament and how attached you were to them, how do you face it?",
  O2: "You are the person in 'self', now old. You have carried a grudge against 'rival' for years. Given your personality, and everything you've learned about yourself across your life, do you finally let it go?",
  O4: "You are the person in 'self', old and facing death. Given your values, your perseverance, and what your life has actually held, how do you meet it?",
  A5: "You are the person in 'self' — read self.mind and self.portrait. Something has happened to the whole town (see 'situation.question'). Given your altruism, your greed, and your courage, what do you do?",
  C3: "You are the person in 'self', a young person on the edge of adulthood — read self.mind and self.portrait. It's time to think about what you'll make of yourself. Given your curiosity, your independence, your values, and your family's trade, what calls to you?",
  C1: "You are the person in 'self', a child — read self.mind and self.portrait. A sibling close to you in age is rivalling you for attention. Given your temperament, do you compete with them, bond with them, or withdraw?",
  C4: "You are the person in 'self', a child — read self.mind and self.portrait. A quick-tempered peer has been bullying you. Given your bravery and your trust in adults, do you fight back, endure it, or tell an elder?",
  Y2: "You are the person in 'self'. Your dream and your current trade are pulling in different directions. Given your ambition, your values around craft, and your practical circumstances, do you pursue the dream, or stay practical?",
  Y5: "You are the person in 'self'. You've spent enough time with someone that a real friendship could form. Given your gregariousness and trust, do you open up to them or keep your distance?",
  A4: "You are the person in 'self'. You have just discovered a betrayal — a spouse's affair, or a partner's theft (see 'situation.question'). Given your temperament, your values, and how much you trusted them, how do you respond?",
  A7: "You are the person in 'self'. A run of bad outcomes has shaken your faith (self.mind.values.faith). Given your values and your perseverance, do you double down on your faith, lose it, or seek another path?",
  A9: "You are the person in 'self', in an unhappy marriage. You feel a real attraction to someone else. Given your love propensity and your values around law and tradition, do you resist it or pursue it?",
  A10: "You are the person in 'self', skilled at your trade, with a capable young person nearby who could use a mentor. Given your altruism and your values around craft, do you take them on as an apprentice, or decline?",
  O1: "You are the person in 'self', old, with property and living heirs. Given your values around family and tradition, and your altruism toward the town, how do you divide your inheritance — to the eldest, to a favorite, split evenly, or to the town itself?",
  O3: "You are the person in 'self', old, with a dream you never realized. Given your perseverance and your values around family, do you make one last attempt at it, pass it on to someone else, or make peace with letting it go?",
  AP1: "You are the person in 'self', a parent, deciding your child's future. ('partner' is your child.) Given your values around tradition and your own ambition for them, do you apprentice them to your own trade, send them elsewhere to apprentice, or keep them at home a while longer?",
  PIL1: "You are the person in 'self'. You've long felt the pull of a pilgrimage. Given your faith and your curiosity, and your ties at home, do you go, or stay?",
  SEX1: "The newborn's given name is `name`. Considering how this given name is conventionally used, is a child with this name a girl or a boy?",
  D1: "You are the person in 'self', living an ordinary year of your life — read self.mind and self.portrait for who you are, and situation.vignette/situation.question for the everyday moment you're facing. Given your personality, values, mood, and circumstances, what do you do?",
};

const OPTION_DESCRIPTIONS: Record<string, string> = {
  encourage: "I encourage their interest and let something begin between us.",
  decline: "I am not interested, and I say so.",
  wait: "I don't decide anything yet; I wait and see.",
  propose: "I propose marriage.",
  delay: "I put the decision off for now.",
  "end-it": "I end the courtship.",
  pass: "I pass the opportunity to a friend instead.",
  ignore: "I let the opportunity go by.",
  try: "We try for a child.",
  refuse: "I refuse — not this year, or not at all.",
  confront: "I confront them about it, openly.",
  forgive: "I let it go and forgive them.",
  "nurse-it": "I say nothing, but I don't forget it either.",
  revenge: "I seek revenge.",
  reconcile: "I make peace and end the feud.",
  feud: "The feud continues as it has.",
  sabotage: "I work against them quietly, to settle the score.",
  leave: "I leave for the distant town.",
  stay: "I stay here, where my life is.",
  "push-harder": "I push harder toward my dream.",
  "adjust-it": "I adjust what I'm aiming for.",
  "abandon-it": "I let the dream go.",
  "give-in": "I give in to it.",
  "master-it": "I master it, through sheer will.",
  "grieve-openly": "I grieve openly, and let people see it.",
  harden: "I harden myself and carry on.",
  "cling-to-other-parent": "I cling to my remaining parent.",
  help: "I help however I can.",
  "take-to-grave": "I will take this grudge to my grave.",
  "follow-trade": "I follow in my family's footsteps.",
  "apprentice-elsewhere": "I seek an apprenticeship of my own, away from home.",
  drift: "I don't know yet — I let it be, for now.",
  peace: "I find peace with it.",
  regret: "I am consumed by regret.",
  "last-wish": "I hold onto one last wish.",
  flee: "I keep clear of it and look after my own.",
  profit: "I look for an advantage in it.",
  compete: "I compete with them for attention.",
  bond: "I bond with them instead of competing.",
  withdraw: "I withdraw rather than deal with it.",
  "fight-back": "I fight back.",
  endure: "I endure it quietly.",
  "tell-an-elder": "I tell an elder about it.",
  "pursue-the-dream": "I pursue my dream, whatever the cost to my trade.",
  "stay-practical": "I stay practical and keep to my trade.",
  "open-up": "I open up to them.",
  "keep-distance": "I keep my distance.",
  "double-down": "I double down on my faith.",
  "lose-faith": "I lose my faith.",
  "seek-another-path": "I seek another path entirely.",
  resist: "I resist the temptation.",
  pursue: "I pursue it.",
  "take-an-apprentice": "I take them on as an apprentice.",
  eldest: "I leave everything to the eldest.",
  favorite: "I leave everything to my favorite.",
  split: "I split it evenly.",
  town: "I leave it to the town.",
  "last-attempt": "I make one last attempt at it.",
  "pass-it-on": "I pass it on to someone else.",
  "make-peace-with-it": "I make peace with letting it go.",
  "apprentice-own-trade": "I apprentice them to my own trade.",
  "send-away": "I send them elsewhere to apprentice.",
  "keep-home": "I keep them at home a while longer.",
  go: "I go.",
};

function describeOption(kind: DecisionQuestion["kind"], option: string): string {
  if (kind === "A3" && option === "seize") return "I seize the opportunity and take up the new role.";
  if (kind === "A10" && option === "decline") return "I decline to take on an apprentice.";
  if (kind === "A4" && option === "leave") return "I leave them over it.";
  if (kind === "SEX1" && option === "f") return "`name` is a girl's name: it is conventionally given to girls.";
  if (kind === "SEX1" && option === "m") return "`name` is a boy's name: it is conventionally given to boys.";
  if (kind === "D1") return VIGNETTE_OPTION_DESCRIPTIONS[option] ?? OPTION_DESCRIPTIONS[option] ?? `I choose "${option}".`;
  return OPTION_DESCRIPTIONS[option] ?? `I choose "${option}".`;
}

const SIGNIFICANCE_CRITERIA = [
  "A minor, everyday moment with little lasting impact on this person's story or the town's history.",
  "A meaningful moment worth mentioning in a biography, but not one of the defining turns of this life.",
  "A defining, pivotal moment — the kind of thing legends are told about — that reshaped this person's life or the town's history.",
] as const;

export interface JevDecisionMakerOptions {
  readonly apiKey?: string;
  readonly model?: string;
  /** Path to a JSON file for cross-run cache persistence. Omit to keep the cache purely in-memory. */
  readonly cacheFilePath?: string;
}

/**
 * TypeSafe (`@typesafe-ai/sdk`) adapter for psychological/social decisions.
 * Caches every answer by a stable hash of (question id + serialized state),
 * so re-simulating a fork only pays for decisions whose state actually
 * changed after the edit — everything upstream of the fork year, and any
 * downstream decision whose inputs happen to be unaffected, is served from
 * cache instead of re-calling the model. This is also what makes repeated
 * calls with identical state reproducible despite the model's own per-call
 * sampling noise (see the determinism experiment) — though NOT what makes a
 * brand-new state reproducible: the cache only covers repeats, so a
 * decision whose state genuinely differs from anything cached still gets
 * one live, noisy Jev sample. See decision 016 for why that matters.
 *
 * `decide()` here returns and caches Jev's RAW distribution, unmodified.
 * Per decision 016 (correcting decision 013), blending Jev's judgment with
 * a code-side prior is a separate, explicit, NAMED policy step —
 * `simulate.ts#resolveDecision` calls `blendDistributions` after getting
 * this raw result — specifically so `jevRaw` stays intact and reusable on
 * its own terms (cached as Jev actually answered it; inspectable in the
 * UI next to what was actually decided) instead of being silently
 * overwritten by the blend before it's ever seen or stored.
 */
export class JevDecisionMaker implements DecisionMaker {
  private readonly client: TypeSafeClient;
  private readonly model: string;
  private readonly cache: FileBackedCache<Distribution>;
  private readonly significanceCache: FileBackedCache<number>;
  private calls = 0;
  private cacheHits = 0;
  private wallTimeMs = 0;
  private inputTokens = 0;
  private outputTokens = 0;

  constructor(options: JevDecisionMakerOptions = {}) {
    this.client = new TypeSafeClient({ apiKey: options.apiKey, timeout: 20000 });
    this.model = options.model ?? process.env.TYPESAFE_MODEL ?? DEFAULT_JEV_MODEL;
    this.cache = new FileBackedCache<Distribution>(options.cacheFilePath);
    this.significanceCache = new FileBackedCache<number>(options.cacheFilePath ? `${options.cacheFilePath}.significance.json` : undefined);
  }

  async decide(question: DecisionQuestion): Promise<Distribution> {
    const criteria: ChoiceCriteria = {};
    for (const option of question.options) criteria[option] = describeOption(question.kind, option);

    // The prompt (instructions + criteria) and model are part of the key: rewording a question
    // must not keep serving answers that were given to the old wording.
    const key = decisionCacheKey(question.id, { state: question.state, instructions: DECISION_INSTRUCTIONS[question.kind], criteria, model: this.model });
    const cached = this.cache.get(key);
    if (cached) {
      this.cacheHits += 1;
      return cached;
    }

    this.calls += 1;
    const started = Date.now();

    const result = await this.client.systemOne({
      state: question.state,
      questions: { outcome: choice(DECISION_INSTRUCTIONS[question.kind], criteria) },
      model: this.model,
    });

    this.wallTimeMs += Date.now() - started;
    this.inputTokens += result.usage.input_tokens;
    this.outputTokens += result.usage.output_tokens;

    const rawDistribution = result.answers.outcome.probabilities as Distribution;
    this.cache.set(key, rawDistribution);
    this.cache.flush();
    return rawDistribution;
  }

  async significance(input: { readonly summary: string; readonly state: Readonly<Record<string, JsonValue>> }): Promise<number> {
    const key = decisionCacheKey(`significance:${input.summary}`, input.state);
    const cached = this.significanceCache.get(key);
    if (cached !== undefined) {
      this.cacheHits += 1;
      return cached;
    }

    this.calls += 1;
    const started = Date.now();
    const result = await this.client.systemOne({
      state: { event: input.summary, ...input.state },
      questions: { narrativeSignificance: score("How significant is this event to this person's life story and the town's history?", SIGNIFICANCE_CRITERIA) },
      model: this.model,
    });
    this.wallTimeMs += Date.now() - started;

    const normalized = result.answers.narrativeSignificance.score / (SIGNIFICANCE_CRITERIA.length - 1);
    this.significanceCache.set(key, normalized);
    this.significanceCache.flush();
    return normalized;
  }

  getStats(): DecisionMakerStats {
    return { calls: this.calls, cacheHits: this.cacheHits, wallTimeMs: this.wallTimeMs, inputTokens: this.inputTokens, outputTokens: this.outputTokens };
  }
}

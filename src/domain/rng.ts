/**
 * Deterministic, keyed random number generation.
 *
 * The whole simulation must be reproducible: the same world seed always
 * produces the same event log. Crucially, a single shared sequential RNG
 * stream would make every downstream draw shift whenever an earlier draw
 * changed (e.g. after an edit), which would make it impossible to say
 * "this and only this changed because of the edit". Instead every decision
 * gets its OWN independent stream, keyed by (worldSeed, personId, year,
 * decisionKind). An edit only changes the *state* that decisions read, so a
 * downstream decision's random draw is byte-identical to the original run
 * unless the edit changed the option set, or an edit-caused avalanche of
 * prior state actually changed the inputs to that specific decision. That is
 * exactly the "butterfly effect through state, not through RNG plumbing"
 * property this simulator is built around.
 */

/** FNV-1a 32-bit string hash. Cheap, well distributed, no dependencies. */
export function hashString(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  // Force unsigned 32-bit.
  return hash >>> 0;
}

/** Mulberry32 PRNG. Small, fast, decent statistical quality for a life sim. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Build an independent, deterministic RNG stream for one decision.
 *
 * `salt` lets a single decision draw more than one independent number
 * (e.g. "which option" then "which detail") without correlating with a
 * different decision that happens to share the same key.
 */
export function keyedRng(worldSeed: string, personId: string, year: number, decisionKind: string, salt = 0): () => number {
  const key = `${worldSeed}::${personId}::${year}::${decisionKind}::${salt}`;
  return mulberry32(hashString(key));
}

/** Draw a single uniform [0, 1) number for a keyed decision. */
export function keyedDraw(worldSeed: string, personId: string, year: number, decisionKind: string, salt = 0): number {
  return keyedRng(worldSeed, personId, year, decisionKind, salt)();
}

/**
 * One draw from the standard Gumbel distribution, from a keyed uniform
 * [0, 1) source: `g = -log(-log(u))`. Clamped away from 0 and 1 so the
 * double log never produces `Infinity`/`NaN`.
 */
function gumbelFromUniform(u: number): number {
  const clamped = Math.min(1 - 1e-12, Math.max(1e-12, u));
  return -Math.log(-Math.log(clamped));
}

/**
 * Normalizes a distribution so its values sum to 1. Some sources (notably
 * `ruleDistribution`'s career-change branch) return raw relative weights,
 * not true probabilities — harmless for Gumbel-max sampling itself
 * (`argmax(log(p_i) + g_i)` is invariant to scaling every `p_i` by the same
 * constant), but `decisionMargin` needs an actual [0, 1]-summing
 * distribution to produce a meaningful [0, 1] margin.
 */
export function normalizeDistribution<T extends string>(distribution: Readonly<Record<T, number>>): Record<T, number> {
  const entries = Object.entries(distribution) as [T, number][];
  const total = entries.reduce((sum, [, p]) => sum + Math.max(0, p), 0);
  if (total <= 0) {
    const uniform = entries.length > 0 ? 1 / entries.length : 0;
    return Object.fromEntries(entries.map(([option]) => [option, uniform])) as Record<T, number>;
  }
  return Object.fromEntries(entries.map(([option, p]) => [option, Math.max(0, p) / total])) as Record<T, number>;
}

export interface GumbelMaxResult<T extends string> {
  readonly chosen: T;
  /** Gumbel noise per option, `option -> g_i`. */
  readonly noise: Readonly<Record<T, number>>;
  /** `log(p_i) + g_i` per option — the value argmax'd over to choose. */
  readonly scores: Readonly<Record<T, number>>;
}

/**
 * Gumbel-max sampling (decision 009): `argmax_i(log(p_i) + g_i)`, where
 * `g_i` is independent Gumbel noise keyed per OPTION — `keyedDraw(seed,
 * personId, year, `${decisionKind}:${optionId}`)` — not one shared draw for
 * the whole decision. This is mathematically equivalent to sampling
 * proportionally to `p_i` (the same distribution `sampleDistribution`
 * used to produce via inverse-CDF), but with a property inverse-CDF
 * sampling lacks: **counterfactual stability**. Inverse-CDF walks the
 * options in a fixed order accumulating probability mass, so raising one
 * option's probability shifts the boundaries for every option after it in
 * that order — an unrelated option's outcome can flip even though its own
 * probability never changed. With Gumbel-max, each option's score only
 * depends on its OWN probability and its OWN noise; raising the chosen
 * option's probability strictly increases its score while every other
 * option's score is untouched, so it can only keep winning (see
 * `rng.test.ts` for the property test, and Oberst & Sontag 2019 for the
 * general result this specializes).
 */
export function sampleGumbelMax<T extends string>(distribution: Readonly<Record<T, number>>, worldSeed: string, personId: string, year: number, decisionKind: string): GumbelMaxResult<T> {
  const entries = Object.entries(distribution) as [T, number][];
  if (entries.length === 0) throw new Error("sampleGumbelMax: empty distribution");

  const noise: Record<string, number> = {};
  const scores: Record<string, number> = {};
  let chosen: T | undefined;
  let bestScore = -Infinity;

  for (const [option, p] of entries) {
    const u = keyedDraw(worldSeed, personId, year, `${decisionKind}:${option}`);
    const g = gumbelFromUniform(u);
    noise[option] = g;
    const score = Math.log(Math.max(p, 1e-12)) + g;
    scores[option] = score;
    if (score > bestScore) {
      bestScore = score;
      chosen = option;
    }
  }

  return { chosen: chosen as T, noise: noise as Record<T, number>, scores: scores as Record<T, number> };
}

/**
 * How close a call was: `final[chosen] - final[runner-up]`, in [0, 1]. A
 * margin near 0 means the winner and the next-best option were nearly
 * equally likely (a coin flip the noise happened to land one way); a
 * margin near 1 means the outcome was close to certain. This is a
 * probability-space margin — it describes how close the underlying
 * distribution was, not the Gumbel scores or the specific noise draw, so
 * it's a meaningful "was this a nail-biter" signal independent of which
 * way chance actually fell.
 */
/**
 * How close a call really was (round 4 fix, decision 018): the gap between
 * the WINNING and RUNNER-UP Gumbel scores (`log p + g`), not the
 * probability gap. A small score gap means a small change in probability
 * (or a slightly different noise draw) would have flipped the outcome —
 * that is what "close call" should mean. The earlier probability-gap
 * `decisionMargin` conflated two different things: a genuine 50/50 toss-up
 * DOES have a small score gap (both options had similar log-probability
 * going in), but so does a decisive win by a favorite that just barely
 * out-scored a long-shot's lucky noise draw — while a case where a 1%
 * option's noise was so large it beat a 99% favorite is NOT fragile in
 * this sense (that 1% option would need to win by noise again to flip
 * back), it is a `surprise` instead (see `isSurprise`). The two are
 * genuinely different and shown differently in the UI: "close call" for a
 * small `fragility`, "long shot" for `isSurprise`.
 */
/** A large-but-finite "certainly not fragile" sentinel — JSON (and SSE frames) turn `Infinity` into `null`, so a real number is used instead of the mathematically cleaner infinity. */
export const NOT_FRAGILE = 999;

export function decisionFragility(scores: Readonly<Record<string, number>>): number {
  const sorted = Object.values(scores).sort((a, b) => b - a);
  if (sorted.length < 2) return NOT_FRAGILE; // only one option: nothing could have flipped it
  return sorted[0]! - sorted[1]!;
}

/** The chosen option was a long shot: its own probability was low (default threshold 20%), regardless of how the Gumbel scores compared. */
export function isSurprise<T extends string>(distribution: Readonly<Record<T, number>>, chosen: T, threshold = 0.2): boolean {
  return (distribution[chosen] ?? 0) < threshold;
}

import type { Sex } from "./types";

/**
 * Round 9 (decision 034, the single-life pivot): the protagonist needs a short, varied
 * `causeOfDeath` (contract: `ProtagonistInfo.causeOfDeath`), and the spec (decision 035) targets
 * 15-20% of protagonists dying before age 15, with causes that vary by life stage. This is layered
 * ONLY on top of the protagonist's own `death` decision (`simulate.ts` passes `protagonistId` in) —
 * the village-wide actuarial curve (`actuarial.ts#deathProbabilityAtAge`) is untouched, so every
 * existing world/town test and the old `/api/worlds` endpoints keep their exact numbers.
 */
export const DEATH_CAUSES = ["infant-fever", "childhood-accident", "childbirth", "plague", "war", "feud-violence", "illness", "old-age", "misadventure"] as const;
export type DeathCause = (typeof DEATH_CAUSES)[number];

/** Short noun phrase for the contract's `causeOfDeath` and for death prose. */
export const DEATH_CAUSE_PHRASE: Record<DeathCause, string> = {
  "infant-fever": "a fever in infancy",
  "childhood-accident": "a childhood accident",
  childbirth: "complications of childbirth",
  plague: "the plague",
  war: "war with a neighboring village",
  "feud-violence": "violence from a long-running feud",
  illness: "a lingering illness",
  "old-age": "old age",
  misadventure: "misfortune",
};

export interface MortalityContext {
  readonly age: number;
  readonly sex: Sex;
  readonly hadIllness: boolean;
  /** This year's town event kind, if any (see `simulate.ts#townEventForYear`). */
  readonly townEventType?: string;
  readonly hasActiveFeud: boolean;
  /** Gave birth (as the mother) the previous simulated year. */
  readonly recentChildbirth: boolean;
}

/**
 * Extra annual death probability, added on top of `deathProbabilityAtAge`, for the protagonist
 * only. Tuned (see `scripts/mortality-stats.ts`) so that, measured across many seeds, roughly
 * 15-20% of protagonists die before their 15th birthday, with the remaining risk spread realistically
 * across plague years, war, feud violence, childbirth and old age.
 */
export function protagonistMortalityBonus(ctx: MortalityContext): number {
  let bonus = 0;
  if (ctx.age === 0) bonus += 0.021;
  else if (ctx.age >= 1 && ctx.age <= 4) bonus += 0.0086;
  else if (ctx.age >= 5 && ctx.age <= 14) bonus += 0.0043;
  if (ctx.townEventType === "plague") bonus += 0.16;
  if (ctx.townEventType === "conflict" && ctx.age >= 16) bonus += 0.09;
  if (ctx.hasActiveFeud) bonus += 0.07;
  if (ctx.recentChildbirth && ctx.sex === "f") bonus += 0.06;
  return bonus;
}

/** Deterministic cause selection from the same context used to compute the bonus above — most specific/dramatic cause wins. */
export function determineDeathCause(ctx: MortalityContext): DeathCause {
  if (ctx.recentChildbirth && ctx.sex === "f") return "childbirth";
  if (ctx.townEventType === "plague") return "plague";
  if (ctx.townEventType === "conflict" && ctx.age >= 16) return "war";
  if (ctx.hasActiveFeud) return "feud-violence";
  if (ctx.age === 0) return "infant-fever";
  if (ctx.age >= 1 && ctx.age <= 14) return "childhood-accident";
  if (ctx.age >= 70) return "old-age";
  if (ctx.hadIllness) return "illness";
  return "misadventure";
}

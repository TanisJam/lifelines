import type { Sex } from "./types";

/**
 * Round 9 (decision 034) introduced a short, varied `causeOfDeath` for the protagonist's death
 * (contract: `ProtagonistInfo.causeOfDeath`). Decision 035 then layered an extra, protagonist-only
 * mortality bonus and cause selection on top of the village-wide actuarial curve
 * (`actuarial.ts#deathProbabilityAtAge`), specifically so the general village simulation and every
 * existing test would keep its exact old numbers while the protagonist alone hit a 15-20%
 * pre-15-death target.
 *
 * Decision 050 removes that split: `deathProbabilityAtAge` is now itself calibrated to the
 * historical target for EVERYONE (research.md, "Mortality and life expectancy" — Wrigley &
 * Schofield's e0 ~35, Galley 2019's IMR ~170.7/1000), so the protagonist faces the exact same risk
 * as any villager — `protagonistMortalityBonus` is gone, not just unused. `determineDeathCause`
 * stays, but is now called for every death (protagonist or NPC) that the general biology
 * resolution in `simulate.ts` produces, not just the protagonist's.
 */
export const DEATH_CAUSES = [
  "infant-fever",
  "childhood-accident",
  "childbirth",
  "plague",
  "sweating-sickness",
  "dearth",
  "influenza",
  "war",
  "feud-violence",
  "illness",
  "old-age",
  "misadventure",
] as const;
export type DeathCause = (typeof DEATH_CAUSES)[number];

/** Short noun phrase for the contract's `causeOfDeath` and for death prose. */
export const DEATH_CAUSE_PHRASE: Record<DeathCause, string> = {
  "infant-fever": "a fever in infancy",
  "childhood-accident": "a childhood accident",
  childbirth: "complications of childbirth",
  plague: "the plague",
  "sweating-sickness": "the sweating sickness",
  dearth: "the dearth",
  influenza: "a grippe",
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
}

/**
 * Deterministic cause selection, most-specific/dramatic first — decision 052 adds the three dated
 * shocks (sweating sickness, dearth, influenza) ahead of the generic `illness`/`misadventure`
 * fallbacks, alongside the pre-existing plague/war/feud/age-banded causes. Maternal deaths
 * (decision 051) are NOT selected here: they're assigned directly, at the moment of birth, in
 * `simulate.ts`'s A2 "try" outcome, since that death can't go through the general per-person
 * "death" biology decision (which already resolved for the year before that birth existed).
 */
export function determineDeathCause(ctx: MortalityContext): DeathCause {
  if (ctx.townEventType === "plague") return "plague";
  if (ctx.townEventType === "sweating-sickness") return "sweating-sickness";
  if (ctx.townEventType === "dearth") return "dearth";
  if (ctx.townEventType === "influenza") return "influenza";
  if (ctx.townEventType === "conflict" && ctx.age >= 16) return "war";
  if (ctx.hasActiveFeud) return "feud-violence";
  if (ctx.age === 0) return "infant-fever";
  if (ctx.age >= 1 && ctx.age <= 14) return "childhood-accident";
  if (ctx.age >= 70) return "old-age";
  if (ctx.hadIllness) return "illness";
  return "misadventure";
}

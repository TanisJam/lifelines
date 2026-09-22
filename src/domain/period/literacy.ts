import { keyedRng } from "../rng";
import type { Sex, SocialClass } from "../types";

/**
 * Decision 063 (engine-life-course PR4, design revision 2): a serf's (villein/cottar) son needed his
 * lord's permission to attend school at all — this multiplier gates the male base rate for exactly
 * those two classes down to its documented effective rate. Never applied to daughters (see
 * `isLiterate` below) — girls of every class were essentially never sent to school regardless of any
 * lord's licence, so their base rate is already the final one.
 */
export const LORD_SCHOOL_LICENCE = 0.3;

/**
 * Signature-literacy base rates by class and sex for c. 1330 (research.md, gap M7 — LOW confidence;
 * target overall ≈5%). Villein/cottar male figures here are the UNGATED base — `isLiterate` applies
 * `LORD_SCHOOL_LICENCE` on top for sons of those two classes only.
 */
const LITERACY_RATE_MALE: Readonly<Record<SocialClass, number>> = {
  clergy: 0.95,
  gentry: 0.5,
  merchant: 0.4,
  artisan: 0.1,
  freeholder: 0.08,
  villein: 0.1,
  cottar: 0.04,
};
const LITERACY_RATE_FEMALE: Readonly<Record<SocialClass, number>> = {
  clergy: 0, // clergy is structurally male in this window; kept only as a safe fallback
  gentry: 0.2,
  merchant: 0.1,
  artisan: 0.02,
  freeholder: 0.01,
  villein: 0.005,
  cottar: 0.002,
};

const LICENCE_GATED_CLASSES: ReadonlySet<SocialClass> = new Set(["villein", "cottar"]);

/**
 * Decided once, deterministically, at birth — keyed by `birthYear` (existing `"literacy"` key) so
 * it's stable across the person's whole life, exactly like the Tudor-era `worldgen.ts#isLiterate`
 * this replaces (decision 057 -> decision 063). A villein/cottar SON's base rate is multiplied by
 * `LORD_SCHOOL_LICENCE` first (spec's "villein's son with no lord's licence defaults illiterate"
 * scenario); every other class/sex combination uses its base rate unchanged.
 */
export function isLiterate(seed: string, personId: string, birthYear: number, sex: Sex, socialClass: SocialClass): boolean {
  const base = sex === "m" ? LITERACY_RATE_MALE[socialClass] : LITERACY_RATE_FEMALE[socialClass];
  const rate = sex === "m" && LICENCE_GATED_CLASSES.has(socialClass) ? base * LORD_SCHOOL_LICENCE : base;
  return keyedRng(seed, personId, birthYear, "literacy")() < rate;
}

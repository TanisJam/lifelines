import { FALLBACK_CLASS } from "./period/classes";
import type { SocialClass } from "./types";

/**
 * Physics/biology stays in code, not behind the DecisionMaker port: aging,
 * birth and death probabilities from simple actuarial-ish curves. These are
 * deliberately crude approximations of real mortality curves — good enough
 * for a legends-mode toy simulator, not for anything else.
 */

/**
 * Decision 050: annual probability of death at a given age, recalibrated against research.md's
 * "Mortality and life expectancy" synthesis for the general English population, 1498-1558 (proxy
 * years, per the doc's own caveat): e0 ~35 (range 28-42, Wrigley & Schofield 1981) and infant
 * mortality ~150-171/1000 (Galley 2019, 170.7/1000 for 1580-99). These per-age numbers already
 * SIT ABOVE their historical per-age counterparts in a couple of deliberate ways: `simulate.ts`'s
 * death resolution also applies an illness x3 multiplier (when a same-year illness occurred) and
 * hardship/epidemic multipliers (plague/famine/fire x1.6, and decision 052's dated shocks), AND the
 * age<2 band below has to cover a real engine-timing gap (next paragraph) — so the EFFECTIVE,
 * simulated rate, not a naive reading of this table against a life-table textbook, is what was tuned
 * to land in the historical band. Measured (not guessed) via `scripts/check-demographics.ts --stats
 * <seedCount>`, a full multi-generation village run (not just the protagonist), across 50+ seeds: see
 * docs/decisions.md 050 for the exact before/after figures from the run this table was calibrated
 * against.
 *
 * The age<2 band (not age<1): `simulate.ts` gathers a year's death candidates BEFORE that year's
 * births are applied, so a child born in-sim is never death-evaluated in its own birth year — its
 * first ever roll is the FOLLOWING year, at `ageInYear` = 1, not 0 (a founder who happens to start the
 * world at literal age 0 is the only case where age 0 is ever actually evaluated). Splitting "infant"
 * mortality into an age<1 band and a separate, lower age-1 band would leave the age<1 band almost
 * entirely dead code for the born-during-sim majority of the population; age<2 folds both into one
 * band instead, so a newborn's real first exposure — whichever age it lands on — carries the
 * intended infant-mortality risk. See `check-demographics.ts#runStats`'s doc comment for the measured
 * consequences of this (it also documents why the SCRIPT measures e0 over a 100-year window rather
 * than the game's own 60-year default — see that comment before assuming this table looks wrong
 * against a 60-year measurement).
 */
export function deathProbabilityAtAge(age: number): number {
  if (age < 2) return 0.14; // infant/toddler year: see the age<2 band-width note above
  if (age < 5) return 0.065;
  if (age < 15) return 0.027;
  if (age < 40) return 0.016;
  if (age < 60) return 0.032;
  if (age < 75) return 0.07;
  if (age < 90) return 0.2;
  return 0.47;
}

/**
 * Decision 050 (keys renamed 1:1 by decision 063): a small class gradient on top of the base curve
 * above — ASSUMPTION, not a sourced figure (research.md's synthesis explicitly flags any
 * class-specific mortality adjustment as unsourced: "this adjustment is an assumption, not a sourced
 * figure"). Gentry/clergy get the "well-provisioned adult male" proxy direction from
 * Hollingsworth/Hatcher's monastic/peerage comparisons (better diet, less exposure to
 * subsistence-level want); merchants a smaller version of the same; cottars (was labourer) the
 * downward adjustment research.md's synthesis suggests for landless wage-labourers versus the
 * aggregate. Villein/freeholder (was husbandman/yeoman)/artisan are left at the aggregate baseline
 * (1.0) — no sourced or even suggested direction was found for them specifically.
 */
const CLASS_MORTALITY_MULTIPLIER: Readonly<Record<SocialClass, number>> = {
  cottar: 1.1,
  villein: 1.0,
  freeholder: 1.0,
  artisan: 1.0,
  merchant: 0.95,
  clergy: 0.85,
  gentry: 0.85,
};

/**
 * Defensive `?? FALLBACK_CLASS` (decision 063 follow-up, CRITICAL fix): the original PR4 CVE was
 * exactly this table returning `undefined` for a legacy class that slipped through a snapshot's
 * unmapped `socialClass`, silently producing `NaN` mortality. `socialClass` should always be a
 * mapped, current `SocialClass` by the time it reaches here — this is defense in depth across the
 * `decompressJson<T>`-cast boundary TypeScript can't verify at runtime.
 */
export function classMortalityMultiplier(socialClass: SocialClass): number {
  return CLASS_MORTALITY_MULTIPLIER[socialClass] ?? CLASS_MORTALITY_MULTIPLIER[FALLBACK_CLASS];
}

/** Whether a person of this age and sex could plausibly have a child this year, biologically. */
export function isFertileAge(age: number, sex: "f" | "m"): boolean {
  return sex === "f" ? age >= 16 && age <= 45 : age >= 16 && age <= 65;
}

export function isAdult(age: number): boolean {
  return age >= 16;
}

export function isWorkingAge(age: number): boolean {
  return age >= 16 && age <= 70;
}

export function ageInYear(birthYear: number, year: number): number {
  return year - birthYear;
}

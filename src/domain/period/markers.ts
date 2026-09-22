/**
 * Engine life course PR5: manorial dues tied to unfree class members (spec's "Manorial markers and
 * i18n parity" requirement; design revision 2's markers table). Every event this module describes
 * uses the shared `"manorial-fine"` `EventKind` (`types.ts`) — `payload.fine` says which due it is;
 * `payload.payee` is always the literal `"lord"`, never a `Person` id (design decision 10: "the lord
 * stays off-stage").
 */
import { keyedDraw } from "../rng";
import type { JsonValue, Sex, SocialClass } from "../types";
import { FALLBACK_CLASS } from "./classes";

/** The unfree/customary classes bound to the manor (design decision 10; research.md's "villein/customary tenant" and "cottar/smallholder" rows) — merchet, heriot, chevage and leyrwite all key off this same set. Freeholders, artisans, merchants, clergy and gentry owe no manorial dues. */
export const UNFREE_CLASSES: ReadonlySet<SocialClass> = new Set(["villein", "cottar"]);

/** Defensive `?? FALLBACK_CLASS` — same rationale as `simulate.ts#minMarriageAge`/`period/literacy.ts` (decision 063 follow-up): a class read back through a deserialization boundary TypeScript can't verify at runtime degrades to the fallback class instead of throwing. `FALLBACK_CLASS` ("cottar") is itself unfree, so a genuinely missing class still resolves to a safe, non-throwing answer here. */
export function isUnfree(socialClass: SocialClass | undefined): boolean {
  return UNFREE_CLASSES.has(socialClass ?? FALLBACK_CLASS);
}

export type ManorialFine = "merchet" | "heriot" | "chevage" | "leyrwite";

/** `manorial-fine` event payload shape (design's markers table). Amount is deliberately omitted — no fine amount is sourced (research gap M5). */
export interface ManorialFinePayload extends Record<string, JsonValue> {
  readonly fine: ManorialFine;
  readonly payerId: string;
  readonly payee: "lord";
}

export function manorialFinePayload(fine: ManorialFine, payerId: string): ManorialFinePayload {
  return { fine, payerId, payee: "lord" };
}

/** research gap M5: no fine amount is sourced for leyrwite; 0.04/courting-year (0.02-0.10, low confidence) is the design's own point default. */
export const LEYRWITE_PROBABILITY_PER_COURTING_YEAR = { default: 0.04, min: 0.02, max: 0.1 } as const;

/** The minimal person shape leyrwite eligibility needs — deliberately not the full `Person`, so callers (and this module's own tests) never have to build a complete fixture just to check eligibility. */
export interface LeyrwiteCandidate {
  readonly sex: Sex;
  readonly socialClass?: SocialClass;
}

/**
 * Design's markers table: "villein/cottar woman with `marital.status=\"courting\"`... the engine has
 * no pre-marital pregnancy, so the courtship state is the tie." `isCourting` is the caller's own
 * read of that state (`simulate.ts` uses `activeRomancePair(events, personId) !== undefined`, the
 * same event-log-derived signal Y1 eligibility already relies on) — kept as a plain boolean
 * parameter here so this module stays free of any dependency on `events.ts`/`life-state.ts`.
 */
export function isLeyrwiteEligible(person: LeyrwiteCandidate, isCourting: boolean): boolean {
  return isCourting && person.sex === "f" && isUnfree(person.socialClass);
}

/**
 * A dedicated `"leyrwite"` keyed draw, independent of every other decision key for this
 * (seed, personId, year) — evaluated once per calendar year a woman remains eligible (design: "a
 * keyed draw... per courting year"), so a multi-year courtship can, in principle, see more than one
 * presentment, matching real manor-court recurrence rather than a one-shot check.
 */
export function shouldPresentLeyrwite(seed: string, personId: string, year: number, probability: number = LEYRWITE_PROBABILITY_PER_COURTING_YEAR.default): boolean {
  return keyedDraw(seed, personId, year, "leyrwite") < probability;
}

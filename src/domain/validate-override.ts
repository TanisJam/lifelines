import { candidateMatchesSubject, decisionSubject } from "./decision-id";
import { gatherCandidatesForYear } from "./simulate";
import type { Event, Override, Person } from "./types";

export type ValidationResult = { readonly ok: true } | { readonly ok: false; readonly error: string };

function ok(): ValidationResult {
  return { ok: true };
}

function err(message: string): ValidationResult {
  return { ok: false, error: message };
}

/**
 * Validates a generic override (decision 008) against the exact state it
 * would apply to — the snapshot restored at `year - 1`, i.e. exactly what
 * `forkWorld` uses. Per decision 008, this is the WHOLE validation rule:
 * "the decision exists in the base branch [at this state] and the option is
 * one of its options." Re-derives the same candidate set `simulate()` would
 * generate for that year (`gatherCandidatesForYear` — pure and
 * side-effect-free, no DecisionMaker calls) rather than hand-rolling
 * separate eligibility rules, so validation and simulation can never
 * disagree about what decisions exist.
 *
 * `year` is the target decision's own `DecisionRecord.year` — decision-identity capability: the
 * caller already knows it (it read the decision it's rewriting), so this never parses a year back
 * out of `override.decisionId` (see `decision-id.ts`). Matching against `gatherCandidatesForYear`'s
 * candidates uses `decisionSubject` plus `candidateMatchesSubject` (fixed after review, R3-001),
 * which works identically for a legacy year-embedded id (bare-personId or, for a paired kind like
 * `Y1`, pairKey-shaped) and a new ordinal one — the spec's legacy-id backward-compatibility
 * requirement.
 */
/**
 * `protagonistId`, when set, does two things (round 9, decision 034):
 *  - the protagonist's birth is immutable — a rewrite targeting a year before they were born is
 *    rejected outright, before even checking whether a decision exists there.
 *  - `gatherCandidatesForYear` is asked WITH the protagonist's extended catalog turned on, so a
 *    rewrite of a protagonist-only decision (C1, AP1, the lord's levy, ...) validates correctly.
 */
export function validateOverride(
  override: Override,
  people: Readonly<Record<string, Person>>,
  events: readonly Event[],
  year: number,
  seed: string,
  config: { readonly startYear: number; readonly endYear: number },
  protagonistId?: string,
): ValidationResult {
  if (year < config.startYear || year > config.endYear) {
    return err(`Decision year ${year} is outside this world's span (${config.startYear}-${config.endYear}).`);
  }

  if (protagonistId) {
    const protagonist = people[protagonistId];
    if (protagonist && year < protagonist.birthYear) {
      return err(`Year ${year} is before the protagonist's birth (${protagonist.birthYear}); their birth is immutable.`);
    }
  }

  const target = decisionSubject(override.decisionId);
  const candidates = gatherCandidatesForYear(year, people, events, seed, protagonistId);
  const decision = candidates.find((c) => c.kind === target.kind && candidateMatchesSubject(target.subject, c.personId, c.partnerId));
  if (!decision) {
    return err(`No such decision "${override.decisionId}" at year ${year} in this branch. It may target someone who is dead, not yet born, or otherwise ineligible, or the decision may not come up this year at all.`);
  }

  if (!decision.options.includes(override.optionId)) {
    return err(`"${override.optionId}" is not one of this decision's options: ${decision.options.join(", ")}.`);
  }

  return ok();
}

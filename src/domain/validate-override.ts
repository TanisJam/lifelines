import { decisionYear } from "./decisions";
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
 * would apply to — the snapshot restored at `decisionYear(override.decisionId) - 1`,
 * i.e. exactly what `forkWorld` uses. Per decision 008, this is the WHOLE
 * validation rule: "the decision exists in the base branch [at this state]
 * and the option is one of its options." Re-derives the same candidate set
 * `simulate()` would generate for that year (`gatherCandidatesForYear` —
 * pure and side-effect-free, no DecisionMaker calls) rather than
 * hand-rolling separate eligibility rules, so validation and simulation
 * can never disagree about what decisions exist.
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
  seed: string,
  config: { readonly startYear: number; readonly endYear: number },
  protagonistId?: string,
): ValidationResult {
  let year: number;
  try {
    year = decisionYear(override.decisionId);
  } catch {
    return err(`Malformed decision id: "${override.decisionId}".`);
  }

  if (year < config.startYear || year > config.endYear) {
    return err(`Decision year ${year} is outside this world's span (${config.startYear}-${config.endYear}).`);
  }

  if (protagonistId) {
    const protagonist = people[protagonistId];
    if (protagonist && year < protagonist.birthYear) {
      return err(`Year ${year} is before the protagonist's birth (${protagonist.birthYear}); their birth is immutable.`);
    }
  }

  const candidates = gatherCandidatesForYear(year, people, events, seed, protagonistId);
  const decision = candidates.find((c) => c.decisionId === override.decisionId);
  if (!decision) {
    return err(`No such decision "${override.decisionId}" at year ${year} in this branch. It may target someone who is dead, not yet born, or otherwise ineligible, or the decision may not come up this year at all.`);
  }

  if (!decision.options.includes(override.optionId)) {
    return err(`"${override.optionId}" is not one of this decision's options: ${decision.options.join(", ")}.`);
  }

  return ok();
}

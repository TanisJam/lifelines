/**
 * PR9 (right-censoring fix, engram #6142/#6311, sdd/engine-life-course): shared life-table
 * cohort-completeness helpers. Extracted out of `scripts/check-demographics.ts` so the exact
 * denominator rule has real unit coverage under `pnpm test` (the script itself is a dev tool, not
 * part of the required verification commands, and vitest only picks up `src/**\/*.test.ts`).
 *
 * The bug this fixes: a naive "count everyone whose outcome I can see" denominator counts a DEATH
 * from any birth cohort (dying is fast — the outcome is a fully-observed fact almost immediately),
 * but only counts a SURVIVOR once their birth cohort has already lived the full observation window
 * (surviving to age X takes X years to become a fact). In a population that isn't static — and
 * especially one where recent birth cohorts are the largest, which pre-plague growth implies —
 * that asymmetry structurally over-represents deaths and inflates every age-X death-share metric.
 *
 * The fix is the standard life-table remedy: restrict the denominator to birth cohorts whose
 * outcome (survived to age X, or died before it) is a SETTLED fact for every member by `endYear`,
 * i.e. `endYear - birthYear >= X`, applied uniformly to the living and the dead. A cohort younger
 * than that is dropped entirely — not "presumed to survive" (that would be right-censoring in the
 * other direction) and not "counted only if it happens to have already produced a death".
 */
export interface CohortMember {
  readonly birthYear: number;
  readonly deathYear?: number;
}

export interface CohortAgeShareResult {
  /** Cohort members whose outcome at the threshold age is a settled fact by `endYear`. */
  readonly resolved: number;
  /** Of `resolved`, how many died before the threshold age. */
  readonly deaths: number;
}

/**
 * Share of `members` who died before `ageThreshold`, restricted to birth cohorts fully observable
 * to that age by `endYear` (see module doc comment). Used for e.g. "died before 15".
 */
export function cohortDeathShareByAge(members: readonly CohortMember[], endYear: number, ageThreshold: number): CohortAgeShareResult {
  let resolved = 0;
  let deaths = 0;
  for (const member of members) {
    if (member.birthYear > endYear - ageThreshold) continue; // cohort not yet fully observable to ageThreshold
    resolved++;
    const ageAtDeath = member.deathYear !== undefined ? member.deathYear - member.birthYear : undefined;
    if (ageAtDeath !== undefined && ageAtDeath < ageThreshold) deaths++;
  }
  return { resolved, deaths };
}

/**
 * Conditional version: of `members` who survived to `surviveToAge` (excluding those who died
 * before it — never part of this conditional cohort), the share who then died by `thenByAge`.
 * Cohort completeness is still judged against the OUTER age (`thenByAge`), since that's the age at
 * which the conditional outcome itself becomes a settled fact. Used for e.g. "of those who survived
 * infancy (2), died by 7".
 */
export function cohortConditionalDeathShare(members: readonly CohortMember[], endYear: number, surviveToAge: number, thenByAge: number): CohortAgeShareResult {
  let resolved = 0;
  let deaths = 0;
  for (const member of members) {
    if (member.birthYear > endYear - thenByAge) continue; // cohort not yet fully observable to thenByAge
    const ageAtDeath = member.deathYear !== undefined ? member.deathYear - member.birthYear : undefined;
    if (ageAtDeath !== undefined && ageAtDeath < surviveToAge) continue; // did not survive to the conditioning age; not part of this conditional cohort
    resolved++;
    if (ageAtDeath !== undefined && ageAtDeath <= thenByAge) deaths++;
  }
  return { resolved, deaths };
}

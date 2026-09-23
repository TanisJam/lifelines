import { describe, expect, it } from "vitest";
import { cohortConditionalDeathShare, cohortDeathShareByAge } from "./cohort-stats";

describe("cohortDeathShareByAge", () => {
  it("excludes a living member whose birth cohort has not yet fully aged past the threshold", () => {
    // Born 5 years before endYear, still alive: at most 5 years old, so "did they die before 15"
    // is genuinely unresolved yet — must not be counted as a survivor OR a death.
    const members = [{ birthYear: 1355 }];
    const result = cohortDeathShareByAge(members, 1360, 15);
    expect(result.resolved).toBe(0);
    expect(result.deaths).toBe(0);
  });

  it("counts a death from an incompletely-observed cohort as a resolved death (it's a fully-observed fact even though the cohort isn't 15 yet)", () => {
    // Old buggy behavior counted this death but dropped same-cohort survivors, inflating the
    // share. The fixed cohort rule instead drops the WHOLE cohort (dead and alive) from the
    // denominator once it isn't old enough to be observed to the threshold age.
    const members = [{ birthYear: 1355, deathYear: 1357 }]; // died at age 2, cohort born 5yr before endYear
    const result = cohortDeathShareByAge(members, 1360, 15);
    expect(result.resolved).toBe(0);
    expect(result.deaths).toBe(0);
  });

  it("includes a fully-observable cohort member who survived", () => {
    const members = [{ birthYear: 1340 }]; // alive, 20 years old at endYear 1360 -- fully observed to 15
    const result = cohortDeathShareByAge(members, 1360, 15);
    expect(result.resolved).toBe(1);
    expect(result.deaths).toBe(0);
  });

  it("includes a fully-observable cohort member who died before the threshold", () => {
    const members = [{ birthYear: 1340, deathYear: 1348 }]; // died at age 8, cohort born 20yr before endYear
    const result = cohortDeathShareByAge(members, 1360, 15);
    expect(result.resolved).toBe(1);
    expect(result.deaths).toBe(1);
  });

  it("includes a fully-observable cohort member who died AFTER the threshold as a non-death (they made it)", () => {
    const members = [{ birthYear: 1340, deathYear: 1359 }]; // died at age 19
    const result = cohortDeathShareByAge(members, 1360, 15);
    expect(result.resolved).toBe(1);
    expect(result.deaths).toBe(0);
  });

  it("does not structurally inflate a death share when recent cohorts are the largest (regression for the PR9 censoring bug)", () => {
    // 10 people born long enough ago to be fully resolved to 15: half died young, half survived.
    const resolvedCohort = Array.from({ length: 10 }, (_, i) => ({
      birthYear: 1330,
      deathYear: i < 5 ? 1332 + i : undefined,
    }));
    // 20 people born in the last 5 years (unresolved to 15): only the ones who already died are
    // "observed" facts, and under the buggy rule they alone got counted, without their
    // not-yet-resolved cohort-mates -- inflating the share far past the resolved cohort's own 50%.
    const unresolvedCohort = [
      { birthYear: 1357, deathYear: 1358 }, // died at 1, real death but cohort unresolved
      ...Array.from({ length: 19 }, () => ({ birthYear: 1357 })), // alive, unresolved
    ];
    const result = cohortDeathShareByAge([...resolvedCohort, ...unresolvedCohort], 1360, 15);
    expect(result.resolved).toBe(10);
    expect(result.deaths).toBe(5);
    expect(result.deaths / result.resolved).toBe(0.5);
  });
});

describe("cohortConditionalDeathShare", () => {
  it("excludes a member who died before reaching the conditioning age (never survived infancy)", () => {
    const members = [{ birthYear: 1330, deathYear: 1331 }]; // died at age 1, never survived infancy (2)
    const result = cohortConditionalDeathShare(members, 1360, 2, 7);
    expect(result.resolved).toBe(0);
    expect(result.deaths).toBe(0);
  });

  it("excludes a living member from a birth cohort not yet fully observable to the outer age", () => {
    const members = [{ birthYear: 1356 }]; // alive, 4yo at endYear 1360 -- not yet observable to age 7
    const result = cohortConditionalDeathShare(members, 1360, 2, 7);
    expect(result.resolved).toBe(0);
  });

  it("counts a member who survived infancy and then died by the outer age", () => {
    const members = [{ birthYear: 1340, deathYear: 1345 }]; // died at age 5: survived infancy, died by 7
    const result = cohortConditionalDeathShare(members, 1360, 2, 7);
    expect(result.resolved).toBe(1);
    expect(result.deaths).toBe(1);
  });

  it("counts a member who survived infancy and lived past the outer age as a non-death", () => {
    const members = [{ birthYear: 1340 }]; // alive at 20, fully observed past 7
    const result = cohortConditionalDeathShare(members, 1360, 2, 7);
    expect(result.resolved).toBe(1);
    expect(result.deaths).toBe(0);
  });
});

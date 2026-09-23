import { describe, expect, it } from "vitest";
import { deathProbabilityAtAge } from "./actuarial";
import { MORTALITY_BY_AGE_BAND } from "./params/demography";

describe("deathProbabilityAtAge", () => {
  // PR9 (step 2, engram #6142/#6311): the age<2 band was still decision 050's Tudor figure (0.14,
  // ~15-17% infant mortality once the engine's own multipliers land) against a 14th-century target
  // of ~30% (params/targets.ts#CALIBRATION_TARGETS.infantMortality). Recalibrated to 0.30, sourced
  // in params/demography.ts#MORTALITY_BY_AGE_BAND / provenance.ts. Every OTHER band is left
  // untouched: under15DeathShare (the conditional age 2-7 death share) already met its own 20-30%
  // band under the Tudor child-mortality figures, so raising them too would risk overshooting an
  // already-passing target for no diagnosed reason.
  it("the infant/toddler band (age<2) is raised to the 14th-century target, not the old Tudor figure", () => {
    expect(deathProbabilityAtAge(0)).toBe(0.3);
    expect(deathProbabilityAtAge(1)).toBe(0.3);
  });

  it("the child bands (age 2-15) are unchanged from decision 050's Tudor figures", () => {
    expect(deathProbabilityAtAge(2)).toBe(0.065);
    expect(deathProbabilityAtAge(4)).toBe(0.065);
    expect(deathProbabilityAtAge(5)).toBe(0.027);
    expect(deathProbabilityAtAge(14)).toBe(0.027);
  });

  it("the adult and elderly bands are unchanged from decision 050's Tudor figures", () => {
    expect(deathProbabilityAtAge(15)).toBe(0.016);
    expect(deathProbabilityAtAge(39)).toBe(0.016);
    expect(deathProbabilityAtAge(40)).toBe(0.032);
    expect(deathProbabilityAtAge(59)).toBe(0.032);
    expect(deathProbabilityAtAge(60)).toBe(0.07);
    expect(deathProbabilityAtAge(74)).toBe(0.07);
    expect(deathProbabilityAtAge(75)).toBe(0.2);
    expect(deathProbabilityAtAge(89)).toBe(0.2);
    expect(deathProbabilityAtAge(90)).toBe(0.47);
    expect(deathProbabilityAtAge(120)).toBe(0.47);
  });

  it("reads from the shared, named MORTALITY_BY_AGE_BAND table, not an inline literal", () => {
    expect(MORTALITY_BY_AGE_BAND.find((b) => 0 < b.maxAge)?.hazard).toBe(deathProbabilityAtAge(0));
  });
});

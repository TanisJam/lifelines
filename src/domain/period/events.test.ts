import { describe, expect, it } from "vitest";
import {
  BLACK_DEATH_MORTALITY,
  BLACK_DEATH_YEARS,
  blackDeathMortalityForYear,
  DATED_NATIONAL_EVENTS,
  datedNationalEventTypesForYear,
  famineClaimedChildhood,
  famineDeathYear,
  FAMINE_COHORT_THINNING,
  FAMINE_WINDOW,
  isBornInFamineWindow,
  isHundredYearsWarLevyYear,
  MURRAIN_MARKER_CLASSES,
  MURRAIN_HUMAN_MULTIPLIER,
  MURRAIN_WINDOW,
  ORDINANCE_OF_LABOURERS_YEAR,
  SECOND_PESTILENCE_MORTALITY,
  SECOND_PESTILENCE_YEARS,
  secondPestilenceMortalityForYear,
  STATUTE_OF_LABOURERS_YEAR,
  survivedFamineAsChild,
} from "./events";

describe("PR5: Great Famine 1315-22 (pre-window backstory)", () => {
  it("only a birth within 1305-1322 is considered a famine-cohort birth", () => {
    expect(isBornInFamineWindow(FAMINE_WINDOW.start)).toBe(true);
    expect(isBornInFamineWindow(FAMINE_WINDOW.end)).toBe(true);
    expect(isBornInFamineWindow(FAMINE_WINDOW.start - 1)).toBe(false);
    expect(isBornInFamineWindow(FAMINE_WINDOW.end + 1)).toBe(false);
  });

  it("a birth outside the famine window is never claimed by it, regardless of seed", () => {
    expect(famineClaimedChildhood("any-seed", "p1", 1327)).toBe(false);
    expect(famineClaimedChildhood("any-seed", "p1", 1300)).toBe(false);
  });

  it("thins a rural famine-window birth cohort at close to the documented 12% rate, across many draws", () => {
    let claimed = 0;
    const trials = 2000;
    for (let i = 0; i < trials; i++) {
      if (famineClaimedChildhood("famine-thinning-seed", `p${i}`, 1318)) claimed++;
    }
    const rate = claimed / trials;
    expect(rate).toBeGreaterThan(FAMINE_COHORT_THINNING.rural - 0.04);
    expect(rate).toBeLessThan(FAMINE_COHORT_THINNING.rural + 0.04);
  });

  it("an urban famine-window birth is thinned at the higher documented rate", () => {
    let claimedUrban = 0;
    let claimedRural = 0;
    const trials = 2000;
    for (let i = 0; i < trials; i++) {
      if (famineClaimedChildhood("urban-thinning-seed", `u${i}`, 1318, true)) claimedUrban++;
      if (famineClaimedChildhood("urban-thinning-seed", `r${i}`, 1318, false)) claimedRural++;
    }
    expect(claimedUrban / trials).toBeGreaterThan(claimedRural / trials);
  });

  it("a famine-claimed death year always falls between birth and the end of the famine window", () => {
    for (let i = 0; i < 50; i++) {
      const birthYear = 1310 + (i % 12);
      const deathYear = famineDeathYear("death-year-seed", `p${i}`, birthYear);
      expect(deathYear).toBeGreaterThanOrEqual(birthYear);
      expect(deathYear).toBeLessThanOrEqual(FAMINE_WINDOW.end);
    }
  });

  it("is deterministic for the same seed/personId/birthYear", () => {
    expect(famineClaimedChildhood("det-seed", "p1", 1318)).toBe(famineClaimedChildhood("det-seed", "p1", 1318));
    expect(famineDeathYear("det-seed", "p1", 1318)).toBe(famineDeathYear("det-seed", "p1", 1318));
  });

  it("a founder born by 1310 is old enough to carry the survived-the-famine backstory marker (aged >=5 in 1315); one born later is not", () => {
    expect(survivedFamineAsChild(1310)).toBe(true);
    expect(survivedFamineAsChild(1305)).toBe(true);
    expect(survivedFamineAsChild(1311)).toBe(false);
  });
});

describe("PR5: cattle murrain 1319-21 (pre-window backstory)", () => {
  it("has no direct human-mortality effect (multiplier 1.0) — it acts on food, not people, per the design", () => {
    expect(MURRAIN_HUMAN_MULTIPLIER).toBe(1.0);
  });

  it("only villein/freeholder founder households are eligible for the backstory marker", () => {
    expect(MURRAIN_MARKER_CLASSES.has("villein")).toBe(true);
    expect(MURRAIN_MARKER_CLASSES.has("freeholder")).toBe(true);
    expect(MURRAIN_MARKER_CLASSES.has("cottar")).toBe(false);
    expect(MURRAIN_MARKER_CLASSES.has("gentry")).toBe(false);
  });

  it("the murrain window sits inside the famine window, 1319-21", () => {
    expect(MURRAIN_WINDOW.start).toBe(1319);
    expect(MURRAIN_WINDOW.end).toBe(1321);
  });
});

describe("PR5: Black Death 1348-49", () => {
  it("dates the Black Death to exactly 1348 and 1349, no other year", () => {
    expect(BLACK_DEATH_YEARS.has(1348)).toBe(true);
    expect(BLACK_DEATH_YEARS.has(1349)).toBe(true);
    expect(BLACK_DEATH_YEARS.has(1347)).toBe(false);
    expect(BLACK_DEATH_YEARS.has(1350)).toBe(false);
  });

  it("returns undefined outside 1348-49", () => {
    expect(blackDeathMortalityForYear(1347)).toBeUndefined();
    expect(blackDeathMortalityForYear(1350)).toBeUndefined();
  });

  it("splits the default 40% total mortality across the two years so the combined survival matches (1-M), per p_y=1-(1-M)^share", () => {
    const p1348 = blackDeathMortalityForYear(1348)!;
    const p1349 = blackDeathMortalityForYear(1349)!;
    expect(p1348).toBeGreaterThan(0);
    expect(p1349).toBeGreaterThan(0);
    const combinedSurvival = (1 - p1348) * (1 - p1349);
    expect(combinedSurvival).toBeCloseTo(1 - BLACK_DEATH_MORTALITY.default, 5);
  });

  it("honors a documented, caller-supplied total mortality within the 20-62.5% range, not just the default", () => {
    const low = blackDeathMortalityForYear(1348, BLACK_DEATH_MORTALITY.min)!;
    const high = blackDeathMortalityForYear(1348, BLACK_DEATH_MORTALITY.max)!;
    expect(high).toBeGreaterThan(low);
  });
});

describe("PR5: second pestilence 1361-62 (child-skewed)", () => {
  it("dates the second pestilence to exactly 1361 and 1362", () => {
    expect(SECOND_PESTILENCE_YEARS.has(1361)).toBe(true);
    expect(SECOND_PESTILENCE_YEARS.has(1362)).toBe(true);
    expect(SECOND_PESTILENCE_YEARS.has(1360)).toBe(false);
    expect(SECOND_PESTILENCE_YEARS.has(1363)).toBe(false);
  });

  it("returns undefined outside 1361-62", () => {
    expect(secondPestilenceMortalityForYear(1360, 8)).toBeUndefined();
    expect(secondPestilenceMortalityForYear(1363, 8)).toBeUndefined();
  });

  it("skews mortality toward children: a child's per-year risk exceeds an adult's, in both dated years", () => {
    for (const year of [1361, 1362]) {
      const child = secondPestilenceMortalityForYear(year, 8)!;
      const adult = secondPestilenceMortalityForYear(year, 35)!;
      expect(child).toBeGreaterThan(adult);
    }
  });

  it("the child rate is close to the documented ~0.22 total across the two years", () => {
    const p1 = secondPestilenceMortalityForYear(1361, 8)!;
    const p2 = secondPestilenceMortalityForYear(1362, 8)!;
    const combinedSurvival = (1 - p1) * (1 - p2);
    expect(combinedSurvival).toBeCloseTo(1 - SECOND_PESTILENCE_MORTALITY.child, 5);
  });
});

describe("PR5: Hundred Years' War levies, Ordinance and Statute of Labourers", () => {
  it("the levy taxation spike runs 1337-47 inclusive, and no other year", () => {
    expect(isHundredYearsWarLevyYear(1337)).toBe(true);
    expect(isHundredYearsWarLevyYear(1347)).toBe(true);
    expect(isHundredYearsWarLevyYear(1342)).toBe(true);
    expect(isHundredYearsWarLevyYear(1336)).toBe(false);
    expect(isHundredYearsWarLevyYear(1348)).toBe(false);
  });

  it("Ordinance 1349 and Statute 1351 are dated exactly once each, and the whole list fires only at its own year", () => {
    expect(ORDINANCE_OF_LABOURERS_YEAR).toBe(1349);
    expect(STATUTE_OF_LABOURERS_YEAR).toBe(1351);
    for (const entry of DATED_NATIONAL_EVENTS) {
      expect(datedNationalEventTypesForYear(entry.year)).toContain(entry.type);
    }
    expect(datedNationalEventTypesForYear(1338)).toEqual([]);
  });
});

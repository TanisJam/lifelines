import { describe, expect, it } from "vitest";
import { createMind } from "../mind";
import type { Person, SimulationResult, SocialClass } from "../types";
import { SOCIAL_CLASS_POOL } from "../types";
import { CLASS_LABEL_EN, CLASS_LABEL_ES, mapLegacyClass, remapLegacyClasses } from "./classes";

function person(overrides: Partial<Person> & Pick<Person, "id" | "sex">): Person {
  const birthYear = overrides.birthYear ?? 1500;
  return { name: overrides.id, birthYear, traits: [], job: "none", founder: true, mind: createMind("period-classes-test", overrides.id, birthYear), ...overrides };
}

describe("decision 063 (engine-life-course PR4): legacy class mapping", () => {
  it("maps each retired Tudor-era class 1:1 to its period equivalent", () => {
    expect(mapLegacyClass("labourer")).toBe("cottar");
    expect(mapLegacyClass("husbandman")).toBe("villein");
    expect(mapLegacyClass("yeoman")).toBe("freeholder");
  });

  it("passes an already-current period class through unchanged", () => {
    for (const cls of SOCIAL_CLASS_POOL) expect(mapLegacyClass(cls)).toBe(cls);
  });

  it("returns undefined for an unrecognized or missing value, never throwing", () => {
    expect(mapLegacyClass(undefined)).toBeUndefined();
    expect(mapLegacyClass("not-a-real-class")).toBeUndefined();
  });
});

describe("remapLegacyClasses: read-time-only, no storage mutation", () => {
  it("maps a legacy husbandman to villein without mutating the input object", () => {
    const original: SimulationResult = {
      config: { seed: "s", startYear: 1500, endYear: 1520, town: { name: "t" } },
      people: { p1: person({ id: "p1", sex: "m", socialClass: "husbandman" as SocialClass }) },
      events: [],
      decisions: [],
    };
    const frozenSnapshot = JSON.parse(JSON.stringify(original)) as SimulationResult;

    const mapped = remapLegacyClasses(original);

    expect(mapped.people.p1!.socialClass).toBe("villein");
    // The input SimulationResult (what a caller might still hold, e.g. before re-persisting) is
    // never touched — this is a read-time projection, not an in-place migration.
    expect(original).toEqual(frozenSnapshot);
  });

  it("returns the exact same object reference when every class is already current (no legacy values present)", () => {
    const result: SimulationResult = {
      config: { seed: "s", startYear: 1500, endYear: 1520, town: { name: "t" } },
      people: { p1: person({ id: "p1", sex: "m", socialClass: "villein" }) },
      events: [],
      decisions: [],
    };
    expect(remapLegacyClasses(result)).toBe(result);
  });
});

describe("decision 063: period class labels, en/es key parity", () => {
  it("en and es expose exactly the classes in SOCIAL_CLASS_POOL, nothing more or less", () => {
    expect(Object.keys(CLASS_LABEL_EN).sort()).toEqual([...SOCIAL_CLASS_POOL].sort());
    expect(Object.keys(CLASS_LABEL_ES).sort()).toEqual([...SOCIAL_CLASS_POOL].sort());
  });

  it("every label in both locales is a non-empty string", () => {
    for (const cls of SOCIAL_CLASS_POOL) {
      expect(typeof CLASS_LABEL_EN[cls]).toBe("string");
      expect(CLASS_LABEL_EN[cls].length).toBeGreaterThan(0);
      expect(typeof CLASS_LABEL_ES[cls]).toBe("string");
      expect(CLASS_LABEL_ES[cls].length).toBeGreaterThan(0);
    }
  });
});

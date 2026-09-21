import { describe, expect, it } from "vitest";
import { createMind } from "@/domain/mind";
import type { Event, Person } from "@/domain/types";
import { causeNounPhrase } from "./chronicle-data";

function makePerson(id: string, overrides: Partial<Person> = {}): Person {
  const birthYear = overrides.birthYear ?? 1470;
  const mind = createMind("seed-1", id, birthYear);
  return { id, name: `Person ${id}`, sex: "f", birthYear, traits: [], job: "farmer", founder: true, mind, ...overrides };
}

describe("round 8 fix: causal annotations are noun phrases, not re-rendered titles (decision 033)", () => {
  it("builds a proper noun phrase with the OTHER person's real name and the viewer's own pronoun", () => {
    const viewer = makePerson("p001", { sex: "f" });
    const other = makePerson("p002", { sex: "m" });
    const people = { p001: viewer, p002: other };
    const romance: Event = { id: "e1", year: 1506, kind: "romance", actors: ["p001", "p002"], payload: {}, causes: [] };
    expect(causeNounPhrase(romance, "p001", people)).toBe("her courtship with Person p002");

    const breakup: Event = { id: "e2", year: 1509, kind: "breakup", actors: ["p001", "p002"], payload: {}, causes: [] };
    expect(causeNounPhrase(breakup, "p001", people)).toBe("her breakup with Person p002");
  });

  it("uses the viewer's own pronoun for a single-actor cause (illness, breakdown, job)", () => {
    const man = makePerson("p003", { sex: "m" });
    const people = { p003: man };
    const illness: Event = { id: "e1", year: 1520, kind: "illness", actors: ["p003"], payload: {}, causes: [] };
    expect(causeNounPhrase(illness, "p003", people)).toBe("his illness");
  });

  it("an event kind with no noun-phrase mapping (e.g. 'child', always same-year as its birth) returns null, so the caller's filter drops it", () => {
    // The OTHER half of the drop rule — same-year causes being dropped — lives in
    // `getChronicleData`'s `.filter((causeEvent) => causeEvent.year < t.event.year)`, which needs
    // a full branch/world fixture to exercise and isn't duplicated here.
    const person = makePerson("p004");
    const child: Event = { id: "e1", year: 1517, kind: "child", actors: ["p004"], payload: {}, causes: [] };
    expect(causeNounPhrase(child, "p004", { p004: person })).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { storyCircle } from "./story-circle";
import type { Event, Person } from "./types";

function person(id: string, extra: Partial<Person> = {}): Person {
  return { id, name: id, sex: "f", birthYear: 1300, ...extra } as Person;
}

function event(kind: Event["kind"], year: number, actors: string[]): Event {
  return { id: `${kind}-${actors.join("-")}-${year}`, year, kind, actors, payload: {}, causes: [] } as Event;
}

describe("storyCircle (decision 084)", () => {
  const people: Record<string, Person> = {
    protagonist: person("protagonist", { motherId: "mum", fatherId: "dad", spouseId: "husband" }),
    mum: person("mum"),
    dad: person("dad", { sex: "m" }),
    husband: person("husband", { sex: "m", spouseId: "protagonist" }),
    brother: person("brother", { sex: "m", motherId: "mum", fatherId: "dad" }),
    daughter: person("daughter", { motherId: "protagonist", fatherId: "husband" }),
    suitor: person("suitor", { sex: "m" }),
    rival: person("rival"),
    stranger: person("stranger"),
  };
  const events: Event[] = [event("romance", 1340, ["protagonist", "suitor"]), event("feud", 1341, ["rival", "protagonist"])];

  it("holds the protagonist, spouse, parents, siblings, children, open romances and feuds", () => {
    const circle = storyCircle("protagonist", people, events);
    expect([...circle].sort()).toEqual(["brother", "dad", "daughter", "husband", "mum", "protagonist", "rival", "suitor"]);
  });

  it("leaves out villagers with no tie to the protagonist", () => {
    expect(storyCircle("protagonist", people, events).has("stranger")).toBe(false);
  });

  it("is empty when there is no protagonist", () => {
    expect(storyCircle(undefined, people, events).size).toBe(0);
  });
});

import { describe, expect, it } from "vitest";
import type { LifeScene, ScenePerson } from "@/contracts/life";
import { ageAt, relationOrdinal, starFacts } from "./star-facts";

const person = (id: string, over: Partial<ScenePerson>): ScenePerson => ({ id, name: id, sex: "f", relCode: "friend", group: "others", born: 1500, appearsAt: 1500, ...over });
const scene: LifeScene = {
  people: [
    person("self", { relCode: "self", group: "self", born: 1490, appearsAt: 1490.3, diedAt: 1550.5 }),
    person("mum", { relCode: "parent", group: "parents", diedAt: 1520 }),
    person("h1", { relCode: "spouse", group: "spouses", sex: "m", appearsAt: 1510 }),
    person("h2", { relCode: "spouse", group: "spouses", sex: "m", appearsAt: 1530 }),
    person("pal", {}),
  ],
  edges: [{ a: "self", b: "pal", kind: "rival", fromAt: 1505, untilAt: 1520 }],
  village: [],
  bands: [],
  span: { start: 1490.3, end: 1550.6 },
};
const by = (id: string) => scene.people.find((p) => p.id === id)!;

describe("ageAt", () => {
  it("counts whole years from the start of the life while the protagonist lives", () => {
    expect(ageAt(scene, 1490.3)).toEqual({ age: 0, alive: true });
    expect(ageAt(scene, 1520.4)).toEqual({ age: 30, alive: true });
  });

  it("freezes at the age of death once the protagonist has died", () => {
    expect(ageAt(scene, 1560)).toEqual({ age: 60, alive: false });
  });
});

describe("starFacts", () => {
  it("reports the protagonist's age, then that the life is written", () => {
    expect(starFacts(scene, by("self"), 1500)).toMatchObject({ status: "age", age: 9, born: 1490 });
    expect(starFacts(scene, by("self"), 1551)).toMatchObject({ status: "written", died: 1550 });
  });

  it("tells the circle from the outside, living from dead", () => {
    expect(starFacts(scene, by("mum"), 1510).status).toBe("circle");
    expect(starFacts(scene, by("mum"), 1521)).toMatchObject({ status: "deadFamily", died: 1520 });
    expect(starFacts(scene, by("pal"), 1510).status).toBe("circle");
    expect(starFacts(scene, by("pal"), 1525).status).toBe("outside");
  });
});

describe("relationOrdinal", () => {
  it("numbers same-code people by arrival", () => {
    expect(relationOrdinal(scene, by("h1"))).toEqual({ nth: 1, of: 2 });
    expect(relationOrdinal(scene, by("h2"))).toEqual({ nth: 2, of: 2 });
    expect(relationOrdinal(scene, by("pal"))).toEqual({ nth: 1, of: 1 });
  });
});

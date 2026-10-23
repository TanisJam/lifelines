import { describe, expect, it } from "vitest";
import type { LifeScene, ScenePerson } from "@/contracts/life";
import { en } from "@/i18n/dictionaries/en";
import { es } from "@/i18n/dictionaries/es";
import { describeStar, relationLabel } from "./describe-star";
import { elinScene } from "./fixture-scene";

const scene = elinScene();
const by = (id: string) => scene.people.find((p) => p.id === id)!;

const participants: readonly ScenePerson[] = [
  { id: "participant-f", name: "Ada", sex: "f", relCode: "participant", group: "others", born: 1480, appearsAt: 1500, diedAt: 1520.5 },
  { id: "participant-m", name: "Robin", sex: "m", relCode: "participant", group: "others", born: 1482, appearsAt: 1501 },
];
const participantScene: LifeScene = { ...scene, people: [...scene.people, ...participants] };

const locales = [
  { locale: "en", sky: en.sky, label: "participant", born: "born 1480", outside: "Outside her story circle now" },
  { locale: "es", sky: es.sky, label: "participante", born: "nació en 1480", outside: "Fuera de su círculo de historia por ahora" },
];

describe("neutral participant text", () => {
  it.each(locales)("labels both sexes without ordinals in $locale", ({ sky, label }) => {
    for (const participant of participants) {
      expect(relationLabel(sky, participantScene, participant)).toBe(label);
    }
  });

  it.each(locales)("preserves names and lifespan facts without invented bonds in $locale", ({ sky, label, born, outside }) => {
    const participant = participants[0]!;
    expect(describeStar(sky, participantScene, "f", participant, 1505)).toEqual({
      rel: label, name: "Ada", sub: `${born}. ${outside}.`,
    });
    expect(describeStar(sky, participantScene, "f", participant, 1521)).toEqual({
      rel: label, name: "Ada", sub: `1480–1520. ${outside}.`,
    });
    expect(describeStar(sky, participantScene, "m", participants[1]!, 1505)).toEqual({
      rel: label, name: "Robin",
      sub: sky === en.sky ? "born 1482. Outside his story circle now." : "nació en 1482. Fuera de su círculo de historia por ahora.",
    });
  });

  it("keeps spouse ordinals and family/friend labels unchanged", () => {
    const husband = by("tomas");
    const second: ScenePerson = { ...husband, id: "second-spouse", appearsAt: husband.appearsAt + 1 };
    const friend: ScenePerson = { ...participants[0]!, id: "friend", relCode: "friend" };
    const withRelations: LifeScene = { ...participantScene, people: [...participantScene.people, second, friend] };
    expect(relationLabel(en.sky, withRelations, second)).toBe("second husband");
    // Preserve the current Spanish ordinal spelling; this unit does not change spouse copy.
    expect(relationLabel(es.sky, withRelations, second)).toBe("segunda esposo");
    expect(relationLabel(en.sky, withRelations, by("joren"))).toBe("father");
    expect(relationLabel(es.sky, withRelations, by("joren"))).toBe("padre");
    expect(relationLabel(en.sky, withRelations, friend)).toBe("friend");
    expect(relationLabel(es.sky, withRelations, friend)).toBe("amiga");
  });
});

describe("describeStar", () => {
  it("names the relation, the years and where the person stands, in English", () => {
    expect(describeStar(en.sky, scene, "f", by("joren"), 1500)).toEqual({ rel: "father", name: by("joren").name, sub: "born 1462. In her story circle." });
    expect(describeStar(en.sky, scene, "f", by("joren"), 1540).sub).toMatch(/^1462–1535\. Dead, still family\.$/);
  });

  it("reports the protagonist's age and speaks Spanish when asked", () => {
    expect(describeStar(en.sky, scene, "f", by("protagonist"), 1500.5).sub).toBe("born 1490. Age 10.");
    expect(describeStar(es.sky, scene, "f", by("protagonist"), 1500.5).sub).toBe("nació en 1490. 10 años.");
    expect(relationLabel(es.sky, scene, by("tomas"))).toBe("esposo");
  });
});

import { describe, expect, it } from "vitest";
import { en } from "@/i18n/dictionaries/en";
import { es } from "@/i18n/dictionaries/es";
import { describeStar, relationLabel } from "./describe-star";
import { elinScene } from "./fixture-scene";

const scene = elinScene();
const by = (id: string) => scene.people.find((p) => p.id === id)!;

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

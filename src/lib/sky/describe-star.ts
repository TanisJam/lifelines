import type { LifeScene, LifeSex, ScenePerson } from "@/contracts/life";
import type { Dictionary } from "@/i18n/dictionary";
import { relationOrdinal, starFacts } from "./star-facts";

export interface StarText {
  /** "second husband" */
  readonly rel: string;
  readonly name: string;
  /** "born 1508. In her story circle." */
  readonly sub: string;
}

export const relationLabel = (sky: Dictionary["sky"], scene: LifeScene, person: ScenePerson): string => {
  const { nth, of } = relationOrdinal(scene, person);
  return sky.relation(person.relCode, person.sex, nth, of);
};

/** The words of a star's tooltip at time `t`, in the reader's language. `protagonistSex` gives "her"/"his" in the status line. */
export function describeStar(sky: Dictionary["sky"], scene: LifeScene, protagonistSex: LifeSex, person: ScenePerson, t: number): StarText {
  const facts = starFacts(scene, person, t);
  const life = facts.died === undefined ? sky.tip.born(facts.born) : sky.tip.lived(facts.born, facts.died);
  return { rel: relationLabel(sky, scene, person), name: person.name, sub: `${life}. ${sky.tip.status(facts.status, protagonistSex, facts.age)}.` };
}

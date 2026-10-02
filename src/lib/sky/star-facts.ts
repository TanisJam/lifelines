import type { LifeScene, ScenePerson } from "@/contracts/life";
import { alive, inCircle } from "./presence";

export type StarStatus = "age" | "written" | "circle" | "deadFamily" | "outside";

export interface StarFacts {
  readonly born: number;
  /** Calendar year of death, once dead. */
  readonly died?: number;
  readonly status: StarStatus;
  /** Whole years, for the protagonist while alive. */
  readonly age: number;
}

const selfOf = (scene: LifeScene): ScenePerson | undefined => scene.people.find((p) => p.group === "self");

/** The protagonist's age at `t`, counted from the start of the span; frozen at death. */
export function ageAt(scene: LifeScene, t: number): { age: number; alive: boolean } {
  const self = selfOf(scene);
  const living = self === undefined || alive(self, t);
  const until = living || self?.diedAt === undefined ? t : self.diedAt;
  return { age: Math.max(0, Math.floor(until - scene.span.start)), alive: living };
}

/** What a star's tooltip says about a person at `t`. */
export function starFacts(scene: LifeScene, person: ScenePerson, t: number): StarFacts {
  const living = alive(person, t);
  const base = { born: person.born, ...(living ? {} : { died: Math.floor(person.diedAt!) }), age: ageAt(scene, t).age };
  if (person.group === "self") return { ...base, status: living ? "age" : "written" };
  if (!inCircle(scene, person, t)) return { ...base, status: "outside" };
  return { ...base, status: living ? "circle" : "deadFamily" };
}

/** Position of a person among those sharing their relation code (by arrival): "second husband" needs 2 of 2. */
export function relationOrdinal(scene: LifeScene, person: ScenePerson): { nth: number; of: number } {
  const same = scene.people.filter((p) => p.relCode === person.relCode).sort((a, b) => a.appearsAt - b.appearsAt || (a.id < b.id ? -1 : 1));
  return { nth: same.findIndex((p) => p.id === person.id) + 1, of: same.length };
}

import type { LifeScene } from "@/contracts/life";
import { edgeKey } from "./layout";
import { growth } from "./presence";

export interface FocusSet {
  /** Keys of the bonds to light. */
  readonly edges: ReadonlySet<string>;
  /** People to keep bright; everyone else dims. */
  readonly people: ReadonlySet<string>;
  /** The one star to enlarge, when the focus is a single person. */
  readonly focal: string | null;
}

/**
 * What lights up when a star (`"star"`: all its bonds and the people on them) or a chronicle entry
 * (`"entry"`: the bonds among the people it names) takes focus. Only bonds already drawn at `t` count.
 */
export function focusSet(scene: LifeScene, ids: readonly string[], t: number, mode: "star" | "entry"): FocusSet {
  const edges = new Set<string>();
  const people = new Set(ids);
  for (const e of scene.edges) {
    const touches = ids.includes(e.a) || ids.includes(e.b);
    if (!touches || growth(e, t) <= 0) continue;
    if (mode === "entry" && !(ids.length === 1 || (ids.includes(e.a) && ids.includes(e.b)))) continue;
    edges.add(edgeKey(e));
    if (mode === "star") {
      people.add(e.a);
      people.add(e.b);
    }
  }
  return { edges, people, focal: ids.length === 1 ? ids[0]! : null };
}

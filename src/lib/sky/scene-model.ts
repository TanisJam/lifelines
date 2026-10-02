import type { LifeScene } from "@/contracts/life";
import { plagueIntensity } from "./dial";
import { edgeKey, positionAt, type Layout } from "./layout";
import { clamp01, type Vec } from "./motion";
import { alive, circleCount, edgeActive, formerOpacity, growth, inCircle, presence, soulsAlive } from "./presence";

export { timeline } from "./dial";

export interface PersonFrame {
  readonly id: string;
  readonly presence: number;
  readonly pos: Vec;
  readonly alive: boolean;
  readonly inCircle: boolean;
  /** Dims over the last stretch before a death. */
  readonly coreOpacity: number;
}

export interface EdgeFrame {
  readonly key: string;
  readonly growth: number;
  readonly active: boolean;
  readonly opacity: number;
  readonly former: boolean;
}

export interface Frame {
  readonly t: number;
  readonly people: readonly PersonFrame[];
  readonly edges: readonly EdgeFrame[];
  readonly souls: number;
  readonly circle: number;
  readonly plague: number;
}

/**
 * Everything the scene shows at time `t`, as a pure function of (scene, layout, t). Play history never
 * enters, so forward play, a jump and a backward scrub converge on the same frame. Real-time ambient
 * layers (sparks, floating, flicker) are drawn on top and are not part of it.
 */
export function frameAt(scene: LifeScene, layout: Layout, t: number): Frame {
  const start = scene.span.start;
  const people: PersonFrame[] = [];
  for (const p of scene.people) {
    const pres = presence(p, t, start);
    const pos = positionAt(layout, p.id, pres);
    if (!pos || pres <= 0) continue;
    const living = alive(p, t);
    let coreOpacity = 1;
    if (p.diedAt !== undefined && living) {
      const window = Math.min(0.55, p.diedAt - p.appearsAt);
      coreOpacity = 1 - 0.55 * clamp01((t - (p.diedAt - window)) / window);
    }
    people.push({ id: p.id, presence: pres, pos, alive: living, inCircle: inCircle(scene, p, t), coreOpacity });
  }
  const byId = new Map(people.map((p) => [p.id, p]));
  const edges: EdgeFrame[] = [];
  for (const e of scene.edges) {
    const g = growth(e, t);
    const a = byId.get(e.a);
    const b = byId.get(e.b);
    if (g <= 0 || !a || !b) continue;
    // A parent bond between two who have both died stays on the sky, but half as bright.
    const opacity = e.kind === "parent" && !a.alive && !b.alive ? Math.min(0.5, formerOpacity(e, t)) : formerOpacity(e, t);
    edges.push({ key: edgeKey(e), growth: g, active: edgeActive(e, t), opacity, former: e.untilAt !== undefined && t > e.untilAt });
  }
  return { t, people, edges, souls: soulsAlive(scene.village, t), circle: circleCount(scene, t), plague: plagueIntensity(scene.bands, t) };
}

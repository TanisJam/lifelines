import type { LifeScene, SceneEdge, ScenePerson } from "@/contracts/life";
import { GROUP_RADIUS, OUTER_STEP, R1, R2, SECTORS } from "./constants";
import { polar, quad, control, paramAt, sideFor, travel, type Side, type Vec } from "./motion";
import { villageSpot } from "./village";

export interface Layout {
  /** Resting place of every person. */
  readonly homes: ReadonlyMap<string, Vec>;
  /** Where each newcomer sets out from: a parent already in the sky, else a village spot. */
  readonly origins: ReadonlyMap<string, Vec>;
  readonly arriveSides: ReadonlyMap<string, Side>;
  readonly edgeSides: ReadonlyMap<string, Side>;
}

export const edgeKey = (e: SceneEdge): string => `${e.kind}:${e.a}>${e.b}@${e.fromAt}`;

/** Radical inverse in base 2 of n >= 1: 0.5, 0.25, 0.75, 0.125 ... so slots bisect the sector and appending never moves an earlier one. */
export function vanDerCorput(n: number): number {
  let result = 0;
  let f = 0.5;
  for (let i = n; i > 0; i = Math.floor(i / 2), f /= 2) result += f * (i % 2);
  return result;
}

const byAppearance = (a: ScenePerson, b: ScenePerson): number => a.appearsAt - b.appearsAt || a.born - b.born || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Stable placement: every group owns a sector, members take Van der Corput slots in order of
 * (appearsAt, born, id), and the outer ring hangs from its anchor child. A later scene only ever
 * appends slots, so the same algorithm serves live ticks and the finished life without relayout.
 */
export function computeLayout(scene: LifeScene): Layout {
  const homes = new Map<string, Vec>();
  const angles = new Map<string, number>();
  const sorted = [...scene.people].sort(byAppearance);

  for (const person of sorted) if (person.group === "self") homes.set(person.id, [0, 0]);
  for (const [group, [a0, a1]] of Object.entries(SECTORS)) {
    sorted
      .filter((p) => p.group === group)
      .forEach((p, i) => {
        const angle = a0 + (a1 - a0) * vanDerCorput(i + 1);
        angles.set(p.id, angle);
        homes.set(p.id, polar(angle, GROUP_RADIUS[group as keyof typeof GROUP_RADIUS] ?? R1));
      });
  }
  const seenAnchors = new Map<string, number>();
  for (const p of sorted.filter((q) => q.group === "outer")) {
    const anchorAngle = p.anchor === undefined ? undefined : angles.get(p.anchor);
    if (anchorAngle === undefined) continue;
    const i = seenAnchors.get(p.anchor!) ?? 0;
    seenAnchors.set(p.anchor!, i + 1);
    const offset = (i % 2 === 0 ? -1 : 1) * OUTER_STEP * (Math.floor(i / 2) + 1);
    homes.set(p.id, polar(anchorAngle + offset, R2));
  }

  const origins = new Map<string, Vec>();
  const arriveSides = new Map<string, Side>();
  const appearsAt = new Map(scene.people.map((p) => [p.id, p.appearsAt]));
  for (const p of sorted) {
    const home = homes.get(p.id);
    if (!home) continue;
    const parent = scene.edges.find((e) => e.kind === "parent" && e.b === p.id && homes.has(e.a) && (appearsAt.get(e.a) ?? Infinity) < p.appearsAt);
    const origin = parent ? homes.get(parent.a)! : villageSpot(p.id);
    origins.set(p.id, origin);
    arriveSides.set(p.id, sideFor(origin, home));
  }

  const edgeSides = new Map<string, Side>();
  for (const e of scene.edges) {
    const a = homes.get(e.a);
    const b = homes.get(e.b);
    if (a && b) edgeSides.set(edgeKey(e), sideFor(a, b));
  }
  return { homes, origins, arriveSides, edgeSides };
}

/** Where a person is at presence `pres`: flying in along an arc-length-constant curve, then at rest. */
export function positionAt(layout: Layout, id: string, pres: number): Vec | undefined {
  const home = layout.homes.get(id);
  if (!home) return undefined;
  if (pres >= 1) return home;
  const origin = layout.origins.get(id)!;
  const c = control(origin, home, 0.22, layout.arriveSides.get(id)!);
  return quad(origin, c, home, paramAt(origin, c, home, travel(pres)));
}

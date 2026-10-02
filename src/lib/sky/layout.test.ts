import { describe, expect, it } from "vitest";
import type { LifeScene } from "@/contracts/life";
import { elinScene } from "./fixture-scene";
import { computeLayout, edgeKey, vanDerCorput } from "./layout";
import { R1 } from "./constants";

/** The scene as a tick would have shown it: only what has appeared by `t`. */
function sceneAt(scene: LifeScene, t: number): LifeScene {
  const people = scene.people.filter((p) => p.appearsAt <= t);
  const ids = new Set(people.map((p) => p.id));
  return { ...scene, people, edges: scene.edges.filter((e) => ids.has(e.a) && ids.has(e.b)) };
}

describe("vanDerCorput", () => {
  it("fills (0,1) by bisection", () => {
    expect([1, 2, 3, 4].map(vanDerCorput)).toEqual([0.5, 0.25, 0.75, 0.125]);
  });
});

describe("computeLayout", () => {
  const scene = elinScene();

  it("puts the protagonist at the centre and family on the inner ring", () => {
    const layout = computeLayout(scene);
    expect(layout.homes.get("protagonist")).toEqual([0, 0]);
    const [x, y] = layout.homes.get("petra")!;
    expect(Math.hypot(x, y)).toBeCloseTo(R1, 6);
  });

  it("never moves existing stars when a later person appears", () => {
    const full = computeLayout(scene);
    for (const t of [1495, 1510, 1521, 1527, 1531]) {
      const partial = computeLayout(sceneAt(scene, t));
      for (const [id, home] of partial.homes) expect(full.homes.get(id)).toEqual(home);
      for (const [id, side] of partial.arriveSides) expect(full.arriveSides.get(id)).toBe(side);
    }
  });

  it("is independent of the order the people arrive in the array", () => {
    const shuffled: LifeScene = { ...scene, people: [...scene.people].reverse() };
    expect(computeLayout(shuffled).homes).toEqual(computeLayout(scene).homes);
  });

  it("fixes each edge's bow side from the homes", () => {
    const layout = computeLayout(scene);
    for (const e of scene.edges) expect([1, -1]).toContain(layout.edgeSides.get(edgeKey(e)));
  });

  it("starts a newcomer from a parent already shown, else from a village spot", () => {
    const layout = computeLayout(scene);
    expect(layout.origins.get("wren")).toEqual(layout.homes.get("protagonist"));
    expect(layout.origins.get("margit")).toBeDefined();
  });
});

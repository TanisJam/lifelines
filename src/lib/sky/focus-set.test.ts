import { describe, expect, it } from "vitest";
import type { LifeScene, SceneEdge } from "@/contracts/life";
import { edgeKey } from "./layout";
import { focusSet } from "./focus-set";

const edge = (a: string, b: string, fromAt: number | null, kind: SceneEdge["kind"] = "friend"): SceneEdge => ({ a, b, kind, fromAt });
const e1 = edge("a", "b", 1500);
const e2 = edge("b", "c", 1500);
const e3 = edge("a", "c", 1520);
const scene = { people: [], edges: [e1, e2, e3], village: [], bands: [], span: { start: 1490, end: 1560 } } as unknown as LifeScene;

describe("focusSet", () => {
  it("a star lights every bond already drawn that touches it, and the people at their far ends", () => {
    const f = focusSet(scene, ["a"], 1510, "star");
    expect([...f.edges]).toEqual([edgeKey(e1)]);
    expect([...f.people].sort()).toEqual(["a", "b"]);
    expect(f.focal).toBe("a");
  });

  it("bonds not yet grown do not light", () => {
    expect(focusSet(scene, ["a"], 1519, "star").edges.has(edgeKey(e3))).toBe(false);
    expect(focusSet(scene, ["a"], 1525, "star").edges.has(edgeKey(e3))).toBe(true);
  });

  it("an entry lights only bonds between the people it names (a lone person lights their own)", () => {
    const pair = focusSet(scene, ["a", "b"], 1530, "entry");
    expect([...pair.edges]).toEqual([edgeKey(e1)]);
    expect([...pair.people].sort()).toEqual(["a", "b"]);
    expect(pair.focal).toBeNull();
    expect(focusSet(scene, ["a"], 1530, "entry").edges.size).toBe(2);
  });
});

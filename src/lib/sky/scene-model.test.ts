import { describe, expect, it } from "vitest";
import type { LifeScene, ScenePerson } from "@/contracts/life";
import { computeLayout } from "./layout";
import { frameAt } from "./scene-model";

const person = (id: string, over: Partial<ScenePerson>): ScenePerson => ({ id, name: id, sex: "f", relCode: "parent", group: "parents", born: 1450, appearsAt: 1490, ...over });
const scene: LifeScene = {
  people: [person("self", { relCode: "self", group: "self", diedAt: 1530 }), person("mum", { diedAt: 1500 }), person("dad", { sex: "m", diedAt: 1510 })],
  edges: [
    { a: "mum", b: "self", kind: "parent", fromAt: null },
    { a: "dad", b: "self", kind: "parent", fromAt: null },
    { a: "mum", b: "dad", kind: "spouse", fromAt: null },
  ],
  village: [],
  bands: [],
  span: { start: 1490, end: 1560 },
};
const layout = computeLayout(scene);
const opacityOf = (t: number, kind: string, a: string) => frameAt(scene, layout, t).edges.find((e) => e.key.startsWith(`${kind}:${a}>`))!.opacity;

describe("frameAt edges", () => {
  it("dims a parent bond to half once both the parent and the child are dead, and not before", () => {
    expect(opacityOf(1505, "parent", "mum")).toBe(1);
    expect(opacityOf(1520, "parent", "mum")).toBe(1);
    expect(opacityOf(1520, "parent", "dad")).toBe(1);
    expect(opacityOf(1535, "parent", "mum")).toBe(0.5);
    expect(opacityOf(1535, "parent", "dad")).toBe(0.5);
  });

  it("leaves other bonds alone", () => {
    expect(opacityOf(1535, "spouse", "mum")).toBe(1);
  });
});

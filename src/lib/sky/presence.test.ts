import { describe, expect, it } from "vitest";
import type { SceneEdge, ScenePerson } from "@/contracts/life";
import { elinScene } from "./fixture-scene";
import { alive, circleCount, edgeActive, formerOpacity, growth, inCircle, presence, soulsAlive } from "./presence";

const scene = elinScene();
const byId = Object.fromEntries(scene.people.map((p) => [p.id, p]));
const START = scene.span.start;

describe("presence", () => {
  it("is 1 for people present at the start, and ramps in around appearsAt", () => {
    expect(presence(byId.petra!, START, START)).toBe(1);
    const wren = byId.wren!;
    expect(presence(wren, wren.appearsAt - 0.5, START)).toBe(0);
    const mid = presence(wren, wren.appearsAt + 0.2, START);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    expect(presence(wren, wren.appearsAt + 2, START)).toBe(1);
  });
});

describe("alive / edgeActive", () => {
  it("treats the death moment as dead", () => {
    const joren = byId.joren! as ScenePerson;
    expect(alive(joren, joren.diedAt! - 0.01)).toBe(true);
    expect(alive(joren, joren.diedAt!)).toBe(false);
    expect(alive(byId.petra!, 9999)).toBe(true);
  });

  it("reads a null fromAt as before the life and an untilAt as exclusive", () => {
    const e: SceneEdge = { a: "a", b: "b", kind: "spouse", fromAt: null, untilAt: 1500 };
    expect(edgeActive(e, 1400)).toBe(true);
    expect(edgeActive(e, 1500)).toBe(false);
  });
});

describe("growth / formerOpacity", () => {
  const e: SceneEdge = { a: "a", b: "b", kind: "spouse", fromAt: 1500, untilAt: 1510 };
  it("grows over GROW years after a short lead and never overshoots", () => {
    expect(growth(e, 1499)).toBe(0);
    expect(growth(e, 1500)).toBeGreaterThan(0);
    expect(growth(e, 1502)).toBe(1);
    expect(growth({ ...e, fromAt: null }, 1400)).toBe(1);
  });

  it("dims a former bond by 45% over a year", () => {
    expect(formerOpacity(e, 1509)).toBe(1);
    expect(formerOpacity(e, 1510.5)).toBeCloseTo(1 - 0.45 * 0.5, 9);
    expect(formerOpacity(e, 1600)).toBeCloseTo(0.55, 9);
  });
});

describe("inCircle", () => {
  it("is the story circle: family always, others only while an active spouse/lover/rival edge touches self", () => {
    expect(inCircle(scene, byId.petra!, START)).toBe(true);
    expect(inCircle(scene, byId.margit!, 1510)).toBe(false);
    expect(inCircle(scene, byId.hollis!, 1535)).toBe(true);
    expect(inCircle(scene, byId.hollis!, 1552)).toBe(false);
    expect(inCircle(scene, byId.tomas!, 1513)).toBe(true);
  });
});

describe("counts", () => {
  it("counts living village souls and circle members", () => {
    expect(soulsAlive(scene.village, 1480)).toBe(1);
    expect(soulsAlive(scene.village, 1530)).toBe(5);
    expect(soulsAlive(scene.village, 1532)).toBe(4);
    expect(circleCount(scene, START)).toBe(2);
  });
});

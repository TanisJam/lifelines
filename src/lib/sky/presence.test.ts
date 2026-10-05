import { describe, expect, it } from "vitest";
import type { LifeScene, SceneEdge, ScenePerson } from "@/contracts/life";
import { elinScene } from "./fixture-scene";
import { alive, circleCount, edgeActive, formerOpacity, growth, inCircle, presence, scenePresence, soulsAlive } from "./presence";

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

describe("journal-ordered eligibility", () => {
  const journal: LifeScene = { ...scene, timeBasis: "journal-ordered", span: { start: 1327, end: 1335 } };
  const p: ScenePerson = { id: "arrival", name: "Arrival", sex: "f", relCode: "participant", group: "others", born: 1300, appearsAt: 1328.25 };

  it("is instantaneous at introduction and bounded on forward and backward scrubs", () => {
    const times = [1326, 1327, 1328.249, 1328.25, 1335, 1335.001, NaN, Infinity, -Infinity];
    const expected = [0, 0, 0, 1, 1, 0, 0, 0, 0];
    expect(times.map(t => scenePresence(journal, p, t))).toEqual(expected);
    expect([...times].reverse().map(t => scenePresence(journal, p, t)).reverse()).toEqual(expected);
  });

  it("requires birth and introduction, rejects future introductions and nonfinite endpoints", () => {
    expect(scenePresence(journal, { ...p, born: 1329 }, 1328.5)).toBe(0);
    expect(scenePresence(journal, { ...p, born: 1329 }, 1329)).toBe(1);
    expect(scenePresence(journal, { ...p, appearsAt: 1336 }, 1335)).toBe(0);
    for (const end of [null, NaN, Infinity, -Infinity]) {
      expect(scenePresence({ ...journal, span: { start: 1327, end } }, p, 1330)).toBe(0);
    }
  });

  it("excludes death before opening but retains exact-opening death and finite zero-length spans", () => {
    const origin = { ...p, born: 1313, appearsAt: 1313 };
    expect(scenePresence(journal, { ...origin, diedAt: 1313 }, 1327)).toBe(0);
    const dead = { ...origin, diedAt: 1327 };
    expect(scenePresence(journal, dead, 1327)).toBe(1);
    expect(alive(dead, 1327)).toBe(false);
    for (const year of [0, 1313]) {
      const point: LifeScene = { ...journal, span: { start: year, end: year } };
      const subject = { ...origin, born: year, appearsAt: year, diedAt: year };
      expect(scenePresence(point, subject, year)).toBe(1);
      expect(scenePresence(point, subject, year - 0.01)).toBe(0);
      expect(scenePresence(point, subject, year + 0.01)).toBe(0);
    }
  });

  it("never badges neutral participants even with an accidental qualifying edge; counts eligible living family only", () => {
    const self = { ...p, id: "self", group: "self", relCode: "self", born: 1327, appearsAt: 1327 } as const;
    const family = { ...p, id: "family", group: "parents", relCode: "parent", diedAt: 1330 } as const;
    const counted: LifeScene = { ...journal, people: [self, p, family],
      edges: [{ a: "self", b: p.id, kind: "spouse", fromAt: null }] };
    expect(inCircle(counted, p, 1329)).toBe(false);
    expect(circleCount(counted, 1328.249)).toBe(0);
    expect(circleCount(counted, 1328.25)).toBe(1);
    expect(circleCount(counted, 1330)).toBe(0);
    expect(circleCount(counted, 1336)).toBe(0);
  });

  it("leaves every absent-mode legacy value and edge membership unchanged", () => {
    for (const person of scene.people) {
      for (const t of [START - 10, START, person.appearsAt - 0.2, person.appearsAt, 9999, NaN]) {
        expect(scenePresence(scene, person, t)).toBe(presence(person, t, START));
      }
    }
    const legacy: LifeScene = { ...journal, timeBasis: undefined, people: [
      { ...p, id: "self", group: "self", relCode: "self" }, p,
    ], edges: [{ a: "self", b: p.id, kind: "spouse", fromAt: null }] };
    expect(inCircle(legacy, p, 1329)).toBe(true);
    expect(circleCount(legacy, 1329)).toBe(1);
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

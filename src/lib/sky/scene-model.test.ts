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

const participants: readonly ScenePerson[] = [
  { id: "visitor-f", name: "Ada", sex: "f", relCode: "participant", group: "others", born: 1480, appearsAt: 1500, diedAt: 1502 },
  { id: "visitor-m", name: "Robin", sex: "m", relCode: "participant", group: "others", born: 1482, appearsAt: 1501 },
];
const withParticipants: LifeScene = { ...scene, people: [...scene.people, ...participants] };
const participantLayout = computeLayout(withParticipants);

describe("neutral participant scene consumers", () => {
  it("uses existing others geometry with finite, distinct homes and origins", () => {
    const others: LifeScene = { ...withParticipants, people: withParticipants.people.map((p) => p.relCode === "participant" ? { ...p, relCode: "friend" } : p) };
    expect(participantLayout).toEqual(computeLayout(others));
    for (const participant of participants) {
      expect(participantLayout.homes.get(participant.id)).toHaveLength(2);
      expect(participantLayout.origins.get(participant.id)).toHaveLength(2);
      expect(participantLayout.homes.get(participant.id)!.every(Number.isFinite)).toBe(true);
      expect(participantLayout.origins.get(participant.id)!.every(Number.isFinite)).toBe(true);
    }
    expect(participantLayout.homes.get("visitor-f")).not.toEqual(participantLayout.homes.get("visitor-m"));
  });

  it("distinguishes not present from visible, arrived but outside the circle, then dead", () => {
    expect(frameAt(withParticipants, participantLayout, 1499).people.find((p) => p.id === "visitor-f")).toBeUndefined();
    const arriving = frameAt(withParticipants, participantLayout, 1500).people.find((p) => p.id === "visitor-f")!;
    expect(arriving.presence).toBeGreaterThan(0);
    expect(arriving.presence).toBeLessThan(1);
    expect(arriving.inCircle).toBe(false);
    const arrived = frameAt(withParticipants, participantLayout, 1501).people.find((p) => p.id === "visitor-f")!;
    expect(arrived).toMatchObject({ presence: 1, alive: true, inCircle: false });
    expect(arrived.pos).toEqual(participantLayout.homes.get("visitor-f"));
    expect(frameAt(withParticipants, participantLayout, 1502).people.find((p) => p.id === "visitor-f")).toMatchObject({ presence: 1, alive: false, inCircle: false });
  });

  it("preserves circle counts and edges across deterministic forward/backward scrubs", () => {
    const times = [1499, 1500, 1501, 1502, 1535];
    const forward = times.map((t) => frameAt(withParticipants, participantLayout, t));
    const backward = [...times].reverse().map((t) => frameAt(withParticipants, participantLayout, t)).reverse();
    expect(backward).toEqual(forward);
    for (const frame of forward) {
      const baseline = frameAt(scene, layout, frame.t);
      expect(frame.circle).toBe(baseline.circle);
      expect(frame.edges).toEqual(baseline.edges);
      for (const p of frame.people.filter((p) => p.id.startsWith("visitor-"))) {
        expect(p.inCircle).toBe(false);
        expect(p.pos.every(Number.isFinite)).toBe(true);
      }
    }
    expect(withParticipants.edges).toEqual(scene.edges);
  });

  it("roundtrips the additive code and existing person fields without mutating inputs", () => {
    const before = JSON.stringify(withParticipants);
    const restored: LifeScene = JSON.parse(before);
    expect(restored).toEqual(withParticipants);
    expect(restored.people.slice(-2)).toEqual(participants);
    const restoredLayout = computeLayout(restored);
    expect(frameAt(restored, restoredLayout, 1501)).toEqual(frameAt(withParticipants, participantLayout, 1501));
    expect(JSON.stringify(withParticipants)).toBe(before);
    expect(JSON.stringify(restored)).toBe(before);
    expect(scene.people.some((p) => p.relCode === "participant")).toBe(false);
  });
});

describe("journal-ordered frames", () => {
  const journal: LifeScene = { ...withParticipants, timeBasis: "journal-ordered", span: { start: 1490, end: 1530 },
    edges: [...scene.edges, { a: "self", b: "visitor-f", kind: "spouse", fromAt: null }] };
  const homes = computeLayout(journal);

  it("shares instantaneous presence, circle eligibility and exclusive death truth without predictive fades", () => {
    const before = frameAt(journal, homes, 1499.999);
    expect(before.people.find(p => p.id === "visitor-f")).toBeUndefined();
    for (const t of [1500, 1501.9, 1502]) {
      const frame = frameAt(journal, homes, t);
      const visitor = frame.people.find(p => p.id === "visitor-f")!;
      expect(visitor).toMatchObject({ presence: 1, alive: t < 1502, inCircle: false, coreOpacity: 1 });
      expect(visitor.pos).toEqual(homes.homes.get("visitor-f"));
      expect(frame.circle).toBe(frame.people.filter(p => p.id !== "self" && p.alive && p.inCircle && p.presence === 1).length);
    }
    expect(frameAt(journal, homes, 1499.999).people.find(p => p.id === "mum")!.coreOpacity).toBe(1);
    expect(frameAt(journal, homes, 1500).people.find(p => p.id === "mum")!.alive).toBe(false);
    expect(frameAt(journal, homes, 1529.999).people.find(p => p.id === "self")!.coreOpacity).toBe(1);
  });

  it("omits people and dependent edges outside the window and converges on backward scrubs", () => {
    const times = [1489.9, 1490, 1499.9, 1500, 1502, 1530, 1530.001, NaN, Infinity];
    const forward = times.map(t => frameAt(journal, homes, t));
    expect([...times].reverse().map(t => frameAt(journal, homes, t)).reverse()).toEqual(forward);
    for (const index of [0, 6, 7, 8]) {
      expect(forward[index].people).toEqual([]);
      expect(forward[index].edges).toEqual([]);
      expect(forward[index].circle).toBe(0);
    }
  });

  it("has finite dead-point frames at zero and historical opening, and no resurrection before birth", () => {
    for (const year of [0, 1313]) {
      const point: LifeScene = { timeBasis: "journal-ordered", people: [person("self", {
        relCode: "self", group: "self", born: year, appearsAt: year, diedAt: year,
      })], edges: [], village: [], bands: [], span: { start: year, end: year } };
      const frame = frameAt(point, computeLayout(point), year);
      expect(frame.people).toHaveLength(1);
      expect(frame.people[0]).toMatchObject({ alive: false, presence: 1, coreOpacity: 1 });
      expect(frame.people[0].pos.every(Number.isFinite)).toBe(true);
      expect(frame.circle).toBe(0);
    }
    const future: LifeScene = { ...journal, people: [...journal.people, person("unborn", { born: 1505, appearsAt: 1490 }),
      person("future-arrival", { born: 1450, appearsAt: 1531 }), person("dead-before", { diedAt: 1489 })] };
    expect(frameAt(future, computeLayout(future), 1500).people.map(p => p.id)).not.toEqual(expect.arrayContaining(["unborn", "future-arrival", "dead-before"]));
    for (const id of ["unborn", "future-arrival", "dead-before"]) {
      expect(frameAt(future, computeLayout(future), 1500).people.find(p => p.id === id)).toBeUndefined();
    }
  });

  it("preserves absent-mode frames byte for byte, including legacy anticipatory arrival and core fade", () => {
    for (const t of [1499.9, 1500, 1501.9, 1502, 1529.9, 1531]) {
      expect(JSON.stringify(frameAt({ ...withParticipants, timeBasis: undefined }, participantLayout, t)))
        .toBe(JSON.stringify(frameAt(withParticipants, participantLayout, t)));
    }
    expect(frameAt(withParticipants, participantLayout, 1499.9).people.find(p => p.id === "visitor-f")!.presence).toBeGreaterThan(0);
    expect(frameAt(withParticipants, participantLayout, 1501.9).people.find(p => p.id === "visitor-f")!.coreOpacity).toBeLessThan(1);
  });
});

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

import { beforeAll, describe, expect, it } from "vitest";
import { RuleDecisionMaker } from "@/adapters/decision/rule-decision-maker";
import { deriveLifeScene, MAX_FRIENDS } from "./scene";
import { simulate } from "./simulate";
import type { Event, Person, SimulationResult } from "./types";
import { generateWorld } from "./worldgen";

function person(id: string, extra: Partial<Person> = {}): Person {
  return { id, name: id.toUpperCase(), sex: "f", birthYear: 1300, ...extra } as Person;
}

function event(id: string, kind: Event["kind"], year: number, actors: string[], extra: Partial<Event> = {}): Event {
  return { id, year, kind, actors, payload: {}, causes: [], ...extra };
}

const people: Record<string, Person> = {
  protagonist: person("protagonist", { birthYear: 1340, motherId: "mum", fatherId: "dad", spouseId: "husband" }),
  mum: person("mum", { birthYear: 1315 }),
  dad: person("dad", { sex: "m", birthYear: 1313, spouseId: "mum" }),
  brother: person("brother", { sex: "m", birthYear: 1336, motherId: "mum", fatherId: "dad" }),
  husband: person("husband", { sex: "m", birthYear: 1338, spouseId: "protagonist" }),
  son: person("son", { sex: "m", birthYear: 1362, motherId: "protagonist", fatherId: "husband" }),
  daughterInLaw: person("daughterInLaw", { birthYear: 1363 }),
  grandson: person("grandson", { sex: "m", birthYear: 1386, motherId: "daughterInLaw", fatherId: "son" }),
  suitor: person("suitor", { sex: "m", birthYear: 1339 }),
  rival: person("rival", { birthYear: 1341 }),
  pal: person("pal", { birthYear: 1341 }),
  neighbour: person("neighbour", { birthYear: 1330, deathYear: 1349 }),
  settler: person("settler", { sex: "m", birthYear: 1325 }),
  gone: person("gone", { birthYear: 1300, deathYear: 1335 }),
  wanderer: person("wanderer", { birthYear: 1338, away: true }),
};

const events: Event[] = [
  event("b-p", "birth", 1340, ["protagonist", "mum", "dad"]),
  event("romance-1", "romance", 1358, ["protagonist", "suitor"]),
  event("breakup-1", "breakup", 1359, ["protagonist", "suitor"], { causes: ["romance-1"] }),
  event("romance-2", "romance", 1360, ["protagonist", "husband"]),
  event("marriage-1", "marriage", 1361, ["protagonist", "husband"], { causes: ["romance-2"] }),
  event("b-son", "birth", 1362, ["son", "protagonist", "husband"], { causes: ["marriage-1"] }),
  event("feud-1", "feud", 1363, ["protagonist", "rival"]),
  event("recon-1", "reconciliation", 1367, ["protagonist", "rival"], { causes: ["feud-1"] }),
  event("marriage-2", "marriage", 1385, ["son", "daughterInLaw"]),
  event("b-gs", "birth", 1386, ["grandson", "daughterInLaw", "son"], { causes: ["marriage-2"] }),
  event("arrive", "move", 1349, ["settler"], { payload: { arrived: true } }),
  event("away", "move", 1352, ["wanderer"], { payload: { away: true } }),
  event("d-neighbour", "death", 1349, ["neighbour"], { payload: { cause: "black-death" } }),
  event("d-husband", "death", 1380, ["husband"]),
  event("d-p", "death", 1395, ["protagonist"]),
];
people.protagonist!.deathYear = 1395;
people.husband!.deathYear = 1380;

const base = { seed: "scene-seed", people, events, protagonistId: "protagonist" } as const;
const byId = (scene: ReturnType<typeof deriveLifeScene>) => new Map(scene.people.map((p) => [p.id, p]));

describe("deriveLifeScene (hand-built life)", () => {
  const scene = deriveLifeScene({ ...base, friends: [{ id: "pal", fromAt: null }] });
  const lookup = byId(scene);

  it("places every relation in its group with the right code and sex", () => {
    expect(lookup.get("protagonist")).toMatchObject({ group: "self", relCode: "self", sex: "f" });
    expect(lookup.get("mum")).toMatchObject({ group: "parents", relCode: "parent" });
    expect(lookup.get("brother")).toMatchObject({ group: "siblings", relCode: "sibling", sex: "m" });
    expect(lookup.get("husband")).toMatchObject({ group: "spouses", relCode: "spouse", sex: "m" });
    expect(lookup.get("son")).toMatchObject({ group: "children", relCode: "child" });
    expect(lookup.get("suitor")).toMatchObject({ group: "others", relCode: "lover" });
    expect(lookup.get("rival")).toMatchObject({ group: "others", relCode: "rival" });
    expect(lookup.get("pal")).toMatchObject({ group: "others", relCode: "friend" });
  });

  it("anchors the outer ring to the child they hang from, and nobody else", () => {
    expect(lookup.get("daughterInLaw")).toMatchObject({ group: "outer", relCode: "childSpouse", anchor: "son" });
    expect(lookup.get("grandson")).toMatchObject({ group: "outer", relCode: "grandchild", anchor: "son" });
    for (const p of scene.people) {
      if (p.group === "outer") expect(lookup.has(p.anchor!)).toBe(true);
      else expect(p.anchor).toBeUndefined();
    }
  });

  it("resolves every edge endpoint and keeps every appearance inside the span", () => {
    for (const edge of scene.edges) {
      expect(lookup.has(edge.a)).toBe(true);
      expect(lookup.has(edge.b)).toBe(true);
    }
    for (const p of scene.people) {
      expect(p.appearsAt).toBeGreaterThanOrEqual(scene.span.start);
      expect(p.appearsAt).toBeLessThanOrEqual(scene.span.end!);
    }
  });

  it("times the span from the protagonist's birth to death, and people from their events", () => {
    expect(Math.floor(scene.span.start)).toBe(1340);
    expect(Math.floor(scene.span.end!)).toBe(1395);
    expect(lookup.get("mum")!.appearsAt).toBe(scene.span.start);
    expect(Math.floor(lookup.get("son")!.appearsAt)).toBe(1362);
    expect(Math.floor(lookup.get("husband")!.diedAt!)).toBe(1380);
  });

  it("bounds edges by their events", () => {
    const edge = (kind: string, a: string, b: string) => scene.edges.find((e) => e.kind === kind && [e.a, e.b].sort().join() === [a, b].sort().join())!;
    expect(edge("spouse", "mum", "dad").fromAt).toBeNull();
    const marriage = edge("spouse", "protagonist", "husband");
    expect(Math.floor(marriage.fromAt!)).toBe(1361);
    expect(marriage.untilAt).toBe(lookup.get("husband")!.diedAt);
    const lover = edge("lover", "protagonist", "suitor");
    expect(Math.floor(lover.fromAt!)).toBe(1358);
    expect(Math.floor(lover.untilAt!)).toBe(1359);
    expect(Math.floor(edge("rival", "protagonist", "rival").untilAt!)).toBe(1367);
    expect(edge("friend", "protagonist", "pal")).toMatchObject({ fromAt: null });
    expect(edge("parent", "mum", "protagonist").fromAt).toBe(scene.span.start);
    expect(edge("parent", "mum", "brother").fromAt).toBeNull();
  });

  it("keeps at most six friends", () => {
    const crowd: Record<string, Person> = { ...people };
    const friends = Array.from({ length: 9 }, (_, i) => {
      crowd[`f${i}`] = person(`f${i}`);
      return { id: `f${i}`, fromAt: null };
    });
    const crowded = deriveLifeScene({ ...base, people: crowd, friends });
    expect(crowded.people.filter((p) => p.relCode === "friend")).toHaveLength(MAX_FRIENDS);
  });

  it("gives villagers soul times keyed by person id, skipping scene, away and long-dead people", () => {
    const keys = scene.village.map((s) => s.k);
    expect(keys).toEqual(["neighbour", "settler"]);
    const settler = scene.village.find((s) => s.k === "settler")!;
    expect(Math.floor(settler.b)).toBe(1349);
    expect(settler.d).toBeUndefined();
    const neighbour = scene.village.find((s) => s.k === "neighbour")!;
    expect(neighbour.b).toBe(1330);
    expect(Math.floor(neighbour.d!)).toBe(1349);
  });

  it("keeps village keys stable when an immigrant is inserted mid-life", () => {
    const later = deriveLifeScene({
      ...base,
      people: { ...people, arrival: person("arrival", { birthYear: 1355 }) },
      events: [...events, event("arrive-2", "move", 1370, ["arrival"], { payload: { arrived: true } })],
    });
    const before = new Map(scene.village.map((s) => [s.k, s]));
    for (const soul of later.village.filter((s) => before.has(s.k))) expect(soul).toEqual(before.get(soul.k));
    expect(later.village.map((s) => s.k)).toContain("arrival");
  });

  it("clips plague bands to the span, one per overlapping plague", () => {
    expect(scene.bands).toEqual([
      { kind: "black-death", from: 1348, to: 1350 },
      { kind: "second-pestilence", from: 1361, to: 1363 },
    ]);
  });

  it("has no bands when the life misses both plagues, and an open end while the protagonist lives", () => {
    const young = { ...people, protagonist: person("protagonist", { birthYear: 1370, motherId: "mum", fatherId: "dad" }) };
    const quiet = deriveLifeScene({ seed: "s", people: young, events: [event("b-p", "birth", 1370, ["protagonist", "mum", "dad"])], protagonistId: "protagonist" });
    expect(quiet.bands).toEqual([]);
    expect(quiet.span.end).toBeNull();
  });

  it("is a superset when built from a later state", () => {
    const earlyEvents = events.filter((e) => e.year <= 1362);
    const early = deriveLifeScene({ ...base, events: earlyEvents, through: 1362 });
    const later = byId(scene);
    for (const p of early.people) expect(later.has(p.id)).toBe(true);
    expect(early.span.end).toBeNull();
    expect(early.bands).toEqual(scene.bands);
  });
});

describe("deriveLifeScene (simulated life)", () => {
  let result: SimulationResult;
  beforeAll(async () => {
    const world = generateWorld({ seed: "scene-life", startYear: 1327, endYear: 1400, founderCount: 10, protagonist: { name: "Testa", sex: "random" } });
    result = (await simulate(world.config, world.people, world.events, { decisionMaker: new RuleDecisionMaker(), engineSource: "rules", protagonistId: "protagonist" })).result;
  });

  it("produces a closed, in-span scene", () => {
    const scene = deriveLifeScene({ seed: "scene-life", people: result.people, events: result.events, protagonistId: "protagonist" });
    const ids = new Set(scene.people.map((p) => p.id));
    expect(scene.people.some((p) => p.relCode === "self")).toBe(true);
    for (const e of scene.edges) {
      expect(ids.has(e.a)).toBe(true);
      expect(ids.has(e.b)).toBe(true);
    }
    for (const p of scene.people) {
      expect(p.appearsAt).toBeGreaterThanOrEqual(scene.span.start);
      if (scene.span.end !== null) expect(p.appearsAt).toBeLessThanOrEqual(scene.span.end);
    }
    expect(scene.village.some((s) => ids.has(s.k))).toBe(false);
    expect(deriveLifeScene({ seed: "scene-life", people: result.people, events: result.events, protagonistId: "protagonist" })).toEqual(scene);
  });
});

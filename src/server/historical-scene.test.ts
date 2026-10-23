import { describe, expect, it, vi } from "vitest";
import { createAnnualRuntime, type AnnualPlan, type Newcomer } from "../domain/e-runtime";
import { initializeWorld } from "../domain/world-initialization";
import type { GenerateWorldOptions } from "../domain/worldgen";
import { alive, scenePresence } from "../lib/sky/presence";
import { computeLayout } from "../lib/sky/layout";
import { frameAt } from "../lib/sky/scene-model";
import { journalPlacements } from "./historical-journal-placement";
import { deriveHistoricalScene } from "./historical-scene";

const initialization = { seed: "verify-1", startYear: 1327, endYear: 1335, founderCount: 6 };
const quiet = (year: number): AnnualPlan => ({ year, physical: [], resources: [], grants: [], requests: [] });
function fixture(options: GenerateWorldOptions = initialization) {
  const { world } = initializeWorld(options);
  const resources = Object.fromEntries(Object.keys(world.people).map(id => [id, { grain: 2, effort: 1, need: 1 }]));
  const runtime = createAnnualRuntime(options, resources);
  const actors = Object.values(runtime.initial.state.people)
    .filter(p => p.birthYear < 1327 && p.deathYear === undefined && !p.away);
  const [creditor, debtor, other] = actors.map(p => p.id);
  const history = [runtime.initial];
  function newcomer(id: string, birthYear: number): Newcomer {
    const p = runtime.initial.state.people[debtor];
    return { id, name: `Arrival ${id}`, sex: p.sex, birthYear, traits: [...p.traits], job: p.job,
      mind: structuredClone(p.mind) as Newcomer["mind"] };
  }
  return { runtime, history, creditor, debtor, other, newcomer };
}

function frozen(value: unknown): void {
  if (value !== null && typeof value === "object") {
    expect(Object.isFrozen(value)).toBe(true);
    Object.values(value).forEach(frozen);
  }
}

describe("explicit historical scene", () => {
  it("keeps a quiet subject's actual origin truth, with no fabricated registry or social edges", () => {
    const { runtime, history, creditor } = fixture();
    history.push(runtime.advance(quiet(1327)));
    const p = runtime.initial.state.people[creditor];
    const scene = deriveHistoricalScene({ history, subjectActorID: creditor, asOfYear: 1327 });
    expect(scene).toEqual({ timeBasis: "journal-ordered", people: [{ id: p.id, name: p.name, sex: p.sex,
      born: p.birthYear, appearsAt: p.birthYear, relCode: "self", group: "self" }],
    edges: [], village: [], bands: [], span: { start: p.birthYear, end: 1327 } });
  });

  it.each([
    ["__proto__", 1300], ["constructor", 1300], ["toString", 1300], ["old arrival", 1300],
    ["newborn", 1328],
  ] as const)("includes terminal-year newcomer %s born %s as subject and participant through the complete last slot", (id, birthYear) => {
    const { runtime, history, creditor, debtor, newcomer } = fixture();
    history.push(runtime.advance(quiet(1327)));
    const person = newcomer(id, birthYear);
    const selected = runtime.advance({ ...quiet(1328), physical: [
      { id: "__proto__", kind: "create", person, causes: [] },
      { id: "away", kind: "residence", actor: debtor, status: "away", causes: [] },
    ], resources: [{ id: "allocate", kind: "allocate", actor: id, causes: ["__proto__"], allocation: { grain: 0, effort: 1, need: 1 } }],
    grants: [{ id: "selected", creditor, debtor: id, causes: ["allocate"] },
      { id: "hidden-ineligible", creditor, debtor, causes: ["away"] }] });
    history.push(selected, runtime.advance(quiet(1329)));
    expect(selected.journal[1].entries).toHaveLength(5);
    expect(selected.journal[1].entries[4].outcome).toBe("ineligible");
    const scene = deriveHistoricalScene({ history, subjectActorID: creditor, asOfYear: 1328 });
    expect(scene.people.map(p => p.id)).toEqual([creditor, id]);
    expect(scene.edges).toEqual([]);
    const arrival = scene.people[1];
    const at = journalPlacements(selected.journal)["__proto__"];
    expect(at).toBe(1328 + 1 / 6);
    expect(arrival).toMatchObject({ born: birthYear, appearsAt: at, relCode: "participant", group: "others" });
    expect(arrival.diedAt).toBeUndefined();
    const end = 1328 + 5 / 6;
    const subjectScene = deriveHistoricalScene({ history, subjectActorID: id, asOfYear: 1328 });
    expect(subjectScene.people[0]).toMatchObject({ born: birthYear, appearsAt: at, group: "self" });
    for (const projected of [scene, subjectScene]) {
      expect(projected.span.end).toBe(end);
      frozen(projected);
      const p = projected.people.find(p => p.id === id)!;
      const layout = computeLayout(projected);
      for (const time of [at - 0.001, at, end, end + 0.001, end, at, at - 0.001]) {
        const expected = time >= at && time <= end ? 1 : 0;
        expect(scenePresence(projected, p, time)).toBe(expected);
        const rendered = frameAt(projected, layout, time).people.find(p => p.id === id);
        if (expected) expect(rendered).toMatchObject({ presence: 1, alive: true, coreOpacity: 1 });
        else expect(rendered).toBeUndefined();
      }
    }
    expect(deriveHistoricalScene({ history: history.slice(0, -1), subjectActorID: id, asOfYear: 1328 })).toEqual(subjectScene);
  });

  it("retains same-year birth/death in distinct strict physical slots, not annual or cumulative positions", () => {
    const { runtime, history, creditor, newcomer } = fixture();
    history.push(runtime.advance(quiet(1327)));
    const selected = runtime.advance({ ...quiet(1328), physical: [
      { id: "birth", kind: "create", person: newcomer("infant", 1328), causes: [] },
      { id: "death", kind: "death", actor: "infant", causes: ["birth"] },
    ], grants: [{ id: "after-death", creditor, debtor: "infant", causes: ["death"] }] });
    history.push(selected);
    const scene = deriveHistoricalScene({ history, subjectActorID: "infant", asOfYear: 1328 });
    const p = scene.people[0];
    expect(selected.journal[1].entries[2].outcome).toBe("ineligible");
    expect(p).toMatchObject({ born: 1328, appearsAt: 1328.25, diedAt: 1328.5 });
    expect(scene.span).toEqual({ start: 1328, end: p.diedAt });
    expect(scenePresence(scene, p, 1328)).toBe(0);
    expect(scenePresence(scene, p, p.appearsAt)).toBe(1);
    expect(alive(p, p.diedAt! - 0.001)).toBe(true);
    expect(alive(p, p.diedAt!)).toBe(false);
    expect(frameAt(scene, computeLayout(scene), p.diedAt!).people[0]).toMatchObject({ presence: 1, alive: false, coreOpacity: 1 });
  });

  it("uses initial actual death without requiring an annual entry, including a dead point subject", () => {
    const { runtime, history, creditor, debtor } = fixture({ seed: "sky7334-0", startYear: 1327, endYear: 1335, founderCount: 62,
      protagonist: { name: "Subject", sex: "f" } });
    expect(Object.keys(runtime.initial.state.people)).toHaveLength(84);
    expect(runtime.initial.state.people.p009).toMatchObject({ birthYear: 1313, deathYear: 1313 });
    history.push(runtime.advance({ ...quiet(1327), grants: [{ id: "later-grant", creditor, debtor, causes: [] }] }));
    const scene = deriveHistoricalScene({ history, subjectActorID: "p009", asOfYear: 1327 });
    expect(scene.people).toHaveLength(1);
    expect(scene.people[0]).toMatchObject({ born: 1313, appearsAt: 1313, diedAt: 1313 });
    expect(scene.span).toEqual({ start: 1313, end: 1313 });
    const layout = computeLayout(scene);
    const frame = frameAt(scene, layout, 1313);
    expect(frame.people[0]).toMatchObject({ presence: 1, alive: false, coreOpacity: 1 });
    expect(frame.people[0].pos.every(Number.isFinite)).toBe(true);
    expect(frameAt(scene, layout, 1327).people).toEqual([]);
  });

  it("keeps posthumous causal actors as neutral context, without reviving them or promoting ties", () => {
    const { runtime, history, creditor, debtor, other } = fixture();
    history.push(runtime.advance({ ...quiet(1327), physical: [
      { id: "death-cause", kind: "death", actor: other, causes: [] },
    ], grants: [{ id: "grant", creditor, debtor, causes: ["death-cause"] }] }));
    history.push(runtime.advance({ ...quiet(1328), requests: [{ id: "request", obligation: "grant/help", noise: 0 }] }));
    const scene = deriveHistoricalScene({ history, subjectActorID: creditor, asOfYear: 1328 });
    expect(new Set(scene.people.map(p => p.id))).toEqual(new Set([creditor, debtor, other]));
    const dead = scene.people.find(p => p.id === other)!;
    expect(dead.diedAt).toBe(1327 + 1 / 3);
    expect(scene.people.filter(p => p.id !== creditor).every(p => p.relCode === "participant" && p.group === "others")).toBe(true);
    expect(scene.edges).toEqual([]);
    expect(frameAt(scene, computeLayout(scene), dead.diedAt!).people.find(p => p.id === other)).toMatchObject({ alive: false, inCircle: false });
  });

  it("retains dead-before-opening origin actors as context but never in the subject sky", () => {
    const { runtime, history, debtor } = fixture({ seed: "sky7334-0", startYear: 1327, endYear: 1335, founderCount: 62,
      protagonist: { name: "Subject", sex: "f" } });
    const death = runtime.initial.origin.initial.events.find(e => e.kind === "death" && e.actors.includes("p009"))!;
    expect(death.year).toBe(1313);
    history.push(runtime.advance({ ...quiet(1327), grants: [{ id: "grant", creditor: "protagonist", debtor, causes: [death.id] }] }));
    const scene = deriveHistoricalScene({ history, subjectActorID: "protagonist", asOfYear: 1327 });
    expect(scene.span).toEqual({ start: 1327, end: 1327.5 });
    const dead = scene.people.find(p => p.id === "p009")!;
    expect(dead).toMatchObject({ born: 1313, diedAt: 1313 });
    expect(scenePresence(scene, dead, 1327)).toBe(0);
    expect(frameAt(scene, computeLayout(scene), 1327).people.find(p => p.id === "p009")).toBeUndefined();
  });

  it("selects exactly, stays byte-stable across valid future truth, but validates malformed future checkpoints", () => {
    const { runtime, history, creditor, debtor, newcomer } = fixture();
    history.push(runtime.advance({ ...quiet(1327), grants: [{ id: "grant", creditor, debtor, causes: [] }] }));
    const input = { history, subjectActorID: creditor, asOfYear: 1327 };
    const before = JSON.stringify(deriveHistoricalScene(input));
    expect(deriveHistoricalScene(input).span.end).toBe(1327.5);
    history.push(runtime.advance({ ...quiet(1329), physical: [
      { id: "future-death", kind: "death", actor: creditor, causes: [] },
      { id: "future-away", kind: "residence", actor: debtor, status: "away", causes: [] },
      { id: "future-create", kind: "create", person: newcomer("future", 1329), causes: [] },
    ] }));
    expect(JSON.stringify(deriveHistoricalScene(input))).toBe(before);
    expect(deriveHistoricalScene({ ...input, asOfYear: 1329 }).span.end).toBe(1329.25);
    for (const asOfYear of [1326, 1328, 1330, NaN, -0]) expect(() => deriveHistoricalScene({ ...input, asOfYear })).toThrow();
    for (const subjectActorID of ["unknown", "future"]) expect(() => deriveHistoricalScene({ ...input, subjectActorID })).toThrow();
    const bad = structuredClone(history);
    Reflect.set(bad[2].state.people[creditor], "name", "forged future");
    expect(() => deriveHistoricalScene({ ...input, history: bad })).toThrow();
  });

  it.each([0, 1328])("uses the quiet selected year %s, not an earlier event or a retained future slot", year => {
    const { runtime, history, creditor, debtor } = fixture({ ...initialization, startYear: year - 1, endYear: year + 1 });
    const previous = runtime.advance({ ...quiet(year - 1), grants: [{ id: "past", creditor, debtor, causes: [] }] });
    history.push(previous, runtime.advance(quiet(year)));
    expect(previous.journal[0].entries).toHaveLength(1);
    const input = { history, subjectActorID: creditor, asOfYear: year };
    const scene = deriveHistoricalScene(input);
    expect(scene.span.end).toBe(year);
    expect(scenePresence(scene, scene.people[0], year)).toBe(1);
    expect(scenePresence(scene, scene.people[0], year + 0.001)).toBe(0);
    history.push(runtime.advance({ ...quiet(year + 1), physical: [{ id: "future-death", kind: "death", actor: creditor, causes: [] }] }));
    expect(deriveHistoricalScene(input)).toEqual(scene);
    expect(scene.people[0].diedAt).toBeUndefined();
  });

  it("rejects accessors before invoking getters and returns only detached, deeply frozen own objects", () => {
    const { runtime, history, creditor, debtor } = fixture();
    history.push(runtime.advance({ ...quiet(1327), grants: [{ id: "grant", creditor, debtor, causes: [] }] }));
    const borrowed = structuredClone(history);
    const before = structuredClone(borrowed);
    const scene = deriveHistoricalScene({ history: borrowed, subjectActorID: creditor, asOfYear: 1327 });
    frozen(scene);
    expect(borrowed).toEqual(before);
    expect(scene.people[0]).not.toBe(borrowed[1].state.people[creditor]);
    Reflect.set(borrowed[1].state.people[creditor], "name", "later mutation");
    expect(scene.people[0].name).toBe(before[1].state.people[creditor].name);
    const hook = vi.fn(() => "unsafe");
    const nested = structuredClone(history);
    Object.defineProperty(nested[1].state.people[creditor], "name", { enumerable: true, get: hook });
    expect(() => deriveHistoricalScene({ history: nested, subjectActorID: creditor, asOfYear: 1327 })).toThrow();
    const input = { subjectActorID: creditor, asOfYear: 1327 };
    Object.defineProperty(input, "history", { enumerable: true, get: hook });
    expect(() => deriveHistoricalScene(input as Parameters<typeof deriveHistoricalScene>[0])).toThrow();
    expect(hook).not.toHaveBeenCalled();
  });
});

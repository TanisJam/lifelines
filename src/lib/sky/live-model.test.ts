import { describe, expect, it } from "vitest";
import { fixtureChronicle } from "@/lib/fixtures";
import { sceneAt, yearTicks } from "@/lib/fixtures/stream";
import { initialLive, liveChronicle, liveReducer, startModel, mergeTick, reconcileDone } from "./live-model";
import { timeline } from "./dial";

const done = fixtureChronicle("life-elin");
const scene = done.scene;
const birth = scene.span.start;
const ticks = yearTicks(done.entries, Math.floor(birth), Math.floor(scene.span.end!)).map(([year, entries]) => ({ year, entries, scene: sceneAt(scene, year) }));

describe("startModel", () => {
  it("is an empty sky at the birth year with nothing to play yet", () => {
    const m = startModel(1500);
    expect(m.scene.people).toEqual([]);
    expect(m.scene.span).toEqual({ start: 1500, end: null });
    expect(m.entries).toEqual([]);
    expect(m.frontier).toBe(1500);
    expect(m.saved).toBe(false);
  });
});

describe("mergeTick", () => {
  it("takes the tick's scene, appends its entries and moves the frontier one year past it", () => {
    const first = ticks.find((t) => t.entries.length > 0)!;
    const m = mergeTick(startModel(birth), first);
    expect(m.scene).toBe(first.scene);
    expect(m.entries.map((e) => e.id)).toEqual(first.entries.map((e) => e.id));
    expect(m.frontier).toBe(first.year + 1);
    expect(m.saved).toBe(false);
  });

  it("never repeats an entry id and never moves the frontier back", () => {
    const a = ticks[10]!;
    const once = mergeTick(startModel(birth), a);
    const twice = mergeTick(once, { ...a, year: a.year - 3 });
    expect(twice.entries).toEqual(once.entries);
    expect(twice.frontier).toBe(once.frontier);
  });

  it("keeps entries already on the reel when later ticks arrive", () => {
    let m = startModel(birth);
    const seen: string[] = [];
    for (const tick of ticks) {
      m = mergeTick(m, tick);
      seen.push(...tick.entries.map((e) => e.id));
      expect(m.entries.map((e) => e.id)).toEqual(seen);
    }
  });
});

describe("reconcileDone", () => {
  it("swaps in the saved scene and entries, marks the model saved and opens the frontier to the end of the life", () => {
    const model = reconcileDone(done);
    expect(model.scene).toBe(done.scene);
    expect(model.entries).toBe(done.entries);
    expect(model.saved).toBe(true);
    expect(model.frontier).toBe(timeline(done.scene, 0, done.entries).end);
  });
});

describe("liveReducer", () => {
  const start = { type: "start" as const, lifeId: "life-x", branchId: "b1", villageName: "Morwyn", protagonist: { name: "Elin Marrow", sex: "f" as const, birthYear: Math.floor(birth) } };
  const events = [start, ...ticks.map((t) => ({ type: "tick" as const, ...t }))];
  const run = (list: readonly Parameters<typeof liveReducer>[1][]) => list.reduce(liveReducer, initialLive);

  it("has nothing until the start event", () => {
    expect(liveChronicle(initialLive)).toBeNull();
    expect(liveChronicle(liveReducer(initialLive, ticks[0] ? { type: "tick", ...ticks[0] } : { type: "reset" }))).toBeNull();
  });

  it("starts an empty sky, then grows it tick by tick", () => {
    const afterStart = liveChronicle(run([start]))!;
    expect(afterStart.lifeId).toBe("life-x");
    expect(afterStart.scene.people).toEqual([]);
    const mid = liveChronicle(run(events.slice(0, 12)))!;
    expect(mid.scene).toBe(ticks[10]!.scene);
    expect(mid.protagonist).toMatchObject({ name: "Elin Marrow", sex: "f", birthYear: Math.floor(birth) });
  });

  it("carries the protagonist's death into the live chronicle once the scene knows it", () => {
    const last = liveChronicle(run(events))!;
    expect(last.protagonist.deathYear).toBe(Math.floor(scene.people.find((p) => p.group === "self")!.diedAt!));
  });

  it("done hands back the saved chronicle itself, and a reset forgets everything", () => {
    const saved = run([...events, { type: "done", chronicle: done, stats: { jevCalls: 0, cacheHits: 0, wallTimeMs: 0 } }]);
    expect(liveChronicle(saved)).toBe(done);
    expect(saved.model!.saved).toBe(true);
    expect(run([...events, { type: "reset" }])).toEqual(initialLive);
  });
});

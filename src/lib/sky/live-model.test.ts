import { describe, expect, it } from "vitest";
import { fixtureChronicle } from "@/lib/fixtures";
import { sceneAt, yearTicks } from "@/lib/fixtures/stream";
import { startModel, mergeTick, reconcileDone } from "./live-model";
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
    expect(model.frontier).toBe(timeline(done.scene, 0).end);
  });
});

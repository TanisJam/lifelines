import { describe, expect, it } from "vitest";
import type { ChronicleEntry } from "@/contracts/life";
import { fixtureChronicle } from "@/lib/fixtures";
import { sceneAt, yearTicks } from "@/lib/fixtures/stream";
import { startModel, mergeTick, reconcileDone } from "./live-model";
import { reelEntries } from "./reel-model";
import { scrollAt, tapeYs } from "./tape";
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
  const live = () => ticks.reduce((m, t) => mergeTick(m, t), startModel(birth));

  it("swaps in the saved scene and entries, marks the model saved and opens the frontier to the end of the life", () => {
    const { model } = reconcileDone(live(), done, 1520);
    expect(model.scene).toBe(done.scene);
    expect(model.entries).toBe(done.entries);
    expect(model.saved).toBe(true);
    expect(model.frontier).toBe(timeline(done.scene, 0).end);
  });

  it("moves nothing when the entries behind the clock are the same", () => {
    const sameReel = { ...done, entries: live().entries };
    expect(reconcileDone(live(), sameReel, 1520).tapeOffsetDelta).toBe(0);
  });

  it("reports how far the tape position under the present moved when done adds an entry behind the clock", () => {
    const before = live();
    const extra: ChronicleEntry = { ...before.entries[0]!, id: "extra-entry", at: 1495.5, year: 1495 };
    const richer = { ...done, entries: [extra, ...done.entries] };
    const t = 1520;
    const oldAts = reelEntries(before.entries).map((e) => e.at);
    const newAts = reelEntries(richer.entries).map((e) => e.at);
    const expected = scrollAt(newAts, tapeYs(newAts), t) - scrollAt(oldAts, tapeYs(oldAts), t);
    const { tapeOffsetDelta } = reconcileDone(before, richer, t);
    expect(tapeOffsetDelta).toBeCloseTo(expected, 9);
    expect(tapeOffsetDelta).not.toBe(0);
  });

  it("ignores period summaries, which never reach the reel", () => {
    const withSummary = { ...done, entries: [...live().entries, { ...live().entries[0]!, id: "period-x", kind: "period" as const }] };
    expect(reconcileDone(live(), withSummary, 1520).tapeOffsetDelta).toBe(0);
  });
});

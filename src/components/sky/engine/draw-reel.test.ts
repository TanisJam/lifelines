import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fixtureChronicle } from "@/lib/fixtures";
import { timeline } from "@/lib/sky/dial";
import { computeLayout } from "@/lib/sky/layout";
import { createPlayerStore } from "@/lib/sky/player-store";
import { reelEntries } from "@/lib/sky/reel-model";
import { frameAt } from "@/lib/sky/scene-model";
import { scrollAt, tapeYs } from "@/lib/sky/tape";
import { createReel } from "./draw-reel";
import { FakeEl } from "./fake-dom";

const chronicle = fixtureChronicle("life-elin");
const scene = chronicle.scene;
const layout = computeLayout(scene);
const line = timeline(scene, scene.span.end!);
const entries = reelEntries(chronicle.entries);

let wide: boolean;
let disconnected: number;

beforeEach(() => {
  wide = true;
  disconnected = 0;
  vi.stubGlobal("CSS", { escape: (s: string) => s });
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("min-width") ? wide : false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {
        disconnected++;
      }
    },
  );
  vi.stubGlobal("document", { createElementNS: () => new FakeEl("path") });
});
afterEach(() => vi.unstubAllGlobals());

function setup() {
  const area = new FakeEl("div");
  area.rect = { left: 0, top: 0, width: 1400, height: 800, right: 1400, bottom: 800 };
  area.querySelector(".sky-disc").rect = { left: 0, top: 0, width: 800, height: 800, right: 800, bottom: 800 };
  const ol = new FakeEl("ol", {}, area);
  ol.children = entries.map(() => new FakeEl("li", {}, ol));
  const rail = new FakeEl("svg");
  const store = createPlayerStore();
  const seek = vi.fn();
  const openPerson = vi.fn();
  const change = vi.fn();
  const focus = { setEntry: vi.fn(), setNamed: vi.fn() };
  const reel = createReel({
    area: area as unknown as HTMLElement,
    ol: ol as unknown as HTMLOListElement,
    rail: rail as unknown as SVGSVGElement,
    entries,
    store,
    timeline: line,
    focus,
    seek,
    openPerson,
    change,
  });
  const draw = (t: number) => store.emitFrame(frameAt(scene, layout, t));
  return { area, ol, rail, store, seek, openPerson, change, focus, reel, draw, rows: ol.children };
}

describe("createReel", () => {
  it("clicking a row seeks just past its entry, so the typewriter has started", () => {
    const { ol, seek, rows } = setup();
    ol.fire("click", {}, rows[2]!);
    expect(seek).toHaveBeenCalledWith(entries[2]!.at + 0.03);
  });

  it("Enter and Space seek like a click; other keys do nothing", () => {
    const { ol, seek, rows } = setup();
    const enter = ol.fire("keydown", { key: "Enter" }, rows[1]!);
    ol.fire("keydown", { key: " " }, rows[3]!);
    ol.fire("keydown", { key: "a" }, rows[0]!);
    expect(enter.prevented).toBe(true);
    expect(seek.mock.calls).toEqual([[entries[1]!.at + 0.03], [entries[3]!.at + 0.03]]);
  });

  it("a click on \"Change what happened\" asks for that entry and does not seek", () => {
    const { ol, seek, change, rows } = setup();
    const button = new FakeEl("button", { "data-change": "" }, rows[4]!);
    ol.fire("click", {}, button);
    expect(change).toHaveBeenCalledWith(entries[4]!.id);
    expect(seek).not.toHaveBeenCalled();
  });

  it("a click on a person link opens the person and does not seek", () => {
    const { ol, seek, openPerson, rows } = setup();
    const link = new FakeEl("a", { "data-person-link": "" }, rows[0]!);
    link.dataset.personLink = "p-elin";
    const ev = ol.fire("click", {}, link);
    expect(openPerson).toHaveBeenCalledWith("p-elin");
    expect(ev.prevented).toBe(true);
    expect(seek).not.toHaveBeenCalled();
  });

  describe("wheel", () => {
    it("scrubs back by the wheel delta over the reel zone", () => {
      const { area, seek, draw } = setup();
      draw(1520);
      const ev = area.fire("wheel", { clientX: 1000, clientY: 400, deltaY: 100, deltaMode: 0 });
      expect(ev.prevented).toBe(true);
      expect(seek).toHaveBeenCalledWith(1520 - 100 * 0.004);
    });

    it("scales line-mode deltas", () => {
      const { area, seek, draw } = setup();
      draw(1520);
      area.fire("wheel", { clientX: 1000, clientY: 400, deltaY: 1, deltaMode: 1 });
      expect(seek).toHaveBeenCalledWith(1520 - 33 * 0.004);
    });

    it("ignores the wheel over the sky, left of the compass ring", () => {
      const { area, seek, draw } = setup();
      draw(1520);
      const ev = area.fire("wheel", { clientX: 300, clientY: 400, deltaY: 100, deltaMode: 0 });
      expect(ev.prevented).toBe(false);
      expect(seek).not.toHaveBeenCalled();
    });

    it("ignores the wheel before the first frame and on the narrow layout", () => {
      const first = setup();
      first.area.fire("wheel", { clientX: 1000, clientY: 400, deltaY: 100, deltaMode: 0 });
      expect(first.seek).not.toHaveBeenCalled();
      wide = false;
      const narrow = setup();
      narrow.draw(1520);
      narrow.area.fire("wheel", { clientX: 1000, clientY: 400, deltaY: 100, deltaMode: 0 });
      expect(narrow.seek).not.toHaveBeenCalled();
    });
  });

  it("on the narrow layout hides rows of the future and keeps the told one in the list", () => {
    wide = false;
    const { draw, rows } = setup();
    const k = Math.floor(entries.length / 2);
    draw(entries[k]!.at + 0.5);
    entries.forEach((e, i) => {
      if (e.at > entries[k]!.at + 0.5) expect(rows[i]!.style.display).toBe("none");
    });
    expect(rows[k]!.style.display).toBe("");
    expect(rows[k]!.style.order).toBeDefined();
  });

  it("snapshots the clock and the tape position under the present for a successor reel to ease from", () => {
    const { reel, draw } = setup();
    expect(reel.snapshot()).toBeNull();
    draw(1520);
    const ats = entries.map((e) => e.at);
    expect(reel.snapshot()).toEqual({ t: 1520, scroll: scrollAt(ats, tapeYs(ats), 1520) });
  });

  it("destroy removes every listener and stops the observer", () => {
    const { area, ol, seek, reel, rows, draw } = setup();
    expect(area.listenerCount()).toBe(1);
    expect(ol.listenerCount()).toBe(2);
    reel.destroy();
    expect(area.listenerCount()).toBe(0);
    expect(ol.listenerCount()).toBe(0);
    rows.forEach((li) => expect(li.listenerCount()).toBe(0));
    expect(disconnected).toBe(1);
    draw(1520);
    area.fire("wheel", { clientX: 1000, clientY: 400, deltaY: 100, deltaMode: 0 });
    ol.fire("click", {}, rows[0]!);
    expect(seek).not.toHaveBeenCalled();
  });
});

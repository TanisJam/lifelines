import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fixtureChronicle } from "@/lib/fixtures";
import { timeline } from "@/lib/sky/dial";
import { computeLayout } from "@/lib/sky/layout";
import { createPlayerStore } from "@/lib/sky/player-store";
import { reelEntries, type ReelEntry } from "@/lib/sky/reel-model";
import { frameAt } from "@/lib/sky/scene-model";
import { scrollAt, tapeYs } from "@/lib/sky/tape";
import { createReel } from "./draw-reel";
import { FakeEl, FakeText } from "./fake-dom";

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
  vi.stubGlobal("document", {
    createElementNS: (_ns: string, tag: string) => new FakeEl(tag),
    createElement: (tag: string) => new FakeEl(tag),
    createTextNode: (text: string) => new FakeText(text),
  });
});
afterEach(() => vi.unstubAllGlobals());

function setup(entries: readonly ReelEntry[] = reelEntries(chronicle.entries)) {
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

  it("shows the clicked entry complete while paused, so what was selected is readable", () => {
    const entry = entries[2]!;
    const { draw, rows } = setup([entry]);
    draw(entry.at + 0.03); // exactly where a click seeks
    expect(rows[0]!.querySelector(".t").textContent).toBe(entry.text.title);
    expect(rows[0]!.querySelector(".p").textContent).toBe(entry.text.prose);
  });

  it("still inks the text while playing", () => {
    const entry = entries[2]!;
    const { draw, rows, store } = setup([entry]);
    store.set({ playing: true });
    draw(entry.at + 0.03);
    const typedTitle = rows[0]!.querySelector(".t").textContent!;
    expect(typedTitle.length).toBeLessThan(entry.text.title.length);
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

  describe("literal rendered links", () => {
    const ids = ["plain", 'quotes"\'&<>', "line\r\nbreak", "nul\0id", "\ud800", "\udfff", "雪😀", "__proto__", "constructor", "toString", "{{marker}}", "}", " "];
    const name = '<img src=x onerror="oops">\r\n\0\ud800雪😀{{marker}}';
    const suffix = ' <script>oops</script>\r\0\udfff{{unknown}}';
    function entry(personId: string, linkedName = name): ReelEntry {
      const text = { title: '<b>Title</b>\r\0\ud800', by: 'Choice\r\0', prose: `Before ${linkedName}${suffix}`, links: [{ start: 7, end: 7 + linkedName.length, personId }] };
      return { ...entries[0]!, at: 0, text, parts: [text.title, text.by, text.prose].map((text) => ({ text, rate: 0.01 })) };
    }

    it.each(ids)("renders literal UTF-16 and selects the exact ID %j through an actual anchor", (id) => {
      wide = false;
      const e = entry(id);
      const { draw, rows, ol, openPerson, seek, reel } = setup([e]);
      draw(10);
      expect(rows[0]!.querySelector(".t").textContent).toBe(e.text.title);
      expect(rows[0]!.querySelector(".by").textContent).toBe(e.text.by);
      const prose = rows[0]!.querySelector(".p");
      expect(prose.textContent).toBe(e.text.prose);
      const anchors = prose.children.filter((el) => el.tag === "a");
      expect(anchors).toHaveLength(1);
      const anchor = anchors[0]!;
      expect(anchor.textContent).toBe(name);
      expect(anchor.attrs).toEqual({ href: "#", "data-person-link": "" });
      expect(anchor.children).toHaveLength(0);
      expect(anchor.childNodes[0]).toBeInstanceOf(FakeText);
      anchor.dataset.personLink = "tampered";
      expect(ol.fire("click", {}, anchor).prevented).toBe(true);
      const child = new FakeEl("span");
      anchor.append(child);
      child.fire("click");
      expect(openPerson.mock.calls).toEqual([[id], [id]]);
      expect(seek).not.toHaveBeenCalled();
      reel.destroy();
    });

    it("keeps each rendered prefix, partial anchor and caret correct while scrubbing backwards", () => {
      wide = false;
      const e = entry("a", "Ann");
      const { draw, rows, ol, openPerson, reel, store } = setup([e]);
      // Partial text only happens while the clock runs; paused rows are shown complete (see below).
      store.set({ playing: true });
      const title = rows[0]!.querySelector(".t");
      const by = rows[0]!.querySelector(".by");
      const prose = rows[0]!.querySelector(".p");
      draw(0.025);
      expect(title.textContent).toBe(e.text.title.slice(0, 2));
      expect(title.children.map((el) => el.attrs.class)).toEqual(["sky-caret"]);
      draw((e.text.title.length + 1.5) * 0.01);
      expect(title.children).toHaveLength(0);
      expect(by.textContent).toBe("C");
      expect(by.children.map((el) => el.attrs.class)).toEqual(["sky-caret"]);
      draw((e.text.title.length + e.text.by!.length + 9.5) * 0.01);
      expect(title.textContent).toBe(e.text.title);
      expect(by.textContent).toBe(e.text.by);
      expect(prose.textContent).toBe("Before An");
      expect(prose.children.map((el) => el.tag)).toEqual(["a", "span"]);
      expect(prose.children[0]!.textContent).toBe("An");
      const partial = prose.children[0]!;
      ol.fire("click", {}, partial);
      expect(openPerson).toHaveBeenCalledWith("a");
      draw(10);
      expect(partial.parentElement).toBeNull();
      expect(prose.textContent).toBe(e.text.prose);
      expect(prose.children.map((el) => el.tag)).toEqual(["a"]);
      draw((e.text.title.length + e.text.by!.length + 6.5) * 0.01);
      expect(prose.textContent).toBe("Before");
      expect(prose.children.map((el) => el.tag)).toEqual(["span"]);
      draw(0);
      expect(prose.textContent).toBe("");
      expect(prose.style.display).toBe("none");
      reel.destroy();
    });

    it("uses WeakMap membership for an empty internal range ID without admitting it as canonical", () => {
      wide = false;
      const { draw, rows, ol, openPerson, seek, reel } = setup([entry("", "Ann")]);
      draw(10);
      const anchor = rows[0]!.querySelector(".p").children[0]!;
      anchor.dataset.personLink = "not-the-id";
      ol.fire("click", {}, anchor);
      expect(openPerson).toHaveBeenCalledWith("");
      expect(seek).not.toHaveBeenCalled();
      reel.destroy();
    });

    it("renders legacy marker resolution literally without changing unknown-marker removal", () => {
      wide = false;
      const source = { ...chronicle.entries[0]!, at: 0, title: "a < b & c", prose: "{{a}} + {{missing}} suffix{{a}}", links: [{ personId: "a", name: name }] };
      const resolved = reelEntries([source]);
      const { draw, rows, reel, store } = setup(resolved);
      store.set({ playing: true }); // partial text is a playing-only effect
      draw(0.016 * 5.5);
      expect(rows[0]!.querySelector(".t").textContent).toBe("a < b");
      draw(10);
      expect(rows[0]!.querySelector(".p").textContent).toBe(`${name} +  suffix${name}`);
      expect(rows[0]!.querySelector(".p").children.map((el) => el.textContent)).toEqual([name, name]);
      reel.destroy();
    });

    it("distinguishes same-name people, guards unmapped hooks, excludes link keys and cleans up", () => {
      wide = false;
      const e = entry("first", "Ann");
      const text = { ...e.text, prose: "AnnAnn", links: [{ start: 0, end: 3, personId: "first" }, { start: 3, end: 6, personId: "second" }] };
      const { draw, rows, ol, openPerson, seek, reel } = setup([{ ...e, text, parts: [text.title, text.by!, text.prose].map((text) => ({ text, rate: 0.01 })) }]);
      draw(10);
      const prose = rows[0]!.querySelector(".p");
      const anchors = prose.children.filter((el) => el.tag === "a");
      expect(anchors).toHaveLength(2);
      anchors.forEach((a) => ol.fire("click", {}, a));
      expect(openPerson.mock.calls).toEqual([["first"], ["second"]]);
      const unknown = new FakeEl("a", { "data-person-link": "" }, rows[0]!);
      ol.fire("click", {}, unknown);
      expect(openPerson).toHaveBeenCalledTimes(2);
      ol.fire("keydown", { key: "Enter" }, anchors[0]!);
      ol.fire("keydown", { key: " " }, new FakeEl("button", {}, rows[0]!));
      expect(seek).not.toHaveBeenCalled();
      reel.destroy();
      anchors[0]!.fire("click");
      draw(0);
      expect(openPerson).toHaveBeenCalledTimes(2);
      expect(prose.textContent).toBe(text.prose);
    });
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

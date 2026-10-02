import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { timeline } from "@/lib/sky/dial";
import { elinScene } from "@/lib/sky/fixture-scene";
import { createPlayerStore } from "@/lib/sky/player-store";
import { createSkyEngine } from "./create-sky-engine";

/** Just enough of an Element for the engine's attribute writes; selectors resolve to one cached node each. */
function fakeEl(): Record<string, unknown> {
  const classes = new Set<string>();
  const found = new Map<string, unknown>();
  return {
    style: { setProperty() {} },
    dataset: {},
    classList: { contains: (n: string) => classes.has(n), toggle: (n: string) => (classes.delete(n) ? false : !!classes.add(n)) },
    setAttribute() {},
    remove() {},
    appendChild() {},
    querySelector(sel: string) {
      if (!found.has(sel)) found.set(sel, fakeEl());
      return found.get(sel);
    },
    querySelectorAll: () => [],
  };
}

const scene = elinScene();
const line = timeline(scene, scene.span.end!);

function fakeSvg() {
  const svg = fakeEl();
  const village = scene.village.map(() => fakeEl());
  const bands = scene.bands.map((b) => ({ ...fakeEl(), dataset: { from: String(b.from), to: String(b.to) } }));
  svg.querySelectorAll = (sel: string) => (sel === "[data-village]" ? village : sel === "[data-band]" ? bands : []);
  return svg as unknown as SVGSVGElement;
}

let frameCallbacks: Array<(ms: number) => void>;
let cancelled: number[];
let mqListeners: Set<() => void>;

beforeEach(() => {
  frameCallbacks = [];
  cancelled = [];
  mqListeners = new Set();
  vi.stubGlobal("CSS", { escape: (s: string) => s });
  vi.stubGlobal("requestAnimationFrame", (cb: (ms: number) => void) => frameCallbacks.push(cb));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => cancelled.push(id));
  // Reduced motion keeps the ambient layer (and its DOM) out of these tests.
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: (_: string, l: () => void) => mqListeners.add(l), removeEventListener: (_: string, l: () => void) => mqListeners.delete(l) }));
});
afterEach(() => vi.unstubAllGlobals());

function setup() {
  const store = createPlayerStore();
  const engine = createSkyEngine({ svg: fakeSvg(), scene, timeline: line, store });
  const seen: number[] = [];
  store.onFrame((f) => seen.push(f.t));
  /** Runs the loop callback the engine last scheduled, `ms` after the engine started. */
  const tick = (ms: number) => frameCallbacks.at(-1)!(performance.now() + ms);
  return { store, engine, seen, tick };
}

describe("createSkyEngine controls", () => {
  it("restarts from the start when toggled at the end, and pauses when toggled while playing", () => {
    const { store, engine, seen, tick } = setup();
    engine.seek(line.end);
    expect(seen.at(-1)).toBe(line.end);
    engine.toggle();
    expect(store.get().playing).toBe(true);
    tick(16);
    expect(seen.at(-1)).toBeGreaterThanOrEqual(line.start);
    expect(seen.at(-1)).toBeLessThan(line.start + 0.2);
    engine.toggle();
    expect(store.get().playing).toBe(false);
  });

  it("seek pauses, clears waiting and clamps to the life", () => {
    const { store, engine, seen } = setup();
    store.set({ playing: true, waiting: true });
    engine.seek(1517.5);
    expect(store.get()).toMatchObject({ playing: false, waiting: false });
    expect(seen.at(-1)).toBe(1517.5);
    engine.seek(-1e9);
    expect(seen.at(-1)).toBe(line.start);
    engine.seek(1e9);
    expect(seen.at(-1)).toBe(line.end);
  });

  it("destroy cancels the pending frame and the reduced-motion subscription", () => {
    const { engine, tick } = setup();
    tick(16);
    expect(mqListeners.size).toBe(1);
    engine.destroy();
    expect(cancelled).toEqual([frameCallbacks.length]);
    expect(mqListeners.size).toBe(0);
  });

  it("update grows the scene over the same clock: t stays, the frontier opens, nothing remounts", () => {
    const early = { ...scene, people: scene.people.filter((p) => p.appearsAt < 1510), edges: [], span: { ...scene.span, end: null } };
    const store = createPlayerStore();
    const engine = createSkyEngine({ svg: fakeSvg(), scene: early, timeline: timeline(early, 1505), store, frontier: 1505 });
    const seen: number[] = [];
    store.onFrame((f) => seen.push(f.t));
    engine.seek(1530);
    expect(seen.at(-1)).toBe(1505);
    const grown = timeline(scene, scene.span.end!);
    engine.update({ scene, timeline: grown });
    expect(seen.at(-1)).toBe(1505);
    engine.seek(1530);
    expect(seen.at(-1)).toBe(1530);
    expect(cancelled).toEqual([]);
  });
});

import { describe, expect, it, vi } from "vitest";
import { createPlayerStore, nextSpeed } from "./player-store";

describe("player store", () => {
  it("cycles the speed 1x, 2x, 4x and back", () => {
    expect([1, 2, 4].map((s) => nextSpeed(s as 1 | 2 | 4))).toEqual([2, 4, 1]);
  });

  it("keeps the same snapshot until something changes, and tells subscribers once", () => {
    const store = createPlayerStore();
    const before = store.get();
    const seen = vi.fn();
    const off = store.subscribe(seen);
    store.set({ playing: false });
    expect(store.get()).toBe(before);
    store.set({ playing: true });
    expect(store.get()).toEqual({ playing: true, speed: 1, waiting: false });
    expect(seen).toHaveBeenCalledTimes(1);
    off();
    store.set({ speed: 4 });
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it("fans every frame out to frame listeners without touching state", () => {
    const store = createPlayerStore();
    const frames: number[] = [];
    const off = store.onFrame((frame) => frames.push(frame.t));
    const before = store.get();
    store.emitFrame({ t: 1500, people: [], edges: [], souls: 0, circle: 0, plague: 0 });
    off();
    store.emitFrame({ t: 1501, people: [], edges: [], souls: 0, circle: 0, plague: 0 });
    expect(frames).toEqual([1500]);
    expect(store.get()).toBe(before);
  });
});

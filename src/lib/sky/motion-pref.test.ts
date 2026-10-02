import { afterEach, describe, expect, it, vi } from "vitest";
import { prefersReducedMotion, subscribeReducedMotion } from "./motion-pref";

type Listener = () => void;

/** A minimal matchMedia double whose `matches` can be flipped and announced. */
function stubMatchMedia(initial: boolean) {
  const listeners = new Set<Listener>();
  const mq = {
    matches: initial,
    addEventListener: (_: string, l: Listener) => listeners.add(l),
    removeEventListener: (_: string, l: Listener) => listeners.delete(l),
  };
  const query = vi.fn(() => mq);
  vi.stubGlobal("matchMedia", query);
  return {
    query,
    listeners,
    set(next: boolean) {
      mq.matches = next;
      listeners.forEach((l) => l());
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("motion-pref", () => {
  it("reads the prefers-reduced-motion media query", () => {
    const mm = stubMatchMedia(true);
    expect(prefersReducedMotion()).toBe(true);
    expect(mm.query).toHaveBeenCalledWith("(prefers-reduced-motion: reduce)");
  });

  it("defaults to full motion where matchMedia does not exist", () => {
    vi.stubGlobal("matchMedia", undefined);
    expect(prefersReducedMotion()).toBe(false);
    expect(subscribeReducedMotion(() => {})()).toBeUndefined();
  });

  it("announces changes until unsubscribed", () => {
    const mm = stubMatchMedia(false);
    const seen: boolean[] = [];
    const off = subscribeReducedMotion((reduced) => seen.push(reduced));
    mm.set(true);
    mm.set(false);
    off();
    mm.set(true);
    expect(seen).toEqual([true, false]);
    expect(mm.listeners.size).toBe(0);
  });
});

import { describe, expect, it } from "vitest";
import { LruCache } from "./lru-cache";

describe("LruCache", () => {
  it("evicts the least-recently-used entry once over capacity", () => {
    const cache = new LruCache<string, number>(2);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3); // evicts "a" (never read since)
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe(2);
    expect(cache.get("c")).toBe(3);
    expect(cache.size).toBe(2);
  });

  it("a get() promotes an entry to most-recently-used, protecting it from the next eviction", () => {
    const cache = new LruCache<string, number>(2);
    cache.set("a", 1);
    cache.set("b", 2);
    expect(cache.get("a")).toBe(1); // "a" is now MRU, "b" is LRU
    cache.set("c", 3); // evicts "b", not "a"
    expect(cache.get("a")).toBe(1);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("c")).toBe(3);
  });

  it("re-setting an existing key updates its value and refreshes its recency", () => {
    const cache = new LruCache<string, number>(1);
    cache.set("a", 1);
    cache.set("a", 2);
    expect(cache.get("a")).toBe(2);
    expect(cache.size).toBe(1);
  });

  it("delete() removes an entry", () => {
    const cache = new LruCache<string, number>(2);
    cache.set("a", 1);
    expect(cache.delete("a")).toBe(true);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.delete("a")).toBe(false);
  });

  it("rejects a non-positive or non-finite maxSize", () => {
    expect(() => new LruCache(0)).toThrow();
    expect(() => new LruCache(-1)).toThrow();
    expect(() => new LruCache(Infinity)).toThrow();
  });
});

/**
 * A small LRU cache bounding the write-through Map caches in `life-store.ts`/`world-store.ts`
 * (self-hosted Docker deploy: an unbounded cache would grow memory without limit — a full-lifespan
 * life alone holds tens of MB of snapshots uncompressed once hydrated). Backed by a plain `Map`,
 * whose keys iterate in insertion order: `get` deletes-then-reinserts the key so it becomes the
 * most-recently-used (last), and `set` evicts from the front (least-recently-used) once over
 * capacity. Eviction only ever drops the cache entry — the caller's `ensureLoaded`-style lazy
 * hydration reloads it from SQLite on the next access, so nothing is ever lost, only re-read.
 */
export class LruCache<K, V> {
  private readonly map = new Map<K, V>();

  constructor(private readonly maxSize: number) {
    if (!Number.isFinite(maxSize) || maxSize < 1) throw new Error(`LruCache maxSize must be a positive finite number, got ${String(maxSize)}`);
  }

  get(key: K): V | undefined {
    const value = this.map.get(key);
    if (value === undefined) return undefined;
    // Re-insert so this key becomes the most-recently-used (Map keys iterate in insertion order).
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.maxSize) {
      const oldestKey = this.map.keys().next().value as K;
      this.map.delete(oldestKey);
    }
  }

  delete(key: K): boolean {
    return this.map.delete(key);
  }

  get size(): number {
    return this.map.size;
  }
}

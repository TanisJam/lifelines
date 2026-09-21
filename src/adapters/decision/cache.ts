import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** Deterministic JSON stringify with sorted object keys, so the same logical value always hashes the same way. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`).join(",")}}`;
}

/** A stable cache key from a question id plus its relevant state, so re-simulating a fork only pays for decisions whose state actually changed. */
export function decisionCacheKey(questionId: string, state: unknown): string {
  const hash = createHash("sha256").update(questionId).update("::").update(stableStringify(state)).digest("hex");
  return `${questionId}::${hash.slice(0, 24)}`;
}

/**
 * A tiny in-memory cache with optional file-based persistence under
 * `.cache/`, so a dev server restart (or a second fork re-simulation that
 * shares unchanged state) doesn't re-pay for identical Jev calls. Server
 * side only — never import this from client code.
 */
export class FileBackedCache<V> {
  private readonly map = new Map<string, V>();
  private dirty = false;

  constructor(private readonly filePath?: string) {
    this.load();
  }

  private load(): void {
    if (!this.filePath) return;
    try {
      if (!existsSync(this.filePath)) return;
      const raw = readFileSync(this.filePath, "utf8");
      const obj = JSON.parse(raw) as Record<string, V>;
      for (const [key, value] of Object.entries(obj)) this.map.set(key, value);
    } catch {
      // Corrupt or unreadable cache file: start fresh rather than failing the app.
    }
  }

  get(key: string): V | undefined {
    return this.map.get(key);
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  set(key: string, value: V): void {
    this.map.set(key, value);
    this.dirty = true;
  }

  get size(): number {
    return this.map.size;
  }

  flush(): void {
    if (!this.filePath || !this.dirty) return;
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      writeFileSync(this.filePath, JSON.stringify(Object.fromEntries(this.map)), "utf8");
      this.dirty = false;
    } catch {
      // Best-effort persistence; the in-memory cache still works for this process's lifetime.
    }
  }
}

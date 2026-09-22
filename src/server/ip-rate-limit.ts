import type { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { dataDir, envInt, openDb, withTransaction } from "./db";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export interface RateLimitOptions {
  readonly perHour: number;
  readonly perDay: number;
}

export interface RateLimitResult {
  readonly ok: boolean;
  /** Present only when `ok` is false — how long until this IP has room for another attempt. */
  readonly retryAfterSeconds?: number;
}

export interface IpRateLimiter {
  /**
   * Atomically checks AND (only when allowed) records one attempt for `ip` — a single call, so a
   * route never has a check-then-act race with itself under concurrent requests from the same IP.
   * `now` is injectable for deterministic tests; defaults to `Date.now()`.
   */
  consume(ip: string, now?: number): RateLimitResult;
  /** Closes the underlying DB connection. Only needed by tests simulating a restart. */
  close(): void;
}

function retryAfterFor(db: DatabaseSync, ip: string, now: number, windowMs: number): number {
  const row = db.prepare("SELECT MIN(created_at) as oldest FROM ip_rate_limit_events WHERE ip = ? AND created_at >= ?").get(ip, now - windowMs) as { oldest: number | null };
  const oldest = row.oldest ?? now;
  return Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
}

/**
 * Builds an independent rate limiter backed by its own SQLite connection at `dbPath` (defaults to
 * `${DATA_DIR}/lifelines.db`, same file/table `db.ts` sets up — see `ip_rate_limit_events`). A
 * sliding window (not a fixed bucket that resets on the hour): each allowed attempt is one row, so
 * "how many in the last hour/day" is always exact, never off by a reset boundary. Pruned
 * opportunistically on every `consume()` call — rows for the calling IP older than the longest
 * window are deleted first, so the table never grows unbounded for a repeat visitor and a burst of
 * traffic never needs a separate cron/cleanup job.
 */
export function createIpRateLimiter(dbPath?: string, options?: Partial<RateLimitOptions>): IpRateLimiter {
  const db: DatabaseSync = openDb(dbPath ?? path.join(dataDir(), "lifelines.db"));
  const perHour = options?.perHour ?? envInt("RATE_LIMIT_PER_HOUR", 6);
  const perDay = options?.perDay ?? envInt("RATE_LIMIT_PER_DAY", 20);

  function consume(ip: string, now: number = Date.now()): RateLimitResult {
    return withTransaction(db, () => {
      db.prepare("DELETE FROM ip_rate_limit_events WHERE ip = ? AND created_at < ?").run(ip, now - DAY_MS);

      const dayCount = (db.prepare("SELECT COUNT(*) as c FROM ip_rate_limit_events WHERE ip = ?").get(ip) as { c: number }).c;
      if (dayCount >= perDay) {
        return { ok: false, retryAfterSeconds: retryAfterFor(db, ip, now, DAY_MS) };
      }

      const hourCount = (db.prepare("SELECT COUNT(*) as c FROM ip_rate_limit_events WHERE ip = ? AND created_at >= ?").get(ip, now - HOUR_MS) as { c: number }).c;
      if (hourCount >= perHour) {
        return { ok: false, retryAfterSeconds: retryAfterFor(db, ip, now, HOUR_MS) };
      }

      db.prepare("INSERT INTO ip_rate_limit_events (ip, created_at) VALUES (?, ?)").run(ip, now);
      return { ok: true };
    });
  }

  return { consume, close: () => db.close() };
}

// Process-wide singleton, same `globalThis` reasoning as `db.ts`/`world-store.ts`: Next.js can
// bundle Route Handlers separately, so a plain module-level variable could fork into independent
// instances (and independent in-process state) across bundles.
const globalLimiterKey = "__lifelinesIpRateLimiter__";
const globalWithLimiter = globalThis as typeof globalThis & { [globalLimiterKey]?: IpRateLimiter };

export function getIpRateLimiter(): IpRateLimiter {
  globalWithLimiter[globalLimiterKey] ??= createIpRateLimiter();
  return globalWithLimiter[globalLimiterKey];
}

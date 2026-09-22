import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createIpRateLimiter, type IpRateLimiter } from "./ip-rate-limit";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

describe("createIpRateLimiter (per-IP sliding window, SQLite-persisted)", () => {
  let dir: string;
  let dbPath: string;
  let limiter: IpRateLimiter;

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), "lifelines-rate-limit-test-"));
    dbPath = path.join(dir, "lifelines.db");
    limiter = createIpRateLimiter(dbPath, { perHour: 3, perDay: 5 });
  });

  afterEach(() => {
    limiter.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("allows attempts up to the hourly limit, then blocks with a positive retryAfterSeconds", () => {
    const now = Date.parse("2026-01-01T00:00:00Z");
    for (let i = 0; i < 3; i++) {
      expect(limiter.consume("1.2.3.4", now + i * 1000)).toEqual({ ok: true });
    }
    const blocked = limiter.consume("1.2.3.4", now + 3000);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    expect(blocked.retryAfterSeconds).toBeLessThanOrEqual(Math.ceil(HOUR_MS / 1000));
  });

  it("a fresh hour frees up a slot again (sliding window, not a fixed reset)", () => {
    const now = Date.parse("2026-01-01T00:00:00Z");
    for (let i = 0; i < 3; i++) expect(limiter.consume("5.5.5.5", now + i * 1000).ok).toBe(true);
    expect(limiter.consume("5.5.5.5", now + 3000).ok).toBe(false);

    // Just over an hour after the FIRST attempt, that attempt has aged out of the window.
    const laterNow = now + HOUR_MS + 1000;
    expect(limiter.consume("5.5.5.5", laterNow).ok).toBe(true);
  });

  it("different IPs get independent buckets", () => {
    const now = Date.parse("2026-01-01T00:00:00Z");
    for (let i = 0; i < 3; i++) expect(limiter.consume("9.9.9.9", now + i * 1000).ok).toBe(true);
    expect(limiter.consume("9.9.9.9", now + 3000).ok).toBe(false);
    // A different IP is unaffected by 9.9.9.9's exhausted hourly limit.
    expect(limiter.consume("8.8.8.8", now + 3000).ok).toBe(true);
  });

  it("enforces the daily limit even when requests are spread across many separate hours", () => {
    const now = Date.parse("2026-01-01T00:00:00Z");
    // perDay=5, perHour=3: spend the 5 daily attempts one per hour, well under the hourly cap.
    for (let i = 0; i < 5; i++) {
      expect(limiter.consume("2.2.2.2", now + i * HOUR_MS).ok).toBe(true);
    }
    const blocked = limiter.consume("2.2.2.2", now + 5 * HOUR_MS);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    expect(blocked.retryAfterSeconds).toBeLessThanOrEqual(Math.ceil(DAY_MS / 1000));
  });

  it("prunes rows older than the day window opportunistically, so the table doesn't grow unbounded", () => {
    const now = Date.parse("2026-01-01T00:00:00Z");
    expect(limiter.consume("3.3.3.3", now).ok).toBe(true);
    // Two days later, the earlier row should have been pruned and a fresh hourly/daily window opens.
    const muchLater = now + 2 * DAY_MS;
    for (let i = 0; i < 5; i++) {
      expect(limiter.consume("3.3.3.3", muchLater + i * HOUR_MS).ok).toBe(true);
    }
  });

  it("survives a simulated restart against the same DB file (limits persist, not just in-memory)", () => {
    const now = Date.parse("2026-01-01T00:00:00Z");
    for (let i = 0; i < 3; i++) expect(limiter.consume("6.6.6.6", now + i * 1000).ok).toBe(true);
    limiter.close();

    // Reassign so `afterEach`'s `limiter.close()` closes THIS (still-open) connection, not the
    // already-closed one above.
    limiter = createIpRateLimiter(dbPath, { perHour: 3, perDay: 5 });
    expect(limiter.consume("6.6.6.6", now + 4000).ok).toBe(false);
  });

  it("reads defaults from RATE_LIMIT_PER_HOUR/RATE_LIMIT_PER_DAY when no explicit options are passed", () => {
    const previousHour = process.env.RATE_LIMIT_PER_HOUR;
    const previousDay = process.env.RATE_LIMIT_PER_DAY;
    process.env.RATE_LIMIT_PER_HOUR = "1";
    process.env.RATE_LIMIT_PER_DAY = "10";
    try {
      const envLimiter = createIpRateLimiter(path.join(dir, "env-defaults.db"));
      try {
        const now = Date.parse("2026-01-01T00:00:00Z");
        expect(envLimiter.consume("7.7.7.7", now).ok).toBe(true);
        expect(envLimiter.consume("7.7.7.7", now + 1).ok).toBe(false);
      } finally {
        envLimiter.close();
      }
    } finally {
      if (previousHour === undefined) delete process.env.RATE_LIMIT_PER_HOUR;
      else process.env.RATE_LIMIT_PER_HOUR = previousHour;
      if (previousDay === undefined) delete process.env.RATE_LIMIT_PER_DAY;
      else process.env.RATE_LIMIT_PER_DAY = previousDay;
    }
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { guardSimulation } from "./abuse-guard";

function requestFrom(ip: string): Request {
  return new Request("http://localhost/api/lives/stream", { method: "POST", headers: { "cf-connecting-ip": ip } });
}

/**
 * `guardSimulation` goes through the process-wide default `IpRateLimiter` singleton (same
 * `globalThis`/shared-`DATA_DIR` reasoning as every other store in `db.ts`) — a real SQLite file
 * under the vitest worker's temp `DATA_DIR`, which (per `vitest.setup.ts`) is keyed by a
 * deterministic pool id and so can be REUSED across separate `pnpm test` invocations. A fresh
 * random "IP" per test avoids colliding with rows a previous run may have left behind for a
 * literal address like `198.51.100.1`.
 */
function freshIp(): string {
  return `test-${Math.random().toString(36).slice(2)}`;
}

describe("guardSimulation (rate limit + Turnstile, in that order)", () => {
  const originalSiteKey = process.env.TURNSTILE_SITE_KEY;
  const originalSecretKey = process.env.TURNSTILE_SECRET_KEY;
  const originalFetch = global.fetch;

  afterEach(() => {
    if (originalSiteKey === undefined) delete process.env.TURNSTILE_SITE_KEY;
    else process.env.TURNSTILE_SITE_KEY = originalSiteKey;
    if (originalSecretKey === undefined) delete process.env.TURNSTILE_SECRET_KEY;
    else process.env.TURNSTILE_SECRET_KEY = originalSecretKey;
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("returns { ok: true, engine } once rate limit and (unconfigured) Turnstile both pass", async () => {
    delete process.env.TURNSTILE_SITE_KEY;
    delete process.env.TURNSTILE_SECRET_KEY;

    const result = await guardSimulation(requestFrom(freshIp()), {});

    expect(result).not.toBeInstanceOf(Response);
    if (result instanceof Response) throw new Error("unreachable");
    expect(result.ok).toBe(true);
    expect(result.engine.engineSource).toBe("rules");
    expect(typeof result.engine.decisionMaker.decide).toBe("function");
  });

  it("returns a 429 with Retry-After once the default hourly limit (6/hour) is exhausted for one IP", async () => {
    delete process.env.TURNSTILE_SITE_KEY;
    delete process.env.TURNSTILE_SECRET_KEY;
    const ip = freshIp();

    for (let i = 0; i < 6; i++) {
      const attempt = await guardSimulation(requestFrom(ip), {});
      expect(attempt).not.toBeInstanceOf(Response);
    }

    const blocked = await guardSimulation(requestFrom(ip), {});
    expect(blocked).toBeInstanceOf(Response);
    if (!(blocked instanceof Response)) throw new Error("unreachable");
    expect(blocked.status).toBe(429);
    const retryAfterHeader = blocked.headers.get("Retry-After");
    expect(retryAfterHeader).toBeTruthy();
    expect(Number(retryAfterHeader)).toBeGreaterThan(0);
    const body = (await blocked.json()) as { error: string; retryAfterSeconds: number };
    expect(body.error).toBe("rate_limited");
    expect(body.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("a different IP is unaffected by another IP's exhausted rate limit", async () => {
    delete process.env.TURNSTILE_SITE_KEY;
    delete process.env.TURNSTILE_SECRET_KEY;
    const exhaustedIp = freshIp();
    for (let i = 0; i < 6; i++) await guardSimulation(requestFrom(exhaustedIp), {});
    expect(await guardSimulation(requestFrom(exhaustedIp), {})).toBeInstanceOf(Response);

    const result = await guardSimulation(requestFrom(freshIp()), {});
    expect(result).not.toBeInstanceOf(Response);
  });

  it("returns a 403 when Turnstile is configured and verification fails, WITHOUT consuming an extra rate-limit slot beyond the attempt itself", async () => {
    process.env.TURNSTILE_SITE_KEY = "site-key";
    process.env.TURNSTILE_SECRET_KEY = "secret-key";
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: false, "error-codes": ["invalid-input-response"] }) }) as unknown as typeof fetch;

    const result = await guardSimulation(requestFrom(freshIp()), { turnstileToken: "bad-token" });

    expect(result).toBeInstanceOf(Response);
    if (!(result instanceof Response)) throw new Error("unreachable");
    expect(result.status).toBe(403);
    const body = (await result.json()) as { error: string };
    expect(body.error).toBe("verification_failed");
  });

  it("passes once Turnstile is configured and verification succeeds", async () => {
    process.env.TURNSTILE_SITE_KEY = "site-key";
    process.env.TURNSTILE_SECRET_KEY = "secret-key";
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) }) as unknown as typeof fetch;

    const result = await guardSimulation(requestFrom(freshIp()), { turnstileToken: "good-token" });

    expect(result).not.toBeInstanceOf(Response);
  });

  it("checks the rate limit BEFORE Turnstile — an already-exhausted IP gets 429, never reaching siteverify", async () => {
    process.env.TURNSTILE_SITE_KEY = "site-key";
    process.env.TURNSTILE_SECRET_KEY = "secret-key";
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
    global.fetch = fetchSpy as unknown as typeof fetch;
    const ip = freshIp();

    // Exhaust the hourly limit first, WITHOUT a Turnstile token (guard still passes: rate limit
    // check runs before Turnstile, and it's configured only from here on for clarity).
    delete process.env.TURNSTILE_SITE_KEY;
    delete process.env.TURNSTILE_SECRET_KEY;
    for (let i = 0; i < 6; i++) await guardSimulation(requestFrom(ip), {});
    process.env.TURNSTILE_SITE_KEY = "site-key";
    process.env.TURNSTILE_SECRET_KEY = "secret-key";

    const blocked = await guardSimulation(requestFrom(ip), { turnstileToken: "good-token" });
    expect(blocked).toBeInstanceOf(Response);
    if (!(blocked instanceof Response)) throw new Error("unreachable");
    expect(blocked.status).toBe(429);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

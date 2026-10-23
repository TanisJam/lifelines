import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { guardSimulation, guardSimulationAccess } from "./abuse-guard";
import * as decisionEngine from "./decision-engine";
import * as rateLimit from "./ip-rate-limit";
import * as turnstile from "./turnstile";

vi.mock("./decision-engine", () => ({
  getDecisionMaker: vi.fn(() => ({ decide: vi.fn() })),
  activeEngineName: vi.fn(() => "rules"),
  getBackgroundDecisionMaker: vi.fn(() => undefined),
  snapshotDecisionMakerStats: vi.fn(),
  decisionMakerRunStats: vi.fn(),
}));

function expectNoEngineCalls(): void {
  for (const exported of Object.values(decisionEngine)) expect(exported).not.toHaveBeenCalled();
}

function requestFrom(ip: string): Request {
  return new Request("http://localhost/api/lives/stream", { method: "POST", headers: { "cf-connecting-ip": ip } });
}

/**
 * `guardSimulation` goes through the process-wide default `IpRateLimiter` singleton (same
 * `globalThis`/shared-`DATA_DIR` reasoning as every other store in `db.ts`) — a real SQLite file
 * under this file's owned disposable `DATA_DIR` (per `vitest.setup.ts`). A fresh random "IP"
 * per test keeps independent cases from sharing a bucket inside this run.
 */
function freshIp(): string {
  return `test-${Math.random().toString(36).slice(2)}`;
}

describe("guardSimulation (rate limit + Turnstile, in that order)", () => {
  const originalSiteKey = process.env.TURNSTILE_SITE_KEY;
  const originalSecretKey = process.env.TURNSTILE_SECRET_KEY;
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(decisionEngine.getDecisionMaker).mockReset().mockReturnValue({ decide: vi.fn() });
    vi.mocked(decisionEngine.activeEngineName).mockReset().mockReturnValue("rules");
    vi.mocked(decisionEngine.getBackgroundDecisionMaker).mockReset().mockReturnValue(undefined);
    global.fetch = vi.fn(() => { throw new Error("Unexpected outgoing request"); }) as typeof fetch;
  });

  afterEach(() => {
    if (originalSiteKey === undefined) delete process.env.TURNSTILE_SITE_KEY;
    else process.env.TURNSTILE_SITE_KEY = originalSiteKey;
    if (originalSecretKey === undefined) delete process.env.TURNSTILE_SECRET_KEY;
    else process.env.TURNSTILE_SECRET_KEY = originalSecretKey;
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("admits access without calling any decision-engine export", async () => {
    delete process.env.TURNSTILE_SITE_KEY;
    delete process.env.TURNSTILE_SECRET_KEY;

    expect(await guardSimulationAccess(requestFrom(freshIp()), {})).toEqual({ ok: true });
    expectNoEngineCalls();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  const guards = [
    { name: "access", guard: guardSimulationAccess },
    { name: "legacy", guard: guardSimulation },
  ];

  describe.each(guards)("$name admission contract", ({ guard }) => {
    it("verifies a configured token with the same resolved IP and consumes exactly once", async () => {
      process.env.TURNSTILE_SITE_KEY = "site-key";
      process.env.TURNSTILE_SECRET_KEY = "secret-key";
      const consume = vi.fn(() => ({ ok: true }));
      vi.spyOn(rateLimit, "getIpRateLimiter").mockReturnValue({ consume, close: vi.fn() });
      global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
      const request = new Request("http://localhost", { headers: { "cf-connecting-ip": " 198.51.100.1 ", "x-forwarded-for": "198.51.100.2" } });

      expect(await guard(request, { turnstileToken: "good-token" })).not.toBeInstanceOf(Response);
      expect(consume).toHaveBeenCalledExactlyOnceWith("198.51.100.1");
      const [, options] = vi.mocked(global.fetch).mock.calls[0]!;
      const form = options!.body as URLSearchParams;
      expect(form.get("remoteip")).toBe("198.51.100.1");
      expect(form.get("response")).toBe("good-token");
      if (guard === guardSimulationAccess) expectNoEngineCalls();
    });

    it.each([
      { headers: new Headers({ "x-forwarded-for": " 198.51.100.2, 198.51.100.3 " }), ip: "198.51.100.2" },
      { headers: new Headers(), ip: "unknown" },
    ])("preserves IP fallback $ip", async ({ headers, ip }) => {
      const consume = vi.fn(() => ({ ok: true }));
      vi.spyOn(rateLimit, "getIpRateLimiter").mockReturnValue({ consume, close: vi.fn() });
      const verify = vi.spyOn(turnstile, "verifyTurnstile").mockResolvedValue({ ok: true });

      await guard(new Request("http://localhost", { headers }), {});
      expect(consume).toHaveBeenCalledExactlyOnceWith(ip);
      expect(verify).toHaveBeenCalledExactlyOnceWith(undefined, ip);
    });

    it.each([37, undefined])("prioritizes 429 over verification and preserves retry %s", async (retryAfterSeconds) => {
      const consume = vi.fn(() => ({ ok: false, retryAfterSeconds }));
      vi.spyOn(rateLimit, "getIpRateLimiter").mockReturnValue({ consume, close: vi.fn() });
      const verify = vi.spyOn(turnstile, "verifyTurnstile").mockRejectedValue(new Error("Must not verify"));

      const result = await guard(requestFrom("blocked-ip"), { turnstileToken: "bad-token" });
      if (!(result instanceof Response)) throw new Error("Expected denial");
      expect(result.status).toBe(429);
      expect(result.headers.get("Content-Type")).toBe("application/json");
      expect(result.headers.get("Retry-After")).toBe(String(retryAfterSeconds ?? 3600));
      expect(await result.json()).toEqual({ error: "rate_limited", retryAfterSeconds: retryAfterSeconds ?? 3600 });
      expect(consume).toHaveBeenCalledExactlyOnceWith("blocked-ip");
      expect(verify).not.toHaveBeenCalled();
      expectNoEngineCalls();
    });

    it("rejects six configured verification failures then rate-limits the seventh attempt", async () => {
      process.env.TURNSTILE_SITE_KEY = "site-key";
      process.env.TURNSTILE_SECRET_KEY = "secret-key";
      global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: false }) });
      const ip = freshIp();

      for (let attempt = 0; attempt < 6; attempt++) {
        const denied = await guard(requestFrom(ip), { turnstileToken: "bad-token" });
        if (!(denied instanceof Response)) throw new Error("Expected denial");
        expect(denied.status).toBe(403);
        expect(denied.headers.get("Content-Type")).toBe("application/json");
        expect(denied.headers.get("Retry-After")).toBeNull();
        expect(await denied.json()).toEqual({ error: "verification_failed" });
      }
      const exhausted = await guard(requestFrom(ip), { turnstileToken: "bad-token" });
      if (!(exhausted instanceof Response)) throw new Error("Expected rate denial");
      expect(exhausted.status).toBe(429);
      expect(global.fetch).toHaveBeenCalledTimes(6);
      expectNoEngineCalls();
    });

    it("propagates verification exceptions after exactly one attempt without acquiring engines", async () => {
      const failure = new Error("Verification unavailable");
      const consume = vi.fn(() => ({ ok: true }));
      vi.spyOn(rateLimit, "getIpRateLimiter").mockReturnValue({ consume, close: vi.fn() });
      vi.spyOn(turnstile, "verifyTurnstile").mockRejectedValue(failure);

      await expect(guard(requestFrom("throwing-ip"), {})).rejects.toBe(failure);
      expect(consume).toHaveBeenCalledExactlyOnceWith("throwing-ip");
      expectNoEngineCalls();
    });

    it("propagates rate-limit exceptions without verifying or acquiring engines", async () => {
      const failure = new Error("Rate storage unavailable");
      const consume = vi.fn(() => { throw failure; });
      vi.spyOn(rateLimit, "getIpRateLimiter").mockReturnValue({ consume, close: vi.fn() });
      const verify = vi.spyOn(turnstile, "verifyTurnstile");

      await expect(guard(requestFrom("throwing-ip"), {})).rejects.toBe(failure);
      expect(consume).toHaveBeenCalledTimes(1);
      expect(verify).not.toHaveBeenCalled();
      expectNoEngineCalls();
    });
  });

  it("acquires legacy engines in their original order only after verification resolves", async () => {
    const order: string[] = [];
    const decisionMaker = { decide: vi.fn() };
    const backgroundDecisionMaker = { decide: vi.fn() };
    const consume = vi.fn(() => { order.push("consume"); return { ok: true }; });
    vi.spyOn(rateLimit, "getIpRateLimiter").mockReturnValue({ consume, close: vi.fn() });
    let admit!: (result: { ok: boolean }) => void;
    vi.spyOn(turnstile, "verifyTurnstile").mockImplementation(() => {
      order.push("verify");
      return new Promise((resolve) => { admit = resolve; });
    });
    vi.spyOn(decisionEngine, "getDecisionMaker").mockImplementation(() => { order.push("main"); return decisionMaker; });
    vi.spyOn(decisionEngine, "activeEngineName").mockImplementation(() => { order.push("source"); return "jev"; });
    vi.spyOn(decisionEngine, "getBackgroundDecisionMaker").mockImplementation(() => { order.push("background"); return backgroundDecisionMaker; });

    const pending = guardSimulation(requestFrom("ordered-ip"), {});
    expect(order).toEqual(["consume", "verify"]);
    expectNoEngineCalls();
    admit({ ok: true });
    expect(await pending).toEqual({ ok: true, engine: { decisionMaker, engineSource: "jev", backgroundDecisionMaker } });
    expect(order).toEqual(["consume", "verify", "main", "source", "background"]);
    expect(consume).toHaveBeenCalledTimes(1);
  });

  it.each(["getDecisionMaker", "activeEngineName", "getBackgroundDecisionMaker"] as const)(
    "preserves legacy %s acquisition failure without retrying admission", async (exportName) => {
      const failure = new Error("Engine acquisition unavailable");
      const consume = vi.fn(() => ({ ok: true }));
      vi.spyOn(rateLimit, "getIpRateLimiter").mockReturnValue({ consume, close: vi.fn() });
      const verify = vi.spyOn(turnstile, "verifyTurnstile").mockResolvedValue({ ok: true });
      vi.spyOn(decisionEngine, exportName).mockImplementation(() => { throw failure; });

      await expect(guardSimulation(requestFrom("engine-ip"), {})).rejects.toBe(failure);
      expect(consume).toHaveBeenCalledTimes(1);
      expect(verify).toHaveBeenCalledTimes(1);
      const acquisitionOrder = ["getDecisionMaker", "activeEngineName", "getBackgroundDecisionMaker"] as const;
      const failedIndex = acquisitionOrder.indexOf(exportName);
      acquisitionOrder.forEach((name, index) => expect(decisionEngine[name]).toHaveBeenCalledTimes(index <= failedIndex ? 1 : 0));
    },
  );

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

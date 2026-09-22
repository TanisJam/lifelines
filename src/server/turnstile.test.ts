import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { turnstileConfigured, turnstileSiteKey, verifyTurnstile } from "./turnstile";

describe("Turnstile bot protection (disabled unless both keys are set; verified via siteverify otherwise)", () => {
  const originalSiteKey = process.env.TURNSTILE_SITE_KEY;
  const originalSecretKey = process.env.TURNSTILE_SECRET_KEY;
  const originalFetch = global.fetch;

  beforeEach(() => {
    delete process.env.TURNSTILE_SITE_KEY;
    delete process.env.TURNSTILE_SECRET_KEY;
  });

  afterEach(() => {
    if (originalSiteKey === undefined) delete process.env.TURNSTILE_SITE_KEY;
    else process.env.TURNSTILE_SITE_KEY = originalSiteKey;
    if (originalSecretKey === undefined) delete process.env.TURNSTILE_SECRET_KEY;
    else process.env.TURNSTILE_SECRET_KEY = originalSecretKey;
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("is not configured when neither key is set", () => {
    expect(turnstileConfigured()).toBe(false);
    expect(turnstileSiteKey()).toBeUndefined();
  });

  it("is not configured when only one of the two keys is set", () => {
    process.env.TURNSTILE_SITE_KEY = "site-key";
    expect(turnstileConfigured()).toBe(false);
    delete process.env.TURNSTILE_SITE_KEY;
    process.env.TURNSTILE_SECRET_KEY = "secret-key";
    expect(turnstileConfigured()).toBe(false);
  });

  it("is configured (and exposes the site key) once both keys are set", () => {
    process.env.TURNSTILE_SITE_KEY = "site-key";
    process.env.TURNSTILE_SECRET_KEY = "secret-key";
    expect(turnstileConfigured()).toBe(true);
    expect(turnstileSiteKey()).toBe("site-key");
  });

  it("verifyTurnstile always passes, without any network call, when Turnstile isn't configured", async () => {
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;
    const result = await verifyTurnstile(undefined, "203.0.113.1");
    expect(result).toEqual({ ok: true });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects a missing token, without a network call, when configured", async () => {
    process.env.TURNSTILE_SITE_KEY = "site-key";
    process.env.TURNSTILE_SECRET_KEY = "secret-key";
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;
    const result = await verifyTurnstile(undefined, "203.0.113.1");
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("missing-token");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("succeeds when siteverify reports success:true", async () => {
    process.env.TURNSTILE_SITE_KEY = "site-key";
    process.env.TURNSTILE_SECRET_KEY = "secret-key";
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
    global.fetch = fetchSpy as unknown as typeof fetch;

    const result = await verifyTurnstile("a-real-token", "203.0.113.1");

    expect(result).toEqual({ ok: true });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    const sentBody = new URLSearchParams(init.body as string);
    expect(sentBody.get("secret")).toBe("secret-key");
    expect(sentBody.get("response")).toBe("a-real-token");
    expect(sentBody.get("remoteip")).toBe("203.0.113.1");
  });

  it("fails when siteverify reports success:false, surfacing its error codes", async () => {
    process.env.TURNSTILE_SITE_KEY = "site-key";
    process.env.TURNSTILE_SECRET_KEY = "secret-key";
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: false, "error-codes": ["invalid-input-response"] }) }) as unknown as typeof fetch;

    const result = await verifyTurnstile("a-bad-token", "203.0.113.1");

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("invalid-input-response");
  });

  it("fails gracefully on a network error", async () => {
    process.env.TURNSTILE_SITE_KEY = "site-key";
    process.env.TURNSTILE_SECRET_KEY = "secret-key";
    global.fetch = vi.fn().mockRejectedValue(new Error("network down")) as unknown as typeof fetch;

    const result = await verifyTurnstile("a-token", "203.0.113.1");

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("network down");
  });

  it("fails on a non-OK HTTP response from siteverify", async () => {
    process.env.TURNSTILE_SITE_KEY = "site-key";
    process.env.TURNSTILE_SECRET_KEY = "secret-key";
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) }) as unknown as typeof fetch;

    const result = await verifyTurnstile("a-token", "203.0.113.1");

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("siteverify-http-503");
  });
});

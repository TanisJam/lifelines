/**
 * Cloudflare Turnstile bot protection (server side). Enabled only when BOTH `TURNSTILE_SITE_KEY`
 * and `TURNSTILE_SECRET_KEY` are set — so local dev, CI, and `DECISION_ENGINE=rules` runs never
 * need a real Turnstile account. The client half (widget rendering) lives in
 * `src/components/turnstile-widget.tsx` / `src/lib/turnstile-client.ts`.
 */

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export interface TurnstileVerifyResult {
  readonly ok: boolean;
  /** Present only when `ok` is false — Turnstile's own error codes, or a local reason ("missing-token", "network-error"). */
  readonly reason?: string;
}

/** Whether both keys are configured — the single switch that turns Turnstile on or off. */
export function turnstileConfigured(): boolean {
  return Boolean(process.env.TURNSTILE_SITE_KEY?.trim() && process.env.TURNSTILE_SECRET_KEY?.trim());
}

/** The public site key, or `undefined` when Turnstile isn't configured — read by `/api/config` for the client widget. */
export function turnstileSiteKey(): string | undefined {
  return turnstileConfigured() ? process.env.TURNSTILE_SITE_KEY?.trim() : undefined;
}

interface SiteverifyResponse {
  readonly success?: boolean;
  readonly "error-codes"?: readonly string[];
}

/**
 * Verifies a Turnstile token against Cloudflare's siteverify endpoint. Always `{ ok: true }` when
 * Turnstile isn't configured (both keys set) — the caller (`abuse-guard.ts`) never needs its own
 * "is this even on" branch. `remoteIp` is passed through as Turnstile's `remoteip` (best-effort
 * signal on Cloudflare's side; the guard's own rate limiting is what actually enforces per-IP
 * limits).
 */
export async function verifyTurnstile(token: string | undefined, remoteIp: string): Promise<TurnstileVerifyResult> {
  if (!turnstileConfigured()) return { ok: true };
  if (!token?.trim()) return { ok: false, reason: "missing-token" };

  const secret = process.env.TURNSTILE_SECRET_KEY!.trim();
  try {
    const res = await fetch(SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret, response: token, remoteip: remoteIp }),
    });
    if (!res.ok) return { ok: false, reason: `siteverify-http-${res.status}` };
    const data = (await res.json()) as SiteverifyResponse;
    if (!data.success) return { ok: false, reason: data["error-codes"]?.join(",") || "verification-failed" };
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "network-error" };
  }
}

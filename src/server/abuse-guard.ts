import { activeEngineName, getBackgroundDecisionMaker, getDecisionMaker } from "./decision-engine";
import { getClientIp } from "./client-ip";
import { getIpRateLimiter } from "./ip-rate-limit";
import { verifyTurnstile } from "./turnstile";
import type { DecisionMaker } from "@/domain/decisions";

/**
 * The single guard every simulation-triggering Route Handler calls before doing any simulation
 * work (or opening an SSE stream): per-IP rate limiting, then (if configured) Turnstile
 * verification. Keeps the hexagonal seam clean — route handlers stay thin ("call guardSimulation,
 * branch on the result") and never duplicate rate-limit/Turnstile logic themselves.
 */

export interface SimulationEngine {
  readonly decisionMaker: DecisionMaker;
  readonly engineSource: "jev" | "rules";
  /** Decision 084: decides the villagers outside the protagonist's story circle; see `getBackgroundDecisionMaker`. */
  readonly backgroundDecisionMaker?: DecisionMaker;
}

export interface SimulationGuardBody {
  /** Sent by the client's Turnstile widget (see `turnstile-widget.tsx`); absent/ignored when Turnstile isn't configured. */
  readonly turnstileToken?: string;
}

export interface SimulationGuardOk {
  readonly ok: true;
  readonly engine: SimulationEngine;
}

function jsonResponse(body: unknown, status: number, extraHeaders?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...extraHeaders } });
}

/**
 * Runs the rate-limit + Turnstile checks for one simulation-triggering request. Returns
 * `{ ok: true, engine }` when it's clear to proceed (`engine` is just `getDecisionMaker()` +
 * `activeEngineName()`, bundled here so every guarded route reads it from one place), or a
 * `Response` the route handler should return as-is (429 with `Retry-After`, or 403).
 */
export async function guardSimulation(request: Request, body: SimulationGuardBody): Promise<SimulationGuardOk | Response> {
  const ip = getClientIp(request);

  const rate = getIpRateLimiter().consume(ip);
  if (!rate.ok) {
    const retryAfterSeconds = rate.retryAfterSeconds ?? 3600;
    return jsonResponse({ error: "rate_limited", retryAfterSeconds }, 429, { "Retry-After": String(retryAfterSeconds) });
  }

  const turnstile = await verifyTurnstile(body.turnstileToken, ip);
  if (!turnstile.ok) {
    return jsonResponse({ error: "verification_failed" }, 403);
  }

  return { ok: true, engine: { decisionMaker: getDecisionMaker(), engineSource: activeEngineName(), backgroundDecisionMaker: getBackgroundDecisionMaker() } };
}

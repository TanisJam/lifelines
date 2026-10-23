import { activeEngineName, getBackgroundDecisionMaker, getDecisionMaker } from "./decision-engine";
import { getClientIp } from "./client-ip";
import { getIpRateLimiter } from "./ip-rate-limit";
import { verifyTurnstile } from "./turnstile";
import type { DecisionMaker } from "@/domain/decisions";

/**
 * Shared admission for simulation-triggering requests: per-IP rate limiting, then (if
 * configured) Turnstile verification. Access-only callers do not acquire a decision provider;
 * existing routes keep the engine-returning guardSimulation wrapper.
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

export interface SimulationAccessOk {
  readonly ok: true;
}

export interface SimulationGuardOk extends SimulationAccessOk {
  readonly engine: SimulationEngine;
}

function jsonResponse(body: unknown, status: number, extraHeaders?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...extraHeaders } });
}

/**
 * Consumes one rate-limit attempt, then verifies Turnstile. Returns `{ ok: true }` without
 * calling any decision-engine export, or a Response to return as-is (429 with Retry-After,
 * or 403). Dependency exceptions propagate; admission does not choose policy or authenticate.
 */
export async function guardSimulationAccess(request: Request, body: SimulationGuardBody): Promise<SimulationAccessOk | Response> {
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

  return { ok: true };
}

/** Legacy routes acquire their engine only after shared admission succeeds. */
export async function guardSimulation(request: Request, body: SimulationGuardBody): Promise<SimulationGuardOk | Response> {
  const access = await guardSimulationAccess(request, body);
  if (access instanceof Response) return access;

  return { ok: true, engine: { decisionMaker: getDecisionMaker(), engineSource: activeEngineName(), backgroundDecisionMaker: getBackgroundDecisionMaker() } };
}

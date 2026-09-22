import type { Dictionary } from "@/i18n/dictionary";

/**
 * Thrown by `life-client.ts`/`sse.ts` when a simulation-triggering request is rejected by
 * `src/server/abuse-guard.ts` (429 rate limit, 403 failed Turnstile verification) — so callers can
 * show the friendly, localized message from `dict.guard` (see `guardErrorMessage` below) instead of
 * whatever raw text the server sent.
 */
export class SimulationGuardError extends Error {
  constructor(
    readonly code: "rate_limited" | "verification_failed",
    readonly retryAfterSeconds: number | undefined,
  ) {
    super(code);
    this.name = "SimulationGuardError";
  }
}

interface GuardErrorBody {
  readonly error?: string;
  readonly retryAfterSeconds?: number;
}

/**
 * Reads a fetch `Response` body ONCE and turns it into an `Error` — a `SimulationGuardError` for a
 * recognized 429/403 guard rejection, a plain `Error` otherwise (unchanged behavior for every other
 * failure). Shared by `life-client.ts#consumeStream` and `lib/sse.ts#streamSSE`, the two call paths
 * every simulation-triggering request goes through.
 */
export async function resolveGuardedResponseError(res: Response): Promise<Error> {
  let body: GuardErrorBody = {};
  try {
    body = (await res.json()) as GuardErrorBody;
  } catch {
    // Not JSON (or empty) — fall through to the generic message below.
  }

  if (res.status === 429 && body.error === "rate_limited") return new SimulationGuardError("rate_limited", body.retryAfterSeconds);
  if (res.status === 403 && body.error === "verification_failed") return new SimulationGuardError("verification_failed", undefined);
  return new Error(body.error || `Request failed (${res.status})`);
}

/** `retryAfterSeconds` formatted as "3 minutes"/"45 seconds" in the reader's own locale. */
function formatRetryAfter(seconds: number, dict: Dictionary): string {
  if (seconds < 60) return dict.guard.retrySeconds(Math.max(1, Math.round(seconds)));
  return dict.guard.retryMinutes(Math.max(1, Math.ceil(seconds / 60)));
}

/**
 * The one place every guarded form's catch block calls: turns a caught error into the string to
 * show the reader, localizing `SimulationGuardError` via `dict.guard` and falling back to
 * `err.message`/`fallback` exactly like the existing (pre-abuse-protection) catch blocks did.
 */
export function guardErrorMessage(err: unknown, dict: Dictionary, fallback: string): string {
  if (err instanceof SimulationGuardError) {
    if (err.code === "rate_limited") return dict.guard.rateLimited(formatRetryAfter(err.retryAfterSeconds ?? 3600, dict));
    return dict.guard.verificationFailed;
  }
  return err instanceof Error ? err.message : fallback;
}

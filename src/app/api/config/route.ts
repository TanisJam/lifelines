import { NextResponse } from "next/server";
import { turnstileSiteKey } from "@/server/turnstile";

export const runtime = "nodejs";

/**
 * Runtime public config for the client. Right now this is just the Turnstile site key: reading it
 * here (rather than baking it in at build time via `NEXT_PUBLIC_TURNSTILE_SITE_KEY`) means the same
 * Docker image works whether or not Turnstile is configured for a given deploy — no rebuild needed
 * to turn it on/off (`deploy/env.example`). Route Handlers aren't cached by default (Next 16 docs,
 * `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`), so this re-reads
 * `process.env` on every request rather than baking in whatever value was present at build time —
 * no `force-dynamic`/`connection()` needed, unlike a Server Component that would otherwise be
 * eligible for static prerendering.
 */
export function GET(): NextResponse {
  return NextResponse.json({ turnstileSiteKey: turnstileSiteKey() ?? null });
}

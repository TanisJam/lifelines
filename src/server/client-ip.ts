/**
 * Resolves the real client IP for abuse protection (per-IP rate limiting, Turnstile's `remoteip`).
 * The app is deployed as a single Docker container behind Traefik, behind a Cloudflare Tunnel
 * (see `deploy/`), so the actual visitor IP arrives in `CF-Connecting-IP` — Cloudflare sets this
 * itself and it can't be spoofed by the client past the tunnel. `X-Forwarded-For` is a fallback for
 * any other proxy hop (e.g. local `docker compose` without the tunnel); its FIRST entry is the
 * original client, per the header's own left-to-right append convention. `"unknown"` is the final
 * fallback (never throws, never returns an empty string) so a misconfigured proxy degrades to "one
 * shared bucket" instead of crashing every simulation request.
 */
export function getClientIp(request: Request): string {
  const cfConnectingIp = request.headers.get("cf-connecting-ip")?.trim();
  if (cfConnectingIp) return cfConnectingIp;

  const forwardedFor = request.headers.get("x-forwarded-for")?.trim();
  if (forwardedFor) {
    const first = forwardedFor.split(",")[0]?.trim();
    if (first) return first;
  }

  return "unknown";
}

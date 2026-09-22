"use client";

import { useEffect, useState } from "react";

/**
 * Fetches the runtime Turnstile site key from `/api/config` (see that route's own comment for why
 * it's a fetch rather than a build-time `NEXT_PUBLIC_` var). Returns `null` until loaded, or
 * forever when Turnstile isn't configured for this deploy — callers only render
 * `<TurnstileWidget>` once this is truthy, so local dev/tests render nothing extra.
 */
export function useTurnstileSiteKey(): string | null {
  const [siteKey, setSiteKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/config")
      .then((res) => (res.ok ? (res.json() as Promise<{ turnstileSiteKey: string | null }>) : null))
      .then((data) => {
        if (!cancelled && data?.turnstileSiteKey) setSiteKey(data.turnstileSiteKey);
      })
      .catch(() => {
        // Turnstile is a best-effort layer on top of server-side rate limiting; a config fetch
        // failure just means the widget doesn't render, never a hard error for the page.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return siteKey;
}

"use client";

import { useEffect, useRef } from "react";

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js";

interface TurnstileRenderOptions {
  readonly sitekey: string;
  readonly theme?: "auto" | "light" | "dark";
  readonly callback?: (token: string) => void;
  readonly "expired-callback"?: () => void;
  readonly "error-callback"?: () => void;
}

interface TurnstileApi {
  render(container: HTMLElement, options: TurnstileRenderOptions): string;
  reset(widgetId?: string): void;
  remove(widgetId?: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let scriptLoadPromise: Promise<void> | undefined;

/** Loads the Turnstile script at most once per page, even if several widgets mount around the same time. */
function loadTurnstileScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  scriptLoadPromise ??= new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Failed to load Turnstile.")), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener("error", () => reject(new Error("Failed to load Turnstile.")), { once: true });
    document.head.appendChild(script);
  });
  return scriptLoadPromise;
}

/**
 * Renders a Cloudflare Turnstile widget (bot protection, decision: enabled only when
 * `TURNSTILE_SITE_KEY`/`TURNSTILE_SECRET_KEY` are both set — see `src/server/turnstile.ts`). Only
 * ever mounted by a caller that already has a real `siteKey` (from `useTurnstileSiteKey()`), so
 * this component itself doesn't need its own "is Turnstile even on" branch. `data-theme="auto"`
 * (via the `theme: "auto"` render option) matches the app's light/dark solarpunk-medieval theming
 * without this widget needing to know which one is active.
 */
export function TurnstileWidget({ siteKey, onToken, className }: { siteKey: string; onToken: (token: string | null) => void; className?: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | undefined>(undefined);
  const onTokenRef = useRef(onToken);

  useEffect(() => {
    onTokenRef.current = onToken;
  }, [onToken]);

  useEffect(() => {
    let cancelled = false;

    loadTurnstileScript()
      .then(() => {
        if (cancelled || !containerRef.current || !window.turnstile) return;
        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          theme: "auto",
          callback: (token) => onTokenRef.current(token),
          "expired-callback": () => onTokenRef.current(null),
          "error-callback": () => onTokenRef.current(null),
        });
      })
      .catch(() => {
        // No token will ever arrive; the caller's submit stays disabled/guarded server-side either way.
      });

    return () => {
      cancelled = true;
      if (widgetIdRef.current && window.turnstile) window.turnstile.remove(widgetIdRef.current);
    };
  }, [siteKey]);

  return <div ref={containerRef} className={className} data-theme="auto" />;
}

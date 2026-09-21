/** Tiny client-only viewport helpers, read once at mount — matches the existing one-shot
 * `window.matchMedia` pattern already used across the app rather than a resize-tracking hook. */

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

export function isNarrowViewport(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(max-width: 640px)").matches;
}

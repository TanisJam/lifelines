const QUERY = "(prefers-reduced-motion: reduce)";

/** True when the viewer asked the system for reduced motion. Full motion wherever matchMedia is missing (server, tests). */
export function prefersReducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia(QUERY).matches;
}

/** Calls `onChange` whenever the preference flips. Returns the unsubscribe. */
export function subscribeReducedMotion(onChange: (reduced: boolean) => void): () => void {
  if (typeof matchMedia !== "function") return () => {};
  const mq = matchMedia(QUERY);
  const listener = () => onChange(mq.matches);
  mq.addEventListener("change", listener);
  return () => mq.removeEventListener("change", listener);
}

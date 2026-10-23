/**
 * RA1 (spec S1): the new lifecycle engine is a HIDDEN opt-in. The create form never offers it
 * visibly; only an explicit `?engine=lifecycle` in the address bar requests it, and every other
 * value — including `"legacy"`, a different case, or no value at all — yields `undefined` so the
 * request body stays exactly what it is today and the create route takes the legacy path.
 *
 * There is no coercion and no fallback between the two representations: the caller sends the field
 * only when this function returns a value.
 */
export function requestedEngine(search: string): "lifecycle" | undefined {
  return new URLSearchParams(search).get("engine") === "lifecycle" ? "lifecycle" : undefined;
}

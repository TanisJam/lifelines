import { inspectHelpOpportunities } from "./effects";
import { requireAnnualPolicyView, stableAnnualIdOrder } from "./e-annual-policy";
import type { RequestIntention } from "./e-runtime";
import { keyedDraw } from "./rng";

/** Policy identity only. Fully resolved plans retain the explicit runtime version;
 * replay certifies their physics, never this policy's provenance or activation.
 */
export const ANNUAL_COMPOSITION_POLICY_VERSION = "annual-composition-rc1-1" as const;

type Purpose = "help-activation" | "help-selection" | "help-noise";
function draw(seed: string, year: number, purpose: Purpose, ...parts: (string | number)[]): number {
  return keyedDraw(JSON.stringify([purpose, ANNUAL_COMPOSITION_POLICY_VERSION, seed, year, ...parts]), "", 0, "", 0);
}

/** Internal data-only planning helper. No caller function sees a mutable draft.
 * Each slot is invoked AFTER the preceding response has changed current physics.
 * Activation is per creditor/slot, selection per debt, noise per selected debt;
 * adding a candidate cannot alias either activation or response noise draws.
 */
export function planAnnualHelpSlot(view: unknown, seed: string, year: number, creditor: string, slot: 0 | 1): RequestIntention | null {
  requireAnnualPolicyView(view);
  if (typeof seed !== "string" || typeof creditor !== "string" || !Number.isSafeInteger(year) || Object.is(year, -0)
    || (slot !== 0 && slot !== 1)) throw new Error("Invalid annual HELP context");
  // Inspect before drawing: current-view validation cannot be skipped by an
  // inactive slot. This is evolving runtime physics, not frozen C2 certification.
  const candidates = inspectHelpOpportunities(view, year).filter(candidate => candidate.creditor === creditor && candidate.reason === null);
  if (draw(seed, year, "help-activation", creditor, slot) >= 0.25) return null;
  candidates.sort((a, b) => draw(seed, year, "help-selection", creditor, slot, a.obligation)
    - draw(seed, year, "help-selection", creditor, slot, b.obligation) || stableAnnualIdOrder(a.obligation, b.obligation));
  const selected = candidates[0];
  if (!selected) return null;
  return {
    id: JSON.stringify(["request", ANNUAL_COMPOSITION_POLICY_VERSION, year, creditor, slot, selected.obligation]),
    obligation: selected.obligation,
    noise: draw(seed, year, "help-noise", creditor, slot, selected.obligation),
  };
}

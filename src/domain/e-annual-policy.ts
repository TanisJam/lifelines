import { Buffer } from "node:buffer";
import { ageInYear, isAdult } from "./actuarial";
import { replayAnnualRuntime, type AnnualPlan, type ResourceAllocation, type RuntimeOutput } from "./e-runtime";
import { ensureLifeState } from "./life-state";
import { keyedDraw } from "./rng";

/** Inactive, explicit allowance/offer policy; not a runtime or provenance version. */
export const ANNUAL_FAVOR_POLICY_VERSION = "annual-favor-policy-ap1-1" as const;
type Purpose = "grain" | "offer" | "target";

function stableIdOrder(a: string, b: string): number {
  // Lone surrogates share UTF-8 replacement bytes. Preserve their raw identity.
  return Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"))
    || (a < b ? -1 : a > b ? 1 : 0);
}
function draw(seed: string, year: number, purpose: Purpose, ...actors: string[]): number {
  // Keep EVERY variable in one JSON argument: the legacy delimiter cannot split
  // a seed/actor tuple differently. Other legacy arguments are fixed constants.
  const key = JSON.stringify([purpose, ANNUAL_FAVOR_POLICY_VERSION, seed, year, ...actors]);
  return keyedDraw(key, "", 0, "", 0);
}
function operationId(purpose: "allocate" | "reset" | "grant", year: number, ...parts: string[]): string {
  return JSON.stringify([purpose, ANNUAL_FAVOR_POLICY_VERSION, year, ...parts]);
}
function pairId(a: string, b: string): string {
  return JSON.stringify([a, b].sort(stableIdOrder));
}

/** Plan only the requested future year from the admitted CURRENT view.
 * No physical operations, help requests, intervening-year generation or consumer
 * activation. Same-year physical composition needs a later explicit boundary;
 * the existing runtime remains responsible for execution-time grant validity.
 * Explicit callers may bypass this policy. Replay certifies runtime semantics,
 * not policy provenance, authorship or historical regeneration authority.
 */
export function buildAnnualFavorPlan(input: unknown, year: number): AnnualPlan {
  // Genuine descriptor-first admission MUST precede every read of caller data.
  const admitted = replayAnnualRuntime(input);
  const { startYear, endYear, seed } = admitted.origin.effective;
  if (!Number.isSafeInteger(year) || Object.is(year, -0) || year < startYear || year > endYear
    || (admitted.frontier !== null && year <= admitted.frontier)) {
    throw new Error("Invalid annual policy year frontier");
  }
  // Replay owns/freeze-detaches the tree. Clone for the existing Person helper's
  // mutable type, not to modify physics; only local budgets evolve below.
  const state = structuredClone(admitted.state as unknown) as RuntimeOutput["state"];
  const plan: AnnualPlan = { year, physical: [], resources: [], grants: [], requests: [] };
  const history = state.legacyEvents.filter(event => event.year <= year);
  const actors = Object.keys(state.people).sort(stableIdOrder).filter(id => {
    const person = state.people[id];
    return person.birthYear <= year && (person.deathYear === undefined || person.deathYear > year)
      && !person.away && ensureLifeState(person, history).residence.status === "home"
      && isAdult(ageInYear(person.birthYear, year));
  });
  const staged = new Map<string, ResourceAllocation>();
  for (const actor of actors) {
    const allocation = { grain: draw(seed, year, "grain", actor) < 0.5 ? 0 : 2, effort: 1, need: 1 };
    staged.set(actor, { ...allocation });
    if (![state.grain, state.assistance, state.need].every(ledger => Object.hasOwn(ledger, actor))) {
      plan.resources.push({ id: operationId("allocate", year, actor), kind: "allocate", actor, allocation, causes: [] });
    } else {
      for (const resource of ["grain", "effort", "need"] as const) {
        const ledger = resource === "effort" ? state.assistance : state[resource];
        const delta = allocation[resource] - ledger[actor];
        // Emit all three changes, including zero, with canonical positive zero.
        plan.resources.push({ id: operationId("reset", year, actor, resource), kind: "resource-change", actor, resource, amount: delta === 0 ? 0 : delta, causes: [] });
      }
    }
  }

  const openPairs = new Set(state.obligations.filter(debt => debt.status === "open")
    .map(debt => pairId(debt.creditor, debt.debtor)));
  const received = new Set<string>();
  for (const creditor of actors) {
    const budget = staged.get(creditor)!;
    if (budget.grain < 2 || budget.need < 1 || draw(seed, year, "offer", creditor) >= 0.25) continue;
    const candidates = actors.filter(debtor => debtor !== creditor && !received.has(debtor)
      && staged.get(debtor)!.grain === 0 && staged.get(debtor)!.effort >= 1
      && !openPairs.has(pairId(creditor, debtor)));
    // Seed each target independently; ties use the same total ID order as reset
    // and creditor traversal. No registry/locale order can resolve a conflict.
    candidates.sort((a, b) => draw(seed, year, "target", creditor, a)
      - draw(seed, year, "target", creditor, b) || stableIdOrder(a, b));
    const debtor = candidates[0];
    if (debtor === undefined) continue;
    plan.grants.push({ id: operationId("grant", year, creditor, debtor), creditor, debtor, causes: [] });
    budget.grain -= 1;
    staged.get(debtor)!.grain += 1;
    received.add(debtor);
    openPairs.add(pairId(creditor, debtor));
  }
  return plan;
}

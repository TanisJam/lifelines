import { inspectHelpOpportunities, type HelpOpportunity, type HelpSkipReason } from "./effects";
import { keyedDraw } from "./rng";
import {
  executeForkGrants, executeForkResponse, semanticForkIdentity,
  type FavorFork, type ForkEvidence,
} from "./favor-fork";

export const FORK_SCHEDULER_VERSION = "favor-scheduler-d2b";
interface Draw { key: string; value: number }
interface Context { seed: string; year: number; creditor: string; slot: 0 | 1; skipped: { obligation: string; reason: HelpSkipReason }[] }
export type ForkAttempt =
  | (Context & { kind: "quiet"; reason: "no-eligible-debt" })
  | (Context & { kind: "inactive"; obligation: string; actors: string[]; activation: Draw })
  | (Context & { kind: "response"; obligation: string; actors: string[]; activation: Draw; response: Draw; outcome: "help" | "refuse"; baselineSelection: "help" | "refuse"; requestId: string; responseId: string });
export interface ForkYear { version: typeof FORK_SCHEDULER_VERSION; year: number; attempts: ForkAttempt[] }

/** C2's byte order, including its lone-surrogate fallback. Physical lineage IDs
 * are deliberately never inputs to order, key construction or RNG transport. */
export function forkByteOrder(a: string, b: string): number {
  const encoder = new TextEncoder();
  const left = encoder.encode(a); const right = encoder.encode(b);
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    if (left[i] !== right[i]) return left[i]! - right[i]!;
  }
  return left.length - right.length || (a < b ? -1 : a > b ? 1 : 0);
}
export function forkOpportunityKey(target: HelpOpportunity, semanticDebt: string, year: number, slot: number, purpose: string): string {
  return JSON.stringify(["favor-scheduler-c2", "keyed-mulberry32-c2", "help-opportunity", [target.creditor, target.debtor], year, slot, semanticDebt, purpose]);
}
export function forkDraw(seed: string, key: string): Draw {
  return { key, value: keyedDraw(JSON.stringify([seed, key]), "favor-c2", 0, "uniform") };
}
/** Internal annual orchestration on a transient, already-admitted world. Shared
 * neutral helpers own feasibility, policy and all physical consequences. */
export function executeForkYear(state: FavorFork, year: number): ForkYear {
  executeForkGrants(state, year);
  const preflight = inspectHelpOpportunities(state, year);
  const creditors = [...new Set(preflight.map((candidate) => candidate.creditor))].sort(forkByteOrder);
  const attempts: ForkAttempt[] = [];
  for (const creditor of creditors) {
    for (const slot of [0, 1] as const) {
      const candidates = inspectHelpOpportunities(state, year).filter((candidate) => candidate.creditor === creditor)
        .sort((a, b) => forkByteOrder(semanticForkIdentity(state, a.obligation), semanticForkIdentity(state, b.obligation)));
      const skipped = candidates.filter((candidate) => candidate.reason !== null).map((candidate) => ({ obligation: candidate.obligation, reason: candidate.reason! }));
      const context = { seed: state.seed, year, creditor, slot, skipped };
      const target = candidates.find((candidate) => candidate.reason === null);
      if (!target) {
        attempts.push({ ...context, kind: "quiet", reason: "no-eligible-debt" });
        continue;
      }
      const actors = [target.creditor, target.debtor];
      const semantic = semanticForkIdentity(state, target.obligation);
      const key = (purpose: string) => forkOpportunityKey(target, semantic, year, slot, purpose);
      const activation = forkDraw(state.seed, key("activation"));
      if (activation.value >= 0.25) {
        attempts.push({ ...context, kind: "inactive", obligation: target.obligation, actors, activation });
        continue;
      }
      const response = forkDraw(state.seed, key("response"));
      const event = executeForkResponse(state, target.obligation, key("request"), year, response.value);
      const evidence = event.evidence as ForkEvidence;
      attempts.push({ ...context, kind: "response", obligation: target.obligation, actors, activation, response, outcome: evidence.effectiveChoice, baselineSelection: evidence.baselineSelection, requestId: event.request!, responseId: event.id });
    }
  }
  return { version: FORK_SCHEDULER_VERSION, year, attempts };
}

import { inspectHelpOpportunities, type CurrentHelpView } from "./effects";
import { planAnnualHelpSlotFiltered } from "./e-annual-composition";
import type { HelpThread } from "./e-thread-ledger";

export const THREAD_HELP_POLICY_VERSION = "thread-help-maturity-1" as const;

/** All HELP debts mature from their actual committed grant, not just recorded protagonist threads. */
export function eligibleThreadHelp(view: CurrentHelpView, threads: readonly HelpThread[], year: number): Set<string> {
  return new Set(inspectHelpOpportunities(view, year).filter(candidate => {
    if (candidate.reason !== null) return false;
    const obligation = view.obligations.find(item => item.id === candidate.obligation)!;
    const grant = view.events.find(event => event.id === obligation.origin && event.kind === "grain-grant");
    const thread = threads.find(item => item.obligation === obligation.id);
    return grant !== undefined && year - grant.year >= 3 && (!thread || (thread.status === "open" && thread.setup === grant.id && year >= thread.eligibleYear));
  }).map(candidate => candidate.obligation));
}

export function planThreadHelpSlot(view: CurrentHelpView, threads: readonly HelpThread[], seed: string, year: number, creditor: string, slot: 0 | 1) {
  return planAnnualHelpSlotFiltered(view, seed, year, creditor, slot, eligibleThreadHelp(view, threads, year));
}

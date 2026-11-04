import { planAnnualFavorDraft, stableAnnualIdOrder } from "./e-annual-policy";
import { planAnnualHelpSlot } from "./e-annual-composition";
import { createFavorExecutor } from "./e-favor-executor";
import { inspectHelpOpportunities, trustFavorState } from "./effects";
import { eligibleThreadHelp, planThreadHelpSlot } from "./e-thread-policy";
import { evolveThreadLedger } from "./e-thread-ledger";
import type { LifecycleGenesis } from "./e-lifecycle-genesis";
import type { LifecycleHelpSlot, LifecycleJournalMode, LifecycleState, LifecycleYearRecord } from "./e-lifecycle-runtime";
import type { LegacyOwnedRunState } from "./simulate";
import type { RuntimeEntry, RequestIntention } from "./e-runtime";
import type { WorldConfig, YearSnapshot } from "./types";

/** Execute one detached year; callers own frontier validation, publication, and commit. */
export async function executeLifecycleAnnual(
  state: LifecycleState, year: number, config: WorldConfig, protagonistId: string,
  versions: LifecycleGenesis["versions"], journalMode: LifecycleJournalMode,
  createSource: (owned: LegacyOwnedRunState) => { execute(year: number): Promise<YearSnapshot> },
): Promise<{ draft: LifecycleState; record: LifecycleYearRecord }> {
  // Never separately clone owned and favors: native phases and FE1 borrow ONE graph.
  const draft = structuredClone(state);
  trustFavorState(draft.favors);
  const lifeStart = draft.owned.events.length;
  const decisionStart = draft.owned.decisions.length;
  const economicStart = draft.favors.events.length;
  // A fresh trusted source/resolver on every attempt; origin endYear is metadata only.
  const source = createSource(draft.owned);
  const physicalSnapshot = await source.execute(year);
  const allowances = planAnnualFavorDraft(draft.favors, config.seed, year);
  const entries: RuntimeEntry[] = [];
  const favor = createFavorExecutor(draft.favors, year, entries, undefined, { auditEvidence: journalMode === "audit" });
  allowances.resources.forEach(favor.executeResource);
  allowances.grants.forEach(favor.executeGrant);
  const creditors = [...new Set(inspectHelpOpportunities(draft.favors, year)
    .filter(candidate => candidate.reason === null).map(candidate => candidate.creditor))].sort(stableAnnualIdOrder);
  const slots: LifecycleHelpSlot[] = [];
  const requests: RequestIntention[] = [];
  for (const creditor of creditors) {
    for (const slot of [0, 1] as const) {
      const opportunities = inspectHelpOpportunities(draft.favors, year);
      const planned = draft.threads
        ? planThreadHelpSlot(draft.favors, draft.threads.threads, config.seed, year, creditor, slot)
        : planAnnualHelpSlot(draft.favors, config.seed, year, creditor, slot);
      const request = planned && draft.threads && !eligibleThreadHelp(draft.favors, draft.threads.threads, year).has(planned.obligation) ? null : planned;
      slots.push({ creditor, slot, opportunities, request });
      if (request !== null) {
        requests.push(request);
        favor.executeRequest(request, requests.length - 1);
      }
    }
  }
  const ledger = draft.threads && evolveThreadLedger(draft.threads.threads, entries, protagonistId, year,
    Object.fromEntries(draft.owned.events.filter(event => event.kind === "death" && event.year <= year)
      .map(event => [event.actors[0], { year: event.year, id: event.id }])));
  if (draft.threads && ledger) draft.threads.threads = ledger.threads;
  // Compact mode omits ONLY fields no production reader consumes; `final` is what the chronicle,
  // the person sheets and the replay comparison all read, so it is never dropped.
  const record: LifecycleYearRecord = journalMode === "compact"
    ? { year, versions, final: draft }
    : {
      year, versions, physicalSnapshot,
      economics: { resources: allowances.resources, grants: allowances.grants, creditors, slots, requests, entries },
      positions: {
        life: { start: lifeStart, end: draft.owned.events.length },
        decisions: { start: decisionStart, end: draft.owned.decisions.length },
        economic: { start: economicStart, end: draft.favors.events.length },
      },
      final: draft,
    };
  // The ledger exists exactly when the admitted profile initialized thread state.
  if (ledger) record.threadBeats = { version: "thread-beats-1", beats: ledger.beats };
  return { draft, record };
}

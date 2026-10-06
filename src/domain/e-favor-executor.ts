import { applyGrantPhysics, applyHelpResponsePhysics, canonicalHelpResponseEffects, currentHelpContext, inspectHelpOpportunities, requireFavorData, validateHelpRequestPhysics, type HelpFavorEffect, type HelpHistoryEntry } from "./effects";
import { ensureLifeState } from "./life-state";
import { selectFavorResponse } from "./favor-policy";
import { requireFields, requireInteger } from "./obligations";
import type { Person } from "./types";
import type { GrantIntention, RequestIntention, ResourceOperation, ResponseAuthority, RuntimeEntry, RuntimeOutput } from "./e-runtime";

type Immutable<T> = T extends object ? { readonly [K in keyof T]: Immutable<T[K]> } : T;
function frozen<T>(value: T): Immutable<T> {
  if (value !== null && typeof value === "object") {
    for (const entry of Object.values(value)) frozen(entry);
    Object.freeze(value);
  }
  return value as Immutable<T>;
}
function detached<T>(value: T): Immutable<T> { return frozen(structuredClone(value)); }
function record(value: unknown): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected record");
}

/** Trusted, already-admitted operations against ONE borrowed private draft.
 * Keeps Person/Mind identity; economic physics may replace separate ledgers.
 * Not transactional: the owner must discard the entire draft on any failure.
 * No allowance/slot planning, admission, publication or outcome callbacks here.
 */
export function createFavorExecutor(next: RuntimeOutput["state"], year: number, entries: RuntimeEntry[], authority?: ResponseAuthority) {
  function known(actor: string): Person {
    if (!Object.hasOwn(next.people, actor)) throw new Error("Unknown actor");
    return next.people[actor];
  }
  function living(actor: string): Person {
    const person = known(actor);
    if (person.birthYear > year || (person.deathYear !== undefined && person.deathYear <= year)) throw new Error("Nonliving actor");
    return person;
  }
  function prior(id: string, refs: string[]) {
    if (next.legacyEvents.some(e => e.id === id) || next.events.some(e => e.id === id)) throw new Error("Duplicate operation identity");
    for (const ref of refs) {
      if (!next.events.some(e => e.id === ref && e.year <= year) && !next.legacyEvents.some(e => e.id === ref && e.year <= year)) throw new Error("Unknown or forward cause");
    }
  }
  function append(entry: Omit<RuntimeEntry, "year" | "position">, extra: Partial<HelpHistoryEntry> = {}) {
    const full = { ...entry, year, position: next.events.length };
    entries.push(full);
    next.events.push({ id: full.id, kind: full.kind, year, position: full.position, actors: full.actors, ...extra });
  }
  function evidence(actors: string[]) {
    const balances = (ledger: Record<string, number>) => actors.map(a => Object.hasOwn(ledger, a) ? ledger[a] : undefined);
    return structuredClone({ people: actors.map(known), grain: balances(next.grain), assistance: balances(next.assistance), need: balances(next.need), obligations: next.obligations, ties: next.ties, priorOperations: next.events.map(e => e.id), lifeEvents: next.legacyEvents.filter(e => e.year <= year && e.actors.some(a => actors.includes(a))) });
  }
  function executeResource(op: ResourceOperation, declarationIndex: number) {
    prior(op.id, op.causes); living(op.actor);
    const consumed = evidence([op.actor]);
    if (op.kind === "allocate") {
      if (Object.hasOwn(next.grain, op.actor)) throw new Error("Already allocated");
      for (const [key, value] of [["grain", op.allocation.grain], ["assistance", op.allocation.effort], ["need", op.allocation.need]] as const) Object.defineProperty(next[key], op.actor, { value, writable: true, enumerable: true, configurable: true });
    } else {
      const key = op.resource === "effort" ? "assistance" : op.resource;
      if (!Object.hasOwn(next[key], op.actor)) throw new Error("Missing allocation");
      const balance = next[key][op.actor] + op.amount;
      requireInteger(balance, 0);
      if (Object.is(balance, -0)) throw new Error("Negative zero input");
      next[key] = { ...next[key], [op.actor]: balance };
    }
    append({ id: op.id, kind: op.kind, phase: "resources", declarationIndex, actors: [op.actor], causes: op.causes, consumed, effects: [op], outcome: "committed" });
  }
  function executeGrant(op: GrantIntention, declarationIndex: number) {
    prior(op.id, op.causes);
    const actors = [op.creditor, op.debtor]; actors.forEach(known);
    const consumed = evidence(actors);
    let reason: string | undefined;
    for (const actor of actors) {
      const person = known(actor);
      if (person.birthYear > year) reason ??= "unborn";
      else if (person.deathYear !== undefined && person.deathYear <= year) reason ??= "dead";
      else if (person.away || ensureLifeState(person, next.legacyEvents).residence.status !== "home") reason ??= "absent";
      else if (!Object.hasOwn(next.grain, actor)) reason ??= "missing-allocation";
    }
    if (!reason && next.grain[op.creditor] === 0) reason = "exhausted-grain";
    if (!reason && next.grain[op.debtor] === Number.MAX_SAFE_INTEGER) reason = "grain-capacity";
    if (reason) {
      append({ id: op.id, kind: "grant-ineligible", phase: "grants", declarationIndex, actors, causes: op.causes, consumed, effects: [], outcome: "ineligible", reason }); return;
    }
    const effects: HelpFavorEffect[] = [
      { kind: "grain", from: op.creditor, to: op.debtor, amount: 1 },
      { kind: "obligation", id: `${op.id}/help`, creditor: op.creditor, debtor: op.debtor, origin: op.id, status: "open" },
    ];
    // All annual entries are admitted history; no fixed-registry C/D reducer is used.
    const physicsCauses = op.causes.filter(c => next.events.some(e => e.id === c));
    Object.assign(next, applyGrantPhysics(next, { id: op.id, year, position: next.events.length, actors, causes: physicsCauses, effects }));
    append({ id: op.id, kind: "grain-grant", phase: "grants", declarationIndex, actors, causes: op.causes, consumed, effects, outcome: "committed" });
  }
  function executeRequest(op: RequestIntention, declarationIndex: number) {
    prior(op.id, []); prior(`${op.id}/response`, []);
    const obligation = next.obligations.find(o => o.id === op.obligation);
    if (!obligation) throw new Error("Unknown obligation");
    const actors = [obligation.creditor, obligation.debtor];
    const consumed = evidence(actors);
    const candidate = inspectHelpOpportunities(next, year).find(o => o.obligation === op.obligation)!;
    if (candidate.reason !== null) {
      append({ id: op.id, kind: "request-ineligible", phase: "help", declarationIndex, actors, causes: [obligation.origin], consumed, effects: [], outcome: "ineligible", reason: candidate.reason }); return;
    }
    const batch = { id: op.id, year, position: next.events.length, actors, causes: [obligation.origin], effects: [], obligation: op.obligation };
    const context = validateHelpRequestPhysics(next, batch);
    append({ id: op.id, kind: "help-request", phase: "help", declarationIndex, actors, causes: batch.causes, consumed: { current: consumed, evidence: context.evidence }, effects: [], outcome: "committed" }, { obligation: op.obligation });
    const id = `${op.id}/response`;
    const { evidence: policy } = currentHelpContext(next, op.obligation, year);
    const responseConsumed = evidence(actors);
    const baseline = selectFavorResponse(policy.factors, op.noise);
    let selected = baseline;
    let source: "rules" | "human" = "rules";
    if (authority) {
      const result = authority(detached({ id, year, actors, obligation: op.obligation, evidence: policy, baseline, noise: op.noise }));
      requireFavorData(result); record(result); requireFields(result, ["source", "selected"]);
      if (result.source !== "human" || (result.selected !== "help" && result.selected !== "refuse")) throw new Error("Invalid human authority result");
      selected = result.selected; source = "human";
    }
    const effects = canonicalHelpResponseEffects({ ties: next.ties }, obligation, id, selected);
    const response = { id, year, position: next.events.length, actors, causes: [obligation.origin, op.id], obligation: op.obligation, request: op.id, effects };
    Object.assign(next, applyHelpResponsePhysics(next, response, selected));
    append({ id, kind: "help-response", phase: "help", declarationIndex, actors, causes: response.causes, consumed: { current: responseConsumed, evidence: policy }, effects, outcome: "committed", authority: { source, selected, baseline, noise: op.noise } }, { obligation: op.obligation, request: op.id });
  }
  return { known, living, prior, append, evidence, executeResource, executeGrant, executeRequest };
}

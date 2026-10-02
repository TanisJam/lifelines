import { ensureLifeState } from "./life-state";
import { createHelpObligation, requireFields, requireId, requireInteger, type HelpObligation } from "./obligations";
import type { Event, Person } from "./types";

/** Deliberately not A's envelope/event/projection version. */
export const FAVOR_VERSION = "favor-b1";
export interface TieDelta { actor: string; trust: number; resentment: number }
export interface AppraisalInput { actor: string; interpretation: "gratitude" | "resentment"; intensity: number }
export interface DirectedTie extends TieDelta { counterpart: string }
export interface Appraisal extends AppraisalInput { id: string; origin: string }
export type FavorEffect =
  | { kind: "grain"; from: string; to: string; amount: 1 }
  | ({ kind: "obligation" } & Omit<HelpObligation, "kind">)
  | ({ kind: "tie"; origin: string; counterpart: string } & TieDelta)
  | ({ kind: "appraisal" } & Appraisal);
export interface FavorEvent {
  version: typeof FAVOR_VERSION;
  id: string;
  key: string;
  ordinal: 0;
  kind: "grain-grant";
  year: number;
  position: number;
  actors: string[]; // ordered creditor, debtor
  causes: string[];
  effects: FavorEffect[];
}
export interface FavorCommand {
  key: string;
  year: number;
  creditor: string;
  debtor: string;
  causes: string[];
  ties: TieDelta[];
  appraisals: AppraisalInput[];
}
export interface FavorState {
  schema: typeof FAVOR_VERSION;
  reducer: typeof FAVOR_VERSION;
  people: Record<string, Person>;
  legacyEvents: Event[];
  allocations: Record<string, number>;
  grain: Record<string, number>;
  obligations: HelpObligation[];
  ties: DirectedTie[];
  appraisals: Appraisal[];
  events: FavorEvent[];
}

/** Descriptor-first check: reject executable/non-JSON containers before reading any fields.
 * Legacy Person optional undefined is allowed only on the existing registry/log boundary. */
function ownData(value: unknown, legacy = false, ancestors = new Set<object>()): void {
  if (value === undefined && legacy) return;
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (typeof value !== "object" || value === null || ancestors.has(value)) throw new Error("Invalid own-data tree");
  const array = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  if (array && prototype !== Array.prototype) throw new Error("Nonstandard array prototype");
  if (!array && prototype !== Object.prototype && prototype !== null) throw new Error("Nonplain record");
  ancestors.add(value);
  const keys = Reflect.ownKeys(value);
  if (array && keys.length !== value.length + 1) throw new Error("Sparse or extended array");
  for (const key of keys) {
    if (array && key === "length") continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (typeof key !== "string" || !descriptor.enumerable || !("value" in descriptor)) throw new Error("Not own enumerable data");
    if (array && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length)) throw new Error("Invalid array index");
    ownData(descriptor.value, legacy, ancestors);
  }
  ancestors.delete(value);
}

function array(value: unknown): asserts value is unknown[] {
  if (!Array.isArray(value)) throw new Error("Expected array");
}
function record(value: unknown): asserts value is object {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected record");
}
function identity(key: string): string { return JSON.stringify([FAVOR_VERSION, key, 0]); }
function counterpart(event: FavorEvent, actor: string): string {
  if (!event.actors.includes(actor)) throw new Error("Effect actor outside grant");
  return event.actors[actor === event.actors[0] ? 1 : 0]!;
}

export function createFavorState(people: Readonly<Record<string, Person>>, legacyEvents: readonly Event[], allocations: Readonly<Record<string, number>>): FavorState {
  ownData(people, true);
  ownData(legacyEvents, true);
  ownData(allocations);
  record(people);
  array(legacyEvents);
  record(allocations);
  for (const [id, person] of Object.entries(people)) {
    requireId(id);
    if (person.id !== id) throw new Error("Registry identity mismatch");
    requireInteger(person.birthYear, Number.MIN_SAFE_INTEGER);
    if (person.deathYear !== undefined) requireInteger(person.deathYear, person.birthYear);
  }
  for (const [id, balance] of Object.entries(allocations)) {
    if (!Object.hasOwn(people, id)) throw new Error("Allocation without registered person");
    requireInteger(balance, 0);
  }
  return { schema: FAVOR_VERSION, reducer: FAVOR_VERSION, people: structuredClone(people), legacyEvents: structuredClone(legacyEvents) as Event[], allocations: { ...allocations }, grain: { ...allocations }, obligations: [], ties: [], appraisals: [], events: [] };
}

/** Internal staged reducer, used identically for commands and imported records. */
function reduce(state: FavorState, event: FavorEvent): FavorState {
  ownData(event);
  record(event);
  requireFields(event, ["version", "id", "key", "ordinal", "kind", "year", "position", "actors", "causes", "effects"]);
  requireId(event.key);
  requireInteger(event.year, Number.MIN_SAFE_INTEGER);
  requireInteger(event.position, 0);
  if (event.version !== FAVOR_VERSION || event.kind !== "grain-grant" || event.ordinal !== 0 || event.id !== identity(event.key)) throw new Error("Unsupported event identity/version");
  if (event.position !== state.events.length || state.events.some((prior) => prior.id === event.id)) throw new Error("Repeated or unordered commit");
  array(event.actors);
  array(event.causes);
  array(event.effects);
  if (event.actors.length !== 2 || event.actors[0] === event.actors[1]) throw new Error("Expected distinct ordered parties");
  const last = state.events.at(-1);
  if (last && event.year < last.year) throw new Error("Time reversal");
  for (const actor of event.actors) {
    requireId(actor);
    const person = Object.hasOwn(state.people, actor) ? state.people[actor] : undefined;
    if (!person || person.birthYear > event.year || (person.deathYear !== undefined && person.deathYear <= event.year)) throw new Error("Unknown or dead actor");
    const history = state.legacyEvents.filter((entry) => entry.year <= event.year);
    if (person.away || ensureLifeState(person, history).residence.status !== "home") throw new Error("Absent actor");
    if (!Object.hasOwn(state.grain, actor)) throw new Error("Missing explicit allocation");
  }
  const causes = new Set<string>();
  for (const cause of event.causes) {
    requireId(cause);
    const prior = state.events.find((entry) => entry.id === cause);
    if (!prior || prior.position >= event.position || prior.year > event.year || causes.has(cause)) throw new Error("Cause is not a unique prior commit");
    causes.add(cause);
  }
  if (event.effects.length < 2) throw new Error("Incomplete grant");
  const [creditor, debtor] = event.actors as [string, string];
  const next = structuredClone(state);
  event.effects.forEach((effect, index) => {
    record(effect);
    if (index === 0) {
      requireFields(effect, ["kind", "from", "to", "amount"]);
      if (effect.kind !== "grain" || effect.from !== creditor || effect.to !== debtor || effect.amount !== 1) throw new Error("Expected conserved one-grain transfer");
      requireInteger(next.grain[creditor], 1);
      requireInteger(next.grain[debtor], 0, Number.MAX_SAFE_INTEGER - 1);
      next.grain[creditor]!--;
      next.grain[debtor]!++;
      return;
    }
    if (index === 1) {
      requireFields(effect, ["kind", "id", "debtor", "creditor", "origin", "status"]);
      if (effect.kind !== "obligation" || effect.id !== `${event.id}/help` || effect.debtor !== debtor || effect.creditor !== creditor || effect.origin !== event.id || effect.status !== "open") throw new Error("Expected grant obligation");
      if (next.obligations.some((entry) => entry.id === effect.id)) throw new Error("Duplicate obligation");
      next.obligations.push(createHelpObligation(effect.id, debtor, creditor, event.id));
      return;
    }
    if (effect.kind === "tie") {
      requireFields(effect, ["kind", "origin", "actor", "counterpart", "trust", "resentment"]);
      if (effect.origin !== event.id || effect.counterpart !== counterpart(event, effect.actor)) throw new Error("Tie source/parties mismatch");
      requireInteger(effect.trust, -200, 200);
      requireInteger(effect.resentment, -100, 100);
      const existing = next.ties.find((tie) => tie.actor === effect.actor && tie.counterpart === effect.counterpart);
      const trust = (existing?.trust ?? 0) + effect.trust;
      const resentment = (existing?.resentment ?? 0) + effect.resentment;
      requireInteger(trust, -100, 100);
      requireInteger(resentment, 0, 100);
      if (existing) Object.assign(existing, { trust, resentment });
      else next.ties.push({ actor: effect.actor, counterpart: effect.counterpart, trust, resentment });
    } else if (effect.kind === "appraisal") {
      requireFields(effect, ["kind", "id", "origin", "actor", "interpretation", "intensity"]);
      counterpart(event, effect.actor);
      if (effect.id !== `${event.id}/appraisal/${index}` || effect.origin !== event.id || !["gratitude", "resentment"].includes(effect.interpretation)) throw new Error("Appraisal identity/source/interpretation mismatch");
      requireInteger(effect.intensity, 0, 100);
      if (next.appraisals.some((entry) => entry.id === effect.id)) throw new Error("Duplicate appraisal");
      next.appraisals.push({ id: effect.id, origin: effect.origin, actor: effect.actor, interpretation: effect.interpretation, intensity: effect.intensity });
    } else throw new Error("Unregistered effect");
  });
  next.events.push(structuredClone(event));
  return next;
}

// Narrow structural comparison avoids importing A orchestration/hash utilities.
function encoding(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(encoding).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${encoding((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

/** Imported checkpoints must be equivalent to their complete recorded prefix. No repair. */
function validateState(state: FavorState): FavorState {
  ownData(state, true);
  record(state);
  requireFields(state, ["schema", "reducer", "people", "legacyEvents", "allocations", "grain", "obligations", "ties", "appraisals", "events"]);
  if (state.schema !== FAVOR_VERSION || state.reducer !== FAVOR_VERSION) throw new Error("Unsupported B state");
  for (const value of [state.allocations, state.grain, state.obligations, state.ties, state.appraisals, state.events]) ownData(value);
  array(state.events);
  let rebuilt = createFavorState(state.people, state.legacyEvents, state.allocations);
  for (const event of state.events) rebuilt = reduce(rebuilt, event);
  for (const key of ["grain", "obligations", "ties", "appraisals"] as const) {
    if (encoding(rebuilt[key]) !== encoding(state[key])) throw new Error("Checkpoint does not match recorded effects");
  }
  return rebuilt;
}

export function applyFavorEvent(state: FavorState, event: FavorEvent): FavorState {
  return reduce(validateState(state), event);
}
export function replayFavorEvents(initial: FavorState, events: readonly FavorEvent[]): FavorState {
  ownData(events);
  array(events);
  let state = validateState(initial);
  for (const event of events) state = reduce(state, event);
  return state;
}
export function grantFavor(state: FavorState, command: FavorCommand): FavorState {
  ownData(command);
  record(command);
  requireFields(command, ["key", "year", "creditor", "debtor", "causes", "ties", "appraisals"]);
  requireId(command.key);
  requireInteger(command.year, Number.MIN_SAFE_INTEGER);
  requireId(command.creditor);
  requireId(command.debtor);
  array(command.causes);
  array(command.ties);
  array(command.appraisals);
  const validated = validateState(state);
  const id = identity(command.key);
  const effects: FavorEffect[] = [
    { kind: "grain", from: command.creditor, to: command.debtor, amount: 1 },
    { kind: "obligation", id: `${id}/help`, debtor: command.debtor, creditor: command.creditor, origin: id, status: "open" },
  ];
  const event: FavorEvent = { version: FAVOR_VERSION, id, key: command.key, ordinal: 0, kind: "grain-grant", year: command.year, position: validated.events.length, actors: [command.creditor, command.debtor], causes: command.causes, effects };
  for (const tie of command.ties) {
    record(tie);
    requireFields(tie, ["actor", "trust", "resentment"]);
    effects.push({ kind: "tie", origin: id, counterpart: counterpart(event, tie.actor), ...tie });
  }
  for (const appraisal of command.appraisals) {
    record(appraisal);
    requireFields(appraisal, ["actor", "interpretation", "intensity"]);
    effects.push({ kind: "appraisal", id: `${id}/appraisal/${effects.length}`, origin: id, ...appraisal });
  }
  return reduce(validated, event);
}

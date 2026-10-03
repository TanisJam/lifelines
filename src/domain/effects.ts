import { ensureLifeState } from "./life-state";
import { createHelpObligation, requireFields, requireId, requireInteger, type HelpObligation } from "./obligations";
import type { Event, Person } from "./types";
import { favorPolicy, selectFavorResponse, type FavorPolicy } from "./favor-policy";

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

export const HELP_FAVOR_VERSION = "favor-c1";
export type HelpFavorEffect = FavorEffect
  | { kind: "settlement"; id: string; origin: string; creditor: string; debtor: string; status: "fulfilled" | "broken" }
  | { kind: "assistance"; from: string; to: string; amount: 1 };
export interface HelpEvidence extends FavorPolicy {
  feasibility: { assistance: number; need: number };
  noise?: number;
  selected?: "help" | "refuse";
}
export interface HelpFavorEvent extends Omit<FavorEvent, "version" | "kind" | "effects"> {
  version: typeof HELP_FAVOR_VERSION;
  kind: "grain-grant" | "help-request" | "help-response";
  effects: HelpFavorEffect[];
  obligation?: string;
  request?: string;
  evidence?: HelpEvidence;
}
export interface HelpFavorState extends Omit<FavorState, "schema" | "reducer" | "events"> {
  schema: typeof HELP_FAVOR_VERSION;
  reducer: typeof HELP_FAVOR_VERSION;
  initialAssistance: Record<string, number>;
  initialNeed: Record<string, number>;
  assistance: Record<string, number>;
  need: Record<string, number>;
  events: HelpFavorEvent[];
}
export interface HelpRequestCommand { key: string; year: number; obligation: string }
export interface HelpResponseCommand { request: string; year: number; noise: number; appraisals: AppraisalInput[] }
/** Current physics inputs, not a versioned checkpoint or replay authority.
 * History is already admitted by the caller; no C event/schema version is implied. */
export interface CurrentGrantView {
  people: Readonly<Record<string, Person>>;
  legacyEvents: readonly Event[];
  grain: Readonly<Record<string, number>>;
  obligations: readonly HelpObligation[];
  ties: readonly DirectedTie[];
  appraisals: readonly Appraisal[];
  events: readonly HelpHistoryEntry[];
}
export interface CurrentHelpView extends CurrentGrantView {
  assistance: Readonly<Record<string, number>>;
  need: Readonly<Record<string, number>>;
}
export type GrantPhysicalLedger = Pick<FavorState, "grain" | "obligations" | "ties" | "appraisals">;
export interface GrantPhysicalBatch extends Pick<FavorEvent, "id" | "year" | "position" | "actors" | "causes"> {
  effects: HelpFavorEffect[];
}
export interface HelpRequestBatch extends GrantPhysicalBatch {
  obligation: string;
}
export interface HelpHistoryEntry {
  id: string; kind: string; year: number; position: number; actors: readonly string[];
  obligation?: string; request?: string;
}
export type HelpPhysicalLedger = Pick<HelpFavorState, "assistance" | "need" | "obligations" | "ties" | "appraisals">;
export interface HelpResponseBatch {
  id: string; year: number; position: number; actors: string[]; causes: string[];
  obligation: string; request: string; effects: HelpFavorEffect[];
}

type AnyFavorState = FavorState | HelpFavorState;
type AnyFavorEvent = FavorEvent | HelpFavorEvent;

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

/** Scheduler boundary reuses the same descriptor-first guards, including legacy Person optionals. */
export function requireFavorData(value: unknown, legacy = false): void { ownData(value, legacy); }

function array(value: unknown): asserts value is unknown[] {
  if (!Array.isArray(value)) throw new Error("Expected array");
}
function record(value: unknown): asserts value is object {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected record");
}
function identity(key: string, version: string = FAVOR_VERSION): string { return JSON.stringify([version, key, 0]); }
function counterpart(event: Pick<FavorEvent, "actors">, actor: string): string {
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
function reduce(state: FavorState, event: FavorEvent): FavorState;
function reduce(state: HelpFavorState, event: HelpFavorEvent): HelpFavorState;
function reduce(state: AnyFavorState, event: AnyFavorEvent): AnyFavorState;
function reduce(state: AnyFavorState, event: AnyFavorEvent): AnyFavorState {
  ownData(event);
  record(event);
  const helpEvent = event.version === HELP_FAVOR_VERSION && event.kind !== "grain-grant";
  requireFields(event, ["version", "id", "key", "ordinal", "kind", "year", "position", "actors", "causes", "effects", ...(helpEvent ? ["obligation", "evidence", ...(event.kind === "help-response" ? ["request"] : [])] : [])]);
  requireId(event.key);
  requireInteger(event.year, Number.MIN_SAFE_INTEGER);
  requireInteger(event.position, 0);
  if (event.version !== state.schema || ![FAVOR_VERSION, HELP_FAVOR_VERSION].includes(event.version) || (event.kind !== "grain-grant" && !helpEvent) || event.ordinal !== 0 || event.id !== identity(event.key, state.schema)) throw new Error("Unsupported event identity/version");
  if (helpEvent) {
    validatePhysicalCommit(state, event);
    if (state.schema !== HELP_FAVOR_VERSION || event.version !== HELP_FAVOR_VERSION) throw new Error("Unsupported help boundary");
    return reduceHelp(state, event);
  }
  const { id, year, position, actors, causes, effects } = event;
  const ledgers = applyGrantPhysics(state, { id, year, position, actors, causes, effects });
  const next = structuredClone(state);
  Object.assign(next, ledgers);
  // Version dispatch above guarantees matching state/event types.
  (next.events as AnyFavorEvent[]).push(structuredClone(event));
  return next;
}

/** Guard the entire borrowed root before reading any registry or history field. */
function guardCurrentView(state: CurrentGrantView): void {
  ownData(state, true);
  record(state);
  for (const key of Object.keys(state)) {
    if (key !== "people" && key !== "legacyEvents") ownData(Object.getOwnPropertyDescriptor(state, key)!.value);
  }
  record(state.people);
  array(state.legacyEvents);
  record(state.grain);
  array(state.obligations);
  array(state.ties);
  array(state.appraisals);
  array(state.events);
}

function validatePhysicalCommit(state: CurrentGrantView, event: GrantPhysicalBatch): void {
  guardCurrentView(state);
  requireId(event.id);
  requireInteger(event.year, Number.MIN_SAFE_INTEGER);
  requireInteger(event.position, 0);
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
}

/** Physical grant only: caller admits history and owns version, identity and log assembly. */
export function applyGrantPhysics(state: CurrentGrantView, event: GrantPhysicalBatch): GrantPhysicalLedger {
  ownData(event);
  record(event);
  requireFields(event, ["id", "year", "position", "actors", "causes", "effects"]);
  validatePhysicalCommit(state, event);
  if (event.effects.length < 2) throw new Error("Incomplete grant");
  const [creditor, debtor] = event.actors as [string, string];
  const next: GrantPhysicalLedger = structuredClone({ grain: state.grain, obligations: [...state.obligations], ties: [...state.ties], appraisals: [...state.appraisals] });
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
    reduceSupplemental(next, event, effect, index);
  });
  return next;
}

function reduceSupplemental(next: Pick<FavorState, "ties" | "appraisals">, event: Pick<FavorEvent, "id" | "actors">, effect: HelpFavorEffect, index: number): void {
  record(effect);
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
}

// Narrow structural comparison avoids importing A orchestration/hash utilities.
function encoding(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(encoding).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${encoding((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

/** Imported checkpoints must be equivalent to their complete recorded prefix. No repair. */
function validateState(state: FavorState): FavorState;
function validateState(state: HelpFavorState): HelpFavorState;
function validateState(state: AnyFavorState): AnyFavorState;
function validateState(state: AnyFavorState): AnyFavorState {
  ownData(state, true);
  record(state);
  const helpState = state.schema === HELP_FAVOR_VERSION;
  requireFields(state, ["schema", "reducer", "people", "legacyEvents", "allocations", "grain", "obligations", "ties", "appraisals", "events", ...(helpState ? ["initialAssistance", "initialNeed", "assistance", "need"] : [])]);
  if (![FAVOR_VERSION, HELP_FAVOR_VERSION].includes(state.schema) || state.reducer !== state.schema) throw new Error("Unsupported favor state");
  for (const value of [state.allocations, state.grain, state.obligations, state.ties, state.appraisals, state.events]) ownData(value);
  array(state.events);
  let rebuilt: AnyFavorState = state.schema === HELP_FAVOR_VERSION
    ? createHelpFavorState(state.people, state.legacyEvents, state.allocations, state.initialAssistance, state.initialNeed)
    : createFavorState(state.people, state.legacyEvents, state.allocations);
  for (const event of state.events) rebuilt = reduce(rebuilt, event);
  if (state.schema === HELP_FAVOR_VERSION && rebuilt.schema === HELP_FAVOR_VERSION) {
    ownData(state.assistance);
    ownData(state.need);
    if (encoding(state.assistance) !== encoding(rebuilt.assistance) || encoding(state.need) !== encoding(rebuilt.need)) throw new Error("Resource checkpoint mismatch");
  }
  for (const key of ["grain", "obligations", "ties", "appraisals"] as const) {
    if (encoding(rebuilt[key]) !== encoding(state[key])) throw new Error("Checkpoint does not match recorded effects");
  }
  return rebuilt;
}

function resourceInput(people: Record<string, Person>, values: Readonly<Record<string, number>>): Record<string, number> {
  ownData(values);
  record(values);
  for (const [actor, value] of Object.entries(values)) {
    if (!Object.hasOwn(people, actor)) throw new Error("Resource without registered actor");
    requireInteger(value, 0);
  }
  return { ...values };
}

/** Fresh C only: complete explicit inputs, not an upgraded B checkpoint. */
export function createHelpFavorState(people: Readonly<Record<string, Person>>, legacyEvents: readonly Event[], allocations: Readonly<Record<string, number>>, assistance: Readonly<Record<string, number>>, need: Readonly<Record<string, number>>): HelpFavorState {
  const base = createFavorState(people, legacyEvents, allocations);
  const initialAssistance = resourceInput(base.people, assistance);
  const initialNeed = resourceInput(base.people, need);
  return { ...base, schema: HELP_FAVOR_VERSION, reducer: HELP_FAVOR_VERSION, events: [], initialAssistance, initialNeed, assistance: { ...initialAssistance }, need: { ...initialNeed } };
}

export function currentHelpContext(state: CurrentHelpView, obligationId: string, year: number): { obligation: HelpObligation; evidence: HelpEvidence } {
  guardCurrentView(state);
  ownData(state.assistance);
  ownData(state.need);
  record(state.assistance);
  record(state.need);
  requireId(obligationId);
  requireInteger(year, Number.MIN_SAFE_INTEGER);
  const obligation = state.obligations.find((entry) => entry.id === obligationId);
  if (!obligation || obligation.status !== "open") throw new Error("Expected existing open debt");
  const grant = state.events.find((entry) => entry.id === obligation.origin);
  if (!grant || grant.kind !== "grain-grant" || grant.year >= year) throw new Error("Help must follow an earlier-year grant");
  const { creditor, debtor } = obligation;
  for (const actor of [creditor, debtor]) {
    requireId(actor);
    const person = Object.hasOwn(state.people, actor) ? state.people[actor] : undefined;
    if (!person || person.birthYear > year || (person.deathYear !== undefined && person.deathYear <= year)) throw new Error("Unknown or dead actor");
    const history = state.legacyEvents.filter((entry) => entry.year <= year);
    if (person.away || ensureLifeState(person, history).residence.status !== "home") throw new Error("Absent actor");
    if (!Object.hasOwn(state.grain, actor)) throw new Error("Missing explicit allocation");
  }
  if (!Object.hasOwn(state.assistance, debtor) || !Object.hasOwn(state.need, creditor)) throw new Error("Missing explicit help resources");
  requireInteger(state.assistance[debtor], 1);
  requireInteger(state.need[creditor], 1);
  const mind = state.people[debtor]!.mind;
  const tie = state.ties.find((entry) => entry.actor === debtor && entry.counterpart === creditor);
  const policy = favorPolicy({ openDebt: true, altruism: mind.facets.altruism, anxiety: mind.facets.anxiety, wealthPreference: mind.values.wealth, trust: tie?.trust ?? 0, resentment: tie?.resentment ?? 0 });
  return { obligation: structuredClone(obligation), evidence: { ...policy, feasibility: { assistance: state.assistance[debtor]!, need: state.need[creditor]! } } };
}

/** Canonical tuple excludes prefix position, noise and transport/override identities. */
function responseKey(request: string, year: number, actors: string[]): string {
  return JSON.stringify(["help-response", actors, year, request, "response"]);
}
export function canonicalHelpResponseEffects(state: Pick<CurrentHelpView, "ties">, obligation: HelpObligation, id: string, selected: "help" | "refuse"): HelpFavorEffect[] {
  ownData(state);
  record(state);
  requireFields(state, ["ties"]);
  ownData(obligation);
  requireId(id);
  if (selected !== "help" && selected !== "refuse") throw new Error("Unknown help choice");
  const { creditor, debtor } = obligation;
  const effects: HelpFavorEffect[] = [{ kind: "settlement", id: obligation.id, origin: obligation.origin, creditor, debtor, status: selected === "help" ? "fulfilled" : "broken" }];
  if (selected === "help") effects.push({ kind: "assistance", from: debtor, to: creditor, amount: 1 });
  const tie = state.ties.find((entry) => entry.actor === creditor && entry.counterpart === debtor);
  const trust = tie?.trust ?? 0;
  const resentment = tie?.resentment ?? 0;
  effects.push({ kind: "tie", origin: id, actor: creditor, counterpart: debtor, trust: selected === "help" ? Math.min(5, 100 - trust) : -Math.min(5, trust + 100), resentment: selected === "help" ? 0 : Math.min(5, 100 - resentment) });
  return effects;
}

/** Stage physical consequences only. The caller owns version/identity, policy
 * selection, admitted history and log assembly; this is not replay admission. */
export function applyHelpResponsePhysics(state: CurrentHelpView, batch: HelpResponseBatch, selected: "help" | "refuse"): HelpPhysicalLedger {
  ownData(batch);
  record(batch);
  requireFields(batch, ["id", "year", "position", "actors", "causes", "obligation", "request", "effects"]);
  requireId(batch.id);
  requireId(batch.request);
  requireInteger(batch.position, 0);
  array(batch.actors);
  array(batch.causes);
  array(batch.effects);
  const { obligation } = currentHelpContext(state, batch.obligation, batch.year);
  const actors = [obligation.creditor, obligation.debtor];
  if (encoding(batch.actors) !== encoding(actors)) throw new Error("Help parties mismatch");
  if (batch.position !== state.events.length || state.events.some((entry) => entry.id === batch.id)) throw new Error("Repeated or unordered commit");
  const last = state.events.at(-1);
  if (last && batch.year < last.year) throw new Error("Time reversal");
  const request = state.events.find((entry) => entry.id === batch.request);
  if (!request || request.kind !== "help-request" || request.obligation !== obligation.id || request.year > batch.year || request.position >= batch.position || encoding(request.actors) !== encoding(actors)) throw new Error("Invalid request identity/frontier");
  if (state.events.some((entry) => entry.kind === "help-response" && entry.request === request.id)) throw new Error("Repeated response");
  if (encoding(batch.causes) !== encoding([obligation.origin, request.id])) throw new Error("Invalid response causes");
  const expected = canonicalHelpResponseEffects({ ties: state.ties }, obligation, batch.id, selected);
  if (encoding(batch.effects.slice(0, expected.length)) !== encoding(expected)) throw new Error("Noncanonical response effects");
  const next: HelpPhysicalLedger = structuredClone({ assistance: state.assistance, need: state.need, obligations: [...state.obligations], ties: [...state.ties], appraisals: [...state.appraisals] });
  batch.effects.forEach((effect, index) => {
    if (index < expected.length && effect.kind === "settlement") {
      next.obligations.find((entry) => entry.id === obligation.id)!.status = effect.status;
    } else if (index < expected.length && effect.kind === "assistance") {
      next.assistance[obligation.debtor]!--;
      next.need[obligation.creditor]!--;
    } else {
      if (index >= expected.length && effect.kind !== "appraisal") throw new Error("Only explicit appraisals may follow response effects");
      reduceSupplemental(next, batch, effect, index);
    }
  });
  return next;
}

/** Current request context and causal validation, without checkpoint or version admission. */
export function validateHelpRequestPhysics(state: CurrentHelpView, batch: HelpRequestBatch): { obligation: HelpObligation; evidence: HelpEvidence } {
  ownData(batch);
  record(batch);
  requireFields(batch, ["id", "year", "position", "actors", "causes", "effects", "obligation"]);
  validatePhysicalCommit(state, batch);
  const context = currentHelpContext(state, batch.obligation, batch.year);
  const { obligation } = context;
  if (encoding(batch.actors) !== encoding([obligation.creditor, obligation.debtor])) throw new Error("Help parties mismatch");
  if (state.events.some((entry) => entry.kind === "help-request" && entry.obligation === obligation.id)) throw new Error("Repeated request");
  if (encoding(batch.causes) !== encoding([obligation.origin]) || batch.effects.length !== 0) throw new Error("Invalid request cause/effects");
  return context;
}

function reduceHelp(state: HelpFavorState, event: HelpFavorEvent): HelpFavorState {
  const { id, year, position, actors: eventActors, causes, effects } = event;
  const { obligation, evidence } = event.kind === "help-request"
    ? validateHelpRequestPhysics(state, { id, year, position, actors: eventActors, causes, effects, obligation: event.obligation! })
    : currentHelpContext(state, event.obligation!, event.year);
  const actors = [obligation.creditor, obligation.debtor];
  if (encoding(event.actors) !== encoding(actors)) throw new Error("Help parties mismatch");
  if (event.kind === "help-response") {
    requireId(event.request);
    const request = state.events.find((entry) => entry.id === event.request);
    if (!request || request.kind !== "help-request" || request.obligation !== obligation.id || request.year > event.year || request.position >= event.position || encoding(request.actors) !== encoding(actors)) throw new Error("Invalid request identity/frontier");
    if (state.events.some((entry) => entry.kind === "help-response" && entry.request === request.id)) throw new Error("Repeated response");
    if (event.key !== responseKey(request.id, event.year, actors) || encoding(event.causes) !== encoding([obligation.origin, request.id])) throw new Error("Invalid response identity/causes");
    record(event.evidence);
    const noise = event.evidence.noise!;
    const selected = selectFavorResponse(evidence.factors, noise);
    Object.assign(evidence, { noise, selected });
    const expected = canonicalHelpResponseEffects({ ties: state.ties }, obligation, event.id, selected);
    if (encoding(event.effects.slice(0, expected.length)) !== encoding(expected)) throw new Error("Noncanonical response effects");
  } else if (event.kind !== "help-request") throw new Error("Unsupported help event");
  if (encoding(event.evidence) !== encoding(evidence)) throw new Error("Stale or forged consumed evidence");
  const next = structuredClone(state);
  if (event.kind === "help-response") {
    const { id, year, position, actors, causes, effects } = event;
    Object.assign(next, applyHelpResponsePhysics(state, { id, year, position, actors, causes, effects, obligation: obligation.id, request: event.request! }, evidence.selected!));
  }
  next.events.push(structuredClone(event));
  return next;
}

export function requestHelp(state: HelpFavorState, command: HelpRequestCommand): HelpFavorState {
  ownData(command);
  record(command);
  requireFields(command, ["key", "year", "obligation"]);
  requireId(command.key);
  requireInteger(command.year, Number.MIN_SAFE_INTEGER);
  const validated = validateState(state);
  if (validated.schema !== HELP_FAVOR_VERSION) throw new Error("Expected C state");
  const { obligation, evidence } = currentHelpContext(validated, command.obligation, command.year);
  return reduce(validated, { version: HELP_FAVOR_VERSION, id: identity(command.key, HELP_FAVOR_VERSION), key: command.key, ordinal: 0, kind: "help-request", year: command.year, position: validated.events.length, actors: [obligation.creditor, obligation.debtor], causes: [obligation.origin], obligation: obligation.id, evidence, effects: [] });
}

export function respondHelp(state: HelpFavorState, command: HelpResponseCommand): HelpFavorState {
  ownData(command);
  record(command);
  requireFields(command, ["request", "year", "noise", "appraisals"]);
  requireId(command.request);
  requireInteger(command.year, Number.MIN_SAFE_INTEGER);
  array(command.appraisals);
  const validated = validateState(state);
  if (validated.schema !== HELP_FAVOR_VERSION) throw new Error("Expected C state");
  const request = validated.events.find((entry) => entry.id === command.request);
  if (!request || request.kind !== "help-request") throw new Error("Unknown request");
  const { obligation, evidence } = currentHelpContext(validated, request.obligation!, command.year);
  const selected = selectFavorResponse(evidence.factors, command.noise);
  Object.assign(evidence, { noise: command.noise, selected });
  const actors = [obligation.creditor, obligation.debtor];
  const key = responseKey(request.id, command.year, actors);
  const id = identity(key, HELP_FAVOR_VERSION);
  const effects = canonicalHelpResponseEffects({ ties: validated.ties }, obligation, id, selected);
  for (const appraisal of command.appraisals) {
    record(appraisal);
    requireFields(appraisal, ["actor", "interpretation", "intensity"]);
    effects.push({ kind: "appraisal", id: `${id}/appraisal/${effects.length}`, origin: id, ...appraisal });
  }
  return reduce(validated, { version: HELP_FAVOR_VERSION, id, key, ordinal: 0, kind: "help-response", year: command.year, position: validated.events.length, actors, causes: [obligation.origin, request.id], obligation: obligation.id, request: request.id, evidence, effects });
}

export function applyHelpFavorEvent(state: HelpFavorState, event: HelpFavorEvent): HelpFavorState {
  const validated = validateState(state);
  if (validated.schema !== HELP_FAVOR_VERSION) throw new Error("Expected C state");
  return reduce(validated, event);
}
export function replayHelpFavorEvents(initial: HelpFavorState, events: readonly HelpFavorEvent[]): HelpFavorState {
  ownData(events);
  array(events);
  let state = validateState(initial);
  if (state.schema !== HELP_FAVOR_VERSION) throw new Error("Expected C state");
  for (const event of events) state = reduce(state, event);
  return state;
}

export type HelpSkipReason = "closed" | "grant-not-earlier" | "already-requested" | "unborn" | "dead" | "absent" | "missing-allocation" | "missing-assistance" | "exhausted-assistance" | "missing-need" | "no-need";
export interface HelpOpportunity { obligation: string; creditor: string; debtor: string; reason: HelpSkipReason | null }

/** C-only preflight: malformed reality throws; legitimate ineligibility is explicit data.
 * Validate every viable candidate's consumed policy before any scheduler activation draw. */
export function helpOpportunities(input: HelpFavorState, year: number): { state: HelpFavorState; candidates: HelpOpportunity[] } {
  requireInteger(year, Number.MIN_SAFE_INTEGER);
  const state = replayHelpFavorEvents(input, []);
  return { state, candidates: inspectHelpOpportunities(state, year) };
}

/** Inspect already-admitted current physics; ineligibility is not a refusal. */
export function inspectHelpOpportunities(state: CurrentHelpView, year: number): HelpOpportunity[] {
  guardCurrentView(state);
  ownData(state.assistance);
  ownData(state.need);
  record(state.assistance);
  record(state.need);
  requireInteger(year, Number.MIN_SAFE_INTEGER);
  const history = state.legacyEvents.filter((entry) => entry.year <= year);
  return state.obligations.map((obligation): HelpOpportunity => {
    const { id, creditor, debtor } = obligation;
    const candidate = { obligation: id, creditor, debtor };
    if (obligation.status !== "open") return { ...candidate, reason: "closed" };
    const grant = state.events.find((entry) => entry.id === obligation.origin);
    if (!grant || grant.kind !== "grain-grant") throw new Error("Unknown grant reference");
    if (grant.year >= year) return { ...candidate, reason: "grant-not-earlier" };
    if (state.events.some((entry) => entry.kind === "help-request" && entry.obligation === id)) return { ...candidate, reason: "already-requested" };
    for (const actor of [creditor, debtor]) {
      const person = Object.hasOwn(state.people, actor) ? state.people[actor] : undefined;
      if (!person) throw new Error("Unknown opportunity actor");
      if (person.birthYear > year) return { ...candidate, reason: "unborn" };
      if (person.deathYear !== undefined && person.deathYear <= year) return { ...candidate, reason: "dead" };
      if (person.away || ensureLifeState(person, history).residence.status !== "home") return { ...candidate, reason: "absent" };
      if (!Object.hasOwn(state.grain, actor)) return { ...candidate, reason: "missing-allocation" };
    }
    if (!Object.hasOwn(state.assistance, debtor)) return { ...candidate, reason: "missing-assistance" };
    if (state.assistance[debtor] === 0) return { ...candidate, reason: "exhausted-assistance" };
    if (!Object.hasOwn(state.need, creditor)) return { ...candidate, reason: "missing-need" };
    if (state.need[creditor] === 0) return { ...candidate, reason: "no-need" };
    currentHelpContext(state, id, year);
    return { ...candidate, reason: null };
  });
}

export function applyFavorEvent(state: FavorState, event: FavorEvent): FavorState {
  const validated = validateState(state);
  if (validated.schema !== FAVOR_VERSION) throw new Error("Expected B state");
  return reduce(validated, event);
}
export function replayFavorEvents(initial: FavorState, events: readonly FavorEvent[]): FavorState {
  ownData(events);
  array(events);
  let state = validateState(initial);
  if (state.schema !== FAVOR_VERSION) throw new Error("Expected B state");
  for (const event of events) state = reduce(state, event);
  return state;
}
export function grantFavor(state: FavorState, command: FavorCommand): FavorState {
  return grant(state, command, FAVOR_VERSION) as FavorState;
}
export function grantHelpFavor(state: HelpFavorState, command: FavorCommand): HelpFavorState {
  return grant(state, command, HELP_FAVOR_VERSION) as HelpFavorState;
}
function grant(state: AnyFavorState, command: FavorCommand, version: AnyFavorState["schema"]): AnyFavorState {
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
  if (validated.schema !== version) throw new Error("Command/state version mismatch");
  const id = identity(command.key, validated.schema);
  const effects: FavorEffect[] = [
    { kind: "grain", from: command.creditor, to: command.debtor, amount: 1 },
    { kind: "obligation", id: `${id}/help`, debtor: command.debtor, creditor: command.creditor, origin: id, status: "open" },
  ];
  const event: AnyFavorEvent = { version: validated.schema, id, key: command.key, ordinal: 0, kind: "grain-grant", year: command.year, position: validated.events.length, actors: [command.creditor, command.debtor], causes: command.causes, effects };
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

import {
  applyHelpResponsePhysics, canonicalHelpResponseEffects, createHelpFavorState,
  currentHelpContext, replayHelpFavorEvents, requireFavorData,
  type AppraisalInput, type CurrentHelpView, type HelpEvidence, type HelpFavorEffect,
  type HelpFavorEvent, type HelpFavorState,
} from "./effects";
import { selectFavorResponse } from "./favor-policy";
import { requireFields, requireId, requireInteger } from "./obligations";

/** Standalone declared authority, not authenticated human identity or a fork engine. */
export const FAVOR_AUTHORITY_VERSION = "favor-authority-d2a";
export const FAVOR_AUTHORITY_MANIFEST = Object.freeze({
  schema: FAVOR_AUTHORITY_VERSION, projection: FAVOR_AUTHORITY_VERSION,
  engine: FAVOR_AUTHORITY_VERSION, reducer: FAVOR_AUTHORITY_VERSION,
  rules: FAVOR_AUTHORITY_VERSION,
});
type Choice = "help" | "refuse";
interface AuthorityTarget {
  version: typeof FAVOR_AUTHORITY_VERSION;
  target: string;
  actors: [string, string];
  year: number;
}
export type ResponseAuthority =
  | (AuthorityTarget & { source: "seeded" })
  | (AuthorityTarget & { source: "human"; choice: Choice });
export interface AuthorityEvidence extends Omit<HelpEvidence, "noise" | "selected"> {
  noise: number;
  baselineSelection: Choice;
  effectiveChoice: Choice;
  authority: ResponseAuthority;
}
export interface AuthorityFavorEvent {
  version: typeof FAVOR_AUTHORITY_VERSION;
  id: string;
  key: string;
  ordinal: 0;
  kind: "help-response";
  year: number;
  position: number;
  actors: [string, string];
  causes: string[];
  obligation: string;
  request: string;
  evidence: AuthorityEvidence;
  effects: HelpFavorEffect[];
}
export interface AuthorityFavorState extends Omit<HelpFavorState, "schema" | "reducer" | "events"> {
  manifest: typeof FAVOR_AUTHORITY_MANIFEST;
  prefixLength: number;
  events: (HelpFavorEvent | AuthorityFavorEvent)[];
}
export interface AuthorityResponseCommand {
  request: string;
  year: number;
  noise: number;
  appraisals: AppraisalInput[];
  authority?: ResponseAuthority;
}

function fields(value: unknown, keys: string[]): asserts value is Record<string, unknown> {
  requireFavorData(value);
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected authority record");
  requireFields(value, keys);
}
function array(value: unknown): asserts value is unknown[] {
  if (!Array.isArray(value)) throw new Error("Expected authority array");
}
// Comparison only, after descriptor admission; not a wire codec or integrity hash.
function encoding(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(encoding).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${encoding((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
function equal(actual: unknown, expected: unknown, message: string): void {
  if (encoding(actual) !== encoding(expected)) throw new Error(message);
}
function fromC(c: HelpFavorState): AuthorityFavorState {
  // C admission owns the transient reconstruction. Retain one registry and log,
  // not a persisted root/final world pair or a D log labelled as C.
  const { people, legacyEvents, allocations, grain, initialAssistance, initialNeed, assistance, need, obligations, ties, appraisals, events } = c;
  return { manifest: { ...FAVOR_AUTHORITY_MANIFEST }, prefixLength: events.length, people, legacyEvents, allocations, grain, initialAssistance, initialNeed, assistance, need, obligations, ties, appraisals, events };
}
export function createAuthorityFavorState(prefix: HelpFavorState): AuthorityFavorState {
  return fromC(replayHelpFavorEvents(prefix, []));
}

function responseContext(state: CurrentHelpView, requestId: string, year: number) {
  requireId(requestId);
  requireInteger(year, Number.MIN_SAFE_INTEGER);
  const request = state.events.find((entry) => entry.id === requestId);
  // This unit has only C requests. D request/scheduling/fork identities are later.
  if (!request || request.kind !== "help-request" || !("key" in request) || typeof request.key !== "string" || request.year !== year) throw new Error("Expected fresh current-year C request");
  const { obligation, evidence } = currentHelpContext(state, request.obligation!, year);
  const actors: [string, string] = [obligation.creditor, obligation.debtor];
  equal(request.actors, actors, "Request parties mismatch");
  const target = JSON.stringify(["help-response", actors, year, ["favor-c1/help-request", request.key, request.year], "response"]);
  return { request, obligation, evidence, actors, target };
}
export function helpResponseTarget(state: AuthorityFavorState, request: string, year: number): string {
  return responseContext(admitAuthorityFavorState(state), request, year).target;
}

/** One resolver for commands and imported records. Baseline noise never becomes
 * an override transport; human choice is a separate, explicitly declared input. */
function resolve(state: AuthorityFavorState, requestId: string, year: number, noise: number, declared?: ResponseAuthority): Omit<AuthorityFavorEvent, "effects"> {
  const { request, obligation, evidence, actors, target } = responseContext(state, requestId, year);
  const baselineSelection = selectFavorResponse(evidence.factors, noise);
  const metadata: AuthorityTarget = { version: FAVOR_AUTHORITY_VERSION, target, actors, year };
  const authority = declared === undefined ? { ...metadata, source: "seeded" as const } : declared;
  requireFavorData(authority);
  if (authority === null || typeof authority !== "object") throw new Error("Expected declared authority record");
  fields(authority, ["version", "source", "target", "actors", "year", ...(authority.source === "human" ? ["choice"] : [])]);
  if (authority.source !== "human" && authority.source !== "seeded") throw new Error("Unknown response authority source");
  equal({ version: authority.version, target: authority.target, actors: authority.actors, year: authority.year }, metadata, "Authority target/parties/year mismatch");
  const effectiveChoice = authority.source === "human" ? authority.choice : baselineSelection;
  if (effectiveChoice !== "help" && effectiveChoice !== "refuse") throw new Error("Unknown response authority choice");
  const id = JSON.stringify([FAVOR_AUTHORITY_VERSION, target, 0]);
  return {
    version: FAVOR_AUTHORITY_VERSION, id, key: target, ordinal: 0 as const, kind: "help-response" as const,
    year, position: state.events.length, actors, causes: [obligation.origin, request.id], obligation: obligation.id, request: request.id,
    evidence: { ...evidence, noise, baselineSelection, effectiveChoice, authority: structuredClone(authority) },
  };
}
function reduceResponse(state: AuthorityFavorState, event: AuthorityFavorEvent): AuthorityFavorState {
  fields(event, ["version", "id", "key", "ordinal", "kind", "year", "position", "actors", "causes", "obligation", "request", "evidence", "effects"]);
  fields(event.evidence, ["factors", "options", "distribution", "feasibility", "noise", "baselineSelection", "effectiveChoice", "authority"]);
  const expected = resolve(state, event.request, event.year, event.evidence.noise, event.evidence.authority);
  const { effects, ...recorded } = event;
  equal(recorded, expected, "Noncanonical D response identity/evidence/causes");
  const { id, year, position, actors, causes, obligation, request } = expected;
  const physical = applyHelpResponsePhysics(state, { id, year, position, actors, causes, obligation, request, effects }, expected.evidence.effectiveChoice);
  return { ...state, ...physical, events: [...state.events, structuredClone(event)] };
}

/** Closed D admission: transient C-prefix replay, then D-only response replay,
 * then all derived checkpoints must agree. No repair, migration or root mirror. */
export function admitAuthorityFavorState(state: AuthorityFavorState): AuthorityFavorState {
  requireFavorData(state, true);
  if (state === null || typeof state !== "object" || Array.isArray(state)) throw new Error("Expected D state");
  requireFields(state, ["manifest", "prefixLength", "people", "legacyEvents", "allocations", "grain", "initialAssistance", "initialNeed", "assistance", "need", "obligations", "ties", "appraisals", "events"]);
  for (const [key, value] of Object.entries(state)) if (key !== "people" && key !== "legacyEvents") requireFavorData(value);
  fields(state.manifest, ["schema", "projection", "engine", "reducer", "rules"]);
  equal(state.manifest, FAVOR_AUTHORITY_MANIFEST, "Unsupported D manifest");
  array(state.events);
  requireInteger(state.prefixLength, 0, state.events.length);
  const initial = createHelpFavorState(state.people, state.legacyEvents, state.allocations, state.initialAssistance, state.initialNeed);
  // The C reducer itself rejects mixed/unsupported prefix events. Never cast a D
  // checkpoint into C: this array is admitted by C before constructing D state.
  const prefix = state.events.slice(0, state.prefixLength);
  const cEvents: HelpFavorEvent[] = [];
  for (const event of prefix) {
    if (event.version !== initial.schema) throw new Error("D prefix must be unchanged C");
    cEvents.push(event);
  }
  let rebuilt = fromC(replayHelpFavorEvents(initial, cEvents));
  for (const event of state.events.slice(state.prefixLength)) {
    if (event.version !== FAVOR_AUTHORITY_VERSION) throw new Error("D suffix accepts only D responses");
    rebuilt = reduceResponse(rebuilt, event);
  }
  for (const key of ["grain", "assistance", "need", "obligations", "ties", "appraisals"] as const) equal(state[key], rebuilt[key], "D checkpoint mismatch");
  return rebuilt;
}
export function respondWithAuthority(state: AuthorityFavorState, command: AuthorityResponseCommand): AuthorityFavorState {
  requireFavorData(command);
  fields(command, ["request", "year", "noise", "appraisals", ...(Object.hasOwn(command, "authority") ? ["authority"] : [])]);
  array(command.appraisals);
  const validated = admitAuthorityFavorState(state);
  const header = resolve(validated, command.request, command.year, command.noise, command.authority);
  const obligation = validated.obligations.find((entry) => entry.id === header.obligation)!;
  const effects = canonicalHelpResponseEffects({ ties: validated.ties }, obligation, header.id, header.evidence.effectiveChoice);
  for (const appraisal of command.appraisals) {
    fields(appraisal, ["actor", "interpretation", "intensity"]);
    effects.push({ kind: "appraisal", id: `${header.id}/appraisal/${effects.length}`, origin: header.id, ...appraisal });
  }
  return reduceResponse(validated, { ...header, effects });
}
export function applyAuthorityFavorEvent(state: AuthorityFavorState, event: AuthorityFavorEvent): AuthorityFavorState {
  requireFavorData(event);
  return reduceResponse(admitAuthorityFavorState(state), event);
}
export function replayAuthorityFavorEvents(state: AuthorityFavorState, events: readonly AuthorityFavorEvent[]): AuthorityFavorState {
  requireFavorData(events);
  array(events);
  let rebuilt = admitAuthorityFavorState(state);
  for (const event of events) rebuilt = reduceResponse(rebuilt, event);
  return rebuilt;
}

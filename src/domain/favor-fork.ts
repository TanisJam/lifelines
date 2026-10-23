import {
  applyGrantPhysics, applyHelpResponsePhysics, canonicalHelpResponseEffects,
  createHelpFavorState, currentHelpContext, replayHelpFavorEvents, requireFavorData,
  validateHelpRequestPhysics, type FavorCommand, type HelpFavorEffect,
  type HelpFavorEvent, type HelpFavorState, type HelpEvidence,
} from "./effects";
import { selectFavorResponse } from "./favor-policy";
import { requireFields, requireId, requireInteger } from "./obligations";
import { admitFavorScheduler, type FavorScheduler, type FavorYear } from "./scheduler";
import { executeForkYear, type ForkYear } from "./favor-scheduler";

export const FAVOR_FORK_VERSION = "favor-fork-d2b";
export const FAVOR_FORK_MANIFEST = Object.freeze({
  schema: FAVOR_FORK_VERSION, projection: FAVOR_FORK_VERSION, engine: FAVOR_FORK_VERSION,
  reducer: FAVOR_FORK_VERSION, rules: FAVOR_FORK_VERSION,
  scheduler: "favor-scheduler-d2b", baselineScheduler: "favor-scheduler-c2", rng: "keyed-mulberry32-c2",
  config: Object.freeze({ slotsPerCreditorYear: 2, activation: 0.25, selection: "first-eligible-semantic-utf8-c2" }),
} as const);
type Choice = "help" | "refuse";
export interface ForkChoice { target: string; actors: [string, string]; year: number; choice: Choice }
export type ForkAction =
  | { kind: "grant"; at: number; command: FavorCommand }
  | { kind: "choice"; at: number; command: ForkChoice }
  | { kind: "year"; year: number }
  | { kind: "fork"; year: number; key: string; overrides: ForkChoice[] };
export interface ForkDeclaration {
  id: string; lineage: string; position: number; declaredAt: number;
  kind: "grant" | "choice"; command: FavorCommand | ForkChoice;
  status: "pending" | "effective" | "superseded" | "inactive";
}
export interface ForkMapping { kind: "grant" | "debt" | "request" | "response" | "appraisal"; semantic: string; physical: string }
export interface ForkEvidence extends Omit<HelpEvidence, "noise" | "selected"> {
  noise: number; baselineSelection: Choice; effectiveChoice: Choice;
  authority: { source: "seeded" } | { source: "human"; declaration: string };
}
export interface ForkEvent {
  version: typeof FAVOR_FORK_VERSION; id: string; semantic: string; lineage: string;
  kind: "grain-grant" | "help-request" | "help-response"; year: number; position: number;
  actors: string[]; causes: string[]; effects: HelpFavorEffect[];
  obligation?: string; request?: string; evidence?: HelpEvidence | ForkEvidence;
}
interface Prefix {
  length: number; initialPrefixLength: number; initialPreviousYear: number;
  completedYear: number; years: FavorYear[];
}
export interface FavorFork extends Omit<HelpFavorState, "schema" | "reducer" | "events"> {
  manifest: typeof FAVOR_FORK_MANIFEST; key: string; seed: string; prefix: Prefix;
  lineage: string; completedYear: number; actions: ForkAction[];
  history: ForkDeclaration[]; mapping: ForkMapping[]; years: ForkYear[];
  events: (HelpFavorEvent | ForkEvent)[];
}

// Equality is admission-local, not a serialized capsule codec or authenticity claim.
function forkEncoding(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(forkEncoding).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${forkEncoding((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
// After the full descriptor guard, allow undefined only at declared legacy paths.
// This is core input validation, not normalization or a serialized codec.
const personOptionals = new Set(["deathYear", "spouseId", "motherId", "fatherId", "socialClass", "literate", "away", "lifeState"]);
function legacyOptional(path: string[]): boolean {
  if (path[0] === "legacyEvents") return path.length === 3 && path[2] === "significance";
  if (path[0] !== "people") return false;
  if (path.length === 3) return personOptionals.has(path[2]!);
  if (path[2] === "lifeState") {
    if (path.length === 4) return path[3] === "marriageableSince";
    return path.length === 5 && ((path[3] === "marital" && path[4] === "partnerId") || (path[3] === "residence" && path[4] === "place") || (path[3] === "vocation" && path[4] === "masterId"));
  }
  return path.length === 6 && path[2] === "mind" && ["thoughts", "memories"].includes(path[3]!) && path[5] === "personId";
}
function checkUndefined(value: unknown, path: string[] = []): void {
  if (value === undefined) {
    if (!legacyOptional(path)) throw new Error("Unsafe undefined in D2b input");
  } else if (Array.isArray(value)) value.forEach((entry, index) => checkUndefined(entry, [...path, String(index)]));
  else if (value !== null && typeof value === "object") for (const [key, entry] of Object.entries(value)) checkUndefined(entry, [...path, key]);
}
function same(a: unknown, b: unknown, message: string): void {
  if (forkEncoding(a) !== forkEncoding(b)) throw new Error(message);
}
function fields(value: unknown, keys: string[]): asserts value is Record<string, unknown> {
  requireFavorData(value);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected D2b record");
  requireFields(value, keys);
}
export function semanticGrant(key: string): string { return JSON.stringify(["favor-c1", key, 0]); }
export function semanticResponseTarget(key: string, actors: string[], year: number): string {
  return JSON.stringify(["help-response", actors, year, ["favor-c1/help-request", key, year], "response"]);
}
function physicalForkId(state: FavorFork, semantic: string): string {
  return JSON.stringify([FAVOR_FORK_VERSION, state.lineage, semantic]);
}
function mapForkIdentity(state: FavorFork, kind: ForkMapping["kind"], semantic: string, physical: string): void {
  requireId(semantic); requireId(physical);
  if (state.mapping.some((entry) => entry.semantic === semantic || entry.physical === physical)) throw new Error("Semantic/physical identity collision");
  state.mapping.push({ kind, semantic, physical });
}
export function semanticForkIdentity(state: FavorFork, physical: string): string {
  const found = state.mapping.find((entry) => entry.physical === physical);
  if (!found) throw new Error("Unmapped physical reference");
  return found.semantic;
}
function fromPrefix(c: FavorScheduler, key: string): FavorFork {
  const { people, legacyEvents, allocations, grain, initialAssistance, initialNeed, assistance, need, obligations, ties, appraisals, events } = c.state;
  const inputs = { people, legacyEvents, allocations, grain, initialAssistance, initialNeed, assistance, need, obligations, ties, appraisals };
  const root: FavorFork = {
    ...inputs, manifest: structuredClone(FAVOR_FORK_MANIFEST), key, seed: c.seed,
    prefix: { length: events.length, initialPrefixLength: c.initialPrefixLength, initialPreviousYear: c.initialPreviousYear, completedYear: c.completedYear, years: structuredClone(c.years) },
    lineage: JSON.stringify([FAVOR_FORK_VERSION, "root", key]), completedYear: c.completedYear,
    actions: [], history: [], mapping: [], years: [], events: structuredClone(events),
  };
  for (const event of events) {
    mapForkIdentity(root, event.kind === "grain-grant" ? "grant" : event.kind === "help-request" ? "request" : "response", event.id, event.id);
    for (const effect of event.effects) {
      if (effect.kind === "obligation") mapForkIdentity(root, "debt", effect.id, effect.id);
      if (effect.kind === "appraisal") mapForkIdentity(root, "appraisal", effect.id, effect.id);
    }
  }
  return root;
}
/** C/C2 is explicitly admitted once; D2a and mixed logs have no chronology and fail closed. */
export function createFavorFork(prefix: FavorScheduler, key: string): FavorFork {
  requireFavorData(prefix, true);
  requireId(key);
  const admitted = admitFavorScheduler(prefix);
  checkUndefined(admitted.state);
  return fromPrefix(admitted, key);
}
function checkChoice(state: FavorFork, command: ForkChoice): void {
  fields(command, ["target", "actors", "year", "choice"]);
  requireId(command.target); requireInteger(command.year, Number.MIN_SAFE_INTEGER);
  if (command.year <= state.completedYear) throw new Error("Cannot replace a processed prefix choice");
  if (command.choice !== "help" && command.choice !== "refuse") throw new Error("Unknown human choice");
  if (!Array.isArray(command.actors) || command.actors.length !== 2 || command.actors[0] === command.actors[1]) throw new Error("Expected distinct target actors");
  for (const actor of command.actors) {
    requireId(actor);
    if (!Object.hasOwn(state.people, actor)) throw new Error("Unknown target actor");
  }
  const target: unknown = JSON.parse(command.target);
  if (!Array.isArray(target) || target.length !== 5 || target[0] !== "help-response" || target[4] !== "response") throw new Error("Malformed semantic response target");
  const request = target[3];
  if (!Array.isArray(request) || request.length !== 3 || request[0] !== "favor-c1/help-request" || typeof request[1] !== "string") throw new Error("Malformed semantic request target");
  same(target, ["help-response", command.actors, command.year, ["favor-c1/help-request", request[1], command.year], "response"], "Noncanonical target actors/year");
  same(command.target, JSON.stringify(target), "Noncanonical target encoding");
  const key: unknown = JSON.parse(request[1]);
  if (!Array.isArray(key) || key.length !== 8 || key[0] !== "favor-scheduler-c2" || key[1] !== "keyed-mulberry32-c2" || key[2] !== "help-opportunity" || key[7] !== "request" || (key[5] !== 0 && key[5] !== 1)) throw new Error("Unsupported semantic opportunity target");
  same(key[3], command.actors, "Opportunity actors mismatch");
  same(key[4], command.year, "Opportunity year mismatch");
  same(request[1], JSON.stringify(key), "Noncanonical opportunity key");
  const knownDebt = state.mapping.some((entry) => entry.kind === "debt" && entry.semantic === key[6]);
  const declaredGrant = state.history.some((entry) => entry.kind === "grant" && `${semanticGrant((entry.command as FavorCommand).key)}/help` === key[6] && forkEncoding([(entry.command as FavorCommand).creditor, (entry.command as FavorCommand).debtor]) === forkEncoding(command.actors));
  if (!knownDebt && !declaredGrant) throw new Error("Unknown semantic target debt");
  if (knownDebt) {
    const mapping = state.mapping.find((entry) => entry.semantic === key[6])!;
    const debt = state.obligations.find((entry) => entry.id === mapping.physical)!;
    same(command.actors, [debt.creditor, debt.debtor], "Target debt actors mismatch");
    if (debt.status !== "open" || state.events.some((event) => event.kind === "help-request" && event.obligation === debt.id)) throw new Error("Stale semantic target debt");
  }
}
function declare(state: FavorFork, kind: "grant" | "choice", command: FavorCommand | ForkChoice, at: number): void {
  requireInteger(at, Number.MIN_SAFE_INTEGER);
  if (at !== state.completedYear) throw new Error("Declaration chronology/frontier mismatch");
  if (kind === "grant") {
    const grant = command as FavorCommand;
    fields(grant, ["key", "year", "creditor", "debtor", "causes", "ties", "appraisals"]);
    requireId(grant.key); requireInteger(grant.year, Number.MIN_SAFE_INTEGER);
    requireId(grant.creditor); requireId(grant.debtor);
    if (grant.year <= at || grant.creditor === grant.debtor || !Object.hasOwn(state.people, grant.creditor) || !Object.hasOwn(state.people, grant.debtor)) throw new Error("Invalid future grant parties/year");
    if (!Array.isArray(grant.causes) || !Array.isArray(grant.ties) || !Array.isArray(grant.appraisals)) throw new Error("Expected grant inputs");
    if (state.mapping.some((entry) => entry.semantic === semanticGrant(grant.key)) || state.history.some((entry) => entry.kind === "grant" && (entry.command as FavorCommand).key === grant.key)) throw new Error("Duplicate semantic grant");
    // Causes are semantic identities of already-issued or earlier-declared grants.
    const causes = new Set<string>();
    for (const cause of grant.causes) {
      requireId(cause);
      if (causes.has(cause) || !state.mapping.some((entry) => entry.kind !== "debt" && entry.semantic === cause) && !state.history.some((entry) => entry.kind === "grant" && semanticGrant((entry.command as FavorCommand).key) === cause && entry.command.year <= grant.year)) throw new Error("Unknown or duplicate semantic cause");
      causes.add(cause);
    }
    for (const tie of grant.ties) {
      fields(tie, ["actor", "trust", "resentment"]);
      if (tie.actor !== grant.creditor && tie.actor !== grant.debtor) throw new Error("Tie actor outside grant");
      requireInteger(tie.trust, -200, 200); requireInteger(tie.resentment, -100, 100);
    }
    for (const appraisal of grant.appraisals) {
      fields(appraisal, ["actor", "interpretation", "intensity"]);
      if (appraisal.actor !== grant.creditor && appraisal.actor !== grant.debtor || !["gratitude", "resentment"].includes(appraisal.interpretation)) throw new Error("Invalid grant appraisal");
      requireInteger(appraisal.intensity, 0, 100);
    }
  } else {
    checkChoice(state, command as ForkChoice);
    const inherited = state.history.filter((entry) => entry.kind === "choice" && (entry.command as ForkChoice).target === (command as ForkChoice).target);
    if (inherited.some((entry) => entry.lineage === state.lineage)) throw new Error("Duplicate same-lineage declaration");
    for (const previous of inherited) previous.status = "superseded";
  }
  const position = state.history.length;
  const id = JSON.stringify([FAVOR_FORK_VERSION, state.lineage, "declaration", position, forkEncoding(command)]);
  state.history.push({ id, lineage: state.lineage, position, declaredAt: at, kind, command: structuredClone(command), status: "pending" });
}

/** Internal reducer seam: only the reconstruction/orchestrator calls this on admitted state. */
export function executeForkGrants(state: FavorFork, year: number): void {
  for (const declaration of state.history) {
    if (declaration.kind !== "grant" || declaration.command.year !== year) continue;
    const command = declaration.command as FavorCommand;
    const semantic = semanticGrant(command.key);
    const id = physicalForkId(state, semantic);
    const actors = [command.creditor, command.debtor];
    const causes = command.causes.map((cause) => {
      const entry = state.mapping.find((mapping) => mapping.semantic === cause);
      if (!entry) throw new Error("Unexecuted grant cause");
      return entry.physical;
    });
    const effects: HelpFavorEffect[] = [
      { kind: "grain", from: command.creditor, to: command.debtor, amount: 1 },
      { kind: "obligation", id: `${id}/help`, debtor: command.debtor, creditor: command.creditor, origin: id, status: "open" },
    ];
    for (const tie of command.ties) effects.push({ kind: "tie", origin: id, counterpart: tie.actor === actors[0] ? actors[1]! : actors[0]!, ...tie });
    for (const appraisal of command.appraisals) effects.push({ kind: "appraisal", id: `${id}/appraisal/${effects.length}`, origin: id, ...appraisal });
    const batch = { id, year, position: state.events.length, actors, causes, effects };
    const physical = applyGrantPhysics(state, batch);
    mapForkIdentity(state, "grant", semantic, id);
    mapForkIdentity(state, "debt", `${semantic}/help`, `${id}/help`);
    effects.forEach((effect, index) => { if (effect.kind === "appraisal") mapForkIdentity(state, "appraisal", `${semantic}/appraisal/${index}`, effect.id); });
    Object.assign(state, physical);
    state.events.push({ ...batch, version: FAVOR_FORK_VERSION, lineage: state.lineage, semantic, kind: "grain-grant" });
    declaration.status = "effective";
  }
}
export function executeForkResponse(state: FavorFork, obligationId: string, key: string, year: number, noise: number): ForkEvent {
  const { obligation, evidence } = currentHelpContext(state, obligationId, year);
  const actors = [obligation.creditor, obligation.debtor];
  const requestSemantic = semanticGrant(key);
  const requestId = physicalForkId(state, requestSemantic);
  const requestBatch = { id: requestId, year, position: state.events.length, actors, causes: [obligation.origin], effects: [], obligation: obligationId };
  validateHelpRequestPhysics(state, requestBatch);
  mapForkIdentity(state, "request", requestSemantic, requestId);
  state.events.push({ ...requestBatch, version: FAVOR_FORK_VERSION, semantic: requestSemantic, lineage: state.lineage, kind: "help-request", evidence });
  const target = semanticResponseTarget(key, actors, year);
  const declaration = state.history.findLast((entry) => entry.kind === "choice" && (entry.command as ForkChoice).target === target && entry.status !== "superseded");
  const baselineSelection = selectFavorResponse(evidence.factors, noise);
  const effectiveChoice = declaration ? (declaration.command as ForkChoice).choice : baselineSelection;
  const semantic = semanticGrant(JSON.stringify(["help-response", actors, year, requestSemantic, "response"]));
  const id = physicalForkId(state, semantic);
  const effects = canonicalHelpResponseEffects({ ties: state.ties }, obligation, id, effectiveChoice);
  const batch = { id, year, position: state.events.length, actors, causes: [obligation.origin, requestId], obligation: obligationId, request: requestId, effects };
  const physical = applyHelpResponsePhysics(state, batch, effectiveChoice);
  mapForkIdentity(state, "response", semantic, id);
  const event: ForkEvent = {
    ...batch, version: FAVOR_FORK_VERSION, semantic, lineage: state.lineage, kind: "help-response",
    evidence: { ...evidence, noise, baselineSelection, effectiveChoice, authority: declaration ? { source: "human", declaration: declaration.id } : { source: "seeded" } },
  };
  Object.assign(state, physical);
  state.events.push(event);
  if (declaration) declaration.status = "effective";
  return event;
}
function applyAction(state: FavorFork, action: ForkAction): void {
  requireFavorData(action);
  if (action.kind === "year") {
    fields(action, ["kind", "year"]);
    requireInteger(action.year, Number.MIN_SAFE_INTEGER);
    if (action.year <= state.completedYear) throw new Error("Backward/repeated annual frontier");
    const record = executeForkYear(state, action.year);
    state.completedYear = action.year;
    state.years.push(record);
    for (const entry of state.history) if (entry.status === "pending" && entry.command.year <= action.year) entry.status = "inactive";
  } else if (action.kind === "fork") {
    fields(action, ["kind", "year", "key", "overrides"]);
    requireInteger(action.year, Number.MIN_SAFE_INTEGER); requireId(action.key);
    if (!Array.isArray(action.overrides) || action.year <= state.completedYear) throw new Error("Fork must follow reconstructed frontier");
    const previous = state.actions.findLast((entry) => entry.kind === "fork");
    if (previous && action.year < previous.year) throw new Error("Cannot replace ancestor prefix");
    state.lineage = JSON.stringify([FAVOR_FORK_VERSION, "branch", state.lineage, action.year, action.key, forkEncoding(action.overrides)]);
    for (const command of action.overrides) {
      if (command.year < action.year) throw new Error("Override precedes fork year");
      declare(state, "choice", command, state.completedYear);
    }
  } else if (action.kind === "grant" || action.kind === "choice") {
    fields(action, ["kind", "at", "command"]);
    declare(state, action.kind, action.command, action.at);
  } else throw new Error("Unknown D2b action");
  state.actions.push(structuredClone(action));
}
/** Entire descriptor tree precedes reads; strict replay derives every ledger, mapping,
 * declaration status, lineage, annual record and event. Nothing is silently repaired. */
export function admitFavorFork(input: FavorFork): FavorFork {
  requireFavorData(input, true);
  checkUndefined(input);
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Expected D2b state");
  requireFields(input, ["manifest", "key", "seed", "prefix", "lineage", "completedYear", "actions", "history", "mapping", "years", "people", "legacyEvents", "allocations", "grain", "initialAssistance", "initialNeed", "assistance", "need", "obligations", "ties", "appraisals", "events"]);
  for (const [key, value] of Object.entries(input)) if (key !== "people" && key !== "legacyEvents") requireFavorData(value);
  same(input.manifest, FAVOR_FORK_MANIFEST, "Unsupported D2b manifest");
  requireId(input.key); requireId(input.seed);
  fields(input.prefix, ["length", "initialPrefixLength", "initialPreviousYear", "completedYear", "years"]);
  if (!Array.isArray(input.events) || !Array.isArray(input.actions)) throw new Error("Expected ordered D2b logs");
  requireInteger(input.prefix.length, 0, input.events.length);
  const initial = createHelpFavorState(input.people, input.legacyEvents, input.allocations, input.initialAssistance, input.initialNeed);
  const prefixEvents: HelpFavorEvent[] = [];
  for (const event of input.events.slice(0, input.prefix.length)) {
    if (event.version !== "favor-c1") throw new Error("Only strict C prefix admitted");
    prefixEvents.push(event);
  }
  const c = replayHelpFavorEvents(initial, prefixEvents);
  const prefix = admitFavorScheduler({
    version: "favor-scheduler-c2", rngVersion: "keyed-mulberry32-c2", seed: input.seed,
    initialPreviousYear: input.prefix.initialPreviousYear, completedYear: input.prefix.completedYear,
    initialPrefixLength: input.prefix.initialPrefixLength, years: input.prefix.years, state: c,
  });
  const rebuilt = fromPrefix(prefix, input.key);
  for (const action of input.actions) applyAction(rebuilt, action);
  same(input, rebuilt, "D2b derived state/history/evidence disagreement");
  return rebuilt;
}
export function declareForkGrant(input: FavorFork, command: FavorCommand): FavorFork {
  requireFavorData(command);
  const state = admitFavorFork(input);
  applyAction(state, { kind: "grant", at: state.completedYear, command });
  return state;
}
export function declareForkChoice(input: FavorFork, command: ForkChoice): FavorFork {
  requireFavorData(command);
  const state = admitFavorFork(input);
  applyAction(state, { kind: "choice", at: state.completedYear, command });
  return state;
}
export function runFavorForkYear(input: FavorFork, year: number): FavorFork {
  requireInteger(year, Number.MIN_SAFE_INTEGER);
  const state = admitFavorFork(input);
  applyAction(state, { kind: "year", year });
  return state;
}
/** Rebuild every recorded frontier strictly before year (including quiet/gapped years).
 * Inherit declarations made by that frontier, then re-execute the entire fork year
 * and recorded later years. Parent outcomes are never commands. */
export function forkFavor(input: FavorFork, year: number, key: string, overrides: ForkChoice[] = []): FavorFork {
  requireFavorData(overrides); requireInteger(year, Number.MIN_SAFE_INTEGER); requireId(key);
  if (!Array.isArray(overrides)) throw new Error("Expected fork overrides");
  const parent = admitFavorFork(input);
  const previous = parent.actions.findLast((entry) => entry.kind === "fork");
  if (year <= parent.prefix.initialPreviousYear || previous && year < previous.year) throw new Error("Cannot fork inside locked initial/ancestor prefix");
  const actions = parent.actions.filter((action) => action.kind === "year" ? action.year < year : action.kind === "fork" ? action.year <= year : action.at < year);
  // Build from the same admitted C-prefix, not a D checkpoint relabelled as C.
  const initial = createHelpFavorState(parent.people, parent.legacyEvents, parent.allocations, parent.initialAssistance, parent.initialNeed);
  const cEvents: HelpFavorEvent[] = [];
  for (const event of parent.events.slice(0, parent.prefix.length)) {
    if (event.version !== "favor-c1") throw new Error("Expected C prefix event");
    if (event.year < year) cEvents.push(event);
  }
  const c = replayHelpFavorEvents(initial, cEvents);
  const prefixYears = parent.prefix.years.filter((record) => record.year < year);
  const prefixFrontier = prefixYears.at(-1)?.year ?? parent.prefix.initialPreviousYear;
  const state = fromPrefix(admitFavorScheduler({
    version: "favor-scheduler-c2", rngVersion: "keyed-mulberry32-c2", seed: parent.seed,
    initialPreviousYear: parent.prefix.initialPreviousYear, completedYear: prefixFrontier,
    initialPrefixLength: parent.prefix.initialPrefixLength, years: prefixYears, state: c,
  }), parent.key);
  for (const action of actions) applyAction(state, action);
  applyAction(state, { kind: "fork", year, key, overrides });
  const years = [year, ...[...parent.prefix.years, ...parent.years].map((record) => record.year).filter((recorded) => recorded > year)];
  for (const recorded of years) applyAction(state, { kind: "year", year: recorded });
  return state;
}

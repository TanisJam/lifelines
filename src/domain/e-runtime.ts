import { createHash } from "node:crypto";
import { planAnnualFavorDraft, stableAnnualIdOrder } from "./e-annual-policy";
import { planAnnualHelpSlot } from "./e-annual-composition";
import { initializeWorld, copyInitializationData } from "./world-initialization";
import type { WorldOrigin } from "./world-origin";
import { inspectHelpOpportunities, requireFavorData, type CurrentHelpView, type HelpEvidence, type HelpHistoryEntry } from "./effects";
import { createFavorExecutor } from "./e-favor-executor";
import { ensureLifeState, applyLifeTransition } from "./life-state";
import { requireFields, requireId, requireInteger } from "./obligations";
import { FACETS, VALUES, DREAM_GOALS } from "./mind";
import { JOB_POOL, TRAIT_POOL, type Person, type Event } from "./types";

export const ANNUAL_RUNTIME_VERSION = "explicit-resources-e2a-1" as const;
type Immutable<T> = T extends object ? { readonly [K in keyof T]: Immutable<T[K]> } : T;
export interface ResourceAllocation { grain: number; effort: number; need: number }
export type ResourcePlan = Record<string, ResourceAllocation>;
/** Creation supplies data, not a demographic selector or an autonomous Mind generator. */
export type Newcomer = Pick<Person, "id" | "name" | "sex" | "birthYear" | "traits" | "job" | "mind">;
interface Operation { id: string; causes: string[] }
export type PhysicalOperation = Operation & (
  | { kind: "create"; person: Newcomer }
  | { kind: "death"; actor: string }
  | { kind: "residence"; actor: string; status: "home" | "away" });
export type ResourceOperation = Operation & (
  | { kind: "allocate"; actor: string; allocation: ResourceAllocation }
  | { kind: "resource-change"; actor: string; resource: "grain" | "effort" | "need"; amount: number });
export interface GrantIntention extends Operation { creditor: string; debtor: string }
export interface RequestIntention { id: string; obligation: string; noise: number }
export interface AnnualPlan {
  year: number; physical: PhysicalOperation[]; resources: ResourceOperation[];
  grants: GrantIntention[]; requests: RequestIntention[];
}
export interface ResponseQuestion {
  id: string; year: number; actors: string[]; obligation: string;
  evidence: HelpEvidence; baseline: "help" | "refuse"; noise: number;
}
/** Domain-only synchronous human declaration. No borrowed world or transport interface. */
export type ResponseAuthority = (question: Immutable<ResponseQuestion>) => unknown;
export interface AuthorityResult { source: "human"; selected: "help" | "refuse" }
export interface RuntimeGenesis {
  version: typeof ANNUAL_RUNTIME_VERSION; originDigest: string; resources: ResourcePlan; digest: string;
}
interface OwnedState extends Omit<CurrentHelpView, "people" | "legacyEvents" | "events"> {
  people: Record<string, Person>; legacyEvents: Event[]; events: HelpHistoryEntry[];
}
export interface RuntimeEntry {
  id: string; year: number; position: number; phase: "physical" | "resources" | "grants" | "help";
  declarationIndex: number; kind: string; actors: string[]; causes: string[];
  effects: unknown[]; consumed: unknown; outcome: "committed" | "ineligible";
  reason?: string; authority?: { source: "rules" | "human"; selected: "help" | "refuse"; baseline: "help" | "refuse"; noise: number };
}
export interface YearRecord { plan: AnnualPlan; entries: RuntimeEntry[] }
export interface RuntimeOutput {
  version: typeof ANNUAL_RUNTIME_VERSION; origin: WorldOrigin; genesis: RuntimeGenesis;
  frontier: number | null; state: OwnedState; journal: YearRecord[];
}

function frozen<T>(value: T): Immutable<T> {
  if (value !== null && typeof value === "object") {
    for (const entry of Object.values(value)) frozen(entry);
    Object.freeze(value);
  }
  return value as Immutable<T>;
}
function detached<T>(value: T): Immutable<T> { return frozen(structuredClone(value)); }
/** In-memory identity encoding preserves generated -0 and legacy own undefined.
 * This is not a durable JSON codec or capsule admission contract. */
function identity(value: unknown): string {
  if (value === undefined) return "undefined";
  if (typeof value === "number" && Object.is(value, -0)) return "-0";
  if (Array.isArray(value)) return `[${value.map(identity).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${identity((value as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(value);
}
function hash(value: unknown): string { return createHash("sha256").update(identity(value), "utf8").digest("hex"); }
function record(value: unknown): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected record");
}
function integer(value: unknown, min = 0): asserts value is number {
  requireInteger(value, min);
  if (Object.is(value, -0)) throw new Error("Negative zero input");
}
function allocation(value: unknown): asserts value is ResourceAllocation {
  record(value); requireFields(value, ["grain", "effort", "need"]);
  for (const entry of Object.values(value)) integer(entry);
}
function causes(value: unknown): asserts value is string[] {
  if (!Array.isArray(value)) throw new Error("Expected causes");
  value.forEach(requireId);
  if (new Set(value).size !== value.length) throw new Error("Repeated cause");
}
function ranged(value: unknown, min: number, max: number): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) throw new Error("Invalid Mind number");
}
function text(value: unknown): void { if (typeof value !== "string") throw new Error("Expected string"); }
function enumValue(value: unknown, choices: readonly string[]): void {
  if (typeof value !== "string" || !choices.includes(value)) throw new Error("Unknown value");
}
function shape(value: unknown, required: string[], optional: string[] = []): asserts value is Record<string, unknown> {
  record(value);
  if (required.some(k => !Object.hasOwn(value, k)) || Object.keys(value).some(k => !required.includes(k) && !optional.includes(k))) throw new Error("Missing or unknown fields");
}
/** Closed newcomer shape: no lifeState/history/founder flags silently imported. */
function newcomer(value: unknown): asserts value is Newcomer {
  shape(value, ["id", "name", "sex", "birthYear", "traits", "job", "mind"]);
  requireId(value.id); text(value.name); enumValue(value.sex, ["f", "m"]);
  integer(value.birthYear, Number.MIN_SAFE_INTEGER); enumValue(value.job, JOB_POOL);
  if (!Array.isArray(value.traits)) throw new Error("Expected traits");
  value.traits.forEach(t => enumValue(t, TRAIT_POOL));
  const mind = value.mind;
  shape(mind, ["facets", "values", "dream", "needs", "thoughts", "stress", "memories", "relationships"]);
  shape(mind.facets, [...FACETS]); Object.values(mind.facets).forEach(v => ranged(v, 0, 100));
  shape(mind.values, [...VALUES]); Object.values(mind.values).forEach(v => ranged(v, -50, 50));
  ranged(mind.stress, 0, 100);
  shape(mind.dream, ["goal", "status", "since"]);
  enumValue(mind.dream.goal, DREAM_GOALS); enumValue(mind.dream.status, ["pursuing", "realized", "abandoned"]);
  integer(mind.dream.since, Number.MIN_SAFE_INTEGER);
  for (const key of ["needs", "thoughts", "memories", "relationships"] as const) {
    if (!Array.isArray(mind[key])) throw new Error("Expected Mind array");
    for (const item of mind[key]) {
      if (key === "needs") { shape(item, ["name", "met"]); text(item.name); ranged(item.met, 0, 100); }
      if (key === "thoughts") {
        shape(item, ["emotion", "cause", "intensity", "yearsLeft", "year"], ["personId"]);
        text(item.emotion); text(item.cause); ranged(item.intensity, 0, 100); integer(item.yearsLeft); integer(item.year, Number.MIN_SAFE_INTEGER);
      }
      if (key === "memories") {
        shape(item, ["year", "text", "emotion", "core"], ["personId"]);
        integer(item.year, Number.MIN_SAFE_INTEGER); text(item.text); text(item.emotion);
        if (typeof item.core !== "boolean") throw new Error("Expected core flag");
      }
      if (key === "relationships") {
        shape(item, ["personId", "bond", "strength"]); requireId(item.personId);
        enumValue(item.bond, ["kin", "friend", "lover", "spouse", "rival", "grudge"]); ranged(item.strength, -100, 100);
      }
      if (Object.hasOwn(item, "personId")) requireId(item.personId);
    }
  }
}
function admitPlan(input: unknown): AnnualPlan {
  requireFavorData(input); // descriptors before any field read, including nested declarations
  shape(input, ["year", "physical", "resources", "grants", "requests"]);
  integer(input.year, Number.MIN_SAFE_INTEGER);
  for (const phase of ["physical", "resources", "grants", "requests"] as const) {
    const list = input[phase];
    if (!Array.isArray(list)) throw new Error("Expected declaration array");
    for (const op of list) {
      record(op); requireId(op.id);
      if (phase === "requests") {
        requireFields(op, ["id", "obligation", "noise"]); requireId(op.obligation);
        if (typeof op.noise !== "number" || !Number.isFinite(op.noise) || op.noise < 0 || op.noise >= 1 || Object.is(op.noise, -0)) throw new Error("Invalid noise input");
      } else {
        causes(op.causes);
        if (phase === "grants") {
          requireFields(op, ["id", "causes", "creditor", "debtor"]); requireId(op.creditor); requireId(op.debtor);
          if (op.creditor === op.debtor) throw new Error("Self favor");
        } else if (phase === "physical") {
          if (op.kind === "create") { requireFields(op, ["id", "causes", "kind", "person"]); newcomer(op.person); }
          else if (op.kind === "death") { requireFields(op, ["id", "causes", "kind", "actor"]); requireId(op.actor); }
          else if (op.kind === "residence") { requireFields(op, ["id", "causes", "kind", "actor", "status"]); requireId(op.actor); enumValue(op.status, ["home", "away"]); }
          else throw new Error("Unknown physical operation");
        } else {
          requireId(op.actor);
          if (op.kind === "allocate") { requireFields(op, ["id", "causes", "kind", "actor", "allocation"]); allocation(op.allocation); }
          else if (op.kind === "resource-change") {
            requireFields(op, ["id", "causes", "kind", "actor", "resource", "amount"]);
            enumValue(op.resource, ["grain", "effort", "need"]); integer(op.amount, Number.MIN_SAFE_INTEGER);
          } else throw new Error("Unknown resource operation");
        }
      }
    }
  }
  return structuredClone(input) as unknown as AnnualPlan;
}

/** Calls verified E1 first. One owned registry evolves; origin is only a frozen snapshot. */
export function createAnnualRuntime(initialization: unknown, resources: unknown, authority?: ResponseAuthority) {
  const { world, origin } = initializeWorld(initialization);
  requireFavorData(resources); record(resources);
  const ids = Object.keys(world.people);
  requireFields(resources, ids); // complete plan, including zero allocations and initially dead actors
  for (const value of Object.values(resources)) allocation(value);
  if (authority !== undefined && typeof authority !== "function") throw new Error("Invalid response authority");
  const captured = structuredClone(resources) as ResourcePlan;
  const payload = { version: ANNUAL_RUNTIME_VERSION, originDigest: origin.digest, resources: captured };
  const genesis = frozen({ ...payload, digest: hash(payload) });
  let state: OwnedState = {
    people: world.people, legacyEvents: world.events, events: [], grain: {}, assistance: {}, need: {},
    obligations: [], ties: [], appraisals: [],
  };
  for (const id of ids) {
    Object.defineProperty(state.grain, id, { value: captured[id].grain, writable: true, enumerable: true, configurable: true });
    Object.defineProperty(state.assistance, id, { value: captured[id].effort, writable: true, enumerable: true, configurable: true });
    Object.defineProperty(state.need, id, { value: captured[id].need, writable: true, enumerable: true, configurable: true });
  }
  let frontier: number | null = null;
  let journal: YearRecord[] = [];
  let advancing = false;
  function snapshot(): Immutable<RuntimeOutput> {
    return detached({ version: ANNUAL_RUNTIME_VERSION, origin, genesis, frontier, state, journal });
  }
  const initial = snapshot();
  /** Built-in composition accepts only year and existing physical vocabulary.
   * No caller policy/callback receives the private staged registry. The resolved
   * journal remains an explicit plan so immutable old-version replay is unchanged.
   */
  function advanceWithAnnualPolicy(input: unknown): Immutable<RuntimeOutput> {
    return execute(input, true);
  }
  function advance(input: unknown): Immutable<RuntimeOutput> {
    return execute(input, false);
  }
  function execute(input: unknown, annualPolicy: boolean): Immutable<RuntimeOutput> {
    if (advancing) throw new Error("Reentrant annual operation");
    advancing = true;
    try {
      let plan: AnnualPlan;
      if (annualPolicy) {
        requireFavorData(input);
        shape(input, ["year", "physical"]);
        plan = admitPlan({ year: input.year, physical: input.physical, resources: [], grants: [], requests: [] });
      } else plan = admitPlan(input);
      const year = plan.year;
      if (year < world.config.startYear || year > world.config.endYear || (frontier !== null && year <= frontier)) throw new Error("Invalid year frontier");
      const next = structuredClone(state);
      const entries: RuntimeEntry[] = [];
      const favor = createFavorExecutor(next, year, entries, authority);
      const { living, prior, append } = favor;
      plan.physical.forEach((op, declarationIndex) => {
        prior(op.id, op.causes);
        let actors: string[];
        let consumed: unknown;
        let effect: unknown;
        if (op.kind === "create") {
          if (Object.hasOwn(next.people, op.person.id) || op.person.birthYear > year) throw new Error("Invalid creation");
          actors = [op.person.id]; consumed = { registered: false };
          const person = { ...structuredClone(op.person), founder: false };
          Object.defineProperty(next.people, person.id, { value: person, writable: true, enumerable: true, configurable: true });
          effect = { kind: "creation", person };
          next.legacyEvents.push({ id: op.id, year, kind: person.birthYear === year ? "birth" : "town", actors, causes: op.causes, payload: { registration: "explicit-e2a", birthYear: person.birthYear } });
        } else {
          const person = living(op.actor); actors = [op.actor]; consumed = structuredClone(person);
          if (op.kind === "death") {
            person.deathYear = year; effect = { kind: "death", actor: op.actor, year };
            next.legacyEvents.push({ id: op.id, year, kind: "death", actors, causes: op.causes, payload: {} });
          } else {
            person.lifeState = applyLifeTransition(ensureLifeState(person, next.legacyEvents), { axis: "residence", to: op.status }, year);
            effect = { kind: "residence", actor: op.actor, status: op.status };
            next.legacyEvents.push({ id: op.id, year, kind: "move", actors, causes: op.causes, payload: { destination: op.status === "home" ? "home" : "away" } });
          }
        }
        append({ id: op.id, kind: op.kind, phase: "physical", declarationIndex, actors, causes: op.causes, consumed, effects: [structuredClone(effect)], outcome: "committed" });
      });
      if (annualPolicy) {
        // This is the REAL private post-physical state, never a fabricated output,
        // provisional checkpoint or second annual execution.
        const allowances = planAnnualFavorDraft(next, world.config.seed, year);
        plan.resources = allowances.resources;
        plan.grants = allowances.grants;
      }
      plan.resources.forEach(favor.executeResource);
      plan.grants.forEach(favor.executeGrant);
      if (annualPolicy) {
        const creditors = [...new Set(inspectHelpOpportunities(next, year)
          .filter(candidate => candidate.reason === null).map(candidate => candidate.creditor))].sort(stableAnnualIdOrder);
        for (const creditor of creditors) {
          for (const slot of [0, 1] as const) {
            const request = planAnnualHelpSlot(next, world.config.seed, year, creditor, slot);
            if (!request) continue;
            plan.requests.push(request);
            favor.executeRequest(request, plan.requests.length - 1);
          }
        }
      } else plan.requests.forEach(favor.executeRequest);
      // No owned publication occurs until all operations and authority results pass.
      const nextJournal = [...journal, { plan, entries }];
      const output = detached({ version: ANNUAL_RUNTIME_VERSION, origin, genesis, frontier: year, state: next, journal: nextJournal });
      state = next; journal = nextJournal; frontier = year;
      return output;
    } finally { advancing = false; }
  }
  return Object.freeze({ initial, advance, advanceWithAnnualPolicy, final: snapshot });
}

/** Cold, in-memory reconstruction from the owned rules-only journal. Re-run E1 and
 * each production operation; compare full origin/genesis/history/state, not just hashes.
 * No wire, durable capsule, storage binding, fork or human callback replay is claimed. */
export function replayAnnualRuntime(input: unknown): Immutable<RuntimeOutput> {
  requireFavorData(input, true);
  shape(input, ["version", "origin", "genesis", "frontier", "state", "journal"]);
  if (input.version !== ANNUAL_RUNTIME_VERSION) throw new Error("Unsupported annual runtime");
  record(input.origin); record(input.genesis);
  const requested = copyInitializationData(input.origin.requested, ["requested"]);
  const runtime = createAnnualRuntime(requested, input.genesis.resources);
  if (!Array.isArray(input.journal)) throw new Error("Expected annual journal");
  for (const record of input.journal) {
    shape(record, ["plan", "entries"]);
    if (!Array.isArray(record.entries)) throw new Error("Expected journal entries");
    if (record.entries.some(e => e?.authority?.source === "human")) throw new Error("Human authority replay not supported");
    runtime.advance(record.plan);
  }
  const output = runtime.final();
  if (identity(output) !== identity(input)) throw new Error("Annual reconstruction disagreement");
  return output;
}

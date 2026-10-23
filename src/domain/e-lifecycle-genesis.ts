import { createHash } from "node:crypto";
import { ANNUAL_FAVOR_POLICY_VERSION } from "./e-annual-policy";
import { ANNUAL_COMPOSITION_POLICY_VERSION } from "./e-annual-composition";
import { RULES_YEAR_SOURCE_VERSION, type RulesYearSourceDeclaration } from "./e-year-source";
import { requireFavorData } from "./effects";
import { requireFields, requireId, requireInteger } from "./obligations";
import { generateInitialWorld, type InitialWorld } from "./world-initialization";
import { initializeWorld, admitWorldOrigin, WORLD_ORIGIN_VERSIONS, type WorldOrigin } from "./world-origin";
import type { ResourcePlan, RuntimeOutput } from "./e-runtime";
import type { LegacyOwnedRunState } from "./simulate";
import type { WorldConfig } from "./types";

/** Distinct from the closed explicit-plan E2 runtime and its E3 capsules.
 * Names the admitted future execution authorities, not an implemented annual loop. */
export const LIFECYCLE_GENESIS_VERSIONS = Object.freeze({
  schema: "lifecycle-genesis-lr1a-1",
  runtime: "native-rules-lifecycle-lr1-1",
  rulesYear: RULES_YEAR_SOURCE_VERSION,
  annualPolicy: ANNUAL_FAVOR_POLICY_VERSION,
  annualComposition: ANNUAL_COMPOSITION_POLICY_VERSION,
  origin: WORLD_ORIGIN_VERSIONS,
} as const);

type Immutable<T> = T extends object ? { readonly [K in keyof T]: Immutable<T[K]> } : T;
interface GenesisPayload {
  versions: typeof LIFECYCLE_GENESIS_VERSIONS;
  origin: WorldOrigin;
  source: RulesYearSourceDeclaration;
  protagonistId: string;
  resources: ResourcePlan;
  // E1's JSON origin deliberately normalizes optional undefined. Retain the
  // actual generated world separately here, without projecting Person or Mind.
  initial: InitialWorld & { registryOrder: string[] };
}
export type LifecycleGenesis = Immutable<GenesisPayload & { digest: string }>;
export interface InstantiatedLifecycleGenesis {
  readonly genesis: LifecycleGenesis;
  readonly config: WorldConfig;
  readonly protagonistId: string;
  readonly owned: LegacyOwnedRunState;
  /** Borrow precisely the owned people and life log; own economic ledgers only. */
  readonly favors: RuntimeOutput["state"];
}

function record(value: unknown): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected lifecycle record");
}
function freeze<T>(value: T): Immutable<T> {
  if (value !== null && typeof value === "object") {
    for (const entry of Object.values(value)) freeze(entry);
    Object.freeze(value);
  }
  return value as Immutable<T>;
}

/** Lossless, order-insensitive record identity AFTER whole-tree descriptor checks.
 * Tagged leaves distinguish own undefined, absence and signed zero. Arrays retain
 * order; registryOrder separately captures behaviorally significant traversal.
 * Existing E1 JSON helpers cannot encode this actual-state contract losslessly.
 * This is private digest material, not a public wire/migration codec. */
function canonical(value: unknown): string {
  if (value === undefined) return '["undefined"]';
  if (value === null) return '["null"]';
  if (typeof value === "number") return JSON.stringify(["number", Object.is(value, -0) ? "-0" : String(value)]);
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify([typeof value, value]);
  if (Array.isArray(value)) return `["array",[${value.map(canonical).join(",")}]]`;
  return `["record",[${Object.keys(value as object).sort().map(key =>
    `[${JSON.stringify(key)},${canonical((value as Record<string, unknown>)[key])}]`).join(",")}]]`;
}
/** Descriptor-checked lossless comparison material, NOT semantic admission or a
 * durable codec. Reuse the genesis grammar without changing its digest bytes.
 * Sorted records do not certify reference identity or registry traversal order. */
export function canonicalLifecycleData(input: unknown): string {
  requireFavorData(input, true);
  return canonical(input);
}

/** Internal full-tree equality, equivalent to canonical string equality but
 * without materializing either string. Admission is mandatory on BOTH complete
 * inputs before comparison can return early. This is not semantic certification
 * or an alias certificate: repeated references are compared as unfolded values. */
export function canonicalLifecycleDataEqual(left: unknown, right: unknown): boolean {
  requireFavorData(left, true);
  requireFavorData(right, true);
  return equalData(left, right);
}

/** Only called after whole-tree descriptor admission; no identity/cache shortcut. */
function equalData(left: unknown, right: unknown): boolean {
  if (left === null || typeof left !== "object") return Object.is(left, right);
  if (right === null || typeof right !== "object") return false;
  if (Array.isArray(left)) {
    if (!Array.isArray(right) || left.length !== right.length) return false;
    for (let index = 0; index < left.length; index++) {
      if (!equalData(left[index], right[index])) return false;
    }
    return true;
  }
  if (Array.isArray(right)) return false;
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const keys = Object.keys(leftRecord);
  if (keys.length !== Object.keys(rightRecord).length) return false;
  for (const key of keys) {
    if (!Object.hasOwn(rightRecord, key) || !equalData(leftRecord[key], rightRecord[key])) return false;
  }
  return true;
}

function digest(payload: unknown): string {
  return createHash("sha256").update(canonical(payload), "utf8").digest("hex");
}
function resourcesFor(input: unknown, ids: string[]): ResourcePlan {
  record(input);
  requireFields(input, ids); // all actors, including initially dead ones
  for (const allocation of Object.values(input)) {
    record(allocation);
    requireFields(allocation, ["grain", "effort", "need"]);
    for (const value of Object.values(allocation)) {
      requireInteger(value, 0);
      if (Object.is(value, -0)) throw new Error("Negative zero lifecycle allocation");
    }
  }
  return structuredClone(input) as ResourcePlan;
}
function payloadFor(origin: WorldOrigin, world: InitialWorld, protagonistId: unknown, resources: unknown): GenesisPayload {
  requireId(protagonistId);
  if (!Object.hasOwn(world.people, protagonistId)) throw new Error("Unknown lifecycle protagonist");
  const ids = Object.keys(world.people);
  for (const id of ids) {
    requireId(id);
    if (world.people[id].id !== id) throw new Error("Lifecycle registry identity disagreement");
  }
  return {
    versions: LIFECYCLE_GENESIS_VERSIONS,
    origin,
    source: { version: RULES_YEAR_SOURCE_VERSION },
    protagonistId,
    resources: resourcesFor(resources, ids),
    initial: { ...world, registryOrder: ids },
  };
}

/** Required input: { initialization: E1 request, protagonistId, resources }.
 * No imported world, source callback, demographic/economic defaults or history.
 * The entire borrowed tree is checked before E1 or any field reads/cloning/hash. */
export function createLifecycleGenesis(input: unknown): LifecycleGenesis {
  requireFavorData(input, true);
  record(input);
  requireFields(input, ["initialization", "protagonistId", "resources"]);
  const { world, origin } = initializeWorld(input.initialization);
  const payload = payloadFor(origin, world, input.protagonistId, input.resources);
  // Clone constants too: freezing a publication must never freeze caller data.
  return freeze(structuredClone({ ...payload, digest: digest(payload) }));
}

/** Cold semantic admission, not a digest credential. E1 admission checks its
 * normalized origin; independent actual generation checks EVERY Person/Mind,
 * event, config, undefined path and signed-zero leaf without a parallel schema.
 * Generic legacy data checking allows undefined structurally, but only complete
 * equality with generated canon permits it semantically. Rehashed forgeries fail. */
export function admitLifecycleGenesis(input: unknown): LifecycleGenesis {
  requireFavorData(input, true);
  record(input);
  requireFields(input, ["versions", "origin", "source", "protagonistId", "resources", "initial", "digest"]);
  if (canonical(input.versions) !== canonical(LIFECYCLE_GENESIS_VERSIONS)) throw new Error("Unsupported lifecycle versions");
  if (canonical(input.source) !== canonical({ version: RULES_YEAR_SOURCE_VERSION })) throw new Error("Unsupported lifecycle source");
  if (typeof input.digest !== "string" || !/^[a-f0-9]{64}$/.test(input.digest)) throw new Error("Invalid lifecycle SHA256");
  const { digest: recordedDigest, ...payload } = input;
  if (digest(payload) !== recordedDigest) throw new Error("Lifecycle digest disagreement");
  const origin = admitWorldOrigin(input.origin);
  const world = generateInitialWorld(origin.requested).world;
  const reproduced = payloadFor(origin, world, input.protagonistId, input.resources);
  if (canonical(payload) !== canonical(reproduced)) throw new Error("Lifecycle generation disagreement");
  return freeze(structuredClone({ ...reproduced, digest: recordedDigest }));
}

/** One fresh mutable actual registry and log, empty decisions, zero native calls.
 * endYear is immutable origin metadata, NOT a future annual execution ceiling.
 * No execution/frontier/replay stub is supplied by this prerequisite boundary. */
export function instantiateLifecycleGenesis(input: unknown): InstantiatedLifecycleGenesis {
  const genesis = admitLifecycleGenesis(input);
  const initial = structuredClone(genesis.initial as unknown) as InitialWorld & { registryOrder: string[] };
  // Restore explicit generated traversal rather than relying on canonical sorting.
  const people: InitialWorld["people"] = Object.create(null);
  for (const id of initial.registryOrder) {
    Object.defineProperty(people, id, { value: initial.people[id], writable: true, enumerable: true, configurable: true });
  }
  const owned: LegacyOwnedRunState = {
    people, events: initial.events, decisions: [], counters: { decisionCalls: 0 },
  };
  const grain: Record<string, number> = Object.create(null);
  const assistance: Record<string, number> = Object.create(null);
  const need: Record<string, number> = Object.create(null);
  const favors: RuntimeOutput["state"] = {
    people: owned.people, legacyEvents: owned.events, events: [],
    grain, assistance, need, obligations: [], ties: [], appraisals: [],
  };
  for (const id of initial.registryOrder) {
    grain[id] = genesis.resources[id].grain;
    assistance[id] = genesis.resources[id].effort;
    need[id] = genesis.resources[id].need;
  }
  return {
    genesis, config: freeze(initial.config), protagonistId: genesis.protagonistId,
    owned, favors,
  };
}

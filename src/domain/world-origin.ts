import { createHash } from "node:crypto";
import { copyInitializationData, generateInitialWorld, initializationJson, type EffectiveInitialization, type InitialWorld, type SexEvidence } from "./world-initialization";
import type { GenerateWorldOptions } from "./worldgen";

/** Names the actual legacy generation/content algorithms, not A's rules run or
 * the future E annual kernel. The sex stream intentionally retains worldgen keys. */
export const WORLD_ORIGIN_VERSIONS = Object.freeze({
  schema: "world-origin-e1",
  initialization: "worldgen-e1-ec4d6a2",
  content: "worldgen-content-ec4d6a2",
  rng: "fnv1a-utf16-mulberry32-delimited-worldgen-e1",
  sexPolicy: "seeded_name_blind-e1",
} as const);

type Immutable<T> = T extends object ? { readonly [K in keyof T]: Immutable<T[K]> } : T;
interface OriginPayload {
  versions: typeof WORLD_ORIGIN_VERSIONS;
  requested: GenerateWorldOptions;
  effective: EffectiveInitialization;
  sex: SexEvidence;
  initial: InitialWorld & { registryOrder: string[] };
}
export type WorldOrigin = Immutable<OriginPayload & { digest: string }>;

function freeze<T>(value: T): Immutable<T> {
  if (value !== null && typeof value === "object") {
    for (const entry of Object.values(value)) freeze(entry);
    Object.freeze(value);
  }
  return value as Immutable<T>;
}
function digest(payload: unknown): string {
  return createHash("sha256").update(initializationJson(payload), "utf8").digest("hex");
}
function capture(generated: ReturnType<typeof generateInitialWorld>): OriginPayload {
  const { requested, effective, sex, world } = generated;
  // Never retain the mutable registry in canonical origin. Preserve every field,
  // including mind and initial event payload/classification, without projection.
  return copyInitializationData({
    versions: WORLD_ORIGIN_VERSIONS, requested, effective, sex,
    initial: { ...world, registryOrder: Object.keys(world.people) },
  }) as OriginPayload;
}

/** Actual E initialization operation: one evolving registry, one frozen origin.
 * No annual simulation, authority callback, provider, persistence or final cards. */
export function initializeWorld(input: unknown): { world: InitialWorld; origin: WorldOrigin } {
  const generated = generateInitialWorld(input);
  const payload = capture(generated);
  return { world: generated.world, origin: freeze({ ...payload, digest: digest(payload) }) };
}

/** Full reproduction is the semantic admission authority, even for rehashed data.
 * A changed, fully consistent seed/request/world is another origin, not proof of
 * authorship. Hashes alone never establish that this operation created a frame. */
export function admitWorldOrigin(input: unknown): WorldOrigin {
  const candidate = copyInitializationData(input);
  if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate)) throw new Error("Expected world origin record");
  const record = candidate as Record<string, unknown>;
  const keys = ["versions", "requested", "effective", "sex", "initial", "digest"];
  if (Object.keys(record).length !== keys.length || keys.some((key) => !Object.hasOwn(record, key))) throw new Error("Missing or unknown world origin fields");
  if (initializationJson(record.versions) !== initializationJson(WORLD_ORIGIN_VERSIONS)) throw new Error("Unsupported world origin versions");
  if (typeof record.digest !== "string" || !/^[a-f0-9]{64}$/.test(record.digest)) throw new Error("Invalid world origin SHA256");
  const { digest: recordedDigest, ...payload } = record;
  if (digest(payload) !== recordedDigest) throw new Error("World origin digest disagreement");
  // Re-run normalization/default resolution and the actual generator. Comparing
  // the entire closed generated shape also rejects unknown nested state fields,
  // fabricated evidence and reordered traversals, without another Person schema.
  const generated = generateInitialWorld(record.requested);
  const reproduced = capture(generated);
  if (initializationJson(payload) !== initializationJson(reproduced)) throw new Error("World origin generation disagreement");
  // Also reconstruct from stored *effective* inputs, rather than trusting a
  // caller/default transcript or inferring origin from any later world state.
  const effectiveWorld = generateInitialWorld(record.effective).world;
  const initial = { ...effectiveWorld, registryOrder: Object.keys(effectiveWorld.people) };
  if (initializationJson(initial) !== initializationJson(record.initial)) throw new Error("Effective world origin disagreement");
  return freeze({ ...reproduced, digest: recordedDigest });
}

export function serializeWorldOrigin(input: unknown): string {
  return initializationJson(admitWorldOrigin(input));
}
export function deserializeWorldOrigin(wire: unknown): WorldOrigin {
  if (typeof wire !== "string") throw new Error("Expected world origin wire string");
  const admitted = admitWorldOrigin(JSON.parse(wire));
  if (initializationJson(admitted) !== wire) throw new Error("Noncanonical world origin wire");
  return admitted;
}

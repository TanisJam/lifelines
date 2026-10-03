import { createHash } from "node:crypto";
import { requireFavorData } from "./effects";
import { ANNUAL_RUNTIME_VERSION, replayAnnualRuntime } from "./e-runtime";
import { WORLD_ORIGIN_VERSIONS } from "./world-origin";

/** Closed compatibility tuple: schema, lossless codec, annual rules, complete E1 authority. */
export const ANNUAL_CAPSULE_MANIFEST = Object.freeze([
  "annual-runtime-capsule-e3-1", "own-data-tuples-e3-1", ANNUAL_RUNTIME_VERSION,
  Object.freeze([
    WORLD_ORIGIN_VERSIONS.schema, WORLD_ORIGIN_VERSIONS.initialization,
    WORLD_ORIGIN_VERSIONS.content, WORLD_ORIGIN_VERSIONS.rng, WORLD_ORIGIN_VERSIONS.sexPolicy,
  ] as const),
] as const);
export interface AnnualRuntimeCapsule {
  readonly manifest: typeof ANNUAL_CAPSULE_MANIFEST;
  readonly digest: string;
  readonly output: ReturnType<typeof replayAnnualRuntime>;
}
type Tagged = ["undefined"] | ["null"] | ["string", string] | ["boolean", boolean]
  | ["number", string] | ["array", Tagged[]] | ["record", [string, Tagged][]];

function fail(): never { throw new Error("Invalid annual capsule encoding"); }
function encode(value: unknown): Tagged {
  if (value === undefined) return ["undefined"];
  if (value === null) return ["null"];
  if (typeof value === "string") return ["string", value];
  if (typeof value === "boolean") return ["boolean", value];
  if (typeof value === "number") return ["number", Object.is(value, -0) ? "-0" : value.toString()];
  if (Array.isArray(value)) return ["array", value.map(encode)];
  return ["record", Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, encode(entry)])];
}
function decode(value: unknown): unknown {
  if (!Array.isArray(value)) return fail();
  const [tag, payload] = value;
  if (value.length === 1) {
    if (tag === "undefined") return undefined;
    if (tag === "null") return null;
    return fail();
  }
  if (value.length !== 2) return fail();
  if (tag === "string" && typeof payload === "string") return payload;
  if (tag === "boolean" && typeof payload === "boolean") return payload;
  if (tag === "number" && typeof payload === "string") {
    const number = Number(payload);
    if (!Number.isFinite(number) || (Object.is(number, -0) ? "-0" : number.toString()) !== payload) return fail();
    return number;
  }
  if (tag === "array" && Array.isArray(payload)) return payload.map(decode);
  if (tag === "record" && Array.isArray(payload)) {
    const result: Record<string, unknown> = Object.create(null);
    for (const entry of payload) {
      if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== "string" || Object.hasOwn(result, entry[0])) return fail();
      Object.defineProperty(result, entry[0], { value: decode(entry[1]), enumerable: true, writable: true, configurable: true });
    }
    return result;
  }
  return fail();
}
function fields(value: unknown, keys: string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) fail();
}
function manifest(value: unknown): asserts value is typeof ANNUAL_CAPSULE_MANIFEST {
  if (JSON.stringify(value) !== JSON.stringify(ANNUAL_CAPSULE_MANIFEST)) throw new Error("Unsupported annual capsule manifest");
}
function digest(payload: Tagged): string {
  return createHash("sha256").update(JSON.stringify([ANNUAL_CAPSULE_MANIFEST, payload]), "utf8").digest("hex");
}
function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const entry of Object.values(value)) freeze(entry);
    Object.freeze(value);
  }
  return value;
}
function owned(output: unknown, hash: string): AnnualRuntimeCapsule {
  // Replay compares all rule-owned data. Keep the admitted traversal, not replay's
  // reordered records. Decode supplies a detached tree with safe own definitions.
  return freeze({ manifest: ANNUAL_CAPSULE_MANIFEST, digest: hash, output: decode(encode(output)) as ReturnType<typeof replayAnnualRuntime> });
}
/** Certify one complete rules-only output, never a retained checkpoint collection. */
export function createAnnualRuntimeCapsule(input: unknown): AnnualRuntimeCapsule {
  requireFavorData(input, true);
  replayAnnualRuntime(input);
  return owned(input, digest(encode(input)));
}
/** Admission is lossless own-data plus semantic replay, not authenticated authorship. */
export function admitAnnualRuntimeCapsule(input: unknown): AnnualRuntimeCapsule {
  requireFavorData(input, true);
  fields(input, ["manifest", "digest", "output"]);
  manifest(input.manifest);
  if (typeof input.digest !== "string" || !/^[a-f0-9]{64}$/.test(input.digest)
    || digest(encode(input.output)) !== input.digest) throw new Error("Annual capsule digest disagreement");
  replayAnnualRuntime(input.output);
  return owned(input.output, input.digest);
}
export function serializeAnnualRuntimeCapsule(input: unknown): string {
  const capsule = admitAnnualRuntimeCapsule(input);
  return JSON.stringify({ manifest: capsule.manifest, payload: encode(capsule.output), digest: capsule.digest });
}
/** Strict canonical bytes reject whitespace, duplicate JSON keys and alternate spellings. */
export function deserializeAnnualRuntimeCapsule(wire: unknown): AnnualRuntimeCapsule {
  if (typeof wire !== "string") throw new Error("Expected annual capsule wire string");
  const envelope: unknown = JSON.parse(wire);
  requireFavorData(envelope, true);
  fields(envelope, ["manifest", "payload", "digest"]);
  manifest(envelope.manifest);
  const output = decode(envelope.payload);
  if (JSON.stringify(encode(output)) !== JSON.stringify(envelope.payload)) fail();
  const canonical = JSON.stringify({ manifest: envelope.manifest, payload: envelope.payload, digest: envelope.digest });
  if (canonical !== wire) throw new Error("Noncanonical annual capsule wire");
  return admitAnnualRuntimeCapsule({ manifest: envelope.manifest, output, digest: envelope.digest });
}

import { createHash } from "node:crypto";
import { admitLifecycleGenesis, canonicalLifecycleData, LIFECYCLE_GENESIS_VERSIONS,
  type LifecycleGenesis } from "./e-lifecycle-genesis";
import { replayLifecycleRuntime } from "./e-lifecycle-replay";
import { requireFavorData } from "./effects";
import { requireFields } from "./obligations";

/** Separate from the frozen E1/C2/E3 codecs; no implicit migration. */
export const LIFECYCLE_CAPSULE_MANIFEST = Object.freeze({
  capsuleSchema: "lifecycle-capsule-lr2b-1",
  codec: "sorted-own-data-tuples-lr2b-1",
  ...LIFECYCLE_GENESIS_VERSIONS,
});
export type LifecycleCapsuleManifest = typeof LIFECYCLE_CAPSULE_MANIFEST;
export interface LifecycleCapsule {
  readonly manifest: LifecycleCapsuleManifest;
  readonly digest: string;
  readonly genesis: LifecycleGenesis;
  readonly output: Awaited<ReturnType<typeof replayLifecycleRuntime>>;
}

function record(value: unknown): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected lifecycle capsule record");
}
function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const entry of Object.values(value)) freeze(entry);
    Object.freeze(value);
  }
  return value;
}
function checkedRecord(input: unknown, fields: string[]): Record<string, unknown> {
  // WHOLE borrowed graph before any field read, hashing, cloning or await.
  requireFavorData(input, true);
  record(input);
  requireFields(input, fields);
  // Borrow only within this synchronous scope; regenerate immediately captures
  // ownership through genesis admission and replay before either can suspend.
  return input;
}
function requireManifest(value: unknown): void {
  if (canonicalLifecycleData(value) !== canonicalLifecycleData(LIFECYCLE_CAPSULE_MANIFEST)) {
    throw new Error("Unsupported lifecycle capsule manifest");
  }
}
function payload(genesis: unknown, output: unknown): string {
  // The sole encoder is the unchanged genesis grammar, not a parallel wire codec.
  return canonicalLifecycleData({ genesis, output });
}
function digest(manifest: unknown, encoded: string): string {
  // A JSON tuple frames two strings unambiguously. Both complete manifest and
  // complete tagged genesis/output participate; digest itself never does.
  return createHash("sha256").update(JSON.stringify([canonicalLifecycleData(manifest), encoded]), "utf8").digest("hex");
}
function requireDigest(value: unknown, manifest: unknown, encoded: string): asserts value is string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value) || value !== digest(manifest, encoded)) {
    throw new Error("Lifecycle capsule digest disagreement");
  }
}
async function regenerate(candidate: Record<string, unknown>): Promise<LifecycleCapsule> {
  // Digest is integrity, NEVER execution authority. LR1a regenerates genesis;
  // LR2a independently regenerates every native/economic year and all evidence.
  // Genesis admission detaches synchronously. Replay guards/clones its whole
  // envelope before its first await; after this await never read candidate again.
  const genesis = admitLifecycleGenesis(candidate.genesis);
  const output = await replayLifecycleRuntime({ genesis, output: candidate.output });
  const manifest = freeze(structuredClone(LIFECYCLE_CAPSULE_MANIFEST));
  return Object.freeze({ manifest, digest: digest(manifest, payload(genesis, output)), genesis, output });
}

/** Required closed input { genesis, output }, including zero-year/alive/death output. */
export async function createLifecycleCapsule(input: unknown): Promise<LifecycleCapsule> {
  return regenerate(checkedRecord(input, ["genesis", "output"]));
}
/** Cold admission always performs full trusted replay, including rehashed candidates. */
export async function admitLifecycleCapsule(input: unknown): Promise<LifecycleCapsule> {
  const candidate = checkedRecord(input, ["manifest", "digest", "genesis", "output"]);
  requireManifest(candidate.manifest);
  requireDigest(candidate.digest, candidate.manifest, payload(candidate.genesis, candidate.output));
  return regenerate(candidate);
}
function wire(capsule: LifecycleCapsule): string {
  // Manifest declaration order and envelope order are fixed; payload sorts records.
  return JSON.stringify({ manifest: capsule.manifest, payload: payload(capsule.genesis, capsule.output), digest: capsule.digest });
}
export async function serializeLifecycleCapsule(input: unknown): Promise<string> {
  return wire(await admitLifecycleCapsule(input));
}

/** Strict inverse ONLY of canonicalLifecycleData's tagged grammar. No executable
 * coercion, prototype assignment, undefined pruning or alternate number grammar. */
function decode(value: unknown): unknown {
  if (!Array.isArray(value) || typeof value[0] !== "string") throw new Error("Invalid lifecycle tuple");
  const [tag, item] = value;
  if (tag === "undefined" || tag === "null") {
    if (value.length !== 1) throw new Error("Invalid lifecycle leaf arity");
    return tag === "undefined" ? undefined : null;
  }
  if (value.length !== 2) throw new Error("Invalid lifecycle tuple arity");
  if (tag === "string" || tag === "boolean") {
    if (typeof item !== tag) throw new Error("Invalid lifecycle leaf");
    return item;
  }
  if (tag === "number") {
    if (typeof item !== "string") throw new Error("Invalid lifecycle number");
    const number = Number(item);
    if (!Number.isFinite(number) || (Object.is(number, -0) ? "-0" : String(number)) !== item) {
      throw new Error("Noncanonical lifecycle number");
    }
    return number;
  }
  if (!Array.isArray(item)) throw new Error("Invalid lifecycle container");
  if (tag === "array") return item.map(decode);
  if (tag !== "record") throw new Error("Unsupported lifecycle tag");
  const result = Object.create(null) as Record<string, unknown>;
  for (const pair of item) {
    if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== "string" || Object.hasOwn(result, pair[0])) {
      throw new Error("Invalid or duplicate lifecycle record key");
    }
    Object.defineProperty(result, pair[0], { value: decode(pair[1]), enumerable: true, writable: true, configurable: true });
  }
  return result;
}
export async function deserializeLifecycleCapsule(input: unknown): Promise<LifecycleCapsule> {
  if (typeof input !== "string") throw new Error("Expected lifecycle capsule wire string");
  const envelope: unknown = JSON.parse(input);
  requireFavorData(envelope, true);
  record(envelope);
  requireFields(envelope, ["manifest", "payload", "digest"]);
  requireManifest(envelope.manifest);
  if (typeof envelope.payload !== "string") throw new Error("Expected lifecycle tagged payload string");
  const candidate = decode(JSON.parse(envelope.payload));
  if (canonicalLifecycleData(candidate) !== envelope.payload) throw new Error("Noncanonical lifecycle payload");
  requireDigest(envelope.digest, envelope.manifest, envelope.payload);
  // JSON.parse alone loses duplicates and syntax variants. Require exact bytes,
  // including manifest declaration order, escapes and outer envelope field order.
  const canonicalWire = JSON.stringify({ manifest: LIFECYCLE_CAPSULE_MANIFEST, payload: envelope.payload, digest: envelope.digest });
  if (canonicalWire !== input) throw new Error("Noncanonical lifecycle capsule wire");
  record(candidate);
  requireFields(candidate, ["genesis", "output"]);
  return regenerate(candidate);
}

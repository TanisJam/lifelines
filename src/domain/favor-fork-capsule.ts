import { createHash } from "node:crypto";
import { requireFavorData } from "./effects";
import { admitFavorFork, FAVOR_FORK_MANIFEST, type FavorFork } from "./favor-fork";
import { requireFields, requireId } from "./obligations";

/** Separate D wire: neither a D1 migration nor authenticated provenance. */
export const FAVOR_FORK_CAPSULE_MANIFEST = Object.freeze({
  capsuleSchema: "favor-fork-capsule-d2b",
  capsuleProjection: "favor-fork-capsule-d2b",
  ...FAVOR_FORK_MANIFEST,
} as const);
export interface FavorForkCapsule {
  manifest: typeof FAVOR_FORK_CAPSULE_MANIFEST;
  registryOrder: string[];
  fork: FavorFork;
  digest: string;
}

// Exact legacy omissions admitted by the frozen D2b core, relative to its root.
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
function normalizeFork(input: unknown): FavorFork {
  requireFavorData(input, true); // Entire tree BEFORE any read, iteration or copying.
  function copy(value: unknown, path: string[]): unknown {
    if (value === undefined) throw new Error("Undefined outside supported D2b optional paths");
    if (Array.isArray(value)) return value.map((entry, index) => copy(entry, [...path, String(index)]));
    if (value !== null && typeof value === "object") {
      const result: Record<string, unknown> = Object.create(null);
      for (const key of Object.keys(value)) {
        const entry = (value as Record<string, unknown>)[key];
        const next = [...path, key];
        if (entry === undefined && legacyOptional(next)) continue;
        result[key] = copy(entry, next);
      }
      return result;
    }
    return value;
  }
  const fork = copy(input, []);
  requireFavorData(fork);
  return fork as FavorFork;
}

/** Local encoding only after own-data admission. Arrays and raw strings retain identity. */
function encoding(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(encoding).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${encoding((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
function hash(payload: Omit<FavorForkCapsule, "digest">): string {
  return createHash("sha256").update(encoding(payload), "utf8").digest("hex");
}
function record(value: unknown): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected D capsule record");
}
function restoreOrder(fork: FavorFork, order: unknown): asserts order is string[] {
  record(fork);
  record(fork.people);
  if (!Array.isArray(order)) throw new Error("Expected registry order");
  for (const id of order) requireId(id);
  if (new Set(order).size !== order.length || order.length !== Object.keys(fork.people).length || order.some(id => !Object.hasOwn(fork.people, id))) throw new Error("Registry order disagreement");
  const people: FavorFork["people"] = Object.create(null);
  for (const id of order) people[id] = fork.people[id]!;
  fork.people = people;
  if (encoding(Object.keys(people)) !== encoding(order)) throw new Error("Unrepresentable registry traversal");
}

/** Complete admitted D2b projection; capture traversal before canonical object-key sorting. */
export function createFavorForkCapsule(input: FavorFork, config: unknown = FAVOR_FORK_MANIFEST.config): FavorForkCapsule {
  requireFavorData(input, true);
  requireFavorData(config);
  if (encoding(config) !== encoding(FAVOR_FORK_MANIFEST.config)) throw new Error("Unsupported effective D2b config");
  const normalized = normalizeFork(input);
  record(normalized); record(normalized.people);
  const registryOrder = Object.keys(normalized.people);
  const fork = admitFavorFork(normalized);
  const payload = { manifest: structuredClone(FAVOR_FORK_CAPSULE_MANIFEST), registryOrder, fork };
  return { ...payload, digest: hash(payload) };
}

/** Integrity AND independent core replay. A recomputed hash cannot authorize derived facts. */
export function admitFavorForkCapsule(input: unknown): FavorForkCapsule {
  requireFavorData(input, true);
  record(input);
  requireFields(input, ["manifest", "registryOrder", "fork", "digest"]);
  requireFavorData(input.manifest);
  if (encoding(input.manifest) !== encoding(FAVOR_FORK_CAPSULE_MANIFEST)) throw new Error("Unsupported D capsule manifest/config tuple");
  requireFavorData(input.registryOrder);
  if (typeof input.digest !== "string" || !/^[a-f0-9]{64}$/.test(input.digest)) throw new Error("Invalid SHA256 digest");
  const fork = normalizeFork(input.fork);
  restoreOrder(fork, input.registryOrder); // Restore behavior BEFORE semantic admission.
  const payload = { manifest: structuredClone(FAVOR_FORK_CAPSULE_MANIFEST), registryOrder: [...input.registryOrder], fork };
  if (hash(payload) !== input.digest) throw new Error("D capsule digest disagreement");
  return { ...payload, fork: admitFavorFork(fork), digest: input.digest };
}
export function serializeFavorForkCapsule(input: unknown): string {
  return encoding(admitFavorForkCapsule(input));
}
/** Exact canonical bytes reject duplicate keys, alternate syntax, whitespace and escapes. */
export function deserializeFavorForkCapsule(wire: unknown): FavorForkCapsule {
  requireId(wire);
  const parsed: unknown = JSON.parse(wire);
  const capsule = admitFavorForkCapsule(parsed);
  if (encoding(capsule) !== wire) throw new Error("Noncanonical D capsule wire");
  return capsule;
}

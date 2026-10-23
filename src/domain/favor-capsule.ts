import { createHash } from "node:crypto";
import { HELP_FAVOR_VERSION, requireFavorData } from "./effects";
import { requireFields, requireId } from "./obligations";
import { admitFavorScheduler, SCHEDULER_VERSION, SCHEDULER_RNG_VERSION, type FavorScheduler } from "./scheduler";

/** D1 is a standalone wire, not A's projection or a production storage schema. */
export const FAVOR_CAPSULE_MANIFEST = Object.freeze({
  capsuleSchema: "favor-capsule-d1",
  projection: "favor-capsule-d1",
  engine: HELP_FAVOR_VERSION,
  reducer: HELP_FAVOR_VERSION,
  scheduler: SCHEDULER_VERSION,
  rng: SCHEDULER_RNG_VERSION,
  config: Object.freeze({ slotsPerCreditorYear: 2, activation: 0.25, selection: "first-eligible-utf8-c2" }),
} as const);
export interface FavorCapsule {
  manifest: typeof FAVOR_CAPSULE_MANIFEST;
  registryOrder: string[];
  scheduler: FavorScheduler;
  digest: string;
}

// These are the only declared legacy undefined paths normalized by this wire version.
// No payload, resource, arbitrary extension, C event or array element may be omitted.
const personOptionals = new Set(["deathYear", "spouseId", "motherId", "fatherId", "socialClass", "literate", "away", "lifeState"]);
function optionalPath(path: string[]): boolean {
  if (path[0] !== "state") return false;
  if (path[1] === "legacyEvents") return path.length === 4 && path[3] === "significance";
  if (path[1] !== "people") return false;
  if (path.length === 4) return personOptionals.has(path[3]!);
  if (path[3] === "lifeState") {
    if (path.length === 5) return path[4] === "marriageableSince";
    return path.length === 6 && ((path[4] === "marital" && path[5] === "partnerId") || (path[4] === "residence" && path[5] === "place") || (path[4] === "vocation" && path[5] === "masterId"));
  }
  return path.length === 7 && path[3] === "mind" && ["thoughts", "memories"].includes(path[4]!) && path[6] === "personId";
}

/** Guard the entire tree before reading/iterating it; then omit only declared optionals.
 * Null-record construction preserves own '__proto__' without setters/prototype pollution. */
function normalizeScheduler(input: unknown): FavorScheduler {
  requireFavorData(input, true);
  function copy(value: unknown, path: string[]): unknown {
    if (value === undefined) throw new Error("Undefined outside supported optional wire paths");
    if (Array.isArray(value)) return value.map((entry, i) => copy(entry, [...path, String(i)]));
    if (value !== null && typeof value === "object") {
      const result: Record<string, unknown> = Object.create(null);
      for (const key of Object.keys(value)) {
        const entry = (value as Record<string, unknown>)[key];
        const next = [...path, key];
        if (entry === undefined && optionalPath(next)) continue;
        result[key] = copy(entry, next);
      }
      return result;
    }
    return value;
  }
  const normalized = copy(input, []);
  requireFavorData(normalized);
  return normalized as FavorScheduler;
}

/** Local versioned encoding, deliberately independent of legacy replay orchestration.
 * Call only after descriptor and undefined admission. Ordered arrays are never sorted. */
function encoding(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(encoding).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${encoding((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
function hash(payload: Omit<FavorCapsule, "digest">): string {
  return createHash("sha256").update(encoding(payload), "utf8").digest("hex");
}
function requireRecord(value: unknown): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected record");
}
function restoreOrder(scheduler: FavorScheduler, order: unknown): void {
  requireRecord(scheduler.state);
  requireRecord(scheduler.state.people);
  if (!Array.isArray(order)) throw new Error("Expected registry order");
  for (const id of order) requireId(id);
  if (new Set(order).size !== order.length || order.length !== Object.keys(scheduler.state.people).length || order.some((id) => !Object.hasOwn(scheduler.state.people, id))) throw new Error("Registry order disagreement");
  const people: FavorScheduler["state"]["people"] = Object.create(null);
  for (const id of order) people[id] = scheduler.state.people[id]!;
  scheduler.state.people = people;
  // ECMAScript enumerates integer-index keys first; reject impossible declared traversal.
  if (encoding(Object.keys(people)) !== encoding(order)) throw new Error("Unrepresentable registry traversal");
}

/** Create from actual C2 provenance only. No legacy cards/results or custom C2 config. */
export function createFavorCapsule(input: FavorScheduler, config: unknown = FAVOR_CAPSULE_MANIFEST.config): FavorCapsule {
  requireFavorData(config);
  if (encoding(config) !== encoding(FAVOR_CAPSULE_MANIFEST.config)) throw new Error("Unsupported effective C2 config");
  const normalized = normalizeScheduler(input);
  const scheduler = admitFavorScheduler(normalized);
  const registryOrder = Object.keys(scheduler.state.people);
  const payload = { manifest: FAVOR_CAPSULE_MANIFEST, registryOrder, scheduler };
  return { ...payload, digest: hash(payload) };
}

/** Hash is integrity, not authenticated authorship. C2 independently checks effects/evidence. */
export function admitFavorCapsule(input: unknown): FavorCapsule {
  requireFavorData(input, true); // BEFORE any field read, including manifest and digest.
  requireRecord(input);
  requireFields(input, ["manifest", "registryOrder", "scheduler", "digest"]);
  requireFavorData(input.manifest);
  if (encoding(input.manifest) !== encoding(FAVOR_CAPSULE_MANIFEST)) throw new Error("Unsupported capsule manifest/config tuple");
  requireFavorData(input.registryOrder);
  if (typeof input.digest !== "string" || !/^[a-f0-9]{64}$/.test(input.digest)) throw new Error("Invalid SHA256 digest");
  const scheduler = normalizeScheduler(input.scheduler);
  requireRecord(scheduler);
  restoreOrder(scheduler, input.registryOrder);
  const payload = { manifest: FAVOR_CAPSULE_MANIFEST, registryOrder: [...input.registryOrder as string[]], scheduler };
  if (hash(payload) !== input.digest) throw new Error("Capsule digest disagreement");
  const admitted = admitFavorScheduler(scheduler);
  return { ...payload, scheduler: admitted, digest: input.digest };
}

export function serializeFavorCapsule(input: unknown): string {
  return encoding(admitFavorCapsule(input));
}

/** Canonical bytes required: rejects duplicate keys, whitespace and alternate JSON syntax. */
export function deserializeFavorCapsule(wire: unknown): FavorCapsule {
  requireId(wire); // Never coerce an object or invoke its hooks via JSON.parse.
  const parsed: unknown = JSON.parse(wire);
  const capsule = admitFavorCapsule(parsed);
  if (encoding(capsule) !== wire) throw new Error("Noncanonical capsule wire");
  return capsule;
}

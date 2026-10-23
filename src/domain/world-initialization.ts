import { keyedRng } from "./rng";
import { generateWorld, type GenerateWorldOptions } from "./worldgen";
import type { Sex } from "./types";

// The public operation lives with origin admission. This re-export introduces no
// top-level generation; the two modules only call each other after admission.
export { initializeWorld } from "./world-origin";
export type { WorldOrigin } from "./world-origin";

export type InitialWorld = ReturnType<typeof generateWorld>;
export interface EffectiveInitialization {
  seed: string;
  townName: string;
  startYear: number;
  endYear: number;
  founderCount: number;
  protagonist?: { name: string; sex: Sex };
}
export type SexEvidence = { requested: null; resolved: null } | {
  requested: Sex | "random";
  resolved: Sex;
  draw?: { personId: "protagonist"; year: number; purpose: "sex"; salt: 0; value: number };
};

const optionals = ["townName", "startYear", "endYear", "founderCount", "protagonist"];
const personOptionals = ["deathYear", "spouseId", "motherId", "fatherId", "socialClass", "literate", "away", "lifeState"];
function permittedAbsence(path: string[]): boolean {
  if (path[0] === "requested") return path.length === 2 && optionals.includes(path[1]!);
  if (path[0] !== "initial") return false;
  if (path[1] === "events") return path.length === 4 && path[3] === "significance";
  if (path[1] !== "people") return false;
  if (path.length === 4) return personOptionals.includes(path[3]!);
  if (path[3] === "lifeState") {
    if (path.length === 5) return path[4] === "marriageableSince";
    return path.length === 6 && ((path[4] === "marital" && path[5] === "partnerId") || (path[4] === "residence" && path[5] === "place") || (path[4] === "vocation" && path[5] === "masterId"));
  }
  return path.length === 7 && path[3] === "mind" && ["thoughts", "memories"].includes(path[4]!) && path[6] === "personId";
}

/** Descriptor-first copy: no getters, iteration hooks, toJSON or coercion.
 * Only versioned optional paths can omit own undefined. Not a Proxy sandbox. */
export function copyInitializationData(input: unknown, path: string[] = []): unknown {
  const active = new Set<object>();
  function copy(value: unknown, at: string[]): unknown {
    if (value === null || typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value !== "object" || value === null) throw new Error("Invalid initialization data value");
    if (active.has(value)) throw new Error("Cyclic initialization data");
    const array = Array.isArray(value);
    const prototype = Object.getPrototypeOf(value);
    if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) throw new Error("Nonplain initialization data");
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const key of Reflect.ownKeys(descriptors)) {
      if (typeof key !== "string") throw new Error("Symbol initialization field");
      const descriptor = descriptors[key]!;
      if (!("value" in descriptor) || (!descriptor.enumerable && !(array && key === "length"))) throw new Error("Executable or hidden initialization field");
    }
    active.add(value);
    let result: unknown;
    if (array) {
      const length = descriptors.length!.value as number;
      if (Object.keys(descriptors).length !== length + 1) throw new Error("Sparse or extended initialization array");
      const entries: unknown[] = [];
      for (let i = 0; i < length; i++) {
        const descriptor = descriptors[String(i)];
        if (!descriptor) throw new Error("Sparse initialization array");
        entries.push(copy(descriptor.value, [...at, String(i)]));
      }
      result = entries;
    } else {
      const entries: Record<string, unknown> = Object.create(null);
      for (const key of Object.keys(descriptors)) {
        const next = [...at, key];
        const entry = descriptors[key]!.value;
        if (entry === undefined && permittedAbsence(next)) continue;
        entries[key] = copy(entry, next);
      }
      result = entries;
    }
    active.delete(value);
    return result;
  }
  return copy(input, path);
}

function encode(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(encode).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${encode((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
/** Strict canonical JSON, separate from frozen A and without adapter imports. */
export function initializationJson(input: unknown): string {
  return encode(copyInitializationData(input));
}
function fields(value: unknown, required: string[], optional: string[] = []): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value) || required.some((key) => !Object.hasOwn(value, key)) || Object.keys(value).some((key) => !required.includes(key) && !optional.includes(key))) throw new Error("Missing or unknown initialization fields");
}

/** Normalize only defaults already used by worldgen; never trim or coerce strings. */
function requestedOptions(input: unknown): GenerateWorldOptions {
  const requested = copyInitializationData(input, ["requested"]);
  fields(requested, ["seed"], optionals);
  if (typeof requested.seed !== "string") throw new Error("Expected seed string");
  if (Object.hasOwn(requested, "townName") && typeof requested.townName !== "string") throw new Error("Expected town name string");
  for (const key of ["startYear", "endYear", "founderCount"]) {
    if (!Object.hasOwn(requested, key)) continue;
    if (!Number.isSafeInteger(requested[key])) throw new Error("Expected safe integer generation parameter");
    // Canonical JSON cannot retain a caller's signed zero. Restrict only these
    // input parameters; naturally generated mind/event values remain untouched.
    if (Object.is(requested[key], -0)) throw new Error(`Negative zero initialization parameter: ${key}`);
  }
  const start = requested.startYear as number | undefined ?? 1498;
  const end = requested.endYear as number | undefined ?? 1558;
  if (!Number.isSafeInteger(start - 72) || end < start) throw new Error("Unsafe founder birth years or reversed years");
  if (Object.hasOwn(requested, "founderCount") && (requested.founderCount as number) < 0) throw new Error("Negative founder count");
  if (Object.hasOwn(requested, "protagonist")) {
    fields(requested.protagonist, ["name", "sex"]);
    if (typeof requested.protagonist.name !== "string" || !["f", "m", "random"].includes(requested.protagonist.sex as string)) throw new Error("Invalid protagonist request");
  }
  return requested as unknown as GenerateWorldOptions;
}

/** Internal generation seam shared by the operation and cold admission.
 * Resolves the chosen policy at the operation, then gives worldgen explicit sex.
 * Town default is captured from worldgen itself, not a duplicated name table. */
export function generateInitialWorld(input: unknown) {
  const requested = requestedOptions(input);
  const startYear = requested.startYear ?? 1498;
  let sex: SexEvidence = { requested: null, resolved: null };
  let protagonist: EffectiveInitialization["protagonist"];
  if (requested.protagonist) {
    const selection = requested.protagonist.sex;
    if (selection === "random") {
      const value = keyedRng(requested.seed, "protagonist", startYear, "sex")();
      const resolved = value < 0.5 ? "f" : "m";
      sex = { requested: selection, resolved, draw: { personId: "protagonist", year: startYear, purpose: "sex", salt: 0, value } };
    } else sex = { requested: selection, resolved: selection };
    protagonist = { name: requested.protagonist.name, sex: sex.resolved! };
  }
  const generation = {
    seed: requested.seed, startYear, endYear: requested.endYear ?? 1558,
    founderCount: requested.founderCount ?? 62,
    ...(requested.townName === undefined ? {} : { townName: requested.townName }),
    ...(protagonist ? { protagonist } : {}),
  };
  const world = generateWorld(generation);
  const effective: EffectiveInitialization = { ...generation, townName: world.config.town.name };
  return { requested, effective, sex, world };
}

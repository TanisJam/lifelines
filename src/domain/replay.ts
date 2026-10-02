import { createHash } from "node:crypto";
import { RuleDecisionMaker } from "../adapters/decision/rule-decision-maker";
import { FACETS, VALUES, DREAM_GOALS } from "./mind";
import { simulate, type SimulateReport } from "./simulate";
import { EVENT_KINDS, JOB_POOL, SOCIAL_CLASS_POOL, TRAIT_POOL, type Event, type Person, type SimulationResult, type WorldConfig } from "./types";

/** Baseline identifiers, not a migration policy or a cross-runtime guarantee. */
export const SUPPORTED_REPLAY_VERSIONS = Object.freeze({
  envelope: 1, projection: 1, engine: "lifelines-d5d9ad5", rules: "rules-d5d9ad5",
  content: "content-d5d9ad5", rng: "keyed-gumbel-d5d9ad5",
});
const EFFECTIVE_OPTIONS = Object.freeze({
  engineSource: "rules", concurrencyLimit: 8, yearBatchConcurrency: 64,
  overrides: [], mode: "full", background: "none", director: "none",
});

/** Strict own-data JSON: never invokes getters or toJSON, and never drops values. */
export function canonicalJson(value: unknown): string {
  const active = new Set<object>();
  function encode(v: unknown): string {
    if (v === null) return "null";
    if (typeof v === "string" || typeof v === "boolean") return JSON.stringify(v);
    if (typeof v === "number" && Number.isFinite(v)) return JSON.stringify(Object.is(v, -0) ? 0 : v);
    if (typeof v !== "object" || v === null) throw new Error("Unsupported canonical JSON value");
    if (active.has(v)) throw new Error("Cyclic canonical JSON");
    const array = Array.isArray(v);
    const prototype = Object.getPrototypeOf(v);
    if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) {
      throw new Error("Nonplain canonical JSON container");
    }
    const descriptors = Object.getOwnPropertyDescriptors(v);
    for (const key of Reflect.ownKeys(v)) {
      if (typeof key !== "string") throw new Error("Symbol key in canonical JSON");
      if (array && key === "length") continue;
      const d = descriptors[key]!;
      if (!("value" in d) || !d.enumerable) throw new Error("Canonical JSON requires enumerable own data");
      if (array && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= v.length)) throw new Error("Extra array property");
    }
    active.add(v);
    let result: string;
    if (array) {
      const items: string[] = [];
      for (let i = 0; i < v.length; i++) {
        if (!Object.hasOwn(v, i)) throw new Error("Sparse canonical JSON array");
        items.push(encode(descriptors[String(i)]!.value));
      }
      result = `[${items.join(",")}]`;
    } else {
      result = `{${Object.keys(descriptors).sort().map((key) => `${JSON.stringify(key)}:${encode(descriptors[key]!.value)}`).join(",")}}`;
    }
    active.delete(v);
    return result;
  }
  return encode(value);
}

export function canonicalHash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}
function copy<T>(value: T): T { return JSON.parse(canonicalJson(value)); }

/** Only declared optional domain fields may be absent; required undefined still fails. */
function omitAbsent<T extends object>(value: T, keys: readonly string[]): T {
  const result = { ...value } as Record<string, unknown>;
  for (const key of keys) if (result[key] === undefined) delete result[key];
  return result as T;
}
function projectPeople(people: Readonly<Record<string, Person>>) {
  return Object.fromEntries(Object.entries(people).map(([id, p]) => {
    const person = omitAbsent(p, ["deathYear", "spouseId", "motherId", "fatherId", "socialClass", "literate", "away", "lifeState"]);
    person.mind = {
      ...p.mind,
      thoughts: p.mind.thoughts.map((t) => omitAbsent(t, ["personId"])),
      memories: p.mind.memories.map((m) => omitAbsent(m, ["personId"])),
    };
    if (p.lifeState) {
      person.lifeState = omitAbsent({ ...p.lifeState,
        marital: omitAbsent(p.lifeState.marital, ["partnerId"]),
        residence: omitAbsent(p.lifeState.residence, ["place"]),
        vocation: omitAbsent(p.lifeState.vocation, ["masterId"]),
      }, ["marriageableSince"]);
    }
    return [id, person];
  }));
}
function projectEvents(events: readonly Event[]) {
  return events.map(({ id, year, kind, actors, payload, causes }) => ({ id, year, kind, actors, payload, causes }));
}

/** Output evidence only; no snapshots, prose, labels, raw priors or runtime diagnostics. */
export function projectResult(result: SimulationResult) {
  return copy({
    people: projectPeople(result.people), registryOrder: Object.keys(result.people),
    events: projectEvents(result.events),
    decisions: result.decisions.map((d) => ({
      id: d.id, year: d.year, personId: d.personId,
      ...(d.partnerId === undefined ? {} : { partnerId: d.partnerId }),
      kind: d.kind, options: d.options.map((o) => o.id), chosen: d.chosen,
      source: d.source, causes: d.causes, resultingEventIds: d.resultingEventIds, final: d.final,
    })),
  });
}

export interface ReplayInput {
  config: WorldConfig;
  initialPeople: Readonly<Record<string, Person>>;
  initialEvents: readonly Event[];
  registryOrder: string[];
  protagonistId: string | null;
  options: typeof EFFECTIVE_OPTIONS;
}
export interface ReplayEnvelope {
  manifest: {
    versions: typeof SUPPORTED_REPLAY_VERSIONS;
    seed: string;
    configHash: string;
    inputHash: string;
  };
  input: ReplayInput;
}
interface CreationInput {
  config: WorldConfig;
  people: Readonly<Record<string, Person>>;
  events: readonly Event[];
  protagonistId?: string | null;
  overrides?: readonly unknown[];
  fromYear?: number;
  engineSource?: "rules";
}

function requireThat(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Invalid replay: ${message}`);
}
function record(value: unknown): asserts value is Record<string, unknown> {
  requireThat(value !== null && typeof value === "object" && !Array.isArray(value), "expected record");
}
function keys(value: Record<string, unknown>, required: string[], optional: string[] = []) {
  requireThat(required.every((k) => Object.hasOwn(value, k)) && Object.keys(value).every((k) => required.includes(k) || optional.includes(k)), "missing or unsupported fields");
}
function text(value: unknown): asserts value is string { requireThat(typeof value === "string" && value.length > 0, "expected nonempty string"); }
function integer(value: unknown) {
  requireThat(Number.isSafeInteger(value), "expected integer");
}
function strings(value: unknown): asserts value is string[] {
  requireThat(Array.isArray(value), "expected string array");
  value.forEach(text);
}
function list(value: unknown): asserts value is unknown[] {
  requireThat(Array.isArray(value), "expected array");
}
function optional(p: object, key: string, validate: (v: unknown) => void) {
  record(p);
  if (Object.hasOwn(p, key)) validate(p[key]);
}
function numericRecord(value: unknown, names?: readonly string[]) {
  record(value);
  if (names) requireThat(names.every((key) => Object.hasOwn(value, key)), "missing numeric state");
  requireThat(Object.values(value).every((n) => typeof n === "number" && Number.isFinite(n)), "invalid numeric state");
}

/** Basic shape admission only: not a complete domain/causal/authenticity validator. */
function validateInput(input: ReplayInput) {
  record(input);
  keys(input, ["config", "initialPeople", "initialEvents", "registryOrder", "protagonistId", "options"]);
  const config = input.config;
  record(config);
  keys(config, ["seed", "startYear", "endYear", "town"]);
  text(config.seed);
  integer(config.startYear);
  integer(config.endYear);
  requireThat(config.endYear >= config.startYear, "endYear before startYear");
  record(config.town);
  keys(config.town, ["name"]);
  text(config.town.name);
  requireThat(canonicalJson(input.options) === canonicalJson(EFFECTIVE_OPTIONS), "unsupported mode/options");
  record(input.initialPeople);
  strings(input.registryOrder);
  const ids = Object.keys(input.initialPeople);
  requireThat(
    ids.length > 0 && ids.length === input.registryOrder.length &&
    new Set(input.registryOrder).size === ids.length &&
    input.registryOrder.every((id) => Object.hasOwn(input.initialPeople, id)),
    "registry order mismatch",
  );
  requireThat(input.protagonistId === null || (typeof input.protagonistId === "string" && Object.hasOwn(input.initialPeople, input.protagonistId)), "unknown protagonist");
  for (const [id, p] of Object.entries(input.initialPeople)) {
    record(p);
    text(p.id);
    requireThat(id === p.id && !["__proto__", "constructor", "prototype"].includes(id), "invalid person identity");
    text(p.name);
    integer(p.birthYear);
    requireThat(p.sex === "f" || p.sex === "m", "invalid sex");
    strings(p.traits);
    requireThat(p.traits.every((t) => (TRAIT_POOL as readonly string[]).includes(t)), "invalid traits");
    requireThat(JOB_POOL.includes(p.job) && typeof p.founder === "boolean", "invalid person state");
    optional(p, "deathYear", integer);
    for (const k of ["spouseId", "motherId", "fatherId"]) optional(p, k, text);
    optional(p, "socialClass", (v) => requireThat((SOCIAL_CLASS_POOL as readonly unknown[]).includes(v), "invalid socialClass"));
    optional(p, "literate", (v) => requireThat(typeof v === "boolean", "invalid literacy"));
    optional(p, "away", (v) => requireThat(v === true, "invalid away marker"));
    const m = p.mind;
    record(m);
    numericRecord(m.facets, FACETS);
    numericRecord(m.values, VALUES);
    requireThat(typeof m.stress === "number" && Number.isFinite(m.stress), "invalid stress");
    record(m.dream);
    requireThat((DREAM_GOALS as readonly string[]).includes(m.dream.goal) && ["pursuing", "realized", "abandoned"].includes(m.dream.status), "invalid dream");
    integer(m.dream.since);
    for (const group of ["thoughts", "memories", "needs", "relationships"] as const) {
      list(m[group]);
      for (const item of m[group]) {
        record(item);
        if (group === "thoughts" || group === "memories") {
          integer(item.year);
          text(item.emotion);
          optional(item, "personId", text);
          if (group === "memories") {
            text(item.text);
            requireThat(typeof item.core === "boolean", "invalid memory");
          } else {
            text(item.cause);
            numericRecord({ intensity: item.intensity, yearsLeft: item.yearsLeft });
          }
        } else if (group === "needs") {
          text(item.name);
          numericRecord({ met: item.met });
        } else {
          text(item.personId);
          requireThat(typeof item.bond === "string" && ["kin", "friend", "lover", "spouse", "rival", "grudge"].includes(item.bond), "invalid bond");
          numericRecord({ strength: item.strength });
        }
      }
    }
    if (Object.hasOwn(p, "lifeState")) {
      const s = p.lifeState;
      record(s);
      record(s.slots);
      list(s.situations);
      for (const slot of Object.values(s.slots)) {
        record(slot);
        integer(slot.occurred);
        integer(slot.attempts);
        requireThat(Number(slot.occurred) >= 0 && Number(slot.attempts) >= 0, "negative slot");
      }
      const axes = [
        ["marital", ["single", "courting", "married", "widowed"]],
        ["residence", ["home", "away"]],
        ["vocation", ["child", "idle", "apprenticed", "in-service", "working", "religious"]],
      ] as const;
      for (const [axis, statuses] of axes) {
        record(s[axis]);
        requireThat(statuses.some((status) => status === s[axis].status), "invalid life axis");
        integer(s[axis].since);
      }
      optional(s.marital, "partnerId", text);
      optional(s.residence, "place", text);
      optional(s.vocation, "masterId", text);
      optional(s, "marriageableSince", integer);
      for (const situation of s.situations) {
        record(situation);
        text(situation.id);
        text(situation.kind);
        integer(situation.since);
        strings(situation.counterpartIds);
        text(situation.stage);
        record(situation.data);
      }
    }
  }
  list(input.initialEvents);
  const eventIds = new Set<string>();
  for (const event of input.initialEvents) {
    record(event);
    keys(event, ["id", "year", "kind", "actors", "payload", "causes"]);
    text(event.id);
    requireThat(!eventIds.has(event.id), "duplicate event id");
    eventIds.add(event.id);
    integer(event.year);
    requireThat(EVENT_KINDS.includes(event.kind), "invalid event kind");
    strings(event.actors);
    strings(event.causes);
    record(event.payload);
    requireThat(event.actors.every((id) => Object.hasOwn(input.initialPeople, id)), "unknown event actor");
  }
}

/** New admission only. Replay must validate existing hashes, never recreate them. */
export function createReplayEnvelope(source: CreationInput): ReplayEnvelope {
  // Reject accessors recursively before reading any source properties or projecting data.
  canonicalJson(source);
  record(source);
  keys(source, ["config", "people", "events"], ["protagonistId", "overrides", "fromYear", "engineSource"]);
  requireThat(source.overrides === undefined || (Array.isArray(source.overrides) && source.overrides.length === 0), "overrides unsupported");
  requireThat(source.fromYear === undefined || source.fromYear === source.config.startYear, "partial fromYear unsupported");
  requireThat(source.engineSource === undefined || source.engineSource === "rules", "model provider unsupported");
  const input: ReplayInput = copy({
    config: source.config,
    initialPeople: projectPeople(source.people),
    initialEvents: projectEvents(source.events),
    registryOrder: Object.keys(source.people),
    protagonistId: source.protagonistId ?? null,
    options: EFFECTIVE_OPTIONS,
  });
  validateInput(input);
  return {
    manifest: {
      versions: { ...SUPPORTED_REPLAY_VERSIONS }, seed: input.config.seed,
      configHash: canonicalHash(input.config), inputHash: canonicalHash(input),
    },
    input,
  };
}

export function validateReplayEnvelope(value: unknown): ReplayEnvelope {
  canonicalJson(value);
  record(value);
  keys(value, ["manifest", "input"]);
  record(value.manifest);
  const manifest = value.manifest;
  requireThat(canonicalJson(manifest.versions ?? null) === canonicalJson(SUPPORTED_REPLAY_VERSIONS), "unsupported or missing version tuple");
  keys(manifest, ["versions", "seed", "configHash", "inputHash"]);
  const envelope = copy(value) as unknown as ReplayEnvelope;
  validateInput(envelope.input);
  requireThat(manifest.seed === envelope.input.config.seed, "manifest seed mismatch");
  requireThat(manifest.configHash === canonicalHash(envelope.input.config), "config hash mismatch");
  requireThat(manifest.inputHash === canonicalHash(envelope.input), "input hash mismatch");
  return envelope;
}

/** Standalone orchestration, not a production route or a general override-history replayer. */
export async function replayRules(value: unknown): Promise<{
  report: SimulateReport; canonical: ReturnType<typeof projectResult>; outputHash: string;
  diagnostics: { node: string; v8: string; wallTimeMs: number; decisionCalls: number; hazardFallbacks: Readonly<Record<string, number>> };
}> {
  const { input } = validateReplayEnvelope(value);
  // Sorted JSON record keys do NOT sort the kernel registry: restore recorded traversal order.
  const people = Object.fromEntries(input.registryOrder.map((id) => [id, input.initialPeople[id]!]));
  requireThat(canonicalJson(Object.keys(people)) === canonicalJson(input.registryOrder), "registry order cannot be restored");
  const report = await simulate(input.config, people, input.initialEvents, {
    decisionMaker: new RuleDecisionMaker(), engineSource: "rules", overrides: [],
    concurrencyLimit: input.options.concurrencyLimit, yearBatchConcurrency: input.options.yearBatchConcurrency,
    fromYear: input.config.startYear,
    ...(input.protagonistId === null ? {} : { protagonistId: input.protagonistId }),
  });
  const canonical = projectResult(report.result);
  return { report, canonical, outputHash: canonicalHash(canonical), diagnostics: {
    node: process.version, v8: process.versions.v8, wallTimeMs: report.wallTimeMs,
    decisionCalls: report.decisionCalls, hazardFallbacks: { ...report.hazardFallbacks },
  } };
}

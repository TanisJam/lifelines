import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createAnnualRuntime, ANNUAL_RUNTIME_VERSION, type AnnualPlan, type Newcomer } from "../src/domain/e-runtime";
import { initializeWorld } from "../src/domain/world-initialization";
import { ANNUAL_CAPSULE_MANIFEST, createAnnualRuntimeCapsule, serializeAnnualRuntimeCapsule, deserializeAnnualRuntimeCapsule } from "../src/domain/e-capsule";
import { forkAnnualRuntime } from "../src/domain/e-fork";

export const CORPUS_VERSION = "annual-local-f-prep-1";
export const CORPUS = Object.freeze([
  Object.freeze({ name: "quiet-gapped" }),
  Object.freeze({ name: "delayed-favor-response" }),
  Object.freeze({ name: "competing-blocked-intentions" }),
  Object.freeze({ name: "explicitly-allocated-newcomer" }),
]);
type Fixture = typeof CORPUS[number];

/** Local comparison oracle, not a new runtime or durable codec. Sorted own keys
 * ignore record traversal; array length/presence and Object.is leaves matter. */
export function ownDataIdentity(value: unknown): string {
  if (value === undefined) return '["undefined"]';
  if (typeof value === "number") return JSON.stringify(["number", Object.is(value, -0) ? "-0" : String(value)]);
  if (value !== null && typeof value === "object") {
    return JSON.stringify([Array.isArray(value) ? "array" : "record", Array.isArray(value) ? value.length : null,
      Object.keys(value).sort().map(key => [key, ownDataIdentity(Reflect.get(value, key))])]);
  }
  return JSON.stringify([typeof value, value]);
}
export function assertEquivalent(first: unknown, second: unknown, label: string): void {
  if (ownDataIdentity(first) !== ownDataIdentity(second)) throw new Error(`${label} mismatch`);
}
function identityHash(value: unknown): string {
  return createHash("sha256").update(ownDataIdentity(value), "utf8").digest("hex");
}
export function wireBytes(wire: string): number { return Buffer.byteLength(wire, "utf8"); }
function timed<T>(operation: () => T) {
  const start = performance.now();
  const value = operation();
  return { value, ms: performance.now() - start };
}
function quiet(year: number): AnnualPlan { return { year, physical: [], resources: [], grants: [], requests: [] }; }
function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

function constructInput(fixture: Fixture) {
  const initialization = { seed: "verify-1", startYear: 1327, endYear: 1335, founderCount: 6 };
  const { world } = initializeWorld(initialization);
  // Explicit allocations are fixture data, never economy defaults or refill.
  const resources = Object.fromEntries(Object.keys(world.people).map(id => [id, { grain: 2, effort: 1, need: 1 }]));
  const [creditor, debtor, other] = Object.values(world.people)
    .filter(person => person.birthYear < 1327 && person.deathYear === undefined && !person.away).map(person => person.id);
  let plans = [quiet(1327), quiet(1333)];
  const grant = { id: "grant", creditor, debtor, causes: [] };
  if (fixture.name === "delayed-favor-response") plans = [
    { ...quiet(1327), grants: [grant] }, quiet(1329),
    { ...quiet(1333), requests: [{ id: "response", obligation: "grant/help", noise: 0 }] },
  ];
  if (fixture.name === "competing-blocked-intentions") plans = [
    { ...quiet(1327), grants: [grant, { id: "competing", creditor, debtor: other, causes: [] },
      { id: "blocked", creditor, debtor: other, causes: [] }] },
    { ...quiet(1333), physical: [{ id: "away", kind: "residence", actor: debtor, status: "away", causes: [] }],
      requests: [{ id: "response", obligation: "grant/help", noise: 0 }] },
  ];
  if (fixture.name === "explicitly-allocated-newcomer") {
    const base = world.people[debtor];
    const mind = structuredClone(base.mind);
    mind.stress = -0;
    const person: Newcomer = { id: "newcomer", name: "É🌱", birthYear: 1327, sex: base.sex, traits: [...base.traits], job: base.job, mind };
    plans = [
      { ...quiet(1327), physical: [{ id: "create", kind: "create", person, causes: [] }],
        grants: [{ id: "early", creditor, debtor: person.id, causes: ["create"] }] },
      { ...quiet(1330), resources: [{ id: "allocate", kind: "allocate", actor: person.id,
        allocation: { grain: 0, effort: 1, need: 1 }, causes: ["create"] }],
        grants: [{ id: "grant", creditor, debtor: person.id, causes: ["allocate"] }] },
      { ...quiet(1333), requests: [{ id: "response", obligation: "grant/help", noise: 0 }] },
    ];
  }
  return freeze({ initialization, resources, plans });
}

export function executeFixture(fixture: Fixture) {
  const input = constructInput(fixture);
  const before = ownDataIdentity(input);
  const execution = timed(() => {
    const runtime = createAnnualRuntime(input.initialization, input.resources);
    const checkpoints = [runtime.initial, ...input.plans.map(plan => runtime.advance(plan))];
    return { runtime, checkpoints };
  });
  assertEquivalent(before, ownDataIdentity(input), "input after runtime execution");
  return { input, ...execution.value, runtimeExecutionMs: execution.ms };
}
type Run = ReturnType<typeof executeFixture>;

export function measureFixture(run: Run) {
  const inputBefore = ownDataIdentity(run.input);
  const retainedBefore = ownDataIdentity(run.checkpoints);
  const finalBefore = ownDataIdentity(run.runtime.final());
  const identityBefore = identityHash(run.runtime.final());
  const serialized = run.checkpoints.slice(1).map(output => {
    const creation = timed(() => createAnnualRuntimeCapsule(output));
    const serialization = timed(() => serializeAnnualRuntimeCapsule(creation.value));
    const admission = timed(() => deserializeAnnualRuntimeCapsule(serialization.value));
    assertEquivalent(output, admission.value.output, "complete cold own-data fidelity");
    assertEquivalent(creation.value.digest, admission.value.digest, "cold identity");
    assertEquivalent(serialization.value, serializeAnnualRuntimeCapsule(admission.value), "cold canonical wire");
    return { capsule: admission.value, wire: serialization.value, creationMs: creation.ms, serializationMs: serialization.ms, admissionMs: admission.ms };
  });
  const last = serialized.at(-1)!;
  const frontier = run.input.plans[0].year;
  const suffix = run.input.plans.slice(1); // Explicit required suffix, no inferred continuation.
  const fork = timed(() => forkAnnualRuntime(last.capsule, frontier, suffix));
  const fresh = createAnnualRuntime(run.input.initialization, run.input.resources);
  const freshInitial = fresh.initial;
  const freshPrefix = fresh.advance(run.input.plans[0]);
  const freshSuffix = suffix.map(plan => fresh.advance(plan));
  assertEquivalent(fork.value.initial, freshInitial, "fork initial parity");
  assertEquivalent(fork.value.prefix, freshPrefix, "fork prefix parity");
  assertEquivalent(fork.value.suffix, freshSuffix, "fork suffix parity");
  assertEquivalent(fork.value.finalCapsule.output, fresh.final(), "fork complete parity");
  assertEquivalent(serializeAnnualRuntimeCapsule(fork.value.finalCapsule), last.wire, "fork wire parity");
  const final = run.runtime.final();
  const entries = final.journal.flatMap(record => record.entries);
  const executedPlans = final.journal.length;
  assertEquivalent(inputBefore, ownDataIdentity(run.input), "input after instrumentation");
  assertEquivalent(retainedBefore, ownDataIdentity(run.checkpoints), "retained outputs after instrumentation");
  assertEquivalent(finalBefore, ownDataIdentity(final), "full canon after instrumentation");
  assertEquivalent(identityBefore, identityHash(final), "identity after instrumentation");
  return {
    inputIdentity: identityHash(run.input), outputIdentity: identityBefore, capsuleDigest: last.capsule.digest,
    calendar: { firstExecutedYear: final.journal[0].plan.year, lastExecutedYear: final.frontier,
      inclusiveSpan: final.frontier! - final.journal[0].plan.year + 1 },
    counts: { executedPlans, entries: entries.length, committed: entries.filter(entry => entry.outcome === "committed").length,
      ineligible: entries.filter(entry => entry.outcome === "ineligible").length, entriesPerExecutedPlan: entries.length / executedPlans,
      helpHistoryEntries: final.state.events.length, people: Object.keys(final.state.people).length },
    bytes: { finalWireBytes: wireBytes(last.wire), retainedExecutedCheckpointWireBytesInitialExcluded: serialized.reduce((sum, entry) => sum + wireBytes(entry.wire), 0) },
    timingsInclusiveMs: { runtimeExecution: run.runtimeExecutionMs,
      capsuleCreation: serialized.map(entry => entry.creationMs), serialization: serialized.map(entry => entry.serializationMs),
      coldAdmission: serialized.map(entry => entry.admissionMs), coldFork: fork.ms },
    fork: { frontier, suffixYears: suffix.map(plan => plan.year), parity: true },
    canonicalWire: last.wire,
  };
}

/** Runner injection only exercises mismatch rejection; all canon checks remain mandatory. */
export function runBaseline(runner: (fixture: Fixture) => Run = executeFixture) {
  const observations = CORPUS.map(fixture => {
    const first = runner(fixture);
    const second = runner(fixture); // Independently initialized, not a clone.
    assertEquivalent(first.input, second.input, "independent input");
    assertEquivalent(first.checkpoints, second.checkpoints, "independent complete canon");
    const runs = [measureFixture(first), measureFixture(second)];
    assertEquivalent(runs[0].outputIdentity, runs[1].outputIdentity, "independent identity");
    assertEquivalent(runs[0].canonicalWire, runs[1].canonicalWire, "independent canonical wire");
    return { name: fixture.name, runs: runs.map(({ canonicalWire, ...metrics }) => {
      void canonicalWire; // Compare full bytes but keep stdout bounded to metrics.
      return metrics;
    }) };
  });
  return {
    corpus: { version: CORPUS_VERSION, count: CORPUS.length, names: CORPUS.map(fixture => fixture.name), independentRunsPerCase: 2 },
    versions: { runtime: ANNUAL_RUNTIME_VERSION, capsuleManifest: ANNUAL_CAPSULE_MANIFEST },
    host: { node: process.version, v8: process.versions.v8 },
    methodology: { timing: "monotonic elapsed milliseconds; inclusive public operations; capsule creation, serialization, admission and fork include existing semantic replay",
      bytes: "UTF-8 final wire and sum of retained executed checkpoint wires; initial excluded; not peak storage",
      denominator: "executed journal plans, separate from inclusive calendar span; no timing budgets or calibration claim" },
    observations,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(runBaseline()));
}

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createAnnualRuntime, replayAnnualRuntime, type AnnualPlan, type Newcomer } from "./e-runtime";
import { initializeWorld } from "./world-initialization";
import { ANNUAL_CAPSULE_MANIFEST, admitAnnualRuntimeCapsule, createAnnualRuntimeCapsule, deserializeAnnualRuntimeCapsule, serializeAnnualRuntimeCapsule } from "./e-capsule";
import { selectHistoricalEvidence } from "./e-selection";
import { forkAnnualRuntime } from "./e-fork";

const initialization = { seed: "verify-1", startYear: 1327, endYear: 1335, founderCount: 6 };
function fixture(options = initialization, authority?: Parameters<typeof createAnnualRuntime>[2]) {
  const { world } = initializeWorld(options);
  return createAnnualRuntime(options, Object.fromEntries(Object.keys(world.people).map(id => [id, { grain: 2, effort: 1, need: 1 }])), authority);
}
function quiet(year: number): AnnualPlan { return { year, physical: [], resources: [], grants: [], requests: [] }; }
function actors(runtime: ReturnType<typeof fixture>) {
  return Object.values(runtime.initial.state.people).filter(p => p.birthYear < 1327 && p.deathYear === undefined && !p.away).map(p => p.id);
}
// Independent test oracle: ignore record traversal/prototypes, never presence or signed zero.
function exact(actual: unknown, expected: unknown): void {
  if (expected !== null && typeof expected === "object") {
    expect(actual !== null && typeof actual === "object").toBe(true);
    expect(Array.isArray(actual)).toBe(Array.isArray(expected));
    if (Array.isArray(expected)) expect((actual as unknown[]).length).toBe(expected.length);
    expect(Object.keys(actual as object).sort()).toEqual(Object.keys(expected).sort());
    for (const key of Object.keys(expected)) exact(Reflect.get(actual as object, key), Reflect.get(expected, key));
  } else expect(Object.is(actual, expected)).toBe(true);
}
function frozen(value: unknown): void {
  if (value !== null && typeof value === "object") {
    expect(Object.isFrozen(value)).toBe(true);
    Object.values(value).forEach(frozen);
  }
}
function objectGraph(value: unknown, objects = new Set<object>()): Set<object> {
  if (value !== null && typeof value === "object" && !objects.has(value)) {
    objects.add(value);
    Object.values(value).forEach(entry => objectGraph(entry, objects));
  }
  return objects;
}
function parentHistory() {
  const runtime = fixture();
  const [creditor, debtor] = actors(runtime);
  const plans: AnnualPlan[] = [
    { ...quiet(1327), grants: [{ id: "grant", creditor, debtor, causes: [] }] },
    { ...quiet(1328), requests: [{ id: "request", obligation: "grant/help", noise: 0 }] },
    { ...quiet(1330), physical: [{ id: "away", kind: "residence", actor: debtor, status: "away", causes: [] }] },
    quiet(1333),
  ];
  const checkpoints = [runtime.initial, ...plans.map(plan => runtime.advance(plan))];
  const capsule = deserializeAnnualRuntimeCapsule(serializeAnnualRuntimeCapsule(createAnnualRuntimeCapsule(runtime.final())));
  return { runtime, creditor, debtor, plans, checkpoints, capsule };
}
// A genuine unsupported human journal needs a valid digest to reach semantic admission.
// This test-only encoder independently follows the public lossless tuple contract.
function tagged(value: unknown): unknown {
  if (value === undefined) return ["undefined"];
  if (value === null) return ["null"];
  if (typeof value === "number") return ["number", Object.is(value, -0) ? "-0" : String(value)];
  if (typeof value === "string" || typeof value === "boolean") return [typeof value, value];
  if (Array.isArray(value)) return ["array", value.map(tagged)];
  return ["record", Object.entries(value as object).map(([key, entry]) => [key, tagged(entry)])];
}
function rawCapsule(output: unknown) {
  const digest = createHash("sha256").update(JSON.stringify([ANNUAL_CAPSULE_MANIFEST, tagged(output)]), "utf8").digest("hex");
  return { manifest: ANNUAL_CAPSULE_MANIFEST, output, digest };
}

it("reconstructs an explicit initial root with an empty suffix", () => {
  const runtime = fixture();
  const parent = createAnnualRuntimeCapsule(runtime.final());
  const fork = forkAnnualRuntime(parent, null, []);
  expect(fork.version).toBe("annual-runtime-fork-e3-1");
  expect(fork.parentDigest).toBe(parent.digest);
  expect(fork.prefixLength).toBe(0);
  expect(fork.finalCapsule.digest).toBe(parent.digest);
});

describe("retained history and explicit suffix", () => {
  it.each(["initial-empty", "initial-same", "mid-same", "mid-changed", "mid-empty", "end-empty"] as const)("shares no caller objects including capsule metadata: %s", scenario => {
    const { runtime, plans } = parentHistory();
    // A factory capsule deliberately retains the public frozen manifest constant.
    const parent = createAnnualRuntimeCapsule(runtime.final());
    const frontier = scenario.startsWith("initial") ? null : scenario === "end-empty" ? 1333 : 1328;
    const suffix = scenario === "initial-same" ? plans : scenario === "mid-same" ? plans.slice(2)
      : scenario === "mid-changed" ? [quiet(1334)] : [];
    const parentObjects = objectGraph(parent);
    const suffixObjects = objectGraph(suffix);
    const result = forkAnnualRuntime(parent, frontier, suffix);
    const resultObjects = objectGraph(result);
    expect([...resultObjects].filter(object => parentObjects.has(object))).toHaveLength(0);
    expect([...resultObjects].filter(object => suffixObjects.has(object))).toHaveLength(0);
    frozen(result);
    expect(result.version).toBe("annual-runtime-fork-e3-1");
    expect(result.parentDigest).toBe(parent.digest);
    exact(result.finalCapsule.manifest, parent.manifest);
    expect(result.finalCapsule.manifest).not.toBe(parent.manifest);
    expect(result.finalCapsule.manifest[3]).not.toBe(parent.manifest[3]);
    const certified = createAnnualRuntimeCapsule(result.finalCapsule.output);
    expect(result.finalCapsule.digest).toBe(certified.digest);
    exact(admitAnnualRuntimeCapsule(result.finalCapsule).output, result.finalCapsule.output);
    if (scenario.endsWith("same") || scenario === "end-empty") expect(result.finalCapsule.digest).toBe(parent.digest);
  });
  it.each([0, 1, 2, 3, 4])("matches all independently captured checkpoints from prefix length %s", length => {
    const { capsule, checkpoints, plans } = parentHistory();
    const frontier = length ? plans[length - 1].year : null;
    const fork = forkAnnualRuntime(capsule, frontier, plans.slice(length));
    expect(fork.frontier).toBe(frontier);
    expect(fork.prefixLength).toBe(length);
    exact(fork.initial, checkpoints[0]);
    exact(fork.prefix, checkpoints[length]);
    fork.suffix.forEach((output, index) => exact(output, checkpoints[length + index + 1]));
    exact(fork.finalCapsule.output, checkpoints.at(-1));
    exact(admitAnnualRuntimeCapsule(fork.finalCapsule).output, checkpoints.at(-1));
    exact(replayAnnualRuntime(fork.finalCapsule.output), checkpoints.at(-1));
    frozen(fork);
    expect(fork.suffix).not.toBe(plans);
  });

  it.each([null, 1327, 1328, 1330, 1333])("empty suffix ends at exactly %s without filling gaps", frontier => {
    const { capsule, checkpoints, plans } = parentHistory();
    const length = frontier === null ? 0 : plans.findIndex(plan => plan.year === frontier) + 1;
    const fork = forkAnnualRuntime(capsule, frontier, []);
    exact(fork.prefix, checkpoints[length]);
    exact(fork.finalCapsule.output, checkpoints[length]);
    expect(fork.suffix).toEqual([]);
    expect(fork.prefix.journal.map(record => record.plan.year)).toEqual(plans.slice(0, length).map(plan => plan.year));
  });

  it("changes only subsequent execution and permits historical projection with retained checkpoints", () => {
    const { capsule, checkpoints, creditor } = parentHistory();
    const changed: AnnualPlan = { ...quiet(1328), resources: [{ id: "change", kind: "resource-change", actor: creditor, resource: "grain", amount: 1, causes: ["grant"] }] };
    const fork = forkAnnualRuntime(capsule, 1327, [changed]);
    exact(fork.prefix, checkpoints[1]);
    expect(fork.suffix[0].state.grain[creditor]).toBe(checkpoints[1].state.grain[creditor] + 1);
    expect(fork.suffix[0].journal[1].plan).not.toEqual(checkpoints[2].journal[1].plan);
    const history = [fork.initial, fork.prefix, ...fork.suffix];
    exact(selectHistoricalEvidence({ history, subjectActorID: creditor, asOfYear: 1327 }),
      selectHistoricalEvidence({ history: checkpoints.slice(0, 2), subjectActorID: creditor, asOfYear: 1327 }));
  });

  it("admits reordered record data but promises semantic, not digest, parity", () => {
    const { capsule, checkpoints, plans } = parentHistory();
    function reorder(value: unknown): unknown {
      if (Array.isArray(value)) return value.map(reorder);
      if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).reverse().map(([key, entry]) => [key, reorder(entry)]));
      return value;
    }
    const reordered = createAnnualRuntimeCapsule(reorder(capsule.output));
    expect(reordered.digest).not.toBe(capsule.digest);
    const fork = forkAnnualRuntime(reordered, 1328, plans.slice(2));
    exact(fork.prefix, checkpoints[2]);
    fork.suffix.forEach((output, index) => exact(output, checkpoints[index + 3]));
    exact(fork.finalCapsule.output, reordered.output);
    expect(fork.parentDigest).toBe(reordered.digest);
    expect(fork.finalCapsule.digest).not.toBe(reordered.digest);
  });

  it("supports genuinely initialized negative executed years", () => {
    const runtime = fixture({ ...initialization, startYear: -10, endYear: -1 });
    const checkpoint = runtime.advance(quiet(-7));
    const fork = forkAnnualRuntime(createAnnualRuntimeCapsule(runtime.final()), -7, [quiet(-3)]);
    exact(fork.prefix, checkpoint);
    expect(fork.finalCapsule.output.frontier).toBe(-3);
  });
});

describe("closed descriptor-first inputs", () => {
  it.each([undefined, -0, NaN, Infinity, -Infinity, 1327.5, Number.MAX_SAFE_INTEGER + 1, 1326, 1329, 1335])("rejects invalid/nonexecuted frontier %s", frontier => {
    const { capsule } = parentHistory();
    expect(() => Reflect.apply(forkAnnualRuntime, undefined, [capsule, frontier, []])).toThrow();
  });
  it("rejects omitted frontier and suffix at the JavaScript boundary", () => {
    const parent = createAnnualRuntimeCapsule(fixture().final());
    expect(() => Reflect.apply(forkAnnualRuntime, undefined, [parent])).toThrow();
    expect(() => Reflect.apply(forkAnnualRuntime, undefined, [parent, null])).toThrow();
  });
  it.each([undefined, null, {}, () => [], { [Symbol.iterator]: () => [][Symbol.iterator]() }, [undefined], new Array(1)])("rejects non-own-data array suffix %s", suffix => {
    const parent = createAnnualRuntimeCapsule(fixture().final());
    expect(() => Reflect.apply(forkAnnualRuntime, undefined, [parent, null, suffix])).toThrow();
  });
  it("rejects getters, nested hooks and extended arrays without running hooks", () => {
    const parent = createAnnualRuntimeCapsule(fixture().final());
    let hooks = 0;
    const accessor = Object.defineProperty({}, "year", { enumerable: true, get() { hooks++; return 1327; } });
    const nested = { ...quiet(1327), physical: [accessor] };
    const extended = [quiet(1327)];
    Object.defineProperty(extended, "extra", { enumerable: true, get() { hooks++; return 1; } });
    const badPlan = { ...quiet(1327), requests: [{ id: "bad", obligation: "x", noise: () => { hooks++; return 0; } }] };
    for (const suffix of [[accessor], [nested], extended, [badPlan]]) {
      expect(() => Reflect.apply(forkAnnualRuntime, undefined, [parent, null, suffix])).toThrow();
    }
    expect(hooks).toBe(0);
  });
  it("admits the entire parent before touching a hostile suffix", () => {
    const { capsule } = parentHistory();
    let hooks = 0;
    const suffix = [Object.defineProperty({}, "year", { enumerable: true, get() { hooks++; return 1327; } })];
    const bad = { ...capsule, manifest: ["unknown"] };
    expect(() => Reflect.apply(forkAnnualRuntime, undefined, [bad, null, suffix])).toThrow(/manifest/);
    expect(hooks).toBe(0);
    const parentAccessor = Object.defineProperty({}, "output", { enumerable: true, get() { hooks++; return capsule.output; } });
    expect(() => Reflect.apply(forkAnnualRuntime, undefined, [parentAccessor, null, []])).toThrow();
    expect(hooks).toBe(0);
    expect(() => forkAnnualRuntime(serializeAnnualRuntimeCapsule(capsule), null, [])).toThrow();
  });
  it.each(["digest", "raw-future", "rehash-future"])("rejects %s even when discarding the whole future", target => {
    const { capsule } = parentHistory();
    const output = structuredClone(capsule.output);
    Reflect.set(output.journal[3], "entries", [{ fabricated: true }]);
    const bad = target === "digest" ? { ...capsule, digest: "0".repeat(64) }
      : target === "raw-future" ? { ...capsule, output } : rawCapsule(output);
    expect(() => forkAnnualRuntime(bad, null, [])).toThrow();
  });
  it("rejects genuine human authority only in discarded future", () => {
    const runtime = fixture(initialization, () => ({ source: "human", selected: "help" }));
    const [creditor, debtor] = actors(runtime);
    runtime.advance({ ...quiet(1327), grants: [{ id: "grant", creditor, debtor, causes: [] }] });
    runtime.advance({ ...quiet(1328), requests: [{ id: "request", obligation: "grant/help", noise: 0 }] });
    expect(runtime.final().journal[1].entries.at(-1)!.authority!.source).toBe("human");
    expect(() => forkAnnualRuntime(rawCapsule(runtime.final()), 1327, [])).toThrow(/Human authority replay/);
  });
});

describe("fresh local identity and failure isolation", () => {
  function futureActor() {
    const runtime = fixture();
    const [actor] = actors(runtime);
    const base = runtime.initial.state.people[actor];
    const person: Newcomer = { id: "constructor", name: "New", sex: base.sex, birthYear: 1328, traits: [...base.traits], job: base.job, mind: structuredClone(base.mind) as Newcomer["mind"] };
    person.mind.stress = -0;
    const prefix = runtime.advance(quiet(1327));
    const creation: AnnualPlan = { ...quiet(1328), physical: [{ id: "future-create", kind: "create", person, causes: [] }] };
    runtime.advance(creation);
    return { capsule: createAnnualRuntimeCapsule(runtime.final()), actor, person, prefix, creation };
  }
  it("does not know discarded future actors or causes", () => {
    const { capsule, actor } = futureActor();
    expect(() => forkAnnualRuntime(capsule, 1327, [{ ...quiet(1329), physical: [{ id: "move", kind: "residence", actor: "constructor", status: "away", causes: [] }] }])).toThrow(/Unknown actor/);
    expect(() => forkAnnualRuntime(capsule, 1327, [{ ...quiet(1329), resources: [{ id: "change", kind: "resource-change", actor, resource: "grain", amount: 1, causes: ["future-create"] }] }])).toThrow(/Unknown or forward cause/);
  });
  it("explicitly reintroduces a discarded future actor and reuses its local discarded ID", () => {
    const { capsule, prefix, creation } = futureActor();
    const allocation: AnnualPlan = { ...quiet(1329), resources: [{ id: "allocate", kind: "allocate", actor: "constructor", allocation: { grain: 0, effort: 1, need: 1 }, causes: ["future-create"] }] };
    const fork = forkAnnualRuntime(capsule, 1327, [creation, allocation]);
    exact(fork.prefix, prefix);
    expect(fork.suffix[0].journal[1].entries[0].id).toBe("future-create");
    expect(Object.is(fork.suffix[1].state.people["constructor"].mind.stress, -0)).toBe(true);
    expect(fork.suffix[1].state.grain["constructor"]).toBe(0);
    exact(replayAnnualRuntime(fork.finalCapsule.output), fork.suffix[1]);
  });
  it.each([null, 1328, 1330])("preserves complete newcomer/undefined/-0 evidence from %s", frontier => {
    const { capsule, creation, actor } = futureActor();
    const runtime = fixture();
    const plans: AnnualPlan[] = [quiet(1327), {
      ...creation, grants: [{ id: "unallocated", creditor: actor, debtor: "constructor", causes: ["future-create"] }],
    }, {
      ...quiet(1330), resources: [{ id: "allocate", kind: "allocate", actor: "constructor", allocation: { grain: 0, effort: 1, need: 1 }, causes: ["future-create"] }],
      grants: [{ id: "allocated-grant", creditor: actor, debtor: "constructor", causes: ["allocate"] }],
    }, { ...quiet(1331), requests: [{ id: "new-request", obligation: "allocated-grant/help", noise: 0 }] }];
    const checkpoints = [runtime.initial, ...plans.map(plan => runtime.advance(plan))];
    const consumed = checkpoints[2].journal[1].entries[1].consumed as { grain: unknown[] };
    expect(Object.hasOwn(consumed.grain, 1)).toBe(true);
    expect(consumed.grain[1]).toBeUndefined();
    const length = frontier === null ? 0 : plans.findIndex(plan => plan.year === frontier) + 1;
    const parent = createAnnualRuntimeCapsule(runtime.final());
    expect(parent.digest).not.toBe(capsule.digest);
    const fork = forkAnnualRuntime(parent, frontier, plans.slice(length));
    exact(fork.prefix, checkpoints[length]);
    fork.suffix.forEach((output, index) => exact(output, checkpoints[length + index + 1]));
    exact(admitAnnualRuntimeCapsule(fork.finalCapsule).output, checkpoints.at(-1));
  });
  it("rejects retained ID collisions", () => {
    const { capsule, creditor, debtor } = parentHistory();
    expect(() => forkAnnualRuntime(capsule, 1327, [{ ...quiet(1328), grants: [{ id: "grant", creditor, debtor, causes: [] }] }])).toThrow(/Duplicate operation identity/);
  });
  it("throws on late failure without returning or mutating any caller data", () => {
    const { capsule } = parentHistory();
    const parent = structuredClone(capsule);
    const suffix = [quiet(1328), quiet(1328)];
    const beforeParent = structuredClone(parent);
    const beforeSuffix = structuredClone(suffix);
    let result: unknown = "not returned";
    expect(() => { result = forkAnnualRuntime(parent, 1327, suffix); }).toThrow(/Invalid year frontier/);
    expect(result).toBe("not returned");
    exact(parent, beforeParent);
    exact(suffix, beforeSuffix);
    expect(Object.isFrozen(parent)).toBe(false);
    expect(Object.isFrozen(suffix)).toBe(false);
    expect(forkAnnualRuntime(parent, 1327, [quiet(1329)]).suffix[0].frontier).toBe(1329);
  });
  it("supports frozen deep-readonly and mutable inputs, with detached deeply frozen outputs", () => {
    const { capsule, plans } = parentHistory();
    const parent = structuredClone(capsule);
    const suffix = structuredClone(plans.slice(1));
    const before = structuredClone(suffix);
    const fork = forkAnnualRuntime(parent, 1327, suffix);
    exact(suffix, before);
    expect(Object.isFrozen(suffix)).toBe(false);
    frozen(fork);
    Reflect.set(suffix[0], "year", 1335);
    Reflect.set(parent.output.state.people[Object.keys(parent.output.state.people)[0]], "name", "mutated");
    exact(fork.suffix[0].journal[1].plan, before[0]);
    expect(fork.prefix).not.toBe(parent.output);
    const readonlySuffix = Object.freeze([Object.freeze({ year: 1328, physical: Object.freeze([]), resources: Object.freeze([]), grants: Object.freeze([]), requests: Object.freeze([]) })]);
    const readonlyFork = forkAnnualRuntime(capsule, 1327, readonlySuffix);
    expect(readonlyFork.suffix[0].frontier).toBe(1328);
    // Compile-time contract checks; never executed.
    if (false) {
      // @ts-expect-error Required explicit frontier and suffix.
      forkAnnualRuntime(capsule);
      // @ts-expect-error Suffix is an array, not a callback.
      forkAnnualRuntime(capsule, null, () => []);
      // @ts-expect-error No authority/options argument.
      forkAnnualRuntime(capsule, null, [], {});
      // @ts-expect-error Deep-readonly nested Person/Mind.
      readonlyFork.prefix.state.people["x"].mind.stress = 1;
      // @ts-expect-error Deep-readonly annual output array.
      readonlyFork.suffix.push(readonlyFork.prefix);
    }
  });
});

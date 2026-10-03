import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createAnnualRuntime, type AnnualPlan, type Newcomer } from "./e-runtime";
import { selectHistoricalEvidence } from "./e-selection";
import { initializeWorld } from "./world-initialization";
import { ANNUAL_CAPSULE_MANIFEST, admitAnnualRuntimeCapsule, createAnnualRuntimeCapsule, deserializeAnnualRuntimeCapsule, serializeAnnualRuntimeCapsule } from "./e-capsule";

const initialization = { seed: "verify-1", startYear: 1327, endYear: 1335, founderCount: 6 };
function fixture(authority?: Parameters<typeof createAnnualRuntime>[2]) {
  const { world } = initializeWorld(initialization);
  const resources = Object.fromEntries(Object.keys(world.people).map(id => [id, { grain: 2, effort: 1, need: 1 }]));
  return createAnnualRuntime(initialization, resources, authority);
}
function quiet(year: number): AnnualPlan { return { year, physical: [], resources: [], grants: [], requests: [] }; }
function actors(runtime: ReturnType<typeof fixture>) {
  return Object.values(runtime.initial.state.people).filter(p => p.birthYear < 1327 && p.deathYear === undefined && !p.away).map(p => p.id);
}
function exact(actual: unknown, expected: unknown) {
  if (expected !== null && typeof expected === "object") {
    expect(actual !== null && typeof actual === "object").toBe(true);
    expect(Object.keys(actual as object)).toEqual(Object.keys(expected));
    expect(Array.isArray(actual)).toBe(Array.isArray(expected));
    for (const key of Object.keys(expected)) exact(Reflect.get(actual as object, key), Reflect.get(expected, key));
  } else expect(Object.is(actual, expected)).toBe(true);
}
function frozen(value: unknown) {
  if (value !== null && typeof value === "object") {
    expect(Object.isFrozen(value)).toBe(true);
    Object.values(value).forEach(frozen);
  }
}
function roundtrip(output: unknown) {
  const capsule = createAnnualRuntimeCapsule(output);
  const admitted = admitAnnualRuntimeCapsule(capsule);
  const wire = serializeAnnualRuntimeCapsule(capsule);
  const cold = deserializeAnnualRuntimeCapsule(wire);
  for (const next of [capsule, admitted, cold]) { exact(next.output, output); frozen(next); }
  expect(serializeAnnualRuntimeCapsule(cold)).toBe(wire);
  expect(capsule.output).not.toBe(output);
  return cold.output;
}
// Test-only wire surgery is independent of the private production encoder.
type Node = [string, unknown?];
type Envelope = { manifest: unknown[]; payload: Node; digest: string };
function envelope(output = fixture().initial): Envelope {
  return JSON.parse(serializeAnnualRuntimeCapsule(createAnnualRuntimeCapsule(output)));
}
function field(node: Node, key: string): Node {
  const pair = (node[1] as [string, Node][]).find(([name]) => name === key);
  if (!pair) throw new Error(`Missing fixture field ${key}`);
  return pair[1];
}
function rehash(wire: Envelope) {
  wire.digest = createHash("sha256").update(JSON.stringify([wire.manifest, wire.payload]), "utf8").digest("hex");
  return JSON.stringify(wire);
}

it("cold-admits a complete initial output", () => {
  roundtrip(fixture().initial);
});

describe("lossless complete annual capsules", () => {
  it.each(["constructor", "toString", "__proto__", "7", "\ud800"])("preserves supported newcomer and unallocated evidence for %s", id => {
    const runtime = fixture();
    const [creditor, debtor] = actors(runtime);
    const base = runtime.initial.state.people[debtor];
    const mind = structuredClone(base.mind) as Newcomer["mind"];
    mind.stress = -0;
    mind.facets.altruism = 12.125;
    mind.needs = [{ name: "[undefined]", met: Number.MIN_VALUE }, { name: "sentinel", met: 1e-7 }];
    mind.relationships = [{ personId: creditor, bond: "friend", strength: -0 }];
    const person: Newcomer = { id, name: "[\"undefined\"]", sex: base.sex, birthYear: 1327, traits: [...base.traits], job: base.job, mind };
    const created = runtime.advance({ ...quiet(1327), physical: [{ id: "create", kind: "create", person, causes: [] }],
      grants: [{ id: "early", creditor, debtor: id, causes: ["create"] }] });
    const consumed = created.journal[0].entries[1].consumed as { grain: unknown[] };
    expect(Object.hasOwn(consumed.grain, 1)).toBe(true);
    expect(consumed.grain[1]).toBeUndefined();
    expect(created.journal[0].entries[1].reason).toBe("missing-allocation");
    roundtrip(created);
    const allocated = runtime.advance({ ...quiet(1328), resources: [{ id: "allocate", kind: "allocate", actor: id, causes: ["create"], allocation: { grain: 0, effort: 1, need: 1 } }],
      grants: [{ id: "grant", creditor, debtor: id, causes: ["allocate"] }] });
    roundtrip(allocated);
    const helped = runtime.advance({ ...quiet(1329), physical: [{ id: "away", kind: "residence", actor: debtor, status: "away", causes: [] }],
      requests: [{ id: "request", obligation: "grant/help", noise: 0 }] });
    roundtrip(helped);
    expect(Object.is(helped.state.people[id].mind.stress, -0)).toBe(true);
    const hasOwnUndefined = (value: unknown): boolean => value === undefined || (value !== null && typeof value === "object" && Object.values(value).some(hasOwnUndefined));
    expect(hasOwnUndefined(helped.state.people)).toBe(true);
    expect(Object.hasOwn(helped.state.people[id], "deathYear")).toBe(false);
    expect(helped.journal[2].entries.at(-1)!.authority!.selected).toBe("help");
    expect(Object.hasOwn({}, "polluted")).toBe(false);
  });

  it("roundtrips each checkpoint independently for historical selection and quiet gapped extension", () => {
    const runtime = fixture();
    const [creditor, debtor] = actors(runtime);
    const history = [runtime.initial, runtime.advance({ ...quiet(1327), grants: [{ id: "grant", creditor, debtor, causes: [] }] }),
      runtime.advance({ ...quiet(1328), requests: [{ id: "request", obligation: "grant/help", noise: 0 }] })].map(roundtrip);
    const selected = selectHistoricalEvidence({ history, subjectActorID: creditor, asOfYear: 1328 });
    history.push(roundtrip(runtime.advance(quiet(1331))));
    exact(selectHistoricalEvidence({ history, subjectActorID: creditor, asOfYear: 1328 }), selected);
    expect(history.at(-1)!.frontier).toBe(1331);
    expect(history.at(-1)!.journal.map(record => record.plan.year)).toEqual([1327, 1328, 1331]);
  });

  it("preserves admitted record traversal after replay and detaches mutable sources", () => {
    const source = structuredClone(fixture().initial);
    const ids = Object.keys(source.state.people).reverse();
    Reflect.set(source.state, "people", Object.fromEntries(ids.map(id => [id, source.state.people[id]])));
    const before = structuredClone(source);
    const capsule = createAnnualRuntimeCapsule(source);
    exact(source, before);
    exact(capsule.output, source);
    expect(Object.keys(capsule.output.state.people)).toEqual(ids);
    const admitted = admitAnnualRuntimeCapsule(structuredClone(capsule));
    expect(admitted.output).not.toBe(capsule.output);
    Reflect.set(source.state.people[ids[0]], "name", "MUTATED");
    exact(admitted.output, before);
    frozen(admitted);
    expect(() => Reflect.set(admitted.output.state.people[ids[0]], "name", "forged")).not.toThrow();
    expect(admitted.output.state.people[ids[0]].name).toBe(before.state.people[ids[0]].name);
  });

  it("rejects genuine human history but accepts callback-configured outputs without human entries", () => {
    const runtime = fixture(() => ({ source: "human", selected: "help" }));
    roundtrip(runtime.initial);
    const [creditor, debtor] = actors(runtime);
    roundtrip(runtime.advance({ ...quiet(1327), grants: [{ id: "grant", creditor, debtor, causes: [] }] }));
    const human = runtime.advance({ ...quiet(1328), requests: [{ id: "request", obligation: "grant/help", noise: 0 }] });
    expect(human.journal[1].entries.at(-1)!.authority!.source).toBe("human");
    expect(() => createAnnualRuntimeCapsule(human)).toThrow(/Human authority replay/);
  });

  it.each(["origin", "genesis", "state", "frontier", "plan", "entries"])("rejects raw and rehashed fabricated %s", target => {
    const runtime = fixture();
    const output = runtime.advance(quiet(1327));
    const wire = envelope(output);
    let node: Node;
    if (target === "plan" || target === "entries") {
      const year = (field(wire.payload, "journal")[1] as Node[])[0];
      node = field(year, target);
    } else node = field(wire.payload, target);
    if (target === "frontier") node[1] = "1328";
    else if (target === "entries") (node[1] as Node[]).push(["null"]);
    else (node[1] as [string, Node][]).push(["fabricated", ["boolean", true]]);
    expect(() => deserializeAnnualRuntimeCapsule(JSON.stringify(wire))).toThrow();
    expect(() => deserializeAnnualRuntimeCapsule(rehash(wire))).toThrow();
  });

  it.each([0, 1, 2, 3, 4, 5, 6, 7])("rejects unsupported compatibility member %s", index => {
    const wire = envelope();
    if (index < 3) wire.manifest[index] = "unknown";
    else (wire.manifest[3] as unknown[])[index - 3] = "unknown";
    expect(() => deserializeAnnualRuntimeCapsule(rehash(wire))).toThrow(/manifest/);
  });
  it.each([null, {}, [], ["e1"], [...ANNUAL_CAPSULE_MANIFEST, "extra"]].map(value => ({ value })))("rejects malformed manifest $value", ({ value }) => {
    const wire = envelope();
    wire.manifest = value as unknown[];
    expect(() => deserializeAnnualRuntimeCapsule(rehash(wire))).toThrow();
  });

  it.each(["NaN", "Infinity", "-Infinity", "01", "-00", "0.0", "1e0", "1e-07", "1E+21", "9007199254740993", "", " 1"])("rejects noncanonical number %s", number => {
    const wire = envelope();
    field(wire.payload, "frontier").splice(0, 2, "number", number);
    expect(() => deserializeAnnualRuntimeCapsule(rehash(wire))).toThrow();
  });
  it.each([["bogus"], ["null", null], ["undefined", 0], ["boolean", "true"], ["string", 1], ["number", 0], ["array", {}], ["record", [[1, ["null"]]]], ["record", [["a", ["null"]], ["a", ["undefined"]]]]].map(tuple => ({ tuple })))("rejects malformed tagged tuple $tuple", ({ tuple }) => {
    const wire = envelope();
    wire.payload = tuple as Node;
    expect(() => deserializeAnnualRuntimeCapsule(rehash(wire))).toThrow();
  });

  it.each(["schema", "initialization", "content", "rng", "sexPolicy", "runtime", "genesis"])("rejects rehashed payload authority version %s", version => {
    const wire = envelope();
    const node = version === "runtime" ? field(wire.payload, "version") : version === "genesis"
      ? field(field(wire.payload, "genesis"), "version")
      : field(field(field(wire.payload, "origin"), "versions"), version);
    node[1] = "unknown";
    expect(() => deserializeAnnualRuntimeCapsule(rehash(wire))).toThrow();
  });

  it("retains finite binary64 precision and signed zero in genuine Mind inputs", () => {
    const runtime = fixture();
    const [actor] = actors(runtime);
    const base = runtime.initial.state.people[actor];
    const values = [-0, 0, Number.MIN_VALUE, 1e-7, 0.1, 0.30000000000000004, 99.99999999999999, 100];
    const mind = structuredClone(base.mind) as Newcomer["mind"];
    mind.needs = values.map(met => ({ name: String(met), met }));
    const person: Newcomer = { id: "numeric", name: "numeric", sex: base.sex, birthYear: 1327, traits: [...base.traits], job: base.job, mind };
    const output = runtime.advance({ ...quiet(1327), physical: [{ id: "numeric-create", kind: "create", person, causes: [] }] });
    const cold = roundtrip(output);
    values.forEach((value, index) => expect(Object.is(cold.state.people.numeric.mind.needs[index].met, value)).toBe(true));
  });

  it("rejects impossible record enumeration order even with a new digest", () => {
    const wire = envelope();
    wire.payload = ["record", [["2", ["null"]], ["1", ["undefined"]]]];
    expect(() => deserializeAnnualRuntimeCapsule(rehash(wire))).toThrow(/encoding/);
  });

  it("rejects alternate canonical bytes, duplicate JSON keys and unknown envelope fields", () => {
    const wire = serializeAnnualRuntimeCapsule(createAnnualRuntimeCapsule(fixture().initial));
    const parsed = JSON.parse(wire);
    const alternatives = [" " + wire, wire + "\n", JSON.stringify(parsed, null, 2),
      wire.replace('{"manifest":', '{"digest":"discarded","manifest":'),
      JSON.stringify({ digest: parsed.digest, manifest: parsed.manifest, payload: parsed.payload }),
      JSON.stringify({ ...parsed, extra: null }), wire.replace("annual", "\\u0061nnual")];
    for (const next of alternatives) expect(() => deserializeAnnualRuntimeCapsule(next)).toThrow();
    expect(() => deserializeAnnualRuntimeCapsule(parsed)).toThrow();
  });

  it("descriptor-guards whole borrowed trees before reads or executable hooks", () => {
    const hook = vi.fn(() => { throw new Error("HOOK"); });
    const cases: unknown[] = [];
    const getter = structuredClone(fixture().initial);
    Object.defineProperty(getter.state.people, "getter", { enumerable: true, get: hook });
    cases.push(getter);
    for (const key of ["toJSON", "toString", "valueOf"]) {
      const input = structuredClone(fixture().initial);
      Object.defineProperty(input.state, key, { enumerable: true, value: hook });
      cases.push(input);
    }
    const hidden = structuredClone(fixture().initial);
    Object.defineProperty(hidden.state, "hidden", { value: 1 }); cases.push(hidden);
    const symbol = structuredClone(fixture().initial);
    Object.defineProperty(symbol.state, Symbol("hidden"), { value: 1, enumerable: true }); cases.push(symbol);
    const cyclic = structuredClone(fixture().initial);
    Reflect.set(cyclic.state, "cycle", cyclic); cases.push(cyclic);
    for (const value of [NaN, Infinity, new Map(), new Date(), [,], Object.assign([], { extra: 1 }), Object.create({ inherited: 1 })]) {
      const input = structuredClone(fixture().initial);
      Reflect.set(input.state, "bad", value); cases.push(input);
    }
    for (const input of cases) expect(() => createAnnualRuntimeCapsule(input)).toThrow();
    const capsule = structuredClone(createAnnualRuntimeCapsule(fixture().initial));
    Object.defineProperty(capsule, "output", { enumerable: true, get: hook });
    expect(() => admitAnnualRuntimeCapsule(capsule)).toThrow();
    expect(() => serializeAnnualRuntimeCapsule(capsule)).toThrow();
    expect(hook).not.toHaveBeenCalled();
  });
});

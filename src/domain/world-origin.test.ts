import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { copyInitializationData, initializationJson, initializeWorld } from "./world-initialization";
import { admitWorldOrigin, deserializeWorldOrigin, serializeWorldOrigin, WORLD_ORIGIN_VERSIONS } from "./world-origin";

const request = { seed: "origin-wire", startYear: 1327, endYear: 1332, founderCount: 6, protagonist: { name: "\ud800\u0000Mara", sex: "random" as const } };
function frame() { return JSON.parse(serializeWorldOrigin(initializeWorld(request).origin)); }
function rehash(value: ReturnType<typeof frame>) {
  const { digest: _digest, ...payload } = value;
  void _digest;
  value.digest = createHash("sha256").update(initializationJson(payload), "utf8").digest("hex");
  return value;
}

function assertNumericFidelity(expected: unknown, actual: unknown): void {
  if (typeof expected === "number") {
    expect(Object.is(actual, expected)).toBe(true);
  } else if (expected !== null && typeof expected === "object") {
    for (const key of Object.keys(expected)) {
      assertNumericFidelity((expected as Record<string, unknown>)[key], (actual as Record<string, unknown>)[key]);
    }
  }
}

const numericParameters = ["startYear", "endYear", "founderCount"] as const;
const zeroRequest = { seed: "minuszero", startYear: 0, endYear: 0, founderCount: 0, protagonist: { name: "N", sex: "f" as const } };

describe("E1 cold world origin", () => {
  it.each(["requested", "effective"] as const)("rejects rehashed negative-zero parameters in %s", (section) => {
    for (const field of numericParameters) {
      const input = JSON.parse(serializeWorldOrigin(initializeWorld(zeroRequest).origin));
      input[section][field] = -0;
      expect(() => admitWorldOrigin(rehash(input))).toThrow(/Negative zero/);
    }
  });

  it("supports ordinary positive zero with Object.is fidelity after cold reconstruction", () => {
    const { world, origin } = initializeWorld(zeroRequest);
    const cold = deserializeWorldOrigin(serializeWorldOrigin(origin));
    for (const field of numericParameters) {
      expect(Object.is(origin.requested[field], 0)).toBe(true);
      expect(Object.is(origin.effective[field], 0)).toBe(true);
      expect(Object.is(cold.requested[field], 0)).toBe(true);
      expect(Object.is(cold.effective[field], 0)).toBe(true);
    }
    assertNumericFidelity(world, origin.initial);
    assertNumericFidelity(origin, cold);
    expect(Object.is(cold.initial.config.startYear, 0)).toBe(true);
    expect(Object.is(cold.initial.people.protagonist.birthYear, 0)).toBe(true);
    expect(Object.is(cold.initial.people.protagonist.mind.dream.since, 0)).toBe(true);
    const birth = cold.initial.events.find((event) => event.kind === "birth" && event.actors[0] === "protagonist")!;
    expect(Object.is(birth.year, 0)).toBe(true);
  });

  it.each([
    { seed: "verify-1", person: "p002", value: "tradition" as const },
    { seed: "verify-5", person: "protagonist", value: "family" as const },
  ])("preserves naturally generated negative zero for $seed/$person/$value", ({ seed, person, value }) => {
    const { world, origin } = initializeWorld({ ...request, seed });
    const cold = deserializeWorldOrigin(serializeWorldOrigin(origin));
    expect(Object.is(world.people[person].mind.values[value], -0)).toBe(true);
    expect(Object.is(origin.initial.people[person].mind.values[value], -0)).toBe(true);
    expect(Object.is(cold.initial.people[person].mind.values[value], -0)).toBe(true);
    assertNumericFidelity(world, origin.initial);
    assertNumericFidelity(origin, cold);
  });

  it.each(["requested", "effective"] as const)("rejects numeric-parameter accessors in %s with zero hooks", (section) => {
    for (const field of numericParameters) {
      const input = JSON.parse(serializeWorldOrigin(initializeWorld(zeroRequest).origin));
      let hooks = 0;
      Object.defineProperty(input[section], field, { enumerable: true, get() { hooks++; return -0; } });
      expect(() => admitWorldOrigin(input)).toThrow(/Executable/);
      expect(hooks).toBe(0);
      if (section === "requested") {
        expect(() => initializeWorld(input.requested)).toThrow(/Executable/);
        expect(hooks).toBe(0);
      }
    }
  });
  it("reconstructs repeatedly from canonical wire after the evolving registry changes", () => {
    const { world, origin } = initializeWorld(request);
    const wire = serializeWorldOrigin(origin);
    world.people.protagonist.mind.stress = 100;
    world.events.reverse();
    delete world.people.p001;
    const cold = deserializeWorldOrigin(wire);
    expect(cold).toEqual(origin);
    expect(serializeWorldOrigin(cold)).toBe(wire);
    expect(deserializeWorldOrigin(wire)).not.toBe(cold);
    expect(cold.initial.people).not.toBe(origin.initial.people);
    expect(cold.versions).toEqual(WORLD_ORIGIN_VERSIONS);
    expect(cold.initial.people.protagonist.name).toBe(request.protagonist.name);
    expect(Object.isFrozen(cold.initial.events[0].actors)).toBe(true);
  });

  it.each([
    { seed: "default-cold" },
    { seed: "no-protagonist-cold", founderCount: 0 },
    { ...request, protagonist: { name: "explicit", sex: "f" } },
    { ...request, protagonist: { name: "explicit", sex: "m" } },
  ])("cold-reconstructs default/absent/explicit modes %#", (options) => {
    const { world, origin } = initializeWorld(options);
    expect(deserializeWorldOrigin(serializeWorldOrigin(origin))).toEqual(origin);
    expect(initializeWorld(origin.effective).world).toEqual(world);
  });

  it.each([undefined, "f", "m"])("rejects manufactured draws for absent/explicit %s", (sex) => {
    const options = { seed: "no-fake-draw", founderCount: 6, ...(sex ? { protagonist: { name: "Mara", sex } } : {}) };
    const input = JSON.parse(serializeWorldOrigin(initializeWorld(options).origin));
    input.sex.draw = { personId: "protagonist", year: 1498, purpose: "sex", salt: 0, value: .1 };
    expect(() => admitWorldOrigin(rehash(input))).toThrow(/generation disagreement/);
  });

  it("detaches admitted frames and tolerates harmless record-key reordering", () => {
    const input = frame();
    input.initial.people = Object.fromEntries(Object.entries(input.initial.people).reverse());
    const admitted = admitWorldOrigin(input);
    input.initial.people.protagonist.mind.stress = 100;
    expect(admitted.initial.people.protagonist.mind.stress).toBe(0);
    expect(admitted.initial.registryOrder).toEqual(initializeWorld(request).origin.initial.registryOrder);
  });

  it("normalizes only declared optional undefined paths", () => {
    const implicit = initializeWorld({ seed: "optional-input", founderCount: 6, townName: undefined, protagonist: undefined });
    expect(implicit.origin.requested).toEqual({ seed: "optional-input", founderCount: 6 });
    const input = frame();
    input.initial.people.p001.deathYear = undefined;
    input.initial.people.p001.lifeState = undefined;
    input.initial.events[0].significance = undefined;
    expect(admitWorldOrigin(input)).toEqual(initializeWorld(request).origin);
    input.initial.events[0].payload.unrelated = undefined;
    expect(() => admitWorldOrigin(input)).toThrow();
  });

  it.each([
    ["people/mind", (x: ReturnType<typeof frame>) => { x.initial.people.p001.mind.facets.altruism++; }],
    ["missing mind field", (x: ReturnType<typeof frame>) => { delete x.initial.people.p001.mind.stress; }],
    ["unknown person field", (x: ReturnType<typeof frame>) => { x.initial.people.p001.extra = 1; }],
    ["event classification", (x: ReturnType<typeof frame>) => { x.initial.events[0].payload.backfilled = false; }],
    ["event order", (x: ReturnType<typeof frame>) => { x.initial.events.reverse(); }],
    ["actor order", (x: ReturnType<typeof frame>) => { const event = x.initial.events.find((e: { actors: string[] }) => e.actors.length > 1); event.actors.reverse(); }],
    ["invented cause", (x: ReturnType<typeof frame>) => { x.initial.events[0].causes.push(x.initial.events[0].id); }],
    ["registry traversal", (x: ReturnType<typeof frame>) => { x.initial.registryOrder.reverse(); }],
    ["duplicate traversal", (x: ReturnType<typeof frame>) => { x.initial.registryOrder[0] = x.initial.registryOrder[1]; }],
    ["initial config", (x: ReturnType<typeof frame>) => { x.initial.config.town.name += "!"; }],
    ["seed", (x: ReturnType<typeof frame>) => { x.requested.seed += "!"; x.effective.seed = x.requested.seed; x.initial.config.seed = x.requested.seed; }],
    ["effective count", (x: ReturnType<typeof frame>) => { x.effective.founderCount++; }],
    ["requested count", (x: ReturnType<typeof frame>) => { x.requested.founderCount++; }],
    ["requested name", (x: ReturnType<typeof frame>) => { x.requested.protagonist.name += "!"; }],
    ["sex draw", (x: ReturnType<typeof frame>) => { x.sex.draw.value = .99; }],
    ["sex stream", (x: ReturnType<typeof frame>) => { x.sex.draw.purpose = "SEX1"; }],
    ["sex choice", (x: ReturnType<typeof frame>) => { x.sex.resolved = x.sex.resolved === "f" ? "m" : "f"; }],
    ["forged initial decision", (x: ReturnType<typeof frame>) => { x.initial.decisions = []; }],
    ["unknown request", (x: ReturnType<typeof frame>) => { x.requested.provider = "rules"; }],
    ["unknown effective", (x: ReturnType<typeof frame>) => { x.effective.callback = "none"; }],
    ["unknown frame", (x: ReturnType<typeof frame>) => { x.extra = true; }],
  ])("rejects recomputed-hash tampering: %s", (_name, change) => {
    const input = frame();
    change(input);
    expect(() => admitWorldOrigin(rehash(input))).toThrow();
  });

  it.each(Object.keys(WORLD_ORIGIN_VERSIONS))("rejects unsupported %s versions with recomputed hash", (axis) => {
    const input = frame();
    input.versions[axis] = "legacy-a-or-future";
    expect(() => admitWorldOrigin(rehash(input))).toThrow(/versions/);
  });

  it("does not confuse consistency with authenticated authorship", () => {
    const alternate = initializeWorld({ ...request, seed: "different-consistent-origin" });
    expect(admitWorldOrigin(alternate.origin)).toEqual(alternate.origin);
    expect(alternate.origin.digest).not.toBe(initializeWorld(request).origin.digest);
  });

  it("rejects missing/wrong digest and noncanonical bytes rather than repairing them", () => {
    const input = frame();
    input.digest = "0".repeat(64);
    expect(() => admitWorldOrigin(input)).toThrow(/digest/);
    delete input.digest;
    expect(() => admitWorldOrigin(input)).toThrow();
    const wire = serializeWorldOrigin(initializeWorld(request).origin);
    for (const alternative of [wire + "\n", JSON.stringify(JSON.parse(wire), null, 2), wire.replace('{"digest":', '{"digest":"duplicate","digest":')]) {
      expect(() => deserializeWorldOrigin(alternative)).toThrow(/Noncanonical/);
    }
    expect(() => deserializeWorldOrigin({ toString() { throw new Error("hook"); } })).toThrow(/wire string/);
  });
});

describe("descriptor-first admission", () => {
  it.each([
    null, [], "seed", {}, { seed: 1 }, { seed: "x", townName: null },
    { seed: "x", founderCount: NaN }, { seed: "x", founderCount: Infinity },
    { seed: "x", founderCount: -1 }, { seed: "x", founderCount: .5 },
    { seed: "x", founderCount: Number.MAX_SAFE_INTEGER + 1 },
    { seed: "x", startYear: Number.MIN_SAFE_INTEGER },
    { seed: "x", endYear: Number.MAX_SAFE_INTEGER + 1 },
    { seed: "x", startYear: 1600 }, { seed: "x", startYear: "1327" },
    { seed: "x", protagonist: {} }, { seed: "x", protagonist: { name: "Mara", sex: "other" } },
    { seed: "x", protagonist: { name: "Mara", sex: "f", extra: undefined } },
    { seed: "x", callback: undefined }, { seed: "x", context: {} },
    { seed: "x", provider: "rules" }, { seed: "x", decisions: [] },
  ])("rejects malformed/unknown initialization input %#", (input) => {
    expect(() => initializeWorld(input)).toThrow();
  });

  it.each(["getter", "toJSON", "iterator", "hidden", "symbol", "prototype", "cycle", "hole", "extended", "array-prototype", "required-undefined", "bigint", "function", "nonfinite"])("rejects %s at input/frame boundaries without executing hooks", (kind) => {
    let hooks = 0;
    const hook = () => { hooks++; throw new Error("Executed hook"); };
    const bad: Record<string | symbol, unknown> = { seed: "x" };
    switch (kind) {
      case "getter": Object.defineProperty(bad, "seed", { enumerable: true, get: hook }); break;
      case "toJSON": bad.toJSON = hook; break;
      case "iterator": bad[Symbol.iterator] = hook; break;
      case "hidden": Object.defineProperty(bad, "hidden", { value: 1 }); break;
      case "symbol": bad[Symbol("x")] = 1; break;
      case "prototype": Object.setPrototypeOf(bad, { get hidden() { return hook(); } }); break;
      case "cycle": bad.extra = bad; break;
      case "hole": bad.extra = new Array(2); break;
      case "extended": bad.extra = Object.assign([], { extra: hook }); break;
      case "array-prototype": bad.extra = Object.setPrototypeOf([], null); break;
      case "required-undefined": bad.seed = undefined; break;
      case "bigint": bad.extra = BigInt(1); break;
      case "function": bad.extra = hook; break;
      case "nonfinite": bad.extra = Infinity; break;
    }
    expect(() => initializeWorld(bad)).toThrow();
    const input = frame();
    input.initial.people.p001.mind = bad;
    expect(() => admitWorldOrigin(input)).toThrow();
    expect(hooks).toBe(0);
  });

  it("rejects nested array index accessors and hidden fields before any read", () => {
    let hooks = 0;
    const array = [1];
    Object.defineProperty(array, "0", { enumerable: true, get() { hooks++; return 1; } });
    expect(() => copyInitializationData(array)).toThrow();
    expect(hooks).toBe(0);
    const input = frame();
    Object.defineProperty(input.versions, "schema", { enumerable: true, get() { hooks++; return WORLD_ORIGIN_VERSIONS.schema; } });
    expect(() => admitWorldOrigin(input)).toThrow();
    expect(hooks).toBe(0);
  });
});

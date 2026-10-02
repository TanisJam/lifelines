import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { generateWorld } from "./worldgen";
import * as simulation from "./simulate";
import { canonicalJson, canonicalHash, createReplayEnvelope, validateReplayEnvelope, replayRules, projectResult, SUPPORTED_REPLAY_VERSIONS } from "./replay";

function fixture(seed = "replay-a") {
  const world = generateWorld({ seed, startYear: 1327, endYear: 1332, founderCount: 6, protagonist: { name: "Alice", sex: "f" } });
  return { ...world, protagonistId: "protagonist" };
}

const roundtrip = <T>(value: T): T => JSON.parse(JSON.stringify(value));

describe("strict canonical JSON", () => {
  it("sorts records, preserves arrays and uses SHA-256 UTF-8", () => {
    expect(canonicalJson({ z: -0, a: [2, 1] })).toBe('{"a":[2,1],"z":0}');
    expect(canonicalHash({ b: 2, a: 1 })).toBe(canonicalHash({ a: 1, b: 2 }));
    expect(canonicalHash([1, 2])).not.toBe(canonicalHash([2, 1]));
    const shared = { x: 1 };
    expect(canonicalJson([shared, shared])).toBe('[{"x":1},{"x":1}]');
    expect(canonicalJson(Object.assign(Object.create(null), shared))).toBe('{"x":1}');
    expect(canonicalHash("é")).toBe("f2886017e9c7abacf804b54d64787dce2b611c9544ba21f3affdd126a6e50086");
    expect(canonicalHash({ text: "é" })).toBe(createHash("sha256").update('{"text":"é"}', "utf8").digest("hex"));
  });
  it.each([undefined, { a: undefined }, [undefined], Array(1), NaN, Infinity, -Infinity, BigInt(1), () => 1, Symbol(), new Date(), new Map(), /x/])("rejects unsupported values (%#)", (value) => {
    expect(() => canonicalJson(value)).toThrow();
  });
  it("rejects cycles, symbol keys, accessors and nonenumerable properties", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    class CustomArray extends Array {}
    for (const value of [cyclic, new CustomArray(), Object.assign([1], { extra: true }), { [Symbol()]: 1 }, Object.defineProperty({}, "a", { get: () => 1, enumerable: true }), Object.defineProperty({}, "a", { value: 1 })]) {
      expect(() => canonicalJson(value)).toThrow();
    }
  });
});

describe("full rules replay", () => {
  it("runs independent complete worlds and restores registry order through canonical JSON", async () => {
    const first = createReplayEnvelope(fixture());
    const second = createReplayEnvelope(fixture());
    expect(first.input.initialEvents.length).toBeGreaterThan(0);
    expect(first.manifest.inputHash).toBe(second.manifest.inputHash);
    const restored = validateReplayEnvelope(JSON.parse(canonicalJson(first)));
    const [a, b] = await Promise.all([replayRules(first), replayRules(restored)]);
    expect(a.outputHash).toBe(b.outputHash);
    expect(a.outputHash).toBe((await replayRules(second)).outputHash);
    for (const decision of a.canonical.decisions) {
      expect(Object.values(decision.final).reduce((sum, p) => sum + p, 0)).toBeCloseTo(1);
    }
    expect(Object.keys(b.report.result.people).slice(0, first.input.registryOrder.length)).toEqual(first.input.registryOrder);
    expect(a.diagnostics.node).toBe(process.version);
    expect(a.diagnostics.v8).toBe(process.versions.v8);
  });
  it("captures complete state, config, protagonist and actual traversal order", async () => {
    const world = fixture();
    const base = createReplayEnvelope(world);
    const reversed = { ...world, people: Object.fromEntries(Object.entries(world.people).reverse()) };
    expect(canonicalHash(world.people)).toBe(canonicalHash(reversed.people));
    const reversedEnvelope = createReplayEnvelope(reversed);
    expect(reversedEnvelope.manifest.inputHash).not.toBe(base.manifest.inputHash);
    const restoredRun = await replayRules(JSON.parse(canonicalJson(reversedEnvelope)));
    expect(Object.keys(restoredRun.report.result.people).slice(0, reversedEnvelope.input.registryOrder.length)).toEqual(reversedEnvelope.input.registryOrder);
    expect(createReplayEnvelope({ ...world, events: [...world.events].reverse() }).manifest.inputHash).not.toBe(base.manifest.inputHash);
    expect(createReplayEnvelope({ ...world, overrides: [], fromYear: 1327, engineSource: "rules" }).manifest.inputHash).toBe(base.manifest.inputHash);
    const variants = [fixture("other"), { ...world, config: { ...world.config, endYear: 1333 } }, { ...world, protagonistId: null }];
    for (const variant of variants) expect(createReplayEnvelope(variant).manifest.inputHash).not.toBe(base.manifest.inputHash);
    const altered = roundtrip(world);
    altered.people.protagonist!.mind.memories.push({ year: 1327, text: "remembered words", emotion: "hope", core: false });
    expect(createReplayEnvelope(altered).manifest.inputHash).not.toBe(base.manifest.inputHash);
    altered.events[0] = { ...altered.events[0]!, payload: { changed: true } };
    expect(createReplayEnvelope(altered).manifest.inputHash).not.toBe(createReplayEnvelope({ ...altered, events: world.events }).manifest.inputHash);
  });
  it("never aliases or mutates caller inputs, envelopes or projections", async () => {
    const world = fixture();
    const before = canonicalJson(world);
    const envelope = createReplayEnvelope(world);
    const envelopeBefore = canonicalJson(envelope);
    const run = await replayRules(envelope);
    expect(canonicalJson(world)).toBe(before);
    expect(canonicalJson(envelope)).toBe(envelopeBefore);
    run.report.result.people.protagonist!.mind.stress = 99;
    expect(envelope.input.initialPeople.protagonist!.mind.stress).not.toBe(99);
    expect(canonicalHash(run.canonical)).toBe(run.outputHash);
  });
  it.each(Object.keys(SUPPORTED_REPLAY_VERSIONS))("rejects unsupported or missing %s version before running", async (axis) => {
    const simulateSpy = vi.spyOn(simulation, "simulate");
    try {
      for (const missing of [false, true]) {
        const envelope = roundtrip(createReplayEnvelope(fixture()));
        const versions = envelope.manifest.versions as Record<string, unknown>;
        if (missing) delete versions[axis]; else versions[axis] = "unknown";
        await expect(replayRules(envelope)).rejects.toThrow(/version/);
      }
      expect(simulateSpy).not.toHaveBeenCalled();
    } finally {
      simulateSpy.mockRestore();
    }
  });
  it("rejects missing provenance and tampering without readmission", async () => {
    const base = createReplayEnvelope(fixture());
    const mutations: ((e: ReturnType<typeof createReplayEnvelope>) => void)[] = [
      (e) => { Reflect.deleteProperty(e, "manifest"); }, (e) => { Reflect.deleteProperty(e.manifest, "inputHash"); },
      (e) => { e.manifest.inputHash = "0".repeat(64); }, (e) => { e.manifest.seed = "other"; },
      (e) => { e.manifest.configHash = "0".repeat(64); }, (e) => { e.input.config = { ...e.input.config, endYear: e.input.config.endYear + 1 }; },
      (e) => { e.input.initialEvents = e.input.initialEvents.map((event, i) => i === 0 ? { ...event, payload: { altered: true } } : event); },
      (e) => { e.input.initialPeople.protagonist.mind.stress++; },
      (e) => { e.input.registryOrder.reverse(); }, (e) => { Reflect.set(e.input.options, "engineSource", "jev"); },
    ];
    for (const mutate of mutations) {
      const envelope = roundtrip(base); mutate(envelope);
      await expect(replayRules(envelope)).rejects.toThrow();
    }
  });
  it("rejects unsupported modes and malformed basic domain structures at creation", () => {
    const world = fixture();
    for (const mode of [{ overrides: [{ id: "x" }] }, { fromYear: 1328 }, { engineSource: "jev" }, { concurrencyLimit: 1 }, { director: true }]) {
      expect(() => createReplayEnvelope({ ...world, ...mode } as never)).toThrow();
    }
    for (const malformed of [{ ...world, config: { ...world.config, endYear: 1326 } }, { ...world, people: {} }, { ...world, events: [{ id: "x" }] }, { ...world, protagonistId: "missing" }]) {
      expect(() => createReplayEnvelope(malformed as never)).toThrow();
    }
    const broken = roundtrip(world); broken.people.protagonist!.mind = {} as never;
    expect(() => createReplayEnvelope(broken)).toThrow();
  });
  it.each([
    { label: "array", bond: ["friend"] },
    { label: "nested array", bond: [["friend"]] },
    { label: "object", bond: {} },
    { label: "number", bond: 1 },
    { label: "null", bond: null },
    { label: "boolean", bond: true },
    { label: "unknown string", bond: "unknown" },
  ])("rejects rehashed non-string relationship bond: $label", async ({ bond }) => {
    const envelope = createReplayEnvelope(fixture());
    envelope.input.initialPeople.protagonist!.mind.relationships = [
      { personId: envelope.input.registryOrder[0]!, bond: "friend", strength: 10 },
    ];
    Reflect.set(envelope.input.initialPeople.protagonist!.mind.relationships[0]!, "bond", bond);
    envelope.manifest.inputHash = canonicalHash(envelope.input);
    expect(() => validateReplayEnvelope(envelope)).toThrow(/invalid bond/);
    expect(() => validateReplayEnvelope(roundtrip(envelope))).toThrow(/invalid bond/);
    await expect(replayRules(envelope)).rejects.toThrow(/invalid bond/);
  });
  it("retains supported string bonds through roundtrip admission", () => {
    for (const bond of ["kin", "friend", "lover", "spouse", "rival", "grudge"] as const) {
      const envelope = createReplayEnvelope(fixture());
      envelope.input.initialPeople.protagonist!.mind.relationships = [
        { personId: envelope.input.registryOrder[0]!, bond, strength: 10 },
      ];
      envelope.manifest.inputHash = canonicalHash(envelope.input);
      expect(validateReplayEnvelope(roundtrip(envelope))).toEqual(envelope);
    }
    expect(() => createReplayEnvelope({ ...fixture(), unknownOption: true } as never)).toThrow(/unsupported fields/);
  });
  it.each(["config", "people", "events", "protagonistId", "overrides", "fromYear", "engineSource"])("rejects source %s accessor without invoking it", (field) => {
    const values = { ...fixture(), overrides: [], fromYear: 1327, engineSource: "rules" as const };
    const source = { ...values };
    const getter = vi.fn(() => Reflect.get(values, field));
    Object.defineProperty(source, field, { get: getter, enumerable: true });
    expect(() => canonicalJson(source)).toThrow(/own data/);
    expect(getter).not.toHaveBeenCalled();
    expect(() => createReplayEnvelope(source)).toThrow(/own data/);
    expect(getter).not.toHaveBeenCalled();
  });
  it("rejects nested config accessor before consulting full-run options", () => {
    const source = { ...fixture(), fromYear: 1327 };
    source.config = { ...source.config };
    const getter = vi.fn(() => 1327);
    Object.defineProperty(source.config, "startYear", { get: getter, enumerable: true });
    expect(() => createReplayEnvelope(source)).toThrow(/own data/);
    expect(getter).not.toHaveBeenCalled();
  });
  it("rejects malformed rehashed inputs: hashes are not semantic validation", () => {
    const base = createReplayEnvelope(fixture());
    const mutations: ((e: typeof base) => void)[] = [
      (e) => { e.input.config = { ...e.input.config, startYear: 1335 }; },
      (e) => { Reflect.set(e.input.initialPeople.protagonist!, "sex", "unknown"); },
      (e) => { Reflect.set(e.input.initialPeople.protagonist!, "lifeState", null); },
      (e) => { Reflect.set(e.input.initialPeople.protagonist!.mind, "facets", {}); },
      (e) => { e.input.initialEvents = [{ ...e.input.initialEvents[0]!, actors: ["missing"] }]; },
      (e) => { e.input.registryOrder.push(e.input.registryOrder[0]!); },
    ];
    for (const mutate of mutations) {
      const envelope = roundtrip(base);
      mutate(envelope);
      envelope.manifest.configHash = canonicalHash(envelope.input.config);
      envelope.manifest.inputHash = canonicalHash(envelope.input);
      expect(() => validateReplayEnvelope(envelope)).toThrow();
    }
  });
  it("omits presentation and runtime diagnostics including forced nonfinite diagnostics", async () => {
    const { report, outputHash } = await replayRules(createReplayEnvelope(fixture()));
    expect(report.result.decisions.length).toBeGreaterThan(0);
    report.result.events[0]!.significance = Infinity;
    const changed = { ...report.result, decisions: report.result.decisions.map((d) => ({
      ...d, question: "changed", options: d.options.map((o) => ({ ...o, label: "changed" })),
      fragility: Infinity, noise: { x: NaN }, surprise: !d.surprise, jevRaw: undefined,
    })) };
    Reflect.set(report, "wallTimeMs", Infinity);
    Reflect.set(report, "decisionCalls", -1);
    Reflect.set(report, "hazardFallbacks", { diagnostic: NaN });
    expect(canonicalHash(projectResult(changed))).toBe(outputHash);
    const chosenChanged = { ...changed, decisions: changed.decisions.map((d, i) => i === 0 ? { ...d, chosen: "altered" } : d) };
    expect(canonicalHash(projectResult(chosenChanged))).not.toBe(outputHash);
    const forced = { ...changed, decisions: [{ ...changed.decisions[0]!, source: "forced" as const, final: { [changed.decisions[0]!.chosen]: 1 }, partnerId: undefined, fragility: Infinity }] };
    const finiteForced = { ...forced, decisions: forced.decisions.map((d) => ({ ...d, fragility: 0, noise: {} })) };
    expect(canonicalHash(projectResult(forced))).toBe(canonicalHash(projectResult(finiteForced)));
    const projection = projectResult(changed);
    expect(canonicalJson(projection)).not.toContain("fragility");
    expect(canonicalJson(projection)).not.toContain("significance");
  });
});

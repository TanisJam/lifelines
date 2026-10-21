import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runLifecycle } from "./e-lifecycle-run";
import { canonicalLifecycleData, createLifecycleGenesis } from "./e-lifecycle-genesis";
import { initializeWorld } from "./world-origin";
import * as runtimeModule from "./e-lifecycle-runtime";
import * as capsuleModule from "./e-lifecycle-capsule";
import * as sourceModule from "./e-year-source";

function genesis(seed = "baseline-1327-0", normal = false) {
  const initialization = normal
    ? { seed, protagonist: { name: "Alice", sex: "f" } }
    : { seed, startYear: 1327, endYear: 1327, founderCount: 6, protagonist: { name: "Alice", sex: "f" } };
  const { world } = initializeWorld(initialization);
  return createLifecycleGenesis({ initialization, protagonistId: "protagonist",
    resources: Object.fromEntries(Object.keys(world.people).map(id => [id, { grain: 2, effort: 3, need: 1 }])) });
}
type Mutable<T> = T extends object ? { -readonly [K in keyof T]: Mutable<T[K]> } : T;
type Capsule = capsuleModule.LifecycleCapsule;
function rehash(capsule: Mutable<Capsule>) {
  const payload = canonicalLifecycleData({ genesis: capsule.genesis, output: capsule.output });
  capsule.digest = createHash("sha256")
    .update(JSON.stringify([canonicalLifecycleData(capsule.manifest), payload]), "utf8").digest("hex");
}
function ownership(capsule: Capsule) {
  const { output } = capsule;
  expect(output.owned.people === output.favors.people).toBe(true);
  expect(output.owned.events === output.favors.legacyEvents).toBe(true);
  expect(Object.isFrozen(output.owned.people)).toBe(true);
  for (const entry of output.journal) {
    expect(entry.final.owned.people === entry.final.favors.people).toBe(true);
    expect(entry.postNative.owned.people === entry.postNative.favors.people).toBe(true);
  }
}
function fidelity(actual: unknown, expected: unknown, path = "root"): void {
  if (expected === null || typeof expected !== "object") {
    if (!Object.is(actual, expected)) throw new Error(`Leaf disagreement at ${path}`);
    return;
  }
  if (actual === null || typeof actual !== "object" || Array.isArray(actual) !== Array.isArray(expected)) {
    throw new Error(`Container disagreement at ${path}`);
  }
  const a = actual as Record<string, unknown>;
  const e = expected as Record<string, unknown>;
  if (JSON.stringify(Object.keys(a).sort()) !== JSON.stringify(Object.keys(e).sort())) throw new Error(`Keys disagree at ${path}`);
  for (const key of Object.keys(e)) fidelity(a[key], e[key], `${path}.${key}`);
}
function identity(value: unknown) {
  return createHash("sha256").update(canonicalLifecycleData(value)).digest("hex");
}
afterEach(() => vi.restoreAllMocks());

describe("controller", () => {
  it("certifies zero budget without manufacturing a year or completion", async () => {
    const g = genesis();
    const result = await runLifecycle({ kind: "start", genesis: g }, { maxSteps: 0 });
    expect(result.status).toBe("incomplete");
    if (result.status !== "incomplete") throw new Error("Expected budget result");
    expect(result.reason).toBe("budget");
    expect(result.capsule.output.frontier).toBe(1326);
    expect(result.capsule.output.journal.length).toBe(0);
  });
  it("start and cold resume equal uninterrupted native execution, including budget beyond origin horizon", async () => {
    const g = genesis("baseline-1327-1");
    const first = await runLifecycle({ kind: "start", genesis: g }, { maxSteps: 1 });
    expect(first.status).toBe("incomplete");
    const cold = await capsuleModule.deserializeLifecycleCapsule(await capsuleModule.serializeLifecycleCapsule(first.capsule));
    const resumed = await runLifecycle({ kind: "resume", capsule: cold }, { maxSteps: 1 });
    const uninterrupted = await runLifecycle({ kind: "start", genesis: g }, { maxSteps: 2 });
    expect(resumed.status).toBe("incomplete");
    expect(resumed.capsule.output.frontier).toBe(1328);
    expect(identity(resumed.capsule)).toBe(identity(uninterrupted.capsule));
    const direct = runtimeModule.createLifecycleRuntime(g);
    await direct.advance(1327);
    await direct.advance(1328);
    fidelity(resumed.capsule.output, direct.snapshot());
    ownership(resumed.capsule);
    expect(JSON.stringify(Object.keys(resumed.capsule.output.owned.people)))
      .toBe(JSON.stringify(Object.keys(direct.snapshot().owned.people)));
  });
  it("zero new steps resumes the whole certified prefix rather than initial state", async () => {
    const first = await runLifecycle({ kind: "start", genesis: genesis("baseline-1327-1") }, { maxSteps: 1 });
    const resumed = await runLifecycle({ kind: "resume", capsule: first.capsule }, { maxSteps: 0 });
    expect(identity(resumed.capsule)).toBe(identity(first.capsule));
    expect(resumed.capsule === first.capsule).toBe(false);
  });
  it("reuses a genuinely complete admitted capsule without a continuation owner", async () => {
    const completed = await runLifecycle({ kind: "start", genesis: genesis() }, { maxSteps: 4 });
    expect(completed.status).toBe("complete");
    const create = vi.spyOn(runtimeModule, "createLifecycleRuntime");
    const reused = await runLifecycle({ kind: "resume", capsule: completed.capsule }, { maxSteps: 20 });
    // One runtime for LR2 admission only; no controller continuation owner.
    expect(create.mock.calls.length).toBe(1);
    expect(identity(reused.capsule)).toBe(identity(completed.capsule));
  });
  it.each([-1, -0, NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1, undefined, "1"])
    ("rejects invalid budget %s", async maxSteps => {
      await expect(runLifecycle({ kind: "start", genesis: genesis() }, { maxSteps } as never)).rejects.toThrow();
    });
  it.each([null, [], {}, { kind: "unknown" }, { kind: "start" }, { kind: "resume" },
    { kind: "start", genesis: undefined }, { kind: "resume", capsule: undefined }])
    ("rejects invalid authority envelope %j", async input => {
      await expect(runLifecycle(input, { maxSteps: 0 })).rejects.toThrow();
    });
  it("rejects extra authority/options and fake native signal, with zero accessor calls", async () => {
    const g = genesis();
    let reads = 0;
    const hostile = { kind: "start", genesis: g };
    Object.defineProperty(hostile, "extra", { enumerable: true, get() { reads++; throw new Error("getter"); } });
    await expect(runLifecycle(hostile, { maxSteps: 0 })).rejects.toThrow();
    const options = Object.defineProperty({}, "maxSteps", { enumerable: true, get() { reads++; return 0; } });
    await expect(runLifecycle({ kind: "start", genesis: g }, options as never)).rejects.toThrow();
    const fakeSignal = Object.defineProperty({}, "aborted", { get() { reads++; return false; } });
    await expect(runLifecycle({ kind: "start", genesis: g }, { maxSteps: 0, signal: fakeSignal } as never)).rejects.toThrow();
    await expect(runLifecycle({ kind: "start", genesis: g, resolver: null }, { maxSteps: 0 })).rejects.toThrow();
    await expect(runLifecycle({ kind: "start", genesis: g }, { maxSteps: 0, onYear: null } as never)).rejects.toThrow();
    expect(reads).toBe(0);
  });
  it("rejects hidden, symbolic, cyclic, executable and nonfinite authority data before execution", async () => {
    const g = genesis();
    const cases: unknown[] = [Object.assign({ kind: "start", genesis: g }, { [Symbol("extra")]: 1 }),
      Object.defineProperty({ kind: "start", genesis: g }, "hidden", { value: 1 }),
      { kind: "start", genesis: g, extra: () => 0 }, { kind: "start", genesis: g, extra: Infinity }];
    const cyclic: Record<string, unknown> = { kind: "start", genesis: g };
    cyclic.extra = cyclic;
    cases.push(cyclic);
    const create = vi.spyOn(runtimeModule, "createLifecycleRuntime");
    for (const input of cases) await expect(runLifecycle(input, { maxSteps: 0 })).rejects.toThrow();
    expect(create.mock.calls.length).toBe(0);
  });
  it("fully rejects a forged, rehashed resume and invalid genesis", async () => {
    const first = await runLifecycle({ kind: "start", genesis: genesis("baseline-1327-1") }, { maxSteps: 1 });
    const forged = structuredClone(first.capsule as unknown) as Mutable<Capsule>;
    forged.output.owned.counters.decisionCalls++;
    rehash(forged);
    await expect(runLifecycle({ kind: "resume", capsule: forged }, { maxSteps: 0 })).rejects.toThrow();
    const invalid = structuredClone(genesis() as unknown) as Mutable<ReturnType<typeof genesis>>;
    invalid.initial.people.protagonist.name = "Forged";
    const { digest: ignored, ...payload } = invalid;
    void ignored;
    invalid.digest = identity(payload);
    await expect(runLifecycle({ kind: "start", genesis: invalid }, { maxSteps: 0 })).rejects.toThrow();
  });
  it("compares reconstructed owner with the full admitted prefix before continuation", async () => {
    const first = await runLifecycle({ kind: "start", genesis: genesis("baseline-1327-1") }, { maxSteps: 1 });
    const real = runtimeModule.createLifecycleRuntime;
    let owners = 0;
    vi.spyOn(runtimeModule, "createLifecycleRuntime").mockImplementation(input => {
      const owner = real(input);
      if (++owners !== 2) return owner; // first is the real cold-admission replay
      return { ...owner, snapshot: () => ({ ...owner.snapshot(), frontier: 1326 }) };
    });
    await expect(runLifecycle({ kind: "resume", capsule: first.capsule }, { maxSteps: 1 }))
      .rejects.toThrow("resume reconstruction disagreement");
  });
  it("captures start/resume and options before the first await and preserves caller data", async () => {
    const g = structuredClone(genesis("baseline-1327-1") as unknown) as Mutable<ReturnType<typeof genesis>>;
    const initialIdentity = identity(g);
    const envelope = { kind: "start", genesis: g };
    const options = { maxSteps: 1, signal: undefined };
    const running = runLifecycle(envelope, options);
    g.initial.people.protagonist.name = "Mutated";
    envelope.kind = "unknown";
    options.maxSteps = 0;
    const first = await running;
    expect(identity(first.capsule.genesis)).toBe(initialIdentity);
    expect(first.capsule.output.frontier).toBe(1327);
    const candidate = structuredClone(first.capsule as unknown) as Mutable<Capsule>;
    const before = identity(candidate);
    const resuming = runLifecycle({ kind: "resume", capsule: candidate }, { maxSteps: 0 });
    candidate.output.owned.people.protagonist.name = "Changed during admission";
    expect(identity((await resuming).capsule)).toBe(before);
    expect(Object.isFrozen(g)).toBe(false);
  });
  it("preserves complete property presence, signed zero, actual snapshots and detached aliases", async () => {
    const initialization = { seed: "verify-5", founderCount: 6, startYear: 1327, endYear: 1332,
      protagonist: { name: "Mara", sex: "random" } };
    const { world } = initializeWorld(initialization);
    const g = createLifecycleGenesis({ initialization, protagonistId: "protagonist",
      resources: Object.fromEntries(Object.keys(world.people).map(id => [id, { grain: 2, effort: 3, need: 1 }])) });
    const direct = runtimeModule.createLifecycleRuntime(g);
    const expected = await direct.advance(1327);
    const result = await runLifecycle({ kind: "start", genesis: g }, { maxSteps: 1, signal: undefined });
    fidelity(result.capsule.output, expected);
    ownership(result.capsule);
    expect(result.capsule.output.owned.people === expected.owned.people).toBe(false);
    expect(result.capsule.genesis === g).toBe(false);
    expect(Object.isFrozen(result)).toBe(true);
    let zeros = 0;
    let undefineds = 0;
    function leaves(value: unknown): void {
      if (Object.is(value, -0)) zeros++;
      if (value === undefined) undefineds++;
      if (value !== null && typeof value === "object") Object.values(value).forEach(leaves);
    }
    leaves(result.capsule);
    expect(zeros).toBeGreaterThan(0);
    expect(undefineds).toBeGreaterThan(0);
  });
  it("observes prior abort but still certifies the zero-year capsule", async () => {
    const controller = new AbortController();
    controller.abort("custom reason");
    const result = await runLifecycle({ kind: "start", genesis: genesis() }, { maxSteps: 4, signal: controller.signal });
    expect(result.status).toBe("aborted");
    expect(result.capsule.output.frontier).toBe(1326);
    expect(identity(await capsuleModule.admitLifecycleCapsule(result.capsule))).toBe(identity(result.capsule));
  });
  it("yields to abort timers between committed years, not just microtasks", async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 0);
    try {
      const result = await runLifecycle({ kind: "start", genesis: genesis("baseline-1327-1") }, { maxSteps: 4, signal: controller.signal });
      expect(result.status).toBe("aborted");
      expect(result.capsule.output.frontier).toBe(1327);
      expect(result.capsule.output.status).toBe("incomplete");
    } finally { clearTimeout(timer); }
  });
  it("in-flight abort waits for the closed native death year and wins over completion", async () => {
    const controller = new AbortController();
    const real = sourceModule.createRulesYearSource;
    let executions = 0;
    vi.spyOn(sourceModule, "createRulesYearSource").mockImplementation((...args) => {
      const source = real(...args);
      return { ...source, execute: async year => {
        const output = await source.execute(year);
        if (++executions === 1) controller.abort();
        return output;
      } };
    });
    const result = await runLifecycle({ kind: "start", genesis: genesis() }, { maxSteps: 4, signal: controller.signal });
    expect(result.status).toBe("aborted");
    expect(result.capsule.output.status).toBe("complete");
    expect(result.capsule.output.frontier).toBe(1327);
    expect(executions).toBe(2); // committed native year plus full capsule certification
  });
  it("abort during certification and completed resume remains producer cancellation", async () => {
    const completed = await runLifecycle({ kind: "start", genesis: genesis() }, { maxSteps: 4 });
    const controller = new AbortController();
    const real = capsuleModule.admitLifecycleCapsule;
    vi.spyOn(capsuleModule, "admitLifecycleCapsule").mockImplementation(async input => {
      const certified = await real(input);
      controller.abort();
      return certified;
    });
    const result = await runLifecycle({ kind: "resume", capsule: completed.capsule }, { maxSteps: 0, signal: controller.signal });
    expect(result.status).toBe("aborted");
    expect(result.capsule.output.status).toBe("complete");
  });
  it("propagates native and certification errors unchanged, even with abort", async () => {
    const error = new Error("native failure");
    const controller = new AbortController();
    const real = sourceModule.createRulesYearSource;
    const spy = vi.spyOn(sourceModule, "createRulesYearSource").mockImplementation((...args) => {
      const source = real(...args);
      return { ...source, execute: async () => { controller.abort(); throw error; } };
    });
    await expect(runLifecycle({ kind: "start", genesis: genesis() }, { maxSteps: 1, signal: controller.signal })).rejects.toBe(error);
    spy.mockRestore();
    vi.spyOn(capsuleModule, "createLifecycleCapsule").mockRejectedValue(error);
    await expect(runLifecycle({ kind: "start", genesis: genesis() }, { maxSteps: 0, signal: controller.signal })).rejects.toBe(error);
  });
});

it("LIFEsmoke genuine unforced death and cold LR2b ownership", async () => {
  const g = genesis();
  let producer: Awaited<ReturnType<typeof runLifecycle>> | undefined = await runLifecycle({ kind: "start", genesis: g }, { maxSteps: 4 });
  expect(producer.status).toBe("complete");
  const death = producer.capsule.output.owned.people.protagonist.deathYear;
  const frontier = producer.capsule.output.frontier;
  expect(frontier).toBe(death);
  expect(frontier).toBeGreaterThanOrEqual(1327);
  expect(frontier).toBeLessThanOrEqual(1330);
  const actual = runtimeModule.createLifecycleRuntime(g);
  for (let year = 1327; year <= frontier; year++) await actual.advance(year);
  fidelity(producer.capsule.output.canonicalYearSnapshot, actual.snapshot().canonicalYearSnapshot);
  const canon = identity(producer.capsule);
  const order = JSON.stringify(Object.keys(producer.capsule.output.owned.people));
  const wire = await capsuleModule.serializeLifecycleCapsule(producer.capsule);
  producer = undefined;
  const cold = await capsuleModule.deserializeLifecycleCapsule(wire);
  expect(identity(cold)).toBe(canon);
  expect(JSON.stringify(Object.keys(cold.output.owned.people))).toBe(order);
  ownership(cold);
  const zero = await runLifecycle({ kind: "start", genesis: g }, { maxSteps: 0 });
  const resumed = await runLifecycle({ kind: "resume", capsule: zero.capsule }, { maxSteps: 4 });
  expect(identity(resumed.capsule)).toBe(canon);
  // This mandated seed dies in its first year. A separate alive seed proves
  // continuation beyond 1327 above; do not mislabel the smoke as beyond-horizon death.
  process.stdout.write(`LIFEsmoke ${JSON.stringify({ frontier: cold.output.frontier, death, wireBytes: Buffer.byteLength(wire) })}\n`);
});

// Predeclared workload, not an adaptive survivor/death search. Never reorder,
// extend, shrink or substitute members after observing any outcome.
const REPRESENTATIVE_COHORT = Object.freeze([
  "lifecycle-representative-v1/0",
  "lifecycle-representative-v1/1",
  "lifecycle-representative-v1/2",
  "lifecycle-representative-v1/3",
  "lifecycle-representative-v1/4",
]);

it("LIFErepresentative predeclared default62 cohort: unforced lives and cold certification", async () => {
  const cohortStarted = performance.now();
  const outcomes: { seed: string; status: string; frontier: number; years: number; deathYear: number | null;
    initialPeople: number; wireBytes: number; coldVerified: boolean }[] = [];
  process.stdout.write(`LIFErepresentative ${JSON.stringify({ boundary: "cohort-plan", seeds: REPRESENTATIVE_COHORT,
    startYear: 1498, endYear: 1558, founderCount: 62, protagonist: "Alice/f age0", resources: [2, 3, 1], maxSteps: 128 })}\n`);
  const realRuntime = runtimeModule.createLifecycleRuntime;
  const realCertification = capsuleModule.createLifecycleCapsule;
  let seed = "";
  let started = cohortStarted;
  let phase = "initialization";
  let frontier = 1497;
  let ownerIndex = 0;
  function metrics(boundary: string, wireBytes?: number) {
    const memory = process.memoryUsage();
    process.stdout.write(`LIFErepresentative ${JSON.stringify({ seed, phase, boundary, ownerIndex, frontier,
      elapsedMs: Math.round(performance.now() - started), cohortElapsedMs: Math.round(performance.now() - cohortStarted),
      rss: memory.rss, heapUsed: memory.heapUsed, heapTotal: memory.heapTotal, wireBytes: wireBytes ?? null })}\n`);
  }
  // All owners, including certification/cold replay, call through unchanged.
  // Instrumentation owns no state or production callback/authority surface.
  vi.spyOn(runtimeModule, "createLifecycleRuntime").mockImplementation(input => {
    const owner = realRuntime(input);
    ownerIndex++;
    frontier = owner.initial.frontier;
    return { ...owner, advance: async year => {
      const output = await owner.advance(year);
      frontier = output.frontier;
      if (output.journal.length % 5 === 0 || output.status === "complete") metrics("committed-progress");
      return output;
    } };
  });
  vi.spyOn(capsuleModule, "createLifecycleCapsule").mockImplementation(async input => {
    metrics("execution-end");
    phase = "certification";
    metrics("phase-start");
    const capsule = await realCertification(input);
    metrics("phase-end");
    return capsule;
  });

  for (const member of REPRESENTATIVE_COHORT) {
    seed = member;
    started = performance.now();
    phase = "initialization";
    frontier = 1497;
    ownerIndex = 0;
    metrics("phase-start");
    try {
      const g = genesis(seed, true);
      expect(g.origin.effective.founderCount).toBe(62);
      expect(g.initial.config.startYear).toBe(1498);
      expect(g.initial.config.endYear).toBe(1558);
      expect(g.initial.people.protagonist.birthYear).toBe(1498);
      expect(g.initial.people.protagonist.name).toBe("Alice");
      expect(g.initial.people.protagonist.sex).toBe("f");
      metrics("phase-end");
      phase = "execution";
      metrics("phase-start");
      let producer: Awaited<ReturnType<typeof runLifecycle>> | undefined =
        await runLifecycle({ kind: "start", genesis: g }, { maxSteps: 128 });
      expect(producer.status).toBe(producer.capsule.output.status);
      const deathYear = producer.capsule.output.owned.people.protagonist.deathYear;
      const years = producer.capsule.output.journal.length;
      const finalFrontier = producer.capsule.output.frontier;
      if (producer.status === "complete") expect(finalFrontier).toBe(deathYear);
      else {
        expect(producer.status).toBe("incomplete");
        expect(years).toBe(128);
        expect(finalFrontier).toBe(1497 + 128);
        expect(deathYear).toBeUndefined();
      }
      const canon = identity(producer.capsule);
      const actualSnapshot = identity(producer.capsule.output.canonicalYearSnapshot);
      const order = JSON.stringify(Object.keys(producer.capsule.output.owned.people));
      phase = "serialization";
      metrics("phase-start");
      const wire = await capsuleModule.serializeLifecycleCapsule(producer.capsule);
      const wireBytes = Buffer.byteLength(wire);
      producer = undefined;
      metrics("phase-end-producer-dropped", wireBytes);
      phase = "cold-replay";
      metrics("phase-start", wireBytes);
      const cold = await capsuleModule.deserializeLifecycleCapsule(wire);
      expect(identity(cold)).toBe(canon);
      expect(identity(cold.output.canonicalYearSnapshot)).toBe(actualSnapshot);
      expect(JSON.stringify(Object.keys(cold.output.owned.people))).toBe(order);
      expect(cold.output.frontier).toBe(finalFrontier);
      expect(cold.output.owned.people.protagonist.deathYear).toBe(deathYear);
      ownership(cold);
      metrics("phase-end-verified", wireBytes);
      const outcome = { seed, status: cold.output.status, frontier: finalFrontier, years,
        deathYear: deathYear ?? null, initialPeople: g.initial.registryOrder.length, wireBytes, coldVerified: true };
      outcomes.push(outcome);
      process.stdout.write(`LIFErepresentative ${JSON.stringify({ boundary: "member-outcome", ...outcome,
        beyondOriginHorizon: finalFrontier > 1558 })}\n`);
    } catch (error) {
      // Any resource/implementation/semantic failure stops the cohort immediately.
      // Fatal OOM cannot be caught: the preceding plan/progress still identifies pending members.
      metrics("member-failure-stop");
      process.stdout.write(`LIFErepresentative ${JSON.stringify({ boundary: "cohort-stopped", outcomes,
        failedMember: seed, pendingMembers: REPRESENTATIVE_COHORT.slice(outcomes.length + 1),
        error: error instanceof Error ? error.message : "non-Error failure" })}\n`);
      throw error;
    }
  }
  const longComplete = outcomes.filter(member => member.status === "complete" && member.years >= 60 && member.coldVerified);
  expect(outcomes.map(member => member.seed)).toEqual(REPRESENTATIVE_COHORT);
  expect(outcomes.every(member => member.coldVerified)).toBe(true);
  expect(outcomes.every(member => member.frontier >= 1499)).toBe(true);
  process.stdout.write(`LIFErepresentative ${JSON.stringify({ boundary: "cohort-outcomes", outcomes,
    longCompleteMembers: longComplete.map(member => member.seed), pendingMembers: [] })}\n`);
  // Human decision 2026-10-21 ("Integrar LC1, gate como metrica"): lifespan-scale
  // coverage is a REPORTED metric under CQ1 for the new-engine MVP, not an
  // assertion. Nothing is skipped: the predeclared cohort always runs in order,
  // every member is cold-verified above, and an unproved 60-year life is printed.
  if (longComplete.length === 0) {
    process.stdout.write(`LIFErepresentative ${JSON.stringify({ boundary: "coverage-open",
      reason: "no >=60-year unforced complete cold-replayed member", trackedAs: "CQ1" })}\n`);
  }
}, 600000);

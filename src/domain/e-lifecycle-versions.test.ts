import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { admitLifecycleCapsule, createLifecycleCapsule, LIFECYCLE_CAPSULE_MANIFEST } from "./e-lifecycle-capsule";
import { createLifecycleGenesis, admitLifecycleGenesis, canonicalLifecycleData, LIFECYCLE_THREAD_VERSIONS } from "./e-lifecycle-genesis";
import { createLifecycleRuntime } from "./e-lifecycle-runtime";
import { replayLifecycleRuntime } from "./e-lifecycle-replay";
import { runLifecycle } from "./e-lifecycle-run";
import { initializeWorld } from "./world-origin";

const initialization = { seed: "thread-versions", startYear: 1327, endYear: 1327, founderCount: 6, protagonist: { name: "Alice", sex: "f" as const } };
function input() {
  const { world } = initializeWorld(initialization);
  return { initialization, protagonistId: "protagonist", resources: Object.fromEntries(Object.keys(world.people).map(id => [id, { grain: 2, effort: 3, need: 1 }])) };
}

describe("lifecycle execution versions", () => {
  it("explicitly selects and admits the thread profile while preserving the old default", () => {
    const old = createLifecycleGenesis(input());
    const next = createLifecycleGenesis({ ...input(), versions: LIFECYCLE_THREAD_VERSIONS });
    expect(next.versions).toEqual(LIFECYCLE_THREAD_VERSIONS);
    expect(admitLifecycleGenesis(next)).toEqual(next);
    expect(old.versions).not.toEqual(next.versions);
    expect(createLifecycleRuntime(old).initial).not.toHaveProperty("threads");
    expect(createLifecycleRuntime(next).initial).toHaveProperty("threads", { version: "thread-state-1", threads: [] });
  });
  it("round trips one year and agrees across audit and compact state", async () => {
    const genesis = createLifecycleGenesis({ ...input(), versions: LIFECYCLE_THREAD_VERSIONS });
    const audit = createLifecycleRuntime(genesis);
    const compact = createLifecycleRuntime(genesis, { journal: "compact" });
    const a = await audit.advance(1327);
    const c = await compact.advance(1327);
    expect(a.threads).toEqual(c.threads);
    expect(a.owned).toEqual(c.owned);
    expect(a.favors).toEqual(c.favors);
    expect(a.owned.people).toBe(a.favors.people);
    expect(c.owned.people).toBe(c.favors.people);
    expect(a.journal[0].threadBeats).toEqual({ version: "thread-beats-1", beats: [] });
    expect(c.journal[0].threadBeats).toEqual(a.journal[0].threadBeats);
    expect(await replayLifecycleRuntime({ genesis, output: a })).toEqual(a);
    expect(await replayLifecycleRuntime({ genesis, output: c }, "compact")).toEqual(c);
    const mixed = structuredClone(a);
    Object.assign(mixed.journal[0].versions, { runtime: "foreign" });
    await expect(replayLifecycleRuntime({ genesis, output: mixed })).rejects.toThrow(/disagreement/);
    const before = audit.snapshot();
    await expect(audit.advance(1329)).rejects.toThrow();
    expect(audit.snapshot()).toBe(before);
    expect(audit.snapshot().journal).toBe(before.journal);
  });
  it("rejects foreign and mixed tuples", () => {
    const old = createLifecycleGenesis(input());
    expect(() => createLifecycleGenesis({ ...input(), versions: { ...old.versions, runtime: "foreign" } })).toThrow();
    expect(() => admitLifecycleGenesis({ ...old, versions: { ...old.versions, runtime: LIFECYCLE_THREAD_VERSIONS.runtime } })).toThrow();
  });
  it("rejects thread genesis at legacy capsule creation and admission without mutation", async () => {
    const genesis = createLifecycleGenesis({ ...input(), versions: LIFECYCLE_THREAD_VERSIONS });
    const output = createLifecycleRuntime(genesis).snapshot();
    const evidence = { genesis, output };
    const encoded = canonicalLifecycleData(evidence);
    const digest = createHash("sha256").update(JSON.stringify([canonicalLifecycleData(LIFECYCLE_CAPSULE_MANIFEST), encoded]), "utf8").digest("hex");
    const candidate = { manifest: LIFECYCLE_CAPSULE_MANIFEST, digest, ...evidence };
    const before = canonicalLifecycleData(candidate);
    await expect(createLifecycleCapsule(evidence)).rejects.toThrow(/thread/i);
    await expect(admitLifecycleCapsule(candidate)).rejects.toThrow(/thread/i);
    expect(canonicalLifecycleData(candidate)).toBe(before);
  });
  it("rejects thread-aware legacy capsule runs before observing a year", async () => {
    const genesis = createLifecycleGenesis({ ...input(), versions: LIFECYCLE_THREAD_VERSIONS });
    let observed = false;
    await expect(runLifecycle({ kind: "start", genesis }, { maxSteps: 1, onYear: () => { observed = true; } })).rejects.toThrow(/thread/i);
    expect(observed).toBe(false);
  });
});

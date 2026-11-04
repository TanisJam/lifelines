import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { canonicalLifecycleData, createLifecycleGenesis, LIFECYCLE_THREAD_VERSIONS } from "./e-lifecycle-genesis";
import { createLifecycleRuntime } from "./e-lifecycle-runtime";
import { createLifecycleCapsule, createLifecycleCompactCapsule, deserializeLifecycleCapsule, deserializeLifecycleCompactCapsule, serializeLifecycleCapsule, serializeLifecycleCompactCapsule, LIFECYCLE_COMPACT_CAPSULE_MANIFEST_V2 } from "./e-lifecycle-capsule";
import { initializeWorld } from "./world-origin";

describe("thread-aware compact capsules", () => {
  it("uses its own profile and domain and cold-admits an empty thread state", async () => {
    const initialization = { seed: "cb3", startYear: 1327, endYear: 1327, founderCount: 6, protagonist: { name: "Alice", sex: "random" as const } };
    const { world } = initializeWorld(initialization);
    const genesis = createLifecycleGenesis({ initialization, protagonistId: "protagonist", versions: LIFECYCLE_THREAD_VERSIONS,
      resources: Object.fromEntries(Object.keys(world.people).map(id => [id, { grain: 2, effort: 3, need: 1 }])) });
    const output = createLifecycleRuntime(genesis, { journal: "compact" }).snapshot();
    const capsule = await createLifecycleCompactCapsule({ genesis, output }, "compact");
    expect(capsule.manifest.capsuleSchema).toBe("lifecycle-capsule-compact-cb3-1");
    const wire = await serializeLifecycleCompactCapsule(capsule);
    expect((await deserializeLifecycleCompactCapsule(wire)).digest).toBe(capsule.digest);
    const wrong = JSON.parse(wire);
    wrong.digest = "0".repeat(64);
    await expect(deserializeLifecycleCompactCapsule(JSON.stringify(wrong))).rejects.toThrow(/digest/);
    wrong.digest = createHash("sha256").update(JSON.stringify(["lifecycle-compact-capsule-cb2-1", canonicalLifecycleData(wrong.manifest), wrong.table])).digest("hex");
    await expect(deserializeLifecycleCompactCapsule(JSON.stringify(wrong))).rejects.toThrow(/digest/);
    wrong.manifest = LIFECYCLE_COMPACT_CAPSULE_MANIFEST_V2;
    wrong.digest = createHash("sha256").update(JSON.stringify(["lifecycle-compact-capsule-cb2-1", canonicalLifecycleData(wrong.manifest), wrong.table])).digest("hex");
    await expect(deserializeLifecycleCompactCapsule(JSON.stringify(wrong))).rejects.toThrow(/profile/);
    await expect(createLifecycleCompactCapsule({ genesis, output }, "audit")).rejects.toThrow();
  });
});

it("retains old audit, compact and tagged capsule dispatch", async () => {
  const initialization = { seed: "old-formats", startYear: 1327, endYear: 1327, founderCount: 6, protagonist: { name: "Alice", sex: "random" as const } };
  const { world } = initializeWorld(initialization);
  const genesis = createLifecycleGenesis({ initialization, protagonistId: "protagonist",
    resources: Object.fromEntries(Object.keys(world.people).map(id => [id, { grain: 2, effort: 3, need: 1 }])) });
  const output = createLifecycleRuntime(genesis).snapshot();
  for (const journal of ["audit", "compact"] as const) {
    const capsule = await createLifecycleCompactCapsule({ genesis, output }, journal);
    expect((await deserializeLifecycleCompactCapsule(await serializeLifecycleCompactCapsule(capsule))).digest).toBe(capsule.digest);
  }
  const tagged = await createLifecycleCapsule({ genesis, output });
  expect((await deserializeLifecycleCapsule(await serializeLifecycleCapsule(tagged))).digest).toBe(tagged.digest);
});

it("cold replays one committed thread-aware year", async () => {
  const initialization = { seed: "cb3-annual", startYear: 1327, endYear: 1327, founderCount: 6, protagonist: { name: "Alice", sex: "random" as const } };
  const { world } = initializeWorld(initialization);
  const genesis = createLifecycleGenesis({ initialization, protagonistId: "protagonist", versions: LIFECYCLE_THREAD_VERSIONS,
    resources: Object.fromEntries(Object.keys(world.people).map(id => [id, { grain: 2, effort: 3, need: 1 }])) });
  const runtime = createLifecycleRuntime(genesis, { journal: "compact" });
  await runtime.advance(1327);
  const capsule = await createLifecycleCompactCapsule({ genesis, output: runtime.snapshot() }, "compact");
  const cold = await deserializeLifecycleCompactCapsule(await serializeLifecycleCompactCapsule(capsule));
  expect(cold.digest).toBe(capsule.digest);
  expect(cold.output.journal[0].threadBeats).toEqual({ version: "thread-beats-1", beats: [] });
});

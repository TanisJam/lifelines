import { expect, it } from "vitest";
import { createLifecycleGenesis } from "../domain/e-lifecycle-genesis";
import { createLifecycleRuntime } from "../domain/e-lifecycle-runtime";
import { createLifecycleCompactCapsule } from "../domain/e-lifecycle-capsule";
import { createLifecycleForkCapsule } from "../domain/e-lifecycle-fork-capsule";
import { forkLifecycle } from "../domain/e-lifecycle-fork";
import { LIFECYCLE_CHOICE_VERSION } from "../domain/e-lifecycle-choice";
import { initializeWorld } from "../domain/world-origin";
import { admitStoredLifecycleFork, loadStoredLifecycleFork } from "./lifecycle-repository";

it("cold dispatch admits forks and nested forks and refuses missing, unknown and cross-life ancestry", async () => {
  const initialization = { seed: "fork-a", startYear: 1327, endYear: 1329, founderCount: 6, protagonist: { name: "Alice", sex: "random" as const } };
  const { world } = initializeWorld(initialization);
  const genesis = createLifecycleGenesis({ initialization, protagonistId: "protagonist", resources: Object.fromEntries(Object.keys(world.people).map(id => [id, { grain: 2, effort: 3, need: 1 }])) });
  const runtime = createLifecycleRuntime(genesis, { journal: "compact" });
  for (let year = 1327; year <= 1329; year++) await runtime.advance(year);
  const root = { genesis, output: runtime.snapshot() };
  const rootCapsule = await createLifecycleCompactCapsule(root, "compact");
  async function fork(parent: typeof root | Awaited<ReturnType<typeof forkLifecycle>>, year: number) {
    const decisionId = `immigration:world#${year}.1`;
    const target = parent.output.owned.decisions.find(entry => entry.id === decisionId)!;
    return forkLifecycle(parent, { version: LIFECYCLE_CHOICE_VERSION, decisionId, optionId: target.options.find(option => option.id !== target.chosen)!.id, year });
  }
  const first = await fork(root, 1327);
  const parent = await createLifecycleForkCapsule(first);
  const nested = await createLifecycleForkCapsule(await fork(first, 1328), { parent });
  const auditRuntime = createLifecycleRuntime(genesis, { journal: "audit" });
  for (let year = 1327; year <= 1329; year++) if ((await auditRuntime.advance(year)).status === "complete") break;
  const auditCapsule = await createLifecycleCompactCapsule({ genesis, output: auditRuntime.snapshot() }, "audit");
  const otherInitialization = { ...initialization, seed: "fork-b" };
  const otherWorld = initializeWorld(otherInitialization).world;
  const otherGenesis = createLifecycleGenesis({ initialization: otherInitialization, protagonistId: "protagonist", resources: Object.fromEntries(Object.keys(otherWorld.people).map(id => [id, { grain: 2, effort: 3, need: 1 }])) });
  const otherRoot = await createLifecycleCompactCapsule({ genesis: otherGenesis, output: createLifecycleRuntime(otherGenesis, { journal: "compact" }).snapshot() }, "compact");
  const rootRecord = { lifeId: "life", capsule: rootCapsule };
  const parentRecord = { lifeId: "life", capsule: parent };
  const resolve = async (digest: string) => digest === genesis.digest ? rootRecord : digest === parent.digest ? parentRecord : undefined;
  const binding = { version: "canonical-lifecycle-fork-binding-v1", lifeId: "life", branchId: "child", capsuleDigest: parent.digest, capsuleSchema: parent.manifest.capsuleSchema, genesisDigest: genesis.digest };
  expect((await loadStoredLifecycleFork(binding, parent, resolve)).capsule.digest).toBe(parent.digest);
  expect((await admitStoredLifecycleFork("life", parent, resolve)).digest).toBe(parent.digest);
  expect((await loadStoredLifecycleFork({ ...binding, capsuleDigest: nested.digest }, nested, resolve)).capsule.digest).toBe(nested.digest);
  const emptyRoot = await createLifecycleCompactCapsule({ genesis, output: createLifecycleRuntime(genesis, { journal: "compact" }).snapshot() }, "compact");
  await expect(admitStoredLifecycleFork("life", parent, async () => ({ lifeId: "life", capsule: emptyRoot }))).rejects.toThrow("Lifecycle fork year is not a closed parent year");
  await expect(loadStoredLifecycleFork({ ...binding, version: "unknown" }, parent, resolve)).rejects.toThrow("Corrupt fork binding");
  await expect(admitStoredLifecycleFork("life", parent, async () => ({ lifeId: "life", capsule: auditCapsule }))).rejects.toThrow("Fork root journal disagreement");
  await expect(admitStoredLifecycleFork("life", nested, async () => undefined)).rejects.toThrow("Missing or cross-life fork ancestry");
  await expect(admitStoredLifecycleFork("life", parent, async () => ({ lifeId: "other", capsule: otherRoot }))).rejects.toThrow("Missing or cross-life fork ancestry");
  await expect(admitStoredLifecycleFork("life", parent, async () => ({ lifeId: "life", capsule: otherRoot }))).rejects.toThrow("Fork root ancestry disagreement");
  await expect(admitStoredLifecycleFork("life", parent, async () => ({ lifeId: "life", capsule: {} }))).rejects.toThrow();
  await expect(loadStoredLifecycleFork({ ...binding, capsuleDigest: nested.digest }, parent, resolve)).rejects.toThrow("Fork binding/capsule disagreement");
  const sibling = await createLifecycleForkCapsule(await fork(root, 1328));
  await expect(admitStoredLifecycleFork("life", nested, async digest => digest === parent.digest ? { lifeId: "life", capsule: sibling } : rootRecord))
    .rejects.toThrow("Fork ancestry disagreement");
  await expect(admitStoredLifecycleFork("life", nested, async digest => digest === parent.digest ? { lifeId: "other", capsule: parent } : rootRecord))
    .rejects.toThrow("Missing or cross-life fork ancestry");
});

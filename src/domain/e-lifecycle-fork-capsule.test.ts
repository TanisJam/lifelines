import { createHash } from "node:crypto";
import { deserializeCompactLifecycleDag, serializeCompactLifecycleDag } from "./e-lifecycle-dag";
import { canonicalLifecycleData } from "./e-lifecycle-genesis";
import { createLifecycleCompactCapsule } from "./e-lifecycle-capsule";
import { describe, expect, it } from "vitest";
import { admitLifecycleForkCapsule, createLifecycleForkCapsule, deserializeLifecycleForkCapsule, serializeLifecycleForkCapsule } from "./e-lifecycle-fork-capsule";
import { LIFECYCLE_CHOICE_VERSION } from "./e-lifecycle-choice";
import { forkLifecycle } from "./e-lifecycle-fork";
import { createLifecycleGenesis, LIFECYCLE_GENESIS_VERSIONS, LIFECYCLE_THREAD_VERSIONS } from "./e-lifecycle-genesis";
import { createLifecycleRuntime, type LifecycleJournalMode } from "./e-lifecycle-runtime";
import { initializeWorld } from "./world-origin";

async function life(journal: LifecycleJournalMode, thread = false, seed = "fork-a") {
  const initialization = { seed, startYear: 1327, endYear: 1329, founderCount: 6, protagonist: { name: "Alice", sex: "random" as const } };
  const { world } = initializeWorld(initialization);
  const genesis = createLifecycleGenesis({ initialization, protagonistId: "protagonist", versions: thread ? LIFECYCLE_THREAD_VERSIONS : LIFECYCLE_GENESIS_VERSIONS,
    resources: Object.fromEntries(Object.keys(world.people).map(id => [id, { grain: 2, effort: 3, need: 1 }])) });
  const runtime = createLifecycleRuntime(genesis, { journal });
  for (let year = 1327; year <= 1329; year++) if ((await runtime.advance(year)).status === "complete") break;
  return { genesis, output: runtime.snapshot() };
}
async function fork(parent: Awaited<ReturnType<typeof life>> | Awaited<ReturnType<typeof forkLifecycle>>, year: number) {
  const id = `immigration:world#${year}.1`;
  const target = parent.output.owned.decisions.find(entry => entry.id === id)!;
  const choice = { version: LIFECYCLE_CHOICE_VERSION, decisionId: id, optionId: target.options.find(option => option.id !== target.chosen)!.id, year };
  return forkLifecycle(parent, choice);
}
describe("fork capsule", () => {
  for (const [label, journal, thread] of [["old audit", "audit", false], ["old compact", "compact", false], ["thread compact", "compact", true]] as const) {
    it(`round trips ${label}`, async () => {
      const result = await fork(await life(journal, thread), 1328);
      const capsule = await createLifecycleForkCapsule(result);
      const decoded = await deserializeLifecycleForkCapsule(await serializeLifecycleForkCapsule(capsule));
      expect(decoded.output).toEqual(result.output);
      expect(decoded.lineage).toEqual(result.lineage);
      expect([decoded.manifest, decoded.digest]).toEqual([capsule.manifest, capsule.digest]);
    });
  }
  it("round trips nested forks", async () => {
    const first = await fork(await life("compact"), 1327);
    const parent = await createLifecycleForkCapsule(first);
    const second = await fork(first, 1328);
    const capsule = await createLifecycleForkCapsule(second, { parent });
    expect((await deserializeLifecycleForkCapsule(await serializeLifecycleForkCapsule(capsule))).output).toEqual(second.output);
  });
  it("refuses an invalid fork capsule input", async () => {
    await expect(createLifecycleForkCapsule(null)).rejects.toThrow();
  });
  it("refuses rehashed recipe, output, thread state, beats, manifest and mode forgeries", async () => {
    const original = await createLifecycleForkCapsule(await fork(await life("compact", true), 1328));
    function forged(change: (value: Record<string, unknown>) => void) {
      const value = structuredClone(original) as unknown as Record<string, unknown>;
      change(value);
      const { manifest, genesis, output, lineage, recipe, parent } = value;
      const table = serializeCompactLifecycleDag({ genesis, output, lineage, recipe, parent });
      value.digest = createHash("sha256").update(JSON.stringify(["lifecycle-fork-capsule-v1", canonicalLifecycleData(manifest), table])).digest("hex");
      return value;
    }
    for (const change of [
      (v: Record<string, unknown>) => { (v.recipe as Record<string, unknown>).lastYear = 1328; },
      (v: Record<string, unknown>) => { (v.output as Record<string, unknown>).frontier = 123; },
      (v: Record<string, unknown>) => { (v.output as Record<string, unknown>).threads = {}; },
      (v: Record<string, unknown>) => { ((v.output as { journal: Record<string, unknown>[] }).journal[0]).threadBeats = {}; },
      (v: Record<string, unknown>) => { (v.manifest as Record<string, unknown>).profile = "legacy"; },
      (v: Record<string, unknown>) => { (v.manifest as Record<string, unknown>).journal = "audit"; },
      (v: Record<string, unknown>) => { (v.manifest as Record<string, unknown>).capsuleSchema = "unknown"; },
    ]) await expect(admitLifecycleForkCapsule(forged(change))).rejects.toThrow();
  });
  it("refuses missing, cyclic and cross-life ancestry", async () => {
    const first = await fork(await life("compact"), 1327);
    const parent = await createLifecycleForkCapsule(first);
    const second = await fork(first, 1328);
    // Without its parent, a nested fork replays as a root fork and disagrees.
    await expect(createLifecycleForkCapsule(second)).rejects.toThrow("Fork replay disagreement");
    // A rehashed capsule that drops its recorded parent is refused before any replay.
    const nested = await createLifecycleForkCapsule(second, { parent });
    const { manifest, genesis, output, lineage, recipe } = nested;
    const table = serializeCompactLifecycleDag({ genesis, output, lineage, recipe, parent: null });
    const digest = createHash("sha256").update(JSON.stringify(["lifecycle-fork-capsule-v1", canonicalLifecycleData(manifest), table])).digest("hex");
    await expect(admitLifecycleForkCapsule({ ...nested, parent: null, digest })).rejects.toThrow("Missing fork ancestry");
    const cyclic = structuredClone(parent) as unknown as { parent: unknown };
    cyclic.parent = cyclic;
    await expect(admitLifecycleForkCapsule(cyclic)).rejects.toThrow();
    const other = await createLifecycleForkCapsule(await fork(await life("compact", false, "fork-b"), 1327));
    await expect(createLifecycleForkCapsule(second, { parent: other })).rejects.toThrow("Fork ancestry disagreement");
  });
  it("refuses an unknown manifest even when the digest covers it", async () => {
    const capsule = await createLifecycleForkCapsule(await fork(await life("compact"), 1328));
    const manifest = { ...capsule.manifest, capsuleSchema: "lifecycle-fork-capsule-v9" };
    const { genesis, output, lineage, recipe, parent } = capsule;
    const table = serializeCompactLifecycleDag({ genesis, output, lineage, recipe, parent });
    const digest = createHash("sha256").update(JSON.stringify(["lifecycle-fork-capsule-v1", canonicalLifecycleData(manifest), table])).digest("hex");
    await expect(admitLifecycleForkCapsule({ ...capsule, manifest, digest })).rejects.toThrow("Unsupported fork capsule manifest");
    await expect(deserializeLifecycleForkCapsule(JSON.stringify({ manifest, table, digest }))).rejects.toThrow("Unsupported fork capsule manifest");
  });
  it("refuses a capsule or wire whose digest disagrees", async () => {
    const capsule = await createLifecycleForkCapsule(await fork(await life("compact"), 1328));
    await expect(admitLifecycleForkCapsule({ ...capsule, digest: "0".repeat(64) })).rejects.toThrow("Fork capsule digest disagreement");
    const wire = JSON.parse(await serializeLifecycleForkCapsule(capsule));
    await expect(deserializeLifecycleForkCapsule(JSON.stringify({ ...wire, digest: "0".repeat(64) }))).rejects.toThrow("Fork capsule digest disagreement");
  });
  it("refuses a thread fork carried by an audit journal", async () => {
    const result = await fork(await life("audit", true), 1328);
    await expect(createLifecycleForkCapsule(result)).rejects.toThrow("Invalid fork journal mode");
  });
  it("does not allow the root capsule creator to certify a fork output", async () => {
    const result = await fork(await life("compact"), 1328);
    await expect(createLifecycleCompactCapsule({ genesis: result.genesis, output: result.output }, "compact")).rejects.toThrow();
  });

  it("refuses inner envelope fields that override the outer wire", async () => {
    const capsule = await createLifecycleForkCapsule(await fork(await life("compact"), 1328));
    const wire = JSON.parse(await serializeLifecycleForkCapsule(capsule));
    const body = deserializeCompactLifecycleDag(wire.table) as Record<string, unknown>;
    body.manifest = capsule.manifest;
    body.digest = capsule.digest;
    wire.table = serializeCompactLifecycleDag(body);
    wire.digest = createHash("sha256").update(JSON.stringify(["lifecycle-fork-capsule-v1", canonicalLifecycleData(wire.manifest), wire.table])).digest("hex");
    await expect(deserializeLifecycleForkCapsule(JSON.stringify(wire))).rejects.toThrow();
  });

  it("refuses a rehashed ceiling change hidden by early death", async () => {
    const root = await life("compact", false, "fork-b");
    const dead = await forkLifecycle(root, { version: LIFECYCLE_CHOICE_VERSION, decisionId: "death:protagonist#1.1", optionId: "die", year: 1328 });
    const capsule = structuredClone(await createLifecycleForkCapsule(dead));
    const recipe = capsule.recipe as { lastYear: number };
    recipe.lastYear = 1328;
    const { manifest, genesis, output, lineage, parent } = capsule;
    const table = serializeCompactLifecycleDag({ genesis, output, lineage, recipe, parent });
    const digest = createHash("sha256").update(JSON.stringify(["lifecycle-fork-capsule-v1", canonicalLifecycleData(manifest), table])).digest("hex");
    let rejected = false;
    try { await admitLifecycleForkCapsule({ ...capsule, digest }); } catch { rejected = true; }
    expect(rejected).toBe(true);
  });

});

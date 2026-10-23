import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalLifecycleData, createLifecycleGenesis } from "@/domain/e-lifecycle-genesis";
import { runLifecycleOutput } from "@/domain/e-lifecycle-run";
import { serializeCompactLifecycleDag } from "@/domain/e-lifecycle-dag";
import {
  LIFECYCLE_COMPACT_CAPSULE_MANIFEST,
  LIFECYCLE_COMPACT_CAPSULE_MANIFEST_V2,
  createLifecycleCompactCapsule,
  deserializeLifecycleCompactCapsule,
} from "@/domain/e-lifecycle-capsule";
import { initializeWorld } from "@/domain/world-origin";
import { openDb } from "@/server/db";
import { LIFECYCLE_MAX_STEPS } from "@/server/lifecycle-life";
import { LifecycleRepository } from "@/server/lifecycle-repository";

/**
 * The journal-mode guard at the PERSISTENCE boundary (blocker B1 of `lifecycle-full-lifetime.md` L7).
 *
 * A branded runtime output proves provenance, not shape. Before the guard, an audit output could be
 * certified as `cb2`, published, and then refused by every later `load` - a schema bug that produced
 * unreadable persisted data instead of an error. These cases prove the refusal happens BEFORE a row
 * exists, including for a hand-forged capsule whose digest is correctly re-signed.
 */
const SEED = "ri1c-lifecycle-1";

function fixture(seed: string) {
  const initialization = { seed, startYear: 1327, endYear: 1427, protagonist: { name: "Probe", sex: "f" as const } };
  const { world } = initializeWorld(initialization);
  const genesis = createLifecycleGenesis({ initialization, protagonistId: "protagonist",
    resources: Object.fromEntries(Object.keys(world.people).map((id) => [id, { grain: 2, effort: 3, need: 1 }])) });
  return { world, genesis };
}

/** The compact capsule digest frame, reimplemented so a forged table can be re-signed in a test. */
function compactDigest(manifest: unknown, table: string, domain: string): string {
  const hash = createHash("sha256");
  hash.update(`["${domain}",${JSON.stringify(canonicalLifecycleData(manifest))},"`, "utf8");
  for (let start = 0; start < table.length;) {
    let end = Math.min(start + 32768, table.length);
    if (end < table.length) {
      const high = table.charCodeAt(end - 1), low = table.charCodeAt(end);
      if (high >= 0xd800 && high <= 0xdbff && low >= 0xdc00 && low <= 0xdfff) end--;
    }
    hash.update(JSON.stringify(table.slice(start, end)).slice(1, -1), "utf8");
    start = end;
  }
  hash.update('\"]', "utf8");
  return hash.digest("hex");
}

function forged(
  manifest: typeof LIFECYCLE_COMPACT_CAPSULE_MANIFEST | typeof LIFECYCLE_COMPACT_CAPSULE_MANIFEST_V2,
  genesis: unknown, output: unknown,
) {
  const table = serializeCompactLifecycleDag({ genesis, output });
  const domain = manifest === LIFECYCLE_COMPACT_CAPSULE_MANIFEST_V2
    ? "lifecycle-compact-capsule-cb2-1" : "lifecycle-compact-capsule-cb1-1";
  return { manifest, digest: compactDigest(manifest, table, domain), genesis, output };
}

describe("lifecycle journal mode guard", () => {
  it("S3: an output's journal shape must match the declared mode, both directions", async () => {
    const { genesis } = fixture(SEED);
    const audit = await runLifecycleOutput({ kind: "start", genesis }, { maxSteps: LIFECYCLE_MAX_STEPS }, "audit");
    const compact = await runLifecycleOutput({ kind: "start", genesis }, { maxSteps: LIFECYCLE_MAX_STEPS }, "compact");
    await expect(createLifecycleCompactCapsule({ genesis: audit.genesis, output: audit.output }, "compact"))
      .rejects.toThrow("Lifecycle journal mode disagreement");
    await expect(createLifecycleCompactCapsule({ genesis: compact.genesis, output: compact.output }, "audit"))
      .rejects.toThrow("Lifecycle journal mode disagreement");
  }, 120_000);

  it("S3: a forged capsule over the wrong journal cannot be published or read", async () => {
    const { world, genesis } = fixture(SEED);
    const audit = await runLifecycleOutput({ kind: "start", genesis }, { maxSteps: LIFECYCLE_MAX_STEPS }, "audit");
    const bad = forged(LIFECYCLE_COMPACT_CAPSULE_MANIFEST_V2, audit.genesis, audit.output);
    const db = openDb(":memory:");
    const repository = new LifecycleRepository(db);
    await expect(repository.publish({ lifeId: "bad", branchId: "bad-b", config: world.config,
      protagonistName: "Probe", protagonistSex: "f", capsule: bad }))
      .rejects.toThrow("Lifecycle journal mode disagreement");
    // Nothing persisted: the refusal precedes the row, it is not a repair after the fact.
    expect((db.prepare("SELECT COUNT(*) AS c FROM lifecycle_lives").get() as { c: number }).c).toBe(0);
    await expect(repository.load("bad", "bad-b")).resolves.toBeUndefined();
    const wire = JSON.stringify({ manifest: bad.manifest,
      table: serializeCompactLifecycleDag({ genesis: audit.genesis, output: audit.output }), digest: bad.digest });
    await expect(deserializeLifecycleCompactCapsule(wire)).rejects.toThrow("Lifecycle journal mode disagreement");
  }, 120_000);

  it("S2/S3: a zero-year journal is mode-neutral, a mixed one is refused", async () => {
    const { genesis } = fixture(SEED);
    const zero = await runLifecycleOutput({ kind: "start", genesis }, { maxSteps: 0 }, "audit");
    expect(zero.output.journal).toHaveLength(0);
    // An empty journal carries no shape, so it must certify under either declaration.
    await expect(createLifecycleCompactCapsule({ genesis, output: zero.output })).resolves.toBeDefined();
    await expect(createLifecycleCompactCapsule({ genesis, output: zero.output }, "compact")).resolves.toBeDefined();
    await expect(createLifecycleCompactCapsule({ genesis, output: { journal: [
      { year: 1327, versions: {}, final: {}, physicalSnapshot: {}, economics: {}, positions: {} },
      { year: 1328, versions: {}, final: {} }] } }, "compact"))
      .rejects.toThrow("Mixed lifecycle journal modes");
    await expect(createLifecycleCompactCapsule({ genesis, output: { journal: [{ year: 1327, physicalSnapshot: {} }] } }, "compact"))
      .rejects.toThrow("Mixed lifecycle journal record");
  }, 60_000);

  it("S4: cb1 and cb2 lives persist and cold-load with exact digests", async () => {
    const { world, genesis } = fixture(SEED);
    const repository = new LifecycleRepository(openDb(":memory:"));
    const audit = await runLifecycleOutput({ kind: "start", genesis }, { maxSteps: LIFECYCLE_MAX_STEPS }, "audit");
    const compact = await runLifecycleOutput({ kind: "start", genesis }, { maxSteps: LIFECYCLE_MAX_STEPS }, "compact");
    const oldCapsule = await createLifecycleCompactCapsule({ genesis: audit.genesis, output: audit.output });
    const newCapsule = await createLifecycleCompactCapsule({ genesis: compact.genesis, output: compact.output }, "compact");
    const publish = (lifeId: string, capsule: typeof oldCapsule | typeof newCapsule) => repository.publish({
      lifeId, branchId: `${lifeId}-b`, config: world.config, protagonistName: "Probe", protagonistSex: "f", capsule });
    const oldBinding = await publish("old", oldCapsule);
    const newBinding = await publish("new", newCapsule);
    expect(oldBinding.capsuleSchema).toBe(LIFECYCLE_COMPACT_CAPSULE_MANIFEST.capsuleSchema);
    expect(newBinding.capsuleSchema).toBe(LIFECYCLE_COMPACT_CAPSULE_MANIFEST_V2.capsuleSchema);
    expect((await repository.load("old", "old-b"))?.capsule.digest).toBe(oldBinding.capsuleDigest);
    expect((await repository.load("new", "new-b"))?.capsule.digest).toBe(newBinding.capsuleDigest);
  }, 180_000);

});

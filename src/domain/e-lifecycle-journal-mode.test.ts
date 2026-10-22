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
  serializeLifecycleCompactCapsule,
} from "@/domain/e-lifecycle-capsule";
import { LOCALES } from "@/domain/locale";
import { initializeWorld } from "@/domain/world-origin";
import { getDb, openDb } from "@/server/db";
import { LIFECYCLE_HORIZON_YEARS, LIFECYCLE_MAX_STEPS, streamLifecycleLife } from "@/server/lifecycle-life";
import { projectLifecycleChronicle, projectLifecyclePersonSheet, projectLifecycleTick } from "@/server/lifecycle-projection";
import { LifecycleRepository } from "@/server/lifecycle-repository";
import { verifyLifecycleLives } from "@/server/lifecycle-verification";

/**
 * S1-S6 of `odd/tasks/lifecycle-full-lifetime.md`: a life runs to its protagonist's death, the create
 * path certifies a `cb2` capsule over the compact journal, `cb1` lives keep loading, and the two
 * journal modes cannot be confused in either direction. Every case is computed from a real run, never
 * from a hand-built journal.
 */
const SEED = "ri1c-lifecycle-1"; // the protagonist dies at age 1: a complete two-year life, cheap for a unit test.
const LONG_SEED = "cap-0"; // survives well past the old 15-year horizon.

function fixture(seed: string) {
  const initialization = { seed, startYear: 1327, endYear: 1427, protagonist: { name: "Probe", sex: "f" as const } };
  const { world } = initializeWorld(initialization);
  const genesis = createLifecycleGenesis({
    initialization, protagonistId: "protagonist",
    resources: Object.fromEntries(Object.keys(world.people).map((id) => [id, { grain: 2, effort: 3, need: 1 }])),
  });
  return { world, genesis };
}

/** The compact capsule digest frame, reimplemented so a forged table can be re-signed in a test. */
function compactDigest(manifest: unknown, table: string, domain: string): string {
  const hash = createHash("sha256");
  hash.update(`["${domain}",${JSON.stringify(canonicalLifecycleData(manifest))},"`, "utf8");
  for (let start = 0; start < table.length;) {
    let end = Math.min(start + 32768, table.length);
    if (end < table.length) {
      const high = table.charCodeAt(end - 1);
      const low = table.charCodeAt(end);
      if (high >= 0xd800 && high <= 0xdbff && low >= 0xdc00 && low <= 0xdfff) end--;
    }
    hash.update(JSON.stringify(table.slice(start, end)).slice(1, -1), "utf8");
    start = end;
  }
  hash.update('\"]', "utf8");
  return hash.digest("hex");
}

function frames() {
  const events: { type: string }[] = [];
  return { events, emit: (event: never) => { events.push(event); } };
}

describe("lifecycle full lifetime — journal modes and capsule schema", () => {
  it("S1: the default budget runs past 15 years to the protagonist's death", async () => {
    expect(LIFECYCLE_MAX_STEPS).toBe(100);
    expect(LIFECYCLE_HORIZON_YEARS).toBe(15);
    const { genesis } = fixture(SEED);
    const run = await runLifecycleOutput({ kind: "start", genesis }, { maxSteps: LIFECYCLE_MAX_STEPS }, "compact");
    expect(run.output.status).toBe("complete");
    expect(run.output.frontier).toBe(1328);
    expect(run.output.journal).toHaveLength(2);
  }, 120_000);

  it("S1: no maxSteps persists a cb2 life that died, not a horizon survivor", async () => {
    const db = openDb(":memory:");
    const { events, emit } = frames();
    await streamLifecycleLife({
      repository: new LifecycleRepository(db), lifeId: "life-default", branchId: "branch-default",
      name: "Probe", sex: "f", seed: SEED, locale: "en", signal: new AbortController().signal,
      emit: emit as never, flushFrame: async () => {},
    });
    const done = events.find((event) => event.type === "done") as
      { chronicle: { protagonist: { deathYear: number | null; horizonYear?: number } } } | undefined;
    expect(done?.chronicle.protagonist.deathYear).toBe(1328);
    expect(done?.chronicle.protagonist.horizonYear).toBeUndefined();
    expect(events.filter((event) => event.type === "tick")).toHaveLength(2);
    const loaded = await new LifecycleRepository(db).load("life-default", "branch-default");
    expect(loaded?.binding.capsuleSchema).toBe(LIFECYCLE_COMPACT_CAPSULE_MANIFEST_V2.capsuleSchema);
    expect(loaded?.capsule.output.status).toBe("complete");
  }, 120_000);

  it("S1: an explicit budget that ends before death is persisted as incomplete", async () => {
    const db = openDb(":memory:");
    const { events, emit } = frames();
    await streamLifecycleLife({
      repository: new LifecycleRepository(db), lifeId: "life-budget", branchId: "branch-budget",
      name: "Probe", sex: "f", seed: SEED, locale: "en", signal: new AbortController().signal,
      emit: emit as never, flushFrame: async () => {}, maxSteps: 1,
    });
    const done = events.find((event) => event.type === "done") as
      { chronicle: { protagonist: { deathYear: number | null; horizonYear?: number } } } | undefined;
    expect(done?.chronicle.protagonist.deathYear).toBeNull();
    expect(done?.chronicle.protagonist.horizonYear).toBe(1327);
    const loaded = await new LifecycleRepository(db).load("life-budget", "branch-budget");
    expect(loaded?.capsule.output.status).toBe("incomplete");
    expect(loaded?.capsule.output.journal).toHaveLength(1);
  }, 120_000);

  it("S1/S3: a zero-year output certifies, publishes and reloads", async () => {
    const { world, genesis } = fixture(SEED);
    const run = await runLifecycleOutput({ kind: "start", genesis }, { maxSteps: 0 }, "compact");
    expect(run.output.status).toBe("incomplete");
    expect(run.output.frontier).toBe(1326);
    const capsule = await createLifecycleCompactCapsule({ genesis: run.genesis, output: run.output }, "compact");
    const repository = new LifecycleRepository(openDb(":memory:"));
    const binding = await repository.publish({ lifeId: "life-zero", branchId: "branch-zero",
      config: world.config, protagonistName: "Probe", protagonistSex: "f", capsule });
    expect(binding.capsuleSchema).toBe(LIFECYCLE_COMPACT_CAPSULE_MANIFEST_V2.capsuleSchema);
    const loaded = await repository.load("life-zero", "branch-zero");
    expect(loaded?.capsule.digest).toBe(binding.capsuleDigest);
    expect(loaded?.capsule.output.journal).toHaveLength(0);
  }, 120_000);

  it("S5: audit and compact journals produce identical chronicle, ticks and every person sheet", async () => {
    const { genesis } = fixture(LONG_SEED);
    const identity = { lifeId: "life-s5", branchId: "branch-s5" };
    const audit = await runLifecycleOutput({ kind: "start", genesis }, { maxSteps: 3 }, "audit");
    const compact = await runLifecycleOutput({ kind: "start", genesis }, { maxSteps: 3 }, "compact");
    expect(audit.output.journal).toHaveLength(3);
    expect(compact.output.journal).toHaveLength(3);
    expect(Object.keys(audit.output.journal[0]!)).toContain("physicalSnapshot");
    expect(Object.keys(compact.output.journal[0]!)).toEqual(["year", "versions", "final"]);
    const auditChronicle = await projectLifecycleChronicle({ source: audit, identity, locale: "en" });
    const compactChronicle = await projectLifecycleChronicle({ source: compact, identity, locale: "en" });
    expect(canonicalLifecycleData(compactChronicle.view)).toBe(canonicalLifecycleData(auditChronicle.view));
    expect(canonicalLifecycleData(compactChronicle.gaps)).toBe(canonicalLifecycleData(auditChronicle.gaps));
    for (const personId of Object.keys(audit.output.owned.people)) {
      const fromAudit = await projectLifecyclePersonSheet({ source: audit, personId, locale: "en" });
      const fromCompact = await projectLifecyclePersonSheet({ source: compact, personId, locale: "en" });
      expect(canonicalLifecycleData(fromCompact.view)).toBe(canonicalLifecycleData(fromAudit.view));
    }
    for (const entry of compact.output.journal) {
      const fromAudit = await projectLifecycleTick({ source: audit, year: entry.year, locale: "en" });
      const fromCompact = await projectLifecycleTick({ source: compact, year: entry.year, locale: "en" });
      expect(canonicalLifecycleData(fromCompact.view)).toBe(canonicalLifecycleData(fromAudit.view));
    }
  }, 300_000);

  it("S4: a cb1 (audit) life keeps loading and verifying while a new life is cb2", async () => {
    const { world, genesis } = fixture(SEED);
    const repository = new LifecycleRepository(getDb());
    const audit = await runLifecycleOutput({ kind: "start", genesis }, { maxSteps: LIFECYCLE_MAX_STEPS }, "audit");
    const compact = await runLifecycleOutput({ kind: "start", genesis }, { maxSteps: LIFECYCLE_MAX_STEPS }, "compact");
    const oldCapsule = await createLifecycleCompactCapsule({ genesis: audit.genesis, output: audit.output });
    const newCapsule = await createLifecycleCompactCapsule({ genesis: compact.genesis, output: compact.output }, "compact");
    expect(oldCapsule.manifest.capsuleSchema).toBe(LIFECYCLE_COMPACT_CAPSULE_MANIFEST.capsuleSchema);
    const publish = async (lifeId: string, capsule: typeof oldCapsule | typeof newCapsule, source: typeof audit) => {
      const branchId = `${lifeId}-branch`;
      const identity = { lifeId, branchId };
      const projections = await Promise.all(LOCALES.map(async (locale) => ({
        locale, view: (await projectLifecycleChronicle({ source, identity, locale })).view })));
      const personSheets = (await Promise.all(LOCALES.map(async (locale) => {
        const sheets = [];
        for (const personId of Object.keys(source.output.owned.people)) {
          sheets.push({ locale, personId, view: (await projectLifecyclePersonSheet({ source, personId, locale })).view });
        }
        return sheets;
      }))).flat();
      return repository.publish({ lifeId, branchId, config: world.config, protagonistName: "Probe",
        protagonistSex: "f", capsule, projections, personSheets });
    };
    const oldBinding = await publish("life-old", oldCapsule, audit);
    const newBinding = await publish("life-new", newCapsule, compact);
    expect(oldBinding.capsuleSchema).toBe(LIFECYCLE_COMPACT_CAPSULE_MANIFEST.capsuleSchema);
    expect(newBinding.capsuleSchema).toBe(LIFECYCLE_COMPACT_CAPSULE_MANIFEST_V2.capsuleSchema);
    const loadedOld = await repository.load("life-old", "life-old-branch");
    const loadedNew = await repository.load("life-new", "life-new-branch");
    expect(loadedOld?.capsule.digest).toBe(oldBinding.capsuleDigest);
    expect(loadedNew?.capsule.digest).toBe(newBinding.capsuleDigest);
    expect(Object.keys(loadedOld!.capsule.output.journal[0]!)).toContain("economics");
    expect(Object.keys(loadedNew!.capsule.output.journal[0]!)).toEqual(["year", "versions", "final"]);
    const report = await verifyLifecycleLives();
    expect(report.issues.filter((issue) => issue.lifeId.startsWith("life-"))).toEqual([]);
  }, 300_000);

  it("S6: a cb2 manifest cannot be minted over an audit journal, nor the reverse", async () => {
    const { genesis } = fixture(SEED);
    const audit = await runLifecycleOutput({ kind: "start", genesis }, { maxSteps: LIFECYCLE_MAX_STEPS }, "audit");
    const compact = await runLifecycleOutput({ kind: "start", genesis }, { maxSteps: LIFECYCLE_MAX_STEPS }, "compact");
    // A branded output proves provenance, not shape: the declared mode must match what it carries.
    await expect(createLifecycleCompactCapsule({ genesis: audit.genesis, output: audit.output }, "compact"))
      .rejects.toThrow(/journal mode disagreement/i);
    await expect(createLifecycleCompactCapsule({ genesis: compact.genesis, output: compact.output }))
      .rejects.toThrow(/journal mode disagreement/i);
  }, 120_000);

  it("S6: a cb2 wire cannot be admitted as cb1 by swapping its manifest, nor an unknown one", async () => {
    const { genesis } = fixture(SEED);
    const compact = await runLifecycleOutput({ kind: "start", genesis }, { maxSteps: LIFECYCLE_MAX_STEPS }, "compact");
    const capsule = await createLifecycleCompactCapsule({ genesis: compact.genesis, output: compact.output }, "compact");
    const wire = await serializeLifecycleCompactCapsule(capsule);
    const envelope = JSON.parse(wire);
    const cb1Manifest = { ...capsule.manifest, capsuleSchema: LIFECYCLE_COMPACT_CAPSULE_MANIFEST.capsuleSchema };
    await expect(deserializeLifecycleCompactCapsule(JSON.stringify({ ...envelope, manifest: cb1Manifest })))
      .rejects.toThrow("Lifecycle compact capsule digest disagreement");
    const unknown = { ...capsule.manifest, capsuleSchema: "lifecycle-capsule-compact-cb3-1" };
    await expect(deserializeLifecycleCompactCapsule(JSON.stringify({ ...envelope, manifest: unknown })))
      .rejects.toThrow("Unsupported lifecycle compact capsule manifest");
    await expect(deserializeLifecycleCompactCapsule(wire.replace('{"manifest"', '{ "manifest"')))
      .rejects.toThrow("Noncanonical lifecycle compact capsule wire");
  }, 120_000);

  it("S6: a cb2 capsule round-trips, and a re-signed journal that drops or reorders a year is refused", async () => {
    const { genesis } = fixture(SEED);
    const compact = await runLifecycleOutput({ kind: "start", genesis }, { maxSteps: LIFECYCLE_MAX_STEPS }, "compact");
    const capsule = await createLifecycleCompactCapsule({ genesis: compact.genesis, output: compact.output }, "compact");
    const wire = await serializeLifecycleCompactCapsule(capsule);
    const back = await deserializeLifecycleCompactCapsule(wire);
    expect(back.digest).toBe(capsule.digest);
    expect(back.output.journal).toHaveLength(capsule.output.journal.length);
    const sign = (output: unknown) => {
      const table = serializeCompactLifecycleDag({ genesis: capsule.genesis, output });
      return JSON.stringify({ manifest: capsule.manifest, table,
        digest: compactDigest(capsule.manifest, table, "lifecycle-compact-capsule-cb2-1") });
    };
    type MutableOutput = { journal: { year: number }[] };
    const dropped = structuredClone({ genesis: capsule.genesis, output: capsule.output }) as unknown as { output: MutableOutput };
    dropped.output.journal = dropped.output.journal.slice(0, -1);
    await expect(deserializeLifecycleCompactCapsule(sign(dropped.output))).rejects.toThrow("Lifecycle final output disagreement");
    const changed = structuredClone({ genesis: capsule.genesis, output: capsule.output }) as unknown as { output: MutableOutput };
    changed.output.journal[1]!.year = 9999;
    await expect(deserializeLifecycleCompactCapsule(sign(changed.output))).rejects.toThrow("contiguous");
  }, 120_000);
});

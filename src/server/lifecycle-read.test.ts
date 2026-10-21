import type { DatabaseSync } from "node:sqlite";
import { beforeAll, describe, expect, it, vi } from "vitest";

// The legacy chronicle builder must never select a configured network provider in these tests
// (same guard as `life-chronicle.test.ts`): the legacy life below is narrated by the rule engine.
vi.mock("@/server/decision-engine", async () => {
  const { RuleDecisionMaker } = await import("@/adapters/decision/rule-decision-maker");
  return { getDecisionMaker: () => new RuleDecisionMaker() };
});
import { RuleDecisionMaker } from "@/adapters/decision/rule-decision-maker";
import type { Chronicle } from "@/contracts/life";
import { createLifecycleCompactCapsule, type LifecycleCompactCapsule } from "@/domain/e-lifecycle-capsule";
import { createLifecycleGenesis } from "@/domain/e-lifecycle-genesis";
import { runLifecycle } from "@/domain/e-lifecycle-run";
import { simulate } from "@/domain/simulate";
import { initializeWorld } from "@/domain/world-origin";
import { generateWorld } from "@/domain/worldgen";
import { getDb } from "./db";
import { buildLifeChronicle } from "./life-chronicle";
import { LIFECYCLE_MAX_STEPS, streamLifecycleLife } from "./lifecycle-life";
import { projectLifecycleChronicle, projectLifecyclePersonSheet, type LifecycleProjectionSource } from "./lifecycle-projection";
import {
  buildLifecycleChronicle,
  buildLifecyclePersonSheet,
  isLifecycleLife,
  listLifecycleSummaries,
} from "./lifecycle-read";
import { LifecycleRepository } from "./lifecycle-repository";
import { registerLife } from "./life-store";

/**
 * RI1d (specs S2, S8): the read side of the canonical seam. A life with a `lifecycle_lives` row is
 * served from a FULL replay of its own capsule; every other life keeps the legacy path untouched.
 *
 * The lifecycle life below is created through `lifecycle-life.ts` (the real published path) and
 * every expectation is compared against a SEPARATE fresh full-authority regeneration of the same
 * inputs, never against what storage happens to hold. The legacy life is a real simulated life
 * registered through the legacy store, so both dispatch directions are exercised against real data.
 *
 * The seed is the one RI1 measured as a 1-2 year life (L8): the compact capsule's capture ceiling
 * bounds a 62-founder life to a few years, so a longer-lived seed cannot be persisted at all.
 */
const SEED = "ri1c-lifecycle-1";
const LIFE = "life-ri1d";
const BRANCH = "branch-ri1d";
const LEGACY_SEED = "ri1d-legacy-1";

const initialization = {
  seed: SEED,
  startYear: 1327,
  endYear: 1327 + LIFECYCLE_MAX_STEPS,
  protagonist: { name: "Alice", sex: "f" as const },
};

function resourcesFor(world: ReturnType<typeof initializeWorld>["world"]) {
  return Object.fromEntries(Object.keys(world.people).map((id) => [id, { grain: 2, effort: 3, need: 1 }]));
}

/** A fresh full current-authority regeneration of exactly the request `lifecycle-life.ts` ran. */
async function freshCapsule(): Promise<LifecycleCompactCapsule> {
  const { world } = initializeWorld(initialization);
  const genesis = createLifecycleGenesis({ initialization, protagonistId: "protagonist", resources: resourcesFor(world) });
  const run = await runLifecycle({ kind: "start", genesis }, { maxSteps: LIFECYCLE_MAX_STEPS });
  if (run.status !== "complete") throw new Error(`fixture life did not end: ${run.status}`);
  return createLifecycleCompactCapsule({ genesis: run.capsule.genesis, output: run.capsule.output });
}

/** A real legacy life, registered through the legacy store exactly as the legacy create route does. */
async function registerLegacyLife(): Promise<{ lifeId: string; branchId: string }> {
  const { config, people, events } = generateWorld({
    seed: LEGACY_SEED, startYear: 1500, endYear: 1600, founderCount: 10,
    protagonist: { name: "Testa", sex: "random" },
  });
  const report = await simulate(config, people, events, {
    decisionMaker: new RuleDecisionMaker(), engineSource: "rules", protagonistId: "protagonist",
  });
  const protagonist = report.result.people.protagonist!;
  const life = registerLife(`legacy-${LEGACY_SEED}`, `branch-${LEGACY_SEED}`, config, protagonist.name, protagonist.sex, report.result, report.snapshots);
  return { lifeId: life.id, branchId: life.originalBranchId };
}

/** The capsule table's single row, read as the stored bytes it actually holds. */
function storedCapsuleRow(db: DatabaseSync): { key: Uint8Array; wire: Uint8Array } {
  return db.prepare("SELECT key, wire FROM main.lifecycle_capsules_v1").get() as { key: Uint8Array; wire: Uint8Array };
}
const decodeWire = (wire: Uint8Array): string => Buffer.from(wire).toString("utf16le");

let fresh: LifecycleCompactCapsule;
let freshSource: LifecycleProjectionSource;
let expectedChronicle: Chronicle;
let legacy: { lifeId: string; branchId: string };

beforeAll(async () => {
  await streamLifecycleLife({
    repository: new LifecycleRepository(getDb()),
    lifeId: LIFE,
    branchId: BRANCH,
    name: "Alice",
    sex: "f",
    seed: SEED,
    locale: "en",
    signal: new AbortController().signal,
    emit: () => {},
    flushFrame: async () => {},
  });
  fresh = await freshCapsule();
  freshSource = { genesis: fresh.genesis, output: fresh.output };
  expectedChronicle = (await projectLifecycleChronicle({
    source: freshSource, identity: { lifeId: LIFE, branchId: BRANCH }, locale: "en",
  })).view;
  legacy = await registerLegacyLife();
}, 240_000);

describe("lifecycle read path (RI1d)", () => {
  it("dispatches by persistence: only the stored lifecycle life is a lifecycle life", () => {
    expect(isLifecycleLife(LIFE)).toBe(true);
    expect(isLifecycleLife(legacy.lifeId)).toBe(false);
    expect(isLifecycleLife("life-that-was-never-saved")).toBe(false);
  });

  it("serves the detail chronicle as the projection of a fresh full-authority regeneration", async () => {
    // The stored capsule is cold-admitted and FULLY replayed on read. The compact digest is
    // computed over the exact wire table, so a matching digest against an independently regenerated
    // capsule IS byte identity — the served view is the life, not a claim about it.
    const loaded = await new LifecycleRepository(getDb()).load(LIFE, BRANCH);
    expect(loaded!.capsule.digest).toBe(fresh.digest);

    const result = await buildLifecycleChronicle(LIFE, undefined, "en");
    expect(result.error).toBeUndefined();
    expect(result.status).toBeUndefined();
    // Identity is the route's own; every other field comes from the regenerated output.
    expect(result.data!.lifeId).toBe(LIFE);
    expect(result.data!.branchId).toBe(BRANCH);
    expect(result.data).toEqual(expectedChronicle);
    // The engine has one branch, so the projection reports no branch switcher (an honest gap).
    expect(result.data!.branches).toEqual([]);

    // An explicit branch id resolves to the same life; an unknown one is the legacy not-found.
    await expect(buildLifecycleChronicle(LIFE, BRANCH, "en")).resolves.toEqual({ data: expectedChronicle });
    await expect(buildLifecycleChronicle(LIFE, "branch-not-this-life", "en")).resolves.toEqual({ error: "Life not found.", status: 404 });
  }, 120_000);

  it("serves a person sheet from the regenerated output and the honest not-found for an unknown person", async () => {
    const personId = expectedChronicle.cast[0]?.personId ?? "protagonist";
    const expected = (await projectLifecyclePersonSheet({ source: freshSource, personId, locale: "en" })).view;

    const result = await buildLifecyclePersonSheet(LIFE, personId, BRANCH, "en");
    expect(result.error).toBeUndefined();
    expect(result.data).toEqual(expected);
    expect(result.data!.personId).toBe(personId);

    // The protagonist is always in the regenerated output; an id that is not is not-found, never a
    // fabricated sheet.
    const self = await buildLifecyclePersonSheet(LIFE, "protagonist", undefined, "en");
    expect(self.data!.relation).toBe("self");
    await expect(buildLifecyclePersonSheet(LIFE, "nobody-in-this-life", undefined, "en")).resolves.toEqual({
      error: "Person not found.", status: 404,
    });
  }, 60_000);

  it("lists the lifecycle life from its own replay, with one branch and no stored claim", async () => {
    const db = getDb();
    const before = db.prepare("SELECT protagonist_name, config_json FROM lifecycle_lives WHERE id = ?").get(LIFE) as {
      protagonist_name: string; config_json: string;
    };
    // The listing row is a projection, never authority: forge it and the served facts must not move.
    db.prepare("UPDATE lifecycle_lives SET protagonist_name = ?, config_json = ? WHERE id = ?").run(
      "Forged Name",
      JSON.stringify({ seed: "forged", startYear: 1, endYear: 2, town: { name: "Forgedville" } }),
      LIFE,
    );
    try {
      const items = await listLifecycleSummaries("en");
      const item = items.find((candidate) => candidate.lifeId === LIFE);
      expect(item).toEqual({
        lifeId: LIFE,
        name: expectedChronicle.protagonist.name,
        birthYear: expectedChronicle.protagonist.birthYear,
        deathYear: expectedChronicle.protagonist.deathYear,
        ageAtDeath: expectedChronicle.protagonist.ageAtDeath,
        causeOfDeath: expectedChronicle.protagonist.causeOfDeath,
        branchCount: 1,
      });
      // The forged row is not echoed anywhere.
      expect(item!.name).not.toBe("Forged Name");
      expect(item!.birthYear).not.toBe(1);
    } finally {
      db.prepare("UPDATE lifecycle_lives SET protagonist_name = ?, config_json = ? WHERE id = ?").run(
        before.protagonist_name, before.config_json, LIFE,
      );
    }
  }, 120_000);

  it("surfaces a refused capsule as the error envelope instead of a view", async () => {
    const db = getDb();
    const stored = storedCapsuleRow(db);
    const wire = decodeWire(stored.wire);
    const envelope = JSON.parse(wire) as { digest: string };
    envelope.digest = "0".repeat(64);
    db.prepare("UPDATE main.lifecycle_capsules_v1 SET wire = ? WHERE key = ?").run(
      Buffer.from(JSON.stringify(envelope), "utf16le"), stored.key,
    );
    try {
      const result = await buildLifecycleChronicle(LIFE, undefined, "en");
      expect(result.data).toBeUndefined();
      expect(result.status).toBe(500);
      expect(result.error).toMatch(/digest disagreement/i);
      const sheet = await buildLifecyclePersonSheet(LIFE, "protagonist", undefined, "en");
      expect(sheet.data).toBeUndefined();
      expect(sheet.status).toBe(500);
      await expect(listLifecycleSummaries("en")).rejects.toThrow(/digest disagreement/i);
    } finally {
      db.prepare("UPDATE main.lifecycle_capsules_v1 SET wire = ? WHERE key = ?").run(stored.wire, stored.key);
    }
    // Restored: the exact stored bytes read again as the same life.
    const restored = await buildLifecycleChronicle(LIFE, undefined, "en");
    expect(restored.data).toEqual(expectedChronicle);
  }, 120_000);

  it("keeps the legacy builder serving a legacy life and never a lifecycle life", async () => {
    const legacyResult = await buildLifeChronicle(legacy.lifeId, legacy.branchId);
    expect(legacyResult.error).toBeUndefined();
    expect(legacyResult.data!.lifeId).toBe(legacy.lifeId);
    expect(legacyResult.data!.branches.map((branch) => branch.label)).toEqual(["Original life"]);

    // The legacy store holds no row for a lifecycle life, so the legacy builder is not its reader…
    await expect(buildLifeChronicle(LIFE)).resolves.toEqual({ error: "Life not found.", status: 404 });
    // …and the lifecycle repository holds no binding for a legacy life, so it is not its reader.
    expect(isLifecycleLife(legacy.lifeId)).toBe(false);
    await expect(buildLifecycleChronicle(legacy.lifeId)).resolves.toEqual({ error: "Life not found.", status: 404 });
    await expect(buildLifecyclePersonSheet(legacy.lifeId, "protagonist")).resolves.toEqual({ error: "Life not found.", status: 404 });
  }, 120_000);
});

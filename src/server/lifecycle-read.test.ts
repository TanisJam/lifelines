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
import { serializeCompactLifecycleDag } from "@/domain/e-lifecycle-dag";
import { createLifecycleGenesis } from "@/domain/e-lifecycle-genesis";
import { runLifecycleOutput } from "@/domain/e-lifecycle-run";
import { simulate } from "@/domain/simulate";
import { initializeWorld } from "@/domain/world-origin";
import { generateWorld } from "@/domain/worldgen";
import { LOCALES, type Locale } from "@/domain/locale";
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
  const run = await runLifecycleOutput({ kind: "start", genesis }, { maxSteps: LIFECYCLE_MAX_STEPS }, "compact");
  if (run.output.status !== "complete") throw new Error(`fixture life did not end: ${run.output.status}`);
  return createLifecycleCompactCapsule({ genesis: run.genesis, output: run.output }, "compact");
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

/** One stored v2 row, addressed by its own `key` — the table may hold more than one life. */
function storedCapsuleRow(db: DatabaseSync, key: Uint8Array): { key: Uint8Array; genesis_table: string } {
  return db.prepare("SELECT key, genesis_table FROM main.lifecycle_capsules_v2 WHERE key = ?")
    .get(key) as { key: Uint8Array; genesis_table: string };
}
/** A structurally valid genesis that is NOT this life's: regeneration must refuse the mismatch. */
function foreignGenesisTable(): string {
  const initialization = { seed: "ri1d-foreign-1", startYear: 1327, endYear: 1427, protagonist: { name: "Foreign", sex: "f" as const } };
  const { world } = initializeWorld(initialization);
  const genesis = createLifecycleGenesis({ initialization, protagonistId: "protagonist",
    resources: Object.fromEntries(Object.keys(world.people).map(id => [id, { grain: 2, effort: 3, need: 1 }])) });
  return serializeCompactLifecycleDag(genesis);
}

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

  it("serves the index for a tampered genesis and refuses it wherever the index cannot answer", async () => {
    const db = getDb();
    const digest = (await new LifecycleRepository(db).load(LIFE, BRANCH))!.capsule.digest;
    const stored = storedCapsuleRow(db, Buffer.from(digest, "utf16le"));
    db.prepare("UPDATE main.lifecycle_capsules_v2 SET genesis_table = ? WHERE key = ?")
      .run(foreignGenesisTable(), stored.key);
    try {
      // P3's deliberate cost: the index is addressed by the capsule digest, so it still answers with
      // the view it was written from. A read no longer re-proves regeneration.
      const indexed = await buildLifecycleChronicle(LIFE, undefined, "en");
      expect(indexed.error).toBeUndefined();
      expect(indexed.data).toEqual(expectedChronicle);
      expect((await listLifecycleSummaries("en"))[0]!.lifeId).toBe(LIFE);
      // P9 made the sheet an indexed read too, so it answers from the index for the same reason.
      const indexedSheet = await buildLifecyclePersonSheet(LIFE, "protagonist", undefined, "en");
      expect(indexedSheet.error).toBeUndefined();
      expect(indexedSheet.data!.personId).toBe("protagonist");
      // Every path that still replays refuses the same row, never repairs it.
      db.prepare("DELETE FROM main.lifecycle_projections_v1").run();
      db.prepare("DELETE FROM main.lifecycle_person_sheets_v1").run();
      const refused = await buildLifecycleChronicle(LIFE, undefined, "en");
      expect(refused.data).toBeUndefined();
      expect(refused.status).toBe(500);
      expect(refused.error).toMatch(/binding\/capsule disagreement/i);
      const refusedSheet = await buildLifecyclePersonSheet(LIFE, "protagonist", undefined, "en");
      expect(refusedSheet.data).toBeUndefined();
      expect(refusedSheet.status).toBe(500);
      expect(refusedSheet.error).toMatch(/binding\/capsule disagreement/i);
      await expect(listLifecycleSummaries("en")).rejects.toThrow(/binding\/capsule disagreement/i);
    } finally {
      db.prepare("UPDATE main.lifecycle_capsules_v2 SET genesis_table = ? WHERE key = ?")
        .run(stored.genesis_table, stored.key);
    }
    // Restored: the stored genesis regenerates the same life again, re-indexing on the miss.
    const restored = await buildLifecycleChronicle(LIFE, undefined, "en");
    expect(restored.data).toEqual(expectedChronicle);
  }, 120_000);

  it("answers from the indexed view without replaying the capsule", async () => {
    const db = getDb();
    const digest = (await new LifecycleRepository(db).load(LIFE, BRANCH))!.capsule.digest;
    // Order-independent: rebuild the "es" row first, whatever a previous test left behind.
    expect((await buildLifecycleChronicle(LIFE, undefined, "es")).error).toBeUndefined();
    const sentinel = { lifeId: LIFE, branchId: BRANCH, protagonist: { name: "Sentinel View", birthYear: 1,
      sex: "f", deathYear: null, ageAtDeath: null, causeOfDeath: null } };
    db.prepare("UPDATE main.lifecycle_projections_v1 SET view_json = ? WHERE capsule_digest = ? AND locale = ?")
      .run(JSON.stringify(sentinel), digest, "es");
    try {
      // A view no replay could ever produce: if the read replays, this cannot come back.
      const result = await buildLifecycleChronicle(LIFE, undefined, "es");
      expect(result.error).toBeUndefined();
      expect((result.data as { protagonist: { name: string } }).protagonist.name).toBe("Sentinel View");
      expect((await listLifecycleSummaries("es"))[0]!.name).toBe("Sentinel View");
    } finally {
      db.prepare("DELETE FROM main.lifecycle_projections_v1 WHERE locale = ?").run("es");
    }
    // The miss replays and re-indexes the real view.
    const healed = await buildLifecycleChronicle(LIFE, undefined, "es");
    expect(healed.error).toBeUndefined();
    expect(healed.data!.protagonist.name).toBe(expectedChronicle.protagonist.name);
    expect(db.prepare("SELECT locale FROM main.lifecycle_projections_v1 WHERE locale = ?").all("es")).toHaveLength(1);
  }, 120_000);

  it("answers a person sheet from the index without regenerating the life", async () => {
    const db = getDb();
    // Warm "es" so the sentinel is the only variable.
    expect((await buildLifecyclePersonSheet(LIFE, "protagonist", undefined, "es")).error).toBeUndefined();
    const digest = (await new LifecycleRepository(db).load(LIFE, BRANCH))!.capsule.digest;
    const sentinel = { personId: "protagonist", name: "Sentinel Sheet", relation: "self", birthYear: 1,
      deathYear: null, job: null, blurb: "sentinel", moments: [] };
    db.prepare(`UPDATE main.lifecycle_person_sheets_v1 SET view_json = ?
      WHERE capsule_digest = ? AND locale = ? AND person_id = ?`)
      .run(JSON.stringify(sentinel), digest, "es", "protagonist");
    try {
      // A sheet no regeneration could ever produce: if the read replays, this cannot come back.
      const result = await buildLifecyclePersonSheet(LIFE, "protagonist", undefined, "es");
      expect(result.error).toBeUndefined();
      expect(result.data!.name).toBe("Sentinel Sheet");
    } finally {
      db.prepare("DELETE FROM main.lifecycle_person_sheets_v1 WHERE locale = ?").run("es");
    }
    // The miss regenerates ONCE and indexes every person of that locale, not just the one asked for.
    const healed = await buildLifecyclePersonSheet(LIFE, "protagonist", undefined, "es");
    expect(healed.error).toBeUndefined();
    const healedName = healed.data!.name;
    const english = await buildLifecyclePersonSheet(LIFE, "protagonist", undefined, "en");
    expect(healedName).toBe(english.data!.name);
    const rows = db.prepare("SELECT count(*) AS n FROM main.lifecycle_person_sheets_v1 WHERE locale = ?")
      .get("es") as { n: number };
    expect(rows.n).toBeGreaterThan(1);
    // Every indexed person is answerable without another regeneration.
    const indexed = db.prepare("SELECT person_id FROM main.lifecycle_person_sheets_v1 WHERE locale = ?")
      .all("es") as { person_id: string }[];
    for (const { person_id } of indexed) {
      expect((await buildLifecyclePersonSheet(LIFE, person_id, undefined, "es")).data).toBeDefined();
    }
  }, 240_000);

  it("answers an unknown person from the index as the legacy not-found, without regenerating", async () => {
    expect((await buildLifecyclePersonSheet(LIFE, "protagonist", undefined, "en")).error).toBeUndefined();
    const load = vi.spyOn(LifecycleRepository.prototype, "load");
    try {
      const result = await buildLifecyclePersonSheet(LIFE, "person-that-never-existed", undefined, "en");
      expect(result).toEqual({ error: "Person not found.", status: 404 });
      // A 404 that came from a regeneration would be as slow as the life is long, and would prove
      // nothing about the index. This pins the answer to the index.
      expect(load).not.toHaveBeenCalled();
    } finally {
      load.mockRestore();
    }
  });

  it("never reports a real person as missing when a sheet row is gone", async () => {
    // A partial index must read as a MISS, never as "this person does not exist". The completeness
    // marker is what makes a partial set identify itself; before it, one missing row was a 404.
    const db = getDb();
    const row = db.prepare(`SELECT person_id FROM main.lifecycle_person_sheets_v1
      WHERE life_id = ? AND locale = 'en' ORDER BY person_id LIMIT 1`).get(LIFE) as { person_id: string };
    db.prepare("DELETE FROM main.lifecycle_person_sheets_v1 WHERE life_id = ? AND locale = 'en' AND person_id = ?")
      .run(LIFE, row.person_id);
    const load = vi.spyOn(LifecycleRepository.prototype, "load");
    try {
      const sheet = await buildLifecyclePersonSheet(LIFE, row.person_id, undefined, "en");
      expect(sheet.error).toBeUndefined();
      expect(sheet.data!.personId).toBe(row.person_id);
      // The miss healed, once, instead of answering 404 forever.
      expect(load).toHaveBeenCalledTimes(1);
    } finally {
      load.mockRestore();
    }
    const stored = db.prepare("SELECT count(*) AS n FROM main.lifecycle_person_sheets_v1 WHERE life_id = ? AND locale = 'en'")
      .get(LIFE) as { n: number };
    const marker = db.prepare("SELECT person_count FROM main.lifecycle_person_sheet_sets_v1 WHERE life_id = ? AND locale = 'en'")
      .get(LIFE) as { person_count: number };
    expect(marker.person_count).toBe(stored.n);
    // And the restored row is the real sheet, not a placeholder.
    expect((await buildLifecyclePersonSheet(LIFE, row.person_id, undefined, "en")).data!.personId).toBe(row.person_id);
  }, 240_000);

  it("heals a locale whose sheet rows cannot be parsed instead of regenerating forever", async () => {
    const db = getDb();
    db.prepare("UPDATE main.lifecycle_person_sheets_v1 SET view_json = ? WHERE life_id = ? AND locale = 'es'")
      .run("{not json", LIFE);
    const first = vi.spyOn(LifecycleRepository.prototype, "load");
    try {
      const sheet = await buildLifecyclePersonSheet(LIFE, "protagonist", undefined, "es");
      expect(sheet.error).toBeUndefined();
      // Unparseable rows are a miss, and the heal OVERWRITES them; keeping them would make every
      // later read miss and regenerate the whole life again.
      expect(first).toHaveBeenCalledTimes(1);
    } finally {
      first.mockRestore();
    }
    const second = vi.spyOn(LifecycleRepository.prototype, "load");
    try {
      expect((await buildLifecyclePersonSheet(LIFE, "protagonist", undefined, "es")).error).toBeUndefined();
      expect(second).not.toHaveBeenCalled();
    } finally {
      second.mockRestore();
    }
  }, 240_000);

  it("restores a completeness marker left with a foreign capsule digest", async () => {
    // A marker that no longer matches the binding is a miss, and the heal must REPLACE it. With
    // DO NOTHING the rows healed but the marker stayed wrong, so every read re-regenerated the life.
    const db = getDb();
    expect((await buildLifecyclePersonSheet(LIFE, "protagonist", undefined, "en")).error).toBeUndefined();
    db.prepare("UPDATE main.lifecycle_person_sheet_sets_v1 SET capsule_digest = ? WHERE life_id = ? AND locale = 'en'")
      .run("f".repeat(64), LIFE);
    const first = vi.spyOn(LifecycleRepository.prototype, "load");
    try {
      expect((await buildLifecyclePersonSheet(LIFE, "protagonist", undefined, "en")).data).toBeDefined();
      expect(first).toHaveBeenCalledTimes(1);
    } finally {
      first.mockRestore();
    }
    const second = vi.spyOn(LifecycleRepository.prototype, "load");
    try {
      expect((await buildLifecyclePersonSheet(LIFE, "protagonist", undefined, "en")).data).toBeDefined();
      expect(second).not.toHaveBeenCalled();
    } finally {
      second.mockRestore();
    }
  }, 240_000);

  it("keeps the sheets of two identical-capsule lives independent", async () => {
    // Two lives created from the same seed, name and sex have IDENTICAL capsule bytes and therefore the
    // same digest. The chronicle index already had to be keyed by the life for this reason; the sheets
    // must not inherit that bug.
    const db = getDb();
    const twinId = "life-twin-sheets";
    const twinBranch = "branch-twin-sheets";
    const config = JSON.parse((db.prepare("SELECT config_json FROM main.lifecycle_lives WHERE id = ?")
      .get(LIFE) as { config_json: string }).config_json) as unknown;
    const source = freshSource;
    const projections = await Promise.all(LOCALES.map(async (target) => ({
      locale: target,
      view: (await projectLifecycleChronicle({ source, identity: { lifeId: twinId, branchId: twinBranch }, locale: target })).view,
    })));
    const personSheets: { locale: Locale; personId: string; view: unknown }[] = [];
    for (const target of LOCALES) {
      for (const personId of Object.keys(fresh.output.owned.people)) {
        personSheets.push({ locale: target, personId,
          view: (await projectLifecyclePersonSheet({ source, personId, locale: target })).view });
      }
    }
    await new LifecycleRepository(db).publish({ lifeId: twinId, branchId: twinBranch, config: config as never,
      protagonistName: "Alice", protagonistSex: "f", capsule: fresh, projections, personSheets });
    // Same capsule digest, two independent bindings.
    const digests = db.prepare("SELECT DISTINCT json_extract(binding_json, '$.capsuleDigest') AS d FROM main.lifecycle_bindings WHERE life_id IN (?, ?)")
      .all(LIFE, twinId) as { d: string }[];
    expect(digests).toHaveLength(1);

    const sentinel = { personId: "protagonist", name: "SENTINEL", relation: "self", birthYear: 1,
      deathYear: null, job: null, blurb: "s", moments: [] };
    db.prepare(`UPDATE main.lifecycle_person_sheets_v1 SET view_json = ?
      WHERE life_id = ? AND locale = 'en' AND person_id = 'protagonist'`)
      .run(JSON.stringify(sentinel), twinId);
    expect((await buildLifecyclePersonSheet(twinId, "protagonist", undefined, "en")).data!.name).toBe("SENTINEL");
    expect((await buildLifecyclePersonSheet(LIFE, "protagonist", undefined, "en")).data!.name).not.toBe("SENTINEL");
  }, 240_000);

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

  it("serves a life alive at its horizon as alive, in the list and in the detail", async () => {
    // Specs S1/S5: the horizon life is persisted (T2) and must now be VIEWABLE as alive. A one-year
    // budget reaches the same `incomplete` state the 15-year product horizon reaches, cheaply.
    const aliveId = "life-ri1d-alive";
    const aliveBranch = "branch-ri1d-alive";
    await streamLifecycleLife({
      repository: new LifecycleRepository(getDb()),
      lifeId: aliveId,
      branchId: aliveBranch,
      name: "Alice",
      sex: "f",
      seed: SEED,
      locale: "en",
      signal: new AbortController().signal,
      emit: () => {},
      flushFrame: async () => {},
      maxSteps: 1,
    });

    // The list row reuses the projection's honest block: an explicit absence, never a borrowed year
    // or a fabricated cause, plus the horizon it reached.
    const items = await listLifecycleSummaries("en");
    expect(items.find((candidate) => candidate.lifeId === aliveId)).toEqual({
      lifeId: aliveId,
      name: "Alice",
      birthYear: 1327,
      deathYear: null,
      ageAtDeath: null,
      causeOfDeath: null,
      horizonYear: 1327,
      branchCount: 1,
    });
    // The completed life next to it keeps its real death, untouched.
    expect(items.find((candidate) => candidate.lifeId === LIFE)).toMatchObject({
      deathYear: expectedChronicle.protagonist.deathYear,
      causeOfDeath: expectedChronicle.protagonist.causeOfDeath,
    });
    expect(items.find((candidate) => candidate.lifeId === LIFE)).not.toHaveProperty("horizonYear");

    const detail = await buildLifecycleChronicle(aliveId, undefined, "en");
    expect(detail.error).toBeUndefined();
    expect(detail.data!.protagonist).toEqual({
      name: "Alice", sex: "f", birthYear: 1327,
      deathYear: null, ageAtDeath: null, causeOfDeath: null, horizonYear: 1327,
    });
    expect(detail.data!.epilogue).toEqual([]);
    expect(detail.data!.entries.some((entry) => entry.kind === "death")).toBe(false);
    expect(detail.data!.summary).toContain("still living");

    // The side sheet for the protagonist is honest too: no death year is invented.
    const sheet = await buildLifecyclePersonSheet(aliveId, "protagonist", undefined, "en");
    expect(sheet.data!.deathYear).toBeNull();
  }, 120_000);
});

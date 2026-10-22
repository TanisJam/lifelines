import { describe, expect, it } from "vitest";
import type { Chronicle } from "@/contracts/life";
import { createLifecycleCompactCapsule } from "@/domain/e-lifecycle-capsule";
import { createLifecycleGenesis } from "@/domain/e-lifecycle-genesis";
import { runLifecycle } from "@/domain/e-lifecycle-run";
import { initializeWorld } from "@/domain/world-origin";
import { getDb } from "./db";
import { streamLifecycleLife } from "./lifecycle-life";
import { LIFECYCLE_VIEW_VERSION } from "./lifecycle-projection-store";
import { buildLifecycleChronicle, listLifecycleSummaries } from "./lifecycle-read";
import { LifecycleRepository } from "./lifecycle-repository";

/**
 * P3's index boundary (spec S6). The capsule is content-addressed, so two lives created from the same
 * seed, name and sex share ONE digest while their derived views differ by route identity. These tests
 * pin that the index is keyed by the life, that a miss self-heals, and that a refused projection takes
 * the whole publication down with it.
 */
const SEED = "ri1c-lifecycle-1";
const repo = () => new LifecycleRepository(getDb());
const count = (sql: string, ...params: (string | number | Uint8Array)[]) =>
  (getDb().prepare(sql).get(...params) as { n: number }).n;

async function createLife(lifeId: string, branchId: string, name: string): Promise<void> {
  await streamLifecycleLife({
    repository: repo(), lifeId, branchId, name, sex: "f", seed: SEED, locale: "en",
    signal: new AbortController().signal, emit: () => {}, flushFrame: async () => {}, maxSteps: 1,
  });
}

async function capsuleFor(name: string) {
  const initialization = { seed: SEED, startYear: 1327, endYear: 1427, protagonist: { name, sex: "f" as const } };
  const { world, origin } = initializeWorld(initialization);
  const resources = Object.fromEntries(Object.keys(world.people).map((id) => [id, { grain: 2, effort: 3, need: 1 }]));
  const genesis = createLifecycleGenesis({ initialization, protagonistId: "protagonist", resources });
  const run = await runLifecycle({ kind: "start", genesis }, { maxSteps: 1 });
  const capsule = await createLifecycleCompactCapsule({ genesis: run.capsule.genesis, output: run.capsule.output });
  return { capsule, config: world.config, name, sex: (origin.sex.resolved ?? "f") as "f" | "m" };
}

describe("lifecycle projection index (P3)", () => {
  it("keeps two lives with identical capsule bytes independently readable", async () => {
    await createLife("dup-p3-1", "dup-p3-b1", "Bea");
    await createLife("dup-p3-2", "dup-p3-b2", "Bea");
    const first = (await repo().load("dup-p3-1", "dup-p3-b1"))!.capsule.digest;
    const second = (await repo().load("dup-p3-2", "dup-p3-b2"))!.capsule.digest;
    expect(second).toBe(first);

    const one = await buildLifecycleChronicle("dup-p3-1", undefined, "en");
    const two = await buildLifecycleChronicle("dup-p3-2", undefined, "en");
    expect(one.error).toBeUndefined();
    expect(two.error).toBeUndefined();
    expect(one.data!.lifeId).toBe("dup-p3-1");
    expect(two.data!.lifeId).toBe("dup-p3-2");

    await expect(listLifecycleSummaries("en")).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ lifeId: "dup-p3-1" }),
      expect.objectContaining({ lifeId: "dup-p3-2" }),
    ]));
  }, 240_000);

  it("indexes every locale as its own distinct view and never cross-serves them", async () => {
    await createLife("loc-p3-1", "loc-p3-b1", "Cleo");
    const digest = (await repo().load("loc-p3-1", "loc-p3-b1"))!.capsule.digest;
    const rows = getDb().prepare(
      "SELECT locale, view_version, view_json FROM main.lifecycle_projections_v1 WHERE life_id = ? ORDER BY locale")
      .all("loc-p3-1") as { locale: string; view_version: string; view_json: string }[];
    expect(rows.map((row) => [row.locale, row.view_version]))
      .toEqual([["en", LIFECYCLE_VIEW_VERSION], ["es", LIFECYCLE_VIEW_VERSION]]);

    const [en, es] = rows.map((row) => JSON.parse(row.view_json) as Chronicle);
    expect(en!.lifeId).toBe("loc-p3-1");
    expect(es!.lifeId).toBe("loc-p3-1");
    expect(en!.summary).not.toBe(es!.summary);
    expect(JSON.stringify((await buildLifecycleChronicle("loc-p3-1", undefined, "en")).data)).toBe(JSON.stringify(en));
    expect(JSON.stringify((await buildLifecycleChronicle("loc-p3-1", undefined, "es")).data)).toBe(JSON.stringify(es));
    // The index row carries the admitted digest, never anything the caller claimed.
    expect(count("SELECT count(*) AS n FROM main.lifecycle_projections_v1 WHERE capsule_digest = ?", digest)).toBe(2);
  }, 240_000);

  it("repopulates on a miss and never selects an older view version", async () => {
    await createLife("miss-p3-1", "miss-p3-b1", "Dana");
    const digest = (await repo().load("miss-p3-1", "miss-p3-b1"))!.capsule.digest;
    const db = getDb();
    db.prepare(`INSERT INTO main.lifecycle_projections_v1
      (life_id, branch_id, view_version, locale, capsule_digest, view_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run("miss-p3-1", "miss-p3-b1", "lifecycle-chronicle-view-0", "en", digest,
      JSON.stringify({ lifeId: "miss-p3-1", branchId: "miss-p3-b1", protagonist: { name: "Old Version", birthYear: 1,
        sex: "f", deathYear: null, ageAtDeath: null, causeOfDeath: null } }), Date.now());
    db.prepare("DELETE FROM main.lifecycle_projections_v1 WHERE life_id = ? AND view_version = ?")
      .run("miss-p3-1", LIFECYCLE_VIEW_VERSION);

    const read = await buildLifecycleChronicle("miss-p3-1", undefined, "en");
    expect(read.error).toBeUndefined();
    expect(read.data!.protagonist.name).toBe("Dana");
    // The miss re-indexed the current version and left the older row untouched (never migrated).
    expect(count("SELECT count(*) AS n FROM main.lifecycle_projections_v1 WHERE life_id = ? AND view_version = ?",
      "miss-p3-1", LIFECYCLE_VIEW_VERSION)).toBe(1);
    expect(count("SELECT count(*) AS n FROM main.lifecycle_projections_v1 WHERE life_id = ? AND view_version = ?",
      "miss-p3-1", "lifecycle-chronicle-view-0")).toBe(1);
  }, 240_000);

  it("rolls back the capsule, binding and life row when a projection is refused", async () => {
    const payload = await capsuleFor("Elmo");
    await expect(repo().publish({
      lifeId: "tx-p3-1", branchId: "tx-p3-b1", config: payload.config, protagonistName: payload.name,
      protagonistSex: payload.sex, capsule: payload.capsule,
      projections: [{ locale: "en", view: { lifeId: "tx-p3-1", branchId: "tx-p3-b1" } },
        { locale: "xx" as never, view: { lifeId: "tx-p3-1", branchId: "tx-p3-b1" } }],
    })).rejects.toThrow(/Unsupported lifecycle projection locale/);
    expect(count("SELECT count(*) AS n FROM main.lifecycle_lives WHERE id = ?", "tx-p3-1")).toBe(0);
    expect(count("SELECT count(*) AS n FROM main.lifecycle_bindings WHERE life_id = ?", "tx-p3-1")).toBe(0);
    const digest = payload.capsule.digest;
    expect(count("SELECT count(*) AS n FROM main.lifecycle_capsules_v1 WHERE key = ?",
      Buffer.from(digest, "utf16le"))).toBe(0);
  }, 240_000);

  it("refuses a projection that claims another life", async () => {
    const payload = await capsuleFor("Gus");
    await expect(repo().publish({
      lifeId: "id-p3-2", branchId: "id-p3-b2", config: payload.config, protagonistName: payload.name,
      protagonistSex: payload.sex, capsule: payload.capsule,
      projections: [{ locale: "en", view: { lifeId: "someone-else", branchId: "id-p3-b2" } }],
    })).rejects.toThrow(/projection identity disagreement/i);
    expect(count("SELECT count(*) AS n FROM main.lifecycle_lives WHERE id = ?", "id-p3-2")).toBe(0);
  }, 240_000);
});

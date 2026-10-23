import { describe, expect, it } from "vitest";
import { serializeCompactLifecycleDag } from "@/domain/e-lifecycle-dag";
import { createLifecycleGenesis } from "@/domain/e-lifecycle-genesis";
import { initializeWorld } from "@/domain/world-origin";
import { getDb } from "./db";
import { streamLifecycleLife } from "./lifecycle-life";
import { LIFECYCLE_VIEW_VERSION } from "./lifecycle-projection-store";
import { LifecycleRepository } from "./lifecycle-repository";
import { verifyLifecycleLives, type LifecycleVerificationIssue } from "./lifecycle-verification";

/**
 * P5: the background verification that replaces the guarantee P3 traded away. It must catch a capsule
 * that no longer replays and an indexed view that disagrees with a fresh regeneration - and it must be
 * quiet about a healthy life.
 *
 * The `missing-binding` issue kind is defense in depth rather than a tested path: the schema's own
 * triggers refuse to delete lifecycle history ("Lifecycle history cannot be deleted"), so a bound life
 * cannot lose its binding row through ordinary SQL.
 */
const SEED = "ri1c-lifecycle-1";

async function createLife(lifeId: string, branchId: string): Promise<void> {
  await streamLifecycleLife({
    repository: new LifecycleRepository(getDb()), lifeId, branchId, name: "Vera", sex: "f", seed: SEED,
    locale: "en", signal: new AbortController().signal, emit: () => {}, flushFrame: async () => {}, maxSteps: 1,
  });
}

const issuesFor = (issues: readonly LifecycleVerificationIssue[], lifeId: string) =>
  issues.filter((issue) => issue.lifeId === lifeId);

/** A structurally valid genesis that is NOT this life's: regeneration must refuse the mismatch. */
function foreignGenesisTable(): string {
  const initialization = { seed: "verify-foreign-1", startYear: 1327, endYear: 1427, protagonist: { name: "Foreign", sex: "f" as const } };
  const { world } = initializeWorld(initialization);
  const genesis = createLifecycleGenesis({ initialization, protagonistId: "protagonist",
    resources: Object.fromEntries(Object.keys(world.people).map(id => [id, { grain: 2, effort: 3, need: 1 }])) });
  return serializeCompactLifecycleDag(genesis);
}

describe("lifecycle verification (P5)", () => {
  it("reports nothing for a healthy life", async () => {
    await createLife("verify-ok", "verify-ok-b");
    const report = await verifyLifecycleLives();
    expect(issuesFor(report.issues, "verify-ok")).toEqual([]);
    expect(report.lives).toBeGreaterThan(0);
  }, 240_000);

  it("refuses a stored genesis that no longer regenerates the bound life", async () => {
    await createLife("verify-bad", "verify-bad-b");
    const db = getDb();
    const digest = (await new LifecycleRepository(db).load("verify-bad", "verify-bad-b"))!.capsule.digest;
    const key = Buffer.from(digest, "utf16le");
    const stored = db.prepare("SELECT genesis_table FROM main.lifecycle_capsules_v2 WHERE key = ?")
      .get(key) as { genesis_table: string };
    db.prepare("UPDATE main.lifecycle_capsules_v2 SET genesis_table = ? WHERE key = ?").run(foreignGenesisTable(), key);
    try {
      // A read would have answered from the index; verification regenerates and refuses.
      const issues = issuesFor((await verifyLifecycleLives()).issues, "verify-bad");
      expect(issues.map((issue) => issue.kind)).toEqual(["capsule-refused"]);
      expect(issues[0]!.detail).toMatch(/binding\/capsule disagreement/i);
    } finally {
      db.prepare("UPDATE main.lifecycle_capsules_v2 SET genesis_table = ? WHERE key = ?").run(stored.genesis_table, key);
    }
    expect(issuesFor((await verifyLifecycleLives()).issues, "verify-bad")).toEqual([]);
  }, 240_000);

  it("reports a missing indexed view per locale", async () => {
    await createLife("verify-gap", "verify-gap-b");
    const db = getDb();
    db.prepare("DELETE FROM main.lifecycle_projections_v1 WHERE life_id = ? AND locale = ?").run("verify-gap", "es");
    const issues = issuesFor((await verifyLifecycleLives()).issues, "verify-gap");
    expect(issues.map((issue) => [issue.kind, issue.detail])).toEqual([["view-missing", "no indexed view for es"]]);
  }, 240_000);

  it("reports an indexed view that disagrees with a fresh regeneration", async () => {
    await createLife("verify-drift", "verify-drift-b");
    const db = getDb();
    db.prepare("UPDATE main.lifecycle_projections_v1 SET view_json = ? WHERE life_id = ? AND view_version = ? AND locale = ?")
      .run(JSON.stringify({ lifeId: "verify-drift", branchId: "verify-drift-b",
        protagonist: { name: "Drifted", birthYear: 1, sex: "f", deathYear: null, ageAtDeath: null, causeOfDeath: null } }),
        "verify-drift", LIFECYCLE_VIEW_VERSION, "en");
    const issues = issuesFor((await verifyLifecycleLives()).issues, "verify-drift");
    expect(issues.map((issue) => [issue.kind, issue.detail])).toEqual([["view-disagreement",
      "the indexed en view disagrees with a fresh regeneration of the same capsule"]]);
  }, 240_000);

});

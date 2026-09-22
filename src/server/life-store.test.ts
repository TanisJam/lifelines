import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RuleDecisionMaker } from "@/adapters/decision/rule-decision-maker";
import { simulate } from "@/domain/simulate";
import type { SocialClass } from "@/domain/types";
import { generateWorld } from "@/domain/worldgen";
import { decompressJson, openDb } from "./db";
import { createLifeStore } from "./life-store";

async function buildLifeArgs(seed: string) {
  const { config, people, events } = generateWorld({ seed, startYear: 1500, endYear: 1520, founderCount: 6, protagonist: { name: "Rosalind", sex: "f" } });
  const report = await simulate(config, people, events, { decisionMaker: new RuleDecisionMaker(), engineSource: "rules", protagonistId: "protagonist" });
  const protagonist = report.result.people.protagonist!;
  return { config, protagonistName: protagonist.name, protagonistSex: protagonist.sex, result: report.result, snapshots: report.snapshots };
}

describe("life-store SQLite persistence (self-hosted Docker deploy)", () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), "lifelines-life-store-test-"));
    dbPath = path.join(dir, "lifelines.db");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("round-trips a life through a fresh store instance against the same DB file, with equal content", async () => {
    const args = await buildLifeArgs("store-roundtrip");

    const writer = createLifeStore(dbPath);
    const lifeId = writer.newLifeId();
    const branchId = writer.newLifeBranchId();
    const written = writer.registerLife(lifeId, branchId, args.config, args.protagonistName, args.protagonistSex, args.result, args.snapshots);
    writer.close();

    // A genuinely fresh store instance, its own SQLite connection, pointed at the same file — as if
    // the process had restarted. Nothing is served from the writer's in-memory cache.
    const reader = createLifeStore(dbPath);
    try {
      const readBack = reader.getLife(lifeId);
      expect(readBack).toBeDefined();
      expect(readBack!.id).toBe(written.id);
      expect(readBack!.protagonistName).toBe(written.protagonistName);
      expect(readBack!.protagonistSex).toBe(written.protagonistSex);
      expect(readBack!.originalBranchId).toBe(written.originalBranchId);
      expect(readBack!.latestBranchId).toBe(written.latestBranchId);
      expect(readBack!.config).toEqual(args.config);

      const branch = reader.getLifeBranch(lifeId, branchId);
      expect(branch).toBeDefined();
      // Compared against a plain JSON round-trip of the original, not the original object itself:
      // records are serialized as JSON (per design), so JSON-only quirks (e.g. `-0` collapsing to
      // `0`) are expected and not a persistence bug — this asserts "the store round-trips exactly
      // what JSON.stringify/parse would", which is the actual contract.
      expect(branch!.result).toEqual(JSON.parse(JSON.stringify(args.result)));
      expect(branch!.label).toBe("Original life");
      // Map identity is never preserved across a JSON round-trip, but content must be.
      expect(branch!.snapshots).toBeInstanceOf(Map);
      expect(branch!.snapshots.size).toBe(args.snapshots.size);
      for (const [year, snapshot] of args.snapshots) {
        expect(branch!.snapshots.get(year)).toEqual(JSON.parse(JSON.stringify(snapshot)));
      }

      // listLifeSummaries()/listLifeBranches() must also see it via the SQL-only path.
      const all = reader.listLifeSummaries();
      expect(all.map((s) => s.id)).toContain(lifeId);
      expect(reader.listLifeBranches(lifeId).map((b) => b.id)).toEqual([branchId]);
    } finally {
      reader.close();
    }
  });

  it("round-trips a forked branch (override, parentBranchId, forkYear) too", async () => {
    const args = await buildLifeArgs("store-roundtrip-branch");
    const writer = createLifeStore(dbPath);
    const lifeId = writer.newLifeId();
    const branchId = writer.newLifeBranchId();
    writer.registerLife(lifeId, branchId, args.config, args.protagonistName, args.protagonistSex, args.result, args.snapshots);

    const override = { id: "ov1", decisionId: "some-decision:protagonist:1510", optionId: "survive" };
    const forked = writer.addLifeBranch(lifeId, branchId, 1510, override, args.result, args.snapshots, "Changed in 1510");
    expect(forked).toBeDefined();
    writer.close();

    const reader = createLifeStore(dbPath);
    try {
      const life = reader.getLife(lifeId);
      expect(life!.latestBranchId).toBe(forked!.id);
      const branch = reader.getLifeBranch(lifeId, forked!.id);
      expect(branch!.override).toEqual(override);
      expect(branch!.parentBranchId).toBe(branchId);
      expect(branch!.forkYear).toBe(1510);
      expect(branch!.label).toBe("Changed in 1510");
    } finally {
      reader.close();
    }
  });

  it("ids stay unique across a simulated restart (counters persisted, not re-seeded at 0)", () => {
    const first = createLifeStore(dbPath);
    const idsFromFirstProcess = [first.newLifeId(), first.newLifeId(), first.newLifeId()];
    const branchIdsFromFirstProcess = [first.newLifeBranchId(), first.newLifeBranchId()];
    first.close();

    // "Restart": a brand-new store instance, no in-memory state carried over, same DB file.
    const second = createLifeStore(dbPath);
    try {
      const idsFromSecondProcess = [second.newLifeId(), second.newLifeId()];
      const branchIdsFromSecondProcess = [second.newLifeBranchId()];

      const allLifeIds = [...idsFromFirstProcess, ...idsFromSecondProcess];
      expect(new Set(allLifeIds).size).toBe(allLifeIds.length);

      const allBranchIds = [...branchIdsFromFirstProcess, ...branchIdsFromSecondProcess];
      expect(new Set(allBranchIds).size).toBe(allBranchIds.length);

      // The counter portion of the id (`life<N>-...`) must have kept incrementing, not restarted at 1.
      const counterOf = (id: string) => Number(id.match(/^life(\d+)-/)![1]);
      expect(counterOf(idsFromSecondProcess[0]!)).toBeGreaterThan(counterOf(idsFromFirstProcess[2]!));
    } finally {
      second.close();
    }
  });

  it("deleteLife removes the life and its branches from a fresh store instance too", async () => {
    const args = await buildLifeArgs("store-delete");
    const writer = createLifeStore(dbPath);
    const lifeId = writer.newLifeId();
    const branchId = writer.newLifeBranchId();
    writer.registerLife(lifeId, branchId, args.config, args.protagonistName, args.protagonistSex, args.result, args.snapshots);
    expect(writer.deleteLife(lifeId)).toBe(true);
    writer.close();

    const reader = createLifeStore(dbPath);
    try {
      expect(reader.getLife(lifeId)).toBeUndefined();
      expect(reader.listLifeSummaries().map((s) => s.id)).not.toContain(lifeId);
    } finally {
      reader.close();
    }
  });

  it("a cache size of 1 evicts the first life once a second is written, but a fork's mutation (latestBranchId) survives the eviction intact", async () => {
    const argsA = await buildLifeArgs("store-lru-life-a");
    const argsB = await buildLifeArgs("store-lru-life-b");

    // Single, long-lived store instance (no simulated restart here) — the point is that eviction
    // alone, within one running process, must never lose a mutation that wasn't written through.
    const store = createLifeStore(dbPath, 1);
    try {
      const lifeIdA = store.newLifeId();
      const originalBranchIdA = store.newLifeBranchId();
      store.registerLife(lifeIdA, originalBranchIdA, argsA.config, argsA.protagonistName, argsA.protagonistSex, argsA.result, argsA.snapshots);

      // Fork life A while it's still the sole (and thus cached) entry — mutates the cached
      // LifeRecord's `latestBranchId` in place, alongside persisting the new branch.
      const override = { id: "ov1", decisionId: "some-decision:protagonist:1505", optionId: "survive" };
      const forkedBranch = store.addLifeBranch(lifeIdA, originalBranchIdA, 1505, override, argsA.result, argsA.snapshots, "Changed in 1505");
      expect(forkedBranch).toBeDefined();

      // Writing a second life is a cache miss for B, which (cacheSize 1) evicts A from the cache.
      const lifeIdB = store.newLifeId();
      const branchIdB = store.newLifeBranchId();
      store.registerLife(lifeIdB, branchIdB, argsB.config, argsB.protagonistName, argsB.protagonistSex, argsB.result, argsB.snapshots);
      expect(lifeIdA).not.toBe(lifeIdB);

      // Reading A back now MUST reload from SQLite (it was evicted) — and must reflect the fork:
      // both branches present, and `latestBranchId` pointing at the forked branch, not the original.
      const reloadedA = store.getLife(lifeIdA);
      expect(reloadedA).toBeDefined();
      expect(reloadedA!.latestBranchId).toBe(forkedBranch!.id);
      expect(reloadedA!.originalBranchId).toBe(originalBranchIdA);
      expect([...reloadedA!.branches.keys()].sort()).toEqual([originalBranchIdA, forkedBranch!.id].sort());

      const latest = store.getLatestBranch(lifeIdA);
      expect(latest!.id).toBe(forkedBranch!.id);
      expect(latest!.override).toEqual(override);
      expect(latest!.parentBranchId).toBe(originalBranchIdA);
      expect(latest!.forkYear).toBe(1505);

      // B is still readable too (it's the currently-cached entry).
      expect(store.getLife(lifeIdB)).toBeDefined();
    } finally {
      store.close();
    }
  });

  it("a second store instance (write-through cache) sees a write immediately without a restart", async () => {
    const args = await buildLifeArgs("store-live-two-handles");
    const a = createLifeStore(dbPath);
    const b = createLifeStore(dbPath);
    try {
      const lifeId = a.newLifeId();
      const branchId = a.newLifeBranchId();
      a.registerLife(lifeId, branchId, args.config, args.protagonistName, args.protagonistSex, args.result, args.snapshots);
      // `b` never wrote this life itself, but its own connection to the same file can still read it
      // (the DB is the source of truth, not either handle's in-memory Map).
      expect(b.getLife(lifeId)).toBeDefined();
    } finally {
      a.close();
      b.close();
    }
  });

  it("listLifeSummaries() matches what the old listLives()-derived GET /api/lives logic would have produced", async () => {
    const args = await buildLifeArgs("store-summary-matches-old");
    const store = createLifeStore(dbPath);
    try {
      const lifeId = store.newLifeId();
      const branchId = store.newLifeBranchId();
      store.registerLife(lifeId, branchId, args.config, args.protagonistName, args.protagonistSex, args.result, args.snapshots);
      // A second branch too, so `branchCount` (previously `listLifeBranches(life.id).length`, now a
      // SQL `COUNT(*)`) is actually exercised past 1.
      const override = { id: "ov1", decisionId: "some-decision:protagonist:1505", optionId: "survive" };
      store.addLifeBranch(lifeId, branchId, 1505, override, args.result, args.snapshots, "Changed in 1505");

      // The "old way" (what `GET /api/lives` did before switching to `listLifeSummaries()`): full
      // `LifeRecord` via `getLife`, its latest branch's `result`, and `listLifeBranches(...).length`.
      const life = store.getLife(lifeId)!;
      const latestBranch = life.branches.get(life.latestBranchId)!;
      const oldStyle = {
        lifeId: life.id,
        name: life.protagonistName,
        birthYear: life.config.startYear,
        deathYearOrEndYear: latestBranch.result.people.protagonist?.deathYear ?? life.config.endYear,
        branchCount: store.listLifeBranches(lifeId).length,
      };

      const summary = store.listLifeSummaries().find((s) => s.id === lifeId)!;
      const newStyle = {
        lifeId: summary.id,
        name: summary.protagonistName,
        birthYear: summary.config.startYear,
        deathYearOrEndYear: summary.latestResult.people.protagonist?.deathYear ?? summary.config.endYear,
        branchCount: summary.branchCount,
      };

      expect(newStyle).toEqual(oldStyle);
      expect(summary.latestBranchId).toBe(life.latestBranchId);
    } finally {
      store.close();
    }
  });

  it("listLifeSummaries() never touches or populates the LRU cache (unlike getLife/getLifeBranch)", async () => {
    const args = await buildLifeArgs("store-summary-bypasses-cache");
    const store = createLifeStore(dbPath);
    try {
      const lifeId = store.newLifeId();
      const branchId = store.newLifeBranchId();
      store.registerLife(lifeId, branchId, args.config, args.protagonistName, args.protagonistSex, args.result, args.snapshots);

      // getLife() is served from the cache: the exact same object comes back every time.
      const life1 = store.getLife(lifeId);
      const life2 = store.getLife(lifeId);
      expect(life1).toBe(life2);

      // listLifeSummaries() reads straight from SQL every call, so it never returns the cached
      // object, or even the same decompressed object twice — proof it isn't reading from (or
      // writing into) the cache at all.
      const summaryA = store.listLifeSummaries().find((s) => s.id === lifeId)!;
      const summaryB = store.listLifeSummaries().find((s) => s.id === lifeId)!;
      expect(summaryA.latestResult).not.toBe(summaryB.latestResult);
      expect(summaryA.latestResult).toEqual(summaryB.latestResult);
    } finally {
      store.close();
    }
  });

  it("a persist failure during a fork leaves the cached record unchanged (never partially mutated)", async () => {
    const args = await buildLifeArgs("store-persist-failure");
    const store = createLifeStore(dbPath);
    const lifeId = store.newLifeId();
    const originalBranchId = store.newLifeBranchId();
    store.registerLife(lifeId, originalBranchId, args.config, args.protagonistName, args.protagonistSex, args.result, args.snapshots);

    const beforeLatestBranchId = store.getLife(lifeId)!.latestBranchId;
    expect(beforeLatestBranchId).toBe(originalBranchId);

    // Cheaply simulate a persist failure: close the store's own DB connection. `ensureLoaded(lifeId)`
    // still succeeds (the life is already cache-resident, so it never touches the closed
    // connection), but the transactional persist inside `registerLifeBranch` (`db.exec("BEGIN")`)
    // throws on a closed `DatabaseSync` — the same shape of failure a real disk/IO error would be.
    store.close();

    const override = { id: "ov1", decisionId: "some-decision:protagonist:1505", optionId: "survive" };
    expect(() => store.registerLifeBranch(lifeId, "lb-attempted", originalBranchId, 1505, override, args.result, args.snapshots, "Changed in 1505")).toThrow();

    // The cached record must be exactly as it was before the failed attempt — no partial mutation
    // (`latestBranchId` still points at the original branch, and the attempted branch was never
    // added to `branches`), even though the failure happened AFTER `ensureLoaded` returned the
    // live, shared cached object.
    const life = store.getLife(lifeId)!;
    expect(life.latestBranchId).toBe(beforeLatestBranchId);
    expect(life.branches.has("lb-attempted")).toBe(false);
    expect([...life.branches.keys()]).toEqual([originalBranchId]);
  });

  it("decision 063 (engine-life-course PR4): a legacy Tudor-era socialClass reads mapped to its period class, with the stored bytes left untouched", async () => {
    const args = await buildLifeArgs("store-legacy-class");
    // A life "stored under the old code" is approximated here by overwriting the protagonist's
    // socialClass with a retired Tudor-era value before it's ever written to the DB — the exact
    // shape `remapLegacyClasses` must handle, since a real pre-rename life would have this value
    // already sitting in `result_json` on disk.
    const legacyResult = { ...args.result, people: { ...args.result.people, protagonist: { ...args.result.people.protagonist!, socialClass: "husbandman" as SocialClass } } };

    const writer = createLifeStore(dbPath);
    const lifeId = writer.newLifeId();
    const branchId = writer.newLifeBranchId();
    writer.registerLife(lifeId, branchId, args.config, args.protagonistName, args.protagonistSex, legacyResult, args.snapshots);
    writer.close();

    const reader = createLifeStore(dbPath);
    try {
      const branch = reader.getLifeBranch(lifeId, branchId);
      expect(branch!.result.people.protagonist!.socialClass).toBe("villein");

      const summary = reader.listLifeSummaries().find((s) => s.id === lifeId);
      expect(summary!.latestResult.people.protagonist!.socialClass).toBe("villein");
    } finally {
      reader.close();
    }

    // No migration: reading the RAW compressed row directly (bypassing the store entirely) still
    // shows the original legacy string — mapping happens only in the in-memory projection returned
    // to callers, never by rewriting the row.
    const raw = openDb(dbPath);
    try {
      const row = raw.prepare("SELECT result_json FROM life_branches WHERE id = ?").get(branchId) as { result_json: Uint8Array };
      const storedResult = decompressJson<typeof legacyResult>(row.result_json);
      expect(storedResult.people.protagonist!.socialClass).toBe("husbandman");
    } finally {
      raw.close();
    }
  });
});

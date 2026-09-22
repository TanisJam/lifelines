import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RuleDecisionMaker } from "@/adapters/decision/rule-decision-maker";
import { simulate } from "@/domain/simulate";
import { generateWorld } from "@/domain/worldgen";
import { createWorldStore } from "./world-store";

async function buildWorldArgs(seed: string) {
  const { config, people, events } = generateWorld({ seed, startYear: 1500, endYear: 1520, founderCount: 8 });
  const report = await simulate(config, people, events, { decisionMaker: new RuleDecisionMaker(), engineSource: "rules" });
  return { config, result: report.result, snapshots: report.snapshots };
}

describe("world-store SQLite persistence (self-hosted Docker deploy)", () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), "lifelines-world-store-test-"));
    dbPath = path.join(dir, "lifelines.db");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("round-trips a world through a fresh store instance against the same DB file, with equal content", async () => {
    const args = await buildWorldArgs("world-roundtrip");

    const writer = createWorldStore(dbPath);
    const written = writer.createWorld(args.config, args.result, args.snapshots);
    writer.close();

    const reader = createWorldStore(dbPath);
    try {
      const readBack = reader.getWorld(written.id);
      expect(readBack).toBeDefined();
      expect(readBack!.id).toBe(written.id);
      expect(readBack!.originalBranchId).toBe(written.originalBranchId);
      expect(readBack!.config).toEqual(args.config);

      const branch = reader.getBranch(written.id, written.originalBranchId);
      expect(branch).toBeDefined();
      // Compared against a plain JSON round-trip of the original, not the original object itself:
      // records are serialized as JSON (per design), so JSON-only quirks (e.g. `-0` collapsing to
      // `0`) are expected and not a persistence bug — this asserts "the store round-trips exactly
      // what JSON.stringify/parse would", which is the actual contract.
      expect(branch!.result).toEqual(JSON.parse(JSON.stringify(args.result)));
      expect(branch!.label).toBe("Original timeline");
      expect(branch!.snapshots).toBeInstanceOf(Map);
      expect(branch!.snapshots.size).toBe(args.snapshots.size);
      for (const [year, snapshot] of args.snapshots) {
        expect(branch!.snapshots.get(year)).toEqual(JSON.parse(JSON.stringify(snapshot)));
      }

      expect(reader.listBranches(written.id).map((b) => b.id)).toEqual([written.originalBranchId]);
    } finally {
      reader.close();
    }
  });

  it("round-trips an added branch (override, parentBranchId, forkYear)", async () => {
    const args = await buildWorldArgs("world-roundtrip-branch");
    const writer = createWorldStore(dbPath);
    const world = writer.createWorld(args.config, args.result, args.snapshots);

    const override = { id: "ov1", decisionId: "some-decision:p1:1510", optionId: "survive" };
    const added = writer.addBranch(world.id, world.originalBranchId, 1510, override, args.result, args.snapshots, "Changed in 1510");
    expect(added).toBeDefined();
    writer.close();

    const reader = createWorldStore(dbPath);
    try {
      const branch = reader.getBranch(world.id, added!.id);
      expect(branch!.override).toEqual(override);
      expect(branch!.parentBranchId).toBe(world.originalBranchId);
      expect(branch!.forkYear).toBe(1510);
      expect(branch!.label).toBe("Changed in 1510");
      expect(reader.listBranches(world.id).map((b) => b.id).sort()).toEqual([world.originalBranchId, added!.id].sort());
    } finally {
      reader.close();
    }
  });

  it("ids stay unique across a simulated restart (counters persisted, not re-seeded at 0)", () => {
    const first = createWorldStore(dbPath);
    const worldIdsFromFirstProcess = [first.newWorldId(), first.newWorldId(), first.newWorldId()];
    const branchIdsFromFirstProcess = [first.newBranchId(), first.newBranchId()];
    first.close();

    const second = createWorldStore(dbPath);
    try {
      const worldIdsFromSecondProcess = [second.newWorldId(), second.newWorldId()];
      const branchIdsFromSecondProcess = [second.newBranchId()];

      const allWorldIds = [...worldIdsFromFirstProcess, ...worldIdsFromSecondProcess];
      expect(new Set(allWorldIds).size).toBe(allWorldIds.length);

      const allBranchIds = [...branchIdsFromFirstProcess, ...branchIdsFromSecondProcess];
      expect(new Set(allBranchIds).size).toBe(allBranchIds.length);

      const counterOf = (id: string) => Number(id.match(/^w(\d+)-/)![1]);
      expect(counterOf(worldIdsFromSecondProcess[0]!)).toBeGreaterThan(counterOf(worldIdsFromFirstProcess[2]!));
    } finally {
      second.close();
    }
  });

  it("a cache size of 1 evicts the first world once a second is written, but an added branch survives the eviction intact", async () => {
    const argsA = await buildWorldArgs("world-lru-a");
    const argsB = await buildWorldArgs("world-lru-b");

    const store = createWorldStore(dbPath, 1);
    try {
      const worldA = store.createWorld(argsA.config, argsA.result, argsA.snapshots);

      const override = { id: "ov1", decisionId: "some-decision:p1:1505", optionId: "survive" };
      const addedBranch = store.addBranch(worldA.id, worldA.originalBranchId, 1505, override, argsA.result, argsA.snapshots, "Changed in 1505");
      expect(addedBranch).toBeDefined();

      // A second world evicts A from the (size-1) cache.
      const worldB = store.createWorld(argsB.config, argsB.result, argsB.snapshots);
      expect(worldA.id).not.toBe(worldB.id);

      // Reading A back reloads from SQLite and must still have both branches.
      const reloadedBranches = store.listBranches(worldA.id);
      expect(reloadedBranches.map((b) => b.id).sort()).toEqual([worldA.originalBranchId, addedBranch!.id].sort());
      const reloadedAdded = store.getBranch(worldA.id, addedBranch!.id);
      expect(reloadedAdded!.override).toEqual(override);
      expect(reloadedAdded!.parentBranchId).toBe(worldA.originalBranchId);
      expect(reloadedAdded!.forkYear).toBe(1505);

      expect(store.getWorld(worldB.id)).toBeDefined();
    } finally {
      store.close();
    }
  });

  it("a second store instance (write-through cache) sees a write immediately without a restart", async () => {
    const args = await buildWorldArgs("world-live-two-handles");
    const a = createWorldStore(dbPath);
    const b = createWorldStore(dbPath);
    try {
      const world = a.createWorld(args.config, args.result, args.snapshots);
      expect(b.getWorld(world.id)).toBeDefined();
    } finally {
      a.close();
      b.close();
    }
  });

  it("a persist failure during addBranch leaves the cached record unchanged (never partially mutated)", async () => {
    const args = await buildWorldArgs("world-persist-failure");
    const store = createWorldStore(dbPath);
    const world = store.createWorld(args.config, args.result, args.snapshots);

    const beforeBranchIds = [...store.getWorld(world.id)!.branches.keys()];
    expect(beforeBranchIds).toEqual([world.originalBranchId]);

    // Cheaply simulate a persist failure the same way as life-store.test.ts: close the store's own
    // DB connection. `ensureLoaded(worldId)` still succeeds (cache-resident, never touches the
    // closed connection), but the transactional persist inside `addBranch` throws on the closed
    // `DatabaseSync`.
    store.close();

    const override = { id: "ov1", decisionId: "some-decision:p1:1505", optionId: "survive" };
    expect(() => store.addBranch(world.id, world.originalBranchId, 1505, override, args.result, args.snapshots, "Changed in 1505")).toThrow();

    // The cached record's `branches` map must be exactly as it was — the attempted branch was never
    // added, even though the failure happened AFTER `ensureLoaded` returned the live, shared cached
    // object.
    const reloaded = store.getWorld(world.id)!;
    expect([...reloaded.branches.keys()]).toEqual(beforeBranchIds);
  });
});

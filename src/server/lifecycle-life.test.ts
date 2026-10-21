import type { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import type { LifeStreamEvent } from "@/contracts/life";
import { createLifecycleCompactCapsule, type LifecycleCompactCapsule } from "@/domain/e-lifecycle-capsule";
import { createLifecycleGenesis } from "@/domain/e-lifecycle-genesis";
import { runLifecycle } from "@/domain/e-lifecycle-run";
import { initializeWorld } from "@/domain/world-origin";
import { openDb } from "./db";
import { LIFECYCLE_MAX_STEPS, streamLifecycleLife, type LifecycleLifeRequest } from "./lifecycle-life";
import { LifecycleRepository } from "./lifecycle-repository";

/**
 * RI1c (spec S7): the create-side orchestration for a new-engine life — genesis, one bounded run,
 * one tick per regenerated journal year, the projection, and the persist. These cases drive it
 * without any HTTP, `Request` or SSE surface, so the only variable is the lifecycle output itself.
 *
 * The engine currently ends a protagonist's life at age 1-2 (measured in RI1's L8), so a "complete"
 * run here is genuinely short; every expectation is computed from a fresh full-authority
 * regeneration, never from a hand-built fixture.
 */
const SEED = "ri1c-lifecycle-1";
const LIFE = "life-ri1c";
const BRANCH = "branch-ri1c";
const initialization = {
  seed: SEED, startYear: 1327, endYear: 1327 + LIFECYCLE_MAX_STEPS,
  protagonist: { name: "Alice", sex: "f" as const },
};

function resourcesFor(world: ReturnType<typeof initializeWorld>["world"]) {
  return Object.fromEntries(Object.keys(world.people).map((id) => [id, { grain: 2, effort: 3, need: 1 }]));
}

/** A fresh full current-authority regeneration of exactly the request the module was given. */
async function freshCapsule(): Promise<LifecycleCompactCapsule> {
  const { world } = initializeWorld(initialization);
  const genesis = createLifecycleGenesis({
    initialization, protagonistId: "protagonist", resources: resourcesFor(world),
  });
  const run = await runLifecycle({ kind: "start", genesis }, { maxSteps: LIFECYCLE_MAX_STEPS });
  if (run.status !== "complete") throw new Error(`fixture life did not end: ${run.status}`);
  return createLifecycleCompactCapsule({ genesis: run.capsule.genesis, output: run.capsule.output });
}

function database(): { db: DatabaseSync; repository: LifecycleRepository } {
  const db = openDb(":memory:");
  return { db, repository: new LifecycleRepository(db) };
}

function count(db: DatabaseSync, table: string): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
}

interface Harness {
  readonly frames: LifeStreamEvent[];
  /** Emitted frames and frame flushes in the exact order they happened. */
  readonly log: string[];
  readonly emit: (event: LifeStreamEvent) => void;
  readonly flushFrame: () => Promise<void>;
}

function harness(): Harness {
  const frames: LifeStreamEvent[] = [];
  const log: string[] = [];
  return {
    frames,
    log,
    emit: (event) => {
      frames.push(event);
      log.push(event.type === "tick" ? `tick:${event.year}` : event.type);
    },
    flushFrame: async () => { log.push("flush"); },
  };
}

function request(
  overrides: Partial<Omit<LifecycleLifeRequest, "emit" | "flushFrame">> & Pick<LifecycleLifeRequest, "repository">,
): Omit<LifecycleLifeRequest, "emit" | "flushFrame"> {
  return {
    lifeId: LIFE, branchId: BRANCH, name: "Alice", sex: "f", seed: SEED, locale: "en",
    signal: new AbortController().signal,
    ...overrides,
  };
}

function startOf(event: LifeStreamEvent | undefined): Extract<LifeStreamEvent, { type: "start" }> {
  if (event?.type !== "start") throw new Error(`Expected a start frame, got ${event?.type ?? "nothing"}`);
  return event;
}
function doneOf(event: LifeStreamEvent | undefined): Extract<LifeStreamEvent, { type: "done" }> {
  if (event?.type !== "done") throw new Error(`Expected a done frame, got ${event?.type ?? "nothing"}`);
  return event;
}
function errorOf(event: LifeStreamEvent | undefined): Extract<LifeStreamEvent, { type: "error" }> {
  if (event?.type !== "error") throw new Error(`Expected an error frame, got ${event?.type ?? "nothing"}`);
  return event;
}
function ticksOf(frames: readonly LifeStreamEvent[]): Extract<LifeStreamEvent, { type: "tick" }>[] {
  return frames.filter((frame): frame is Extract<LifeStreamEvent, { type: "tick" }> => frame.type === "tick");
}

describe("lifecycle create orchestration (RI1c)", () => {
  it("streams a start, one tick per regenerated journal year, then done, and publishes a reloadable capsule", async () => {
    const { db, repository } = database();
    try {
      const wire = harness();
      await streamLifecycleLife({ ...request({ repository }), emit: wire.emit, flushFrame: wire.flushFrame });

      const start = startOf(wire.frames[0]);
      expect(start.lifeId).toBe(LIFE);
      expect(start.branchId).toBe(BRANCH);
      expect(start.protagonist).toEqual({ name: "Alice", sex: "f", birthYear: 1327 });
      expect(start.villageName.length).toBeGreaterThan(0);

      const ticks = ticksOf(wire.frames);
      expect(ticks.length).toBeGreaterThan(0);
      // Regenerated journal order, starting at the genesis year, no year reordered, invented or skipped.
      expect(ticks.map((tick) => tick.year)).toEqual(ticks.map((_, index) => 1327 + index));

      const done = doneOf(wire.frames.at(-1));
      expect(done.chronicle.lifeId).toBe(LIFE);
      expect(done.chronicle.branchId).toBe(BRANCH);
      expect(done.chronicle.villageName).toBe(start.villageName);
      expect(done.chronicle.protagonist.name).toBe("Alice");
      expect(done.chronicle.protagonist.birthYear).toBe(1327);
      expect(done.chronicle.protagonist.deathYear).toBe(ticks.at(-1)!.year);
      expect(ticks.length).toBe(done.chronicle.protagonist.deathYear - done.chronicle.protagonist.birthYear + 1);
      // The new engine makes no Jev calls: its own counters are zero, never borrowed or estimated.
      expect(done.stats).toEqual({ jevCalls: 0, cacheHits: 0, wallTimeMs: expect.any(Number) });
      expect(Number.isInteger(done.stats.wallTimeMs)).toBe(true);
      expect(done.stats.wallTimeMs).toBeGreaterThanOrEqual(0);

      // Frame order and the per-frame flush discipline, in one exact sequence.
      expect(wire.log).toEqual([
        "start",
        ...ticks.map((tick) => `tick:${tick.year}`).flatMap((tick) => [tick, "flush"]),
        "done",
      ]);

      const loaded = await repository.load(LIFE, BRANCH);
      expect(loaded).toBeDefined();
      expect(loaded!.capsule.digest).toBe((await freshCapsule()).digest);
      expect(count(db, "lifecycle_lives")).toBe(1);
      expect(count(db, "lifecycle_bindings")).toBe(1);
      // The lifecycle path never writes the legacy tables.
      expect(count(db, "lives")).toBe(0);
      expect(count(db, "life_branches")).toBe(0);
    } finally {
      db.close();
    }
  }, 120_000);

  it("refuses a life the step budget left alive and persists nothing", async () => {
    // Explicit budget, not a hidden constant: the module defaults to the legacy 100-year horizon.
    expect(LIFECYCLE_MAX_STEPS).toBe(100);
    const { db, repository } = database();
    try {
      const wire = harness();
      await streamLifecycleLife({ ...request({ repository, maxSteps: 1 }), emit: wire.emit, flushFrame: wire.flushFrame });

      expect(wire.frames.map((frame) => frame.type)).toEqual(["start", "error"]);
      expect(errorOf(wire.frames[1]).message).toBe("This life has not yet ended.");
      expect(count(db, "lifecycle_lives")).toBe(0);
      expect(count(db, "lifecycle_bindings")).toBe(0);
      expect(count(db, "lifecycle_capsules_v1")).toBe(0);
    } finally {
      db.close();
    }
  });

  it("persists nothing and sends no done when the client already aborted", async () => {
    const { db, repository } = database();
    try {
      const wire = harness();
      const controller = new AbortController();
      controller.abort();
      await streamLifecycleLife({
        ...request({ repository, signal: controller.signal }), emit: wire.emit, flushFrame: wire.flushFrame,
      });

      expect(wire.frames.map((frame) => frame.type)).toEqual(["start"]);
      expect(count(db, "lifecycle_lives")).toBe(0);
      expect(count(db, "lifecycle_bindings")).toBe(0);
      expect(count(db, "lifecycle_capsules_v1")).toBe(0);
    } finally {
      db.close();
    }
  });

  it("takes the village name from the initialised world, including a requested override", async () => {
    const { db, repository } = database();
    try {
      const wire = harness();
      await streamLifecycleLife({
        ...request({ repository, villageName: "Ravenford" }), emit: wire.emit, flushFrame: wire.flushFrame,
      });

      expect(startOf(wire.frames[0]).villageName).toBe("Ravenford");
      const loaded = await repository.load(LIFE, BRANCH);
      expect(loaded!.capsule.genesis.initial.config.town.name).toBe("Ravenford");
    } finally {
      db.close();
    }
  }, 60_000);

  it("resolves a requested \"random\" sex through the world origin and persists that resolved sex", async () => {
    const { db, repository } = database();
    try {
      const wire = harness();
      await streamLifecycleLife({ ...request({ repository, sex: "random" }), emit: wire.emit, flushFrame: wire.flushFrame });

      const start = startOf(wire.frames[0]);
      expect(["f", "m"]).toContain(start.protagonist.sex);
      const loaded = await repository.load(LIFE, BRANCH);
      expect(loaded!.capsule.genesis.origin.sex.resolved).toBe(start.protagonist.sex);
      const row = db.prepare("SELECT protagonist_sex FROM lifecycle_lives WHERE id = ?").get(LIFE) as { protagonist_sex: string };
      expect(row.protagonist_sex).toBe(start.protagonist.sex);
    } finally {
      db.close();
    }
  }, 60_000);

  it("never sends done when publication refuses", async () => {
    const wire = harness();
    const refusing = { publish: async () => { throw new Error("publication refused"); } };
    await expect(streamLifecycleLife({
      ...request({ repository: refusing }), emit: wire.emit, flushFrame: wire.flushFrame,
    })).rejects.toThrow("publication refused");
    expect(wire.frames.some((frame) => frame.type === "done")).toBe(false);
    expect(ticksOf(wire.frames).length).toBeGreaterThan(0);
  }, 60_000);
});

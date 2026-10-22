import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LifeStreamEvent } from "@/contracts/life";
import { createLifecycleCompactCapsule } from "@/domain/e-lifecycle-capsule";
import { createLifecycleGenesis } from "@/domain/e-lifecycle-genesis";
import { runLifecycle } from "@/domain/e-lifecycle-run";
import { createMind } from "@/domain/mind";
import type { SimulateReport } from "@/domain/simulate";
import { initializeWorld } from "@/domain/world-origin";
import { getDb } from "@/server/db";
import {
  LIFECYCLE_CREATE_QUEUE_LIMIT,
  lifecycleCreateQueueState,
  requestLifecycleCreateSlot,
} from "@/server/lifecycle-create-queue";
import { LifecycleRepository } from "@/server/lifecycle-repository";

/**
 * RI1c (specs S2, S7): route activation of the new engine. `engine: "lifecycle"` runs the
 * lifecycle seam end to end through the EXISTING POST + SSE contract and persists through the
 * lifecycle repository; every other request keeps the legacy path.
 *
 * The lifecycle cases are deliberately unmocked downstream of the route (real engine, real
 * projection, real SQLite; `vitest.setup.ts` gives this file its own temp `DATA_DIR`) so the
 * persisted capsule can be compared against a fresh full-authority regeneration. Only the legacy
 * path's expensive I/O is mocked, exactly as `route.test.ts` does, so no provider or legacy store
 * is touched.
 */
const mocks = vi.hoisted(() => ({
  guard: vi.fn(async () => ({ engine: { decisionMaker: {}, engineSource: "rules" as const } })),
  register: vi.fn(),
  build: vi.fn(),
  drain: vi.fn(),
  serial: 0,
}));

vi.mock("@/server/abuse-guard", () => ({
  guardSimulation: (...args: unknown[]) => mocks.guard(...(args as [])),
}));
vi.mock("@/server/decision-engine", () => ({
  snapshotDecisionMakerStats: () => ({}),
  decisionMakerRunStats: () => ({ cacheHits: 0 }),
}));
vi.mock("@/domain/simulate", async (original) => ({
  ...await original<typeof import("@/domain/simulate")>(),
  simulateYears: vi.fn(),
  drainSimulation: (...args: unknown[]) => mocks.drain(...(args as [])),
}));
vi.mock("@/server/life-store", () => ({
  newLifeId: () => `life-route-${++mocks.serial}`,
  newLifeBranchId: () => `branch-route-${++mocks.serial}`,
  registerLife: (...args: unknown[]) => mocks.register(...(args as [])),
}));
// Partial, not wholesale: the lifecycle projection shares this module's real pure builders.
vi.mock("@/server/life-chronicle", async (original) => ({
  ...await original<typeof import("@/server/life-chronicle")>(),
  buildCandidateLifeChronicle: (...args: unknown[]) => mocks.build(...(args as [])),
}));

import { POST } from "./route";

const SEED = "ri1c-route-lifecycle-1";
const initialization = {
  seed: SEED, startYear: 1327, endYear: 1427, protagonist: { name: "Alice", sex: "f" as const },
};

/** The legacy path's own simulation report, shaped exactly as `route.test.ts` builds it. */
function legacyReport(): SimulateReport {
  const people = {
    protagonist: {
      id: "protagonist", name: "Testa", sex: "f" as const, birthYear: 1327, deathYear: 1328,
      traits: [], job: "none" as const, founder: false, mind: createMind("route", "protagonist", 1327),
    },
  };
  const events = [{ id: "death", kind: "death" as const, year: 1328, actors: ["protagonist"], causes: [], payload: {} }];
  const result = {
    config: { seed: "route", startYear: 1327, endYear: 1427, town: { name: "Testford" } },
    people, events, decisions: [],
  };
  return {
    result, snapshots: new Map([[1328, { year: 1328, people, events, decisions: [] }]]),
    decisionCalls: 0, wallTimeMs: 0, hazardFallbacks: {},
  };
}

/** A fresh full current-authority regeneration of the exact request the route accepted. */
async function freshCompact() {
  const { world } = initializeWorld(initialization);
  const genesis = createLifecycleGenesis({
    initialization, protagonistId: "protagonist",
    resources: Object.fromEntries(Object.keys(world.people).map((id) => [id, { grain: 2, effort: 3, need: 1 }])),
  });
  const run = await runLifecycle({ kind: "start", genesis }, { maxSteps: 100 });
  if (run.status !== "complete") throw new Error(`fixture life did not end: ${run.status}`);
  return createLifecycleCompactCapsule({ genesis: run.capsule.genesis, output: run.capsule.output });
}

function jsonRequest(body: unknown): Request {
  return new Request("http://local/api/lives/stream", { method: "POST", body: JSON.stringify(body) });
}

/** Row counts of every table the two paths can write, so each request proves its own footprint. */
function counts(): Record<string, number> {
  const tables = ["lives", "life_branches", "lifecycle_lives", "lifecycle_bindings", "lifecycle_capsules_v1"];
  return Object.fromEntries(tables.map((table) => [table, (getDb().prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n]));
}

interface SseFrame {
  readonly event: string;
  readonly data: LifeStreamEvent;
}

/** Same POST-body SSE frame parsing src/lib/sse.ts uses client-side. */
async function collectFrames(res: Response): Promise<SseFrame[]> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const frames: SseFrame[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      let event = "message";
      let dataText = "";
      for (const line of part.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) dataText += line.slice(5).trim();
      }
      if (dataText) frames.push({ event, data: JSON.parse(dataText) as LifeStreamEvent });
    }
  }
  return frames;
}

function startOf(event: LifeStreamEvent | undefined): Extract<LifeStreamEvent, { type: "start" }> {
  if (event?.type !== "start") throw new Error(`Expected a start frame, got ${event?.type ?? "nothing"}`);
  return event;
}
function doneOf(event: LifeStreamEvent | undefined): Extract<LifeStreamEvent, { type: "done" }> {
  if (event?.type !== "done") throw new Error(`Expected a done frame, got ${event?.type ?? "nothing"}`);
  return event;
}
function ticksOf(frames: readonly SseFrame[]): Extract<LifeStreamEvent, { type: "tick" }>[] {
  return frames
    .filter((frame): frame is SseFrame & { data: Extract<LifeStreamEvent, { type: "tick" }> } => frame.data.type === "tick")
    .map((frame) => frame.data);
}

afterAll(() => {
  try { getDb().close(); } catch { /* Never opened. */ }
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Network is forbidden in route tests"); }));
  mocks.drain.mockResolvedValue(legacyReport());
  mocks.build.mockResolvedValue({ data: { entries: [] } });
});

afterEach(() => vi.unstubAllGlobals());

describe("POST /api/lives/stream — new-engine activation (RI1c)", () => {
  it("streams and persists a lifecycle life through the existing contract, reloadable as the same regeneration", async () => {
    const before = counts();
    const res = await POST(jsonRequest({ name: "Alice", sex: "f", seed: SEED, engine: "lifecycle" }));
    expect(res.status).toBe(200);
    const frames = await collectFrames(res);

    expect(frames[0]!.event).toBe("start");
    const start = startOf(frames[0]!.data);
    expect(start.protagonist).toEqual({ name: "Alice", sex: "f", birthYear: 1327 });
    expect(start.villageName.length).toBeGreaterThan(0);

    const ticks = ticksOf(frames);
    expect(ticks.length).toBeGreaterThan(0);
    expect(ticks.map((tick) => tick.year)).toEqual(ticks.map((_, index) => 1327 + index));

    expect(frames.at(-1)!.event).toBe("done");
    const done = doneOf(frames.at(-1)!.data);
    expect(done.chronicle.lifeId).toBe(start.lifeId);
    expect(done.chronicle.branchId).toBe(start.branchId);
    expect(done.chronicle.villageName).toBe(start.villageName);
    expect(done.chronicle.protagonist.deathYear).toBe(ticks.at(-1)!.year);
    expect(done.stats).toEqual({ jevCalls: 0, cacheHits: 0, wallTimeMs: expect.any(Number) });

    // Persistence authority: load FULL-regenerates, and the stored digest equals a fresh regeneration.
    const loaded = await new LifecycleRepository(getDb()).load(start.lifeId, start.branchId);
    expect(loaded).toBeDefined();
    expect(loaded!.capsule.digest).toBe((await freshCompact()).digest);
    expect(counts()).toEqual({
      ...before,
      lifecycle_lives: before.lifecycle_lives! + 1,
      lifecycle_bindings: before.lifecycle_bindings! + 1,
      lifecycle_capsules_v1: before.lifecycle_capsules_v1! + 1,
    });

    // The lifecycle branch reuses the existing admission guard and never the legacy simulation path.
    expect(mocks.guard).toHaveBeenCalledOnce();
    expect(mocks.drain).not.toHaveBeenCalled();
    expect(mocks.build).not.toHaveBeenCalled();
    expect(mocks.register).not.toHaveBeenCalled();
  }, 120_000);

  it.each([undefined, "legacy"] as const)("keeps the legacy path when engine is %s", async (engine) => {
    const before = counts();
    const res = await POST(jsonRequest({ name: "Testa", sex: "f", seed: "route", ...(engine === undefined ? {} : { engine }) }));
    expect(res.status).toBe(200);
    const frames = await collectFrames(res);
    expect(frames.map((frame) => frame.event)).toEqual(["start", "done"]);

    expect(mocks.guard).toHaveBeenCalledOnce();
    expect(mocks.drain).toHaveBeenCalledOnce();
    expect(mocks.build).toHaveBeenCalledOnce();
    expect(mocks.register).toHaveBeenCalledOnce();
    // The legacy path never writes the lifecycle tables (and vice versa).
    expect(counts()).toEqual(before);
  });

  it("rejects an unknown engine with the existing JSON error shape before any admission", async () => {
    const before = counts();
    const res = await POST(jsonRequest({ name: "Testa", sex: "f", seed: "route", engine: "annual" }));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: '"engine" must be "legacy" or "lifecycle".' });
    expect(mocks.guard).not.toHaveBeenCalled();
    expect(counts()).toEqual(before);
  });

  it("refuses with 429 when the create gate's waiting list is full", async () => {
    const opened = [];
    try {
      // One running + the whole waiting list. The queue is a memory guardrail: refusing is honest.
      for (let index = 0; index <= LIFECYCLE_CREATE_QUEUE_LIMIT; index++) opened.push(requestLifecycleCreateSlot());
      const res = await POST(jsonRequest({ name: "Blocked", sex: "f", seed: SEED, engine: "lifecycle" }));
      expect(res.status).toBe(429);
      const body = (await res.json()) as { error?: string };
      expect(body.error).toMatch(/waiting list is full/i);
    } finally {
      for (const ticket of opened) ticket.release();
    }
    // The refusal left no slot behind.
    expect(lifecycleCreateQueueState()).toEqual({ active: 0, waiting: 0 });
  });

});

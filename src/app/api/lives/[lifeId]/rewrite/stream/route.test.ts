import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SimulationAbortedError, type SimulateReport } from "@/domain/simulate";
import { createMind } from "@/domain/mind";
import type { LifeStreamEvent } from "@/contracts/life";

const mocks = vi.hoisted(() => ({
  drain: vi.fn(), life: vi.fn(), branch: vi.fn(), register: vi.fn(), build: vi.fn(), provisional: vi.fn(), stream: false,
  abort: new AbortController(), frames: [] as { event: string; data: unknown }[],
}));
vi.mock("@/server/abuse-guard", () => ({ guardSimulation: async () => ({ engine: { decisionMaker: {}, engineSource: "rules" } }) }));
vi.mock("@/server/decision-engine", () => ({ snapshotDecisionMakerStats: () => ({}), decisionMakerRunStats: () => ({ cacheHits: 0 }) }));
vi.mock("@/domain/fork", () => ({ getRestoreSnapshot: () => ({ people: { protagonist: { birthYear: 1327 } }, events: [] }) }));
vi.mock("@/domain/validate-override", () => ({ validateOverride: () => ({ ok: true }) }));
vi.mock("@/domain/simulate", async (original) => ({ ...await original<typeof import("@/domain/simulate")>(), simulateYears: vi.fn(), drainSimulation: mocks.drain }));
vi.mock("@/server/life-store", () => ({ getLife: mocks.life, getLifeBranch: mocks.branch, listLifeBranches: () => [mocks.branch()], newLifeBranchId: () => "candidate", registerLifeBranch: mocks.register }));
vi.mock("@/server/life-scene", () => ({ friendSeenBefore: vi.fn(), createSceneTracker: () => ({ observe: vi.fn(), scene: () => ({ people: [{ id: "protagonist" }] }) }) }));
vi.mock("@/server/life-chronicle", () => ({ buildLifeChronicle: mocks.build, buildCandidateLifeChronicle: mocks.build, buildProvisionalTickEntries: mocks.provisional }));
vi.mock("@/server/sse", () => ({
  yieldToEventLoop: async () => {},
  sseResponse: async (handler: (send: (event: string, data: unknown) => void, signal: AbortSignal) => Promise<void>) => {
    if (mocks.stream) {
      const { sseResponse } = await vi.importActual<typeof import("@/server/sse")>("@/server/sse");
      return sseResponse(handler);
    }
    try { await handler((event, data) => mocks.frames.push({ event, data }), mocks.abort.signal); }
    catch (error) { if (!mocks.abort.signal.aborted) mocks.frames.push({ event: "error", data: { message: String(error) } }); }
    return new Response();
  },
}));
import { POST } from "./route";

function report(alive = false): SimulateReport {
  const people = {
    protagonist: {
      id: "protagonist", name: "Testa", sex: "f" as const, birthYear: 1327,
      deathYear: alive ? undefined : 1328, traits: [], job: "none" as const,
      founder: false, mind: createMind("route", "protagonist", 1327),
    },
  };
  const events = alive ? [] : [{
    id: "death", kind: "death" as const, year: 1328,
    actors: ["protagonist"], causes: [], payload: {},
  }];
  const result = {
    config: { seed: "route", startYear: 1327, endYear: 1427, town: { name: "Testford" } },
    people, events, decisions: [],
  };
  const year = alive ? 1427 : 1328;
  return {
    result, snapshots: new Map([[year, { year, people, events, decisions: [] }]]),
    decisionCalls: 0, wallTimeMs: 0, hazardFallbacks: {},
  };
}
const request = () => new Request("http://local/api/lives/life/rewrite/stream", { method: "POST", body: JSON.stringify({ branchId: "base", decisionId: "choice", optionId: "new" }) });
const context = { params: Promise.resolve({ lifeId: "life" }) };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Network is forbidden in route tests"); }));
  mocks.abort = new AbortController();
  mocks.frames = [];
  mocks.stream = false;
  mocks.provisional.mockResolvedValue([]);
  const run = report();
  mocks.life.mockReturnValue({ config: run.result.config, protagonistName: "Testa", protagonistSex: "f", latestBranchId: "base" });
  mocks.branch.mockReturnValue({
    id: "base", lifeId: "life", label: "Original life", snapshots: run.snapshots,
    result: {
      ...run.result,
      decisions: [{
        id: "choice", year: 1327, chosen: "old",
        options: [{ id: "old", label: "Old" }, { id: "new", label: "New" }],
        resultingEventIds: [], kind: "vignette", personId: "protagonist",
      }],
    },
  });
  mocks.drain.mockResolvedValue(run);
  mocks.build.mockResolvedValue({ data: { entries: [] } });
  mocks.register.mockReturnValue({ id: "candidate" });
});

afterEach(() => vi.unstubAllGlobals());

describe("rewrite publication boundary", () => {
  it("does not publish when the real response body is cancelled during narration", async () => {
    mocks.stream = true;
    let release!: () => void;
    let entered!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { entered = resolve; });
    mocks.build.mockImplementation(async () => {
      entered();
      await pending;
      return { data: { entries: [] } };
    });
    const response = await POST(request(), context);
    await started;
    await response.body!.cancel();
    release();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(mocks.register).not.toHaveBeenCalled();
    expect(mocks.life().latestBranchId).toBe("base");
  });

  it("skips publication when the simulation drain is aborted", async () => {
    mocks.drain.mockRejectedValue(new SimulationAbortedError());
    await POST(request(), context);
    expect(mocks.register).not.toHaveBeenCalled();
    expect(mocks.frames.map((f) => f.event)).toEqual(["start", "divergence"]);
  });
  it("keeps the legacy missing-life 404", async () => {
    mocks.life.mockReturnValue(undefined);
    const response = await POST(request(), context);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Life not found." });
    expect(mocks.register).not.toHaveBeenCalled();
  });

  it("does not persist an actual alive cap or change latest", async () => {
    mocks.drain.mockResolvedValue(report(true));
    await POST(request(), context);
    expect(mocks.register).not.toHaveBeenCalled();
    expect(mocks.life().latestBranchId).toBe("base");
    expect(mocks.build).not.toHaveBeenCalled();
    expect(mocks.frames.map((f) => f.event)).toEqual(["start", "divergence", "error"]);
  });

  it.each(["returned", "thrown"])("does not persist %s narration failure", async (kind) => {
    if (kind === "returned") mocks.build.mockResolvedValue({ error: "Narration failed" });
    else mocks.build.mockRejectedValue(new Error("Narration failed"));
    await POST(request(), context);
    expect(mocks.register).not.toHaveBeenCalled();
    expect(mocks.frames.map((f) => f.event)).toEqual(["start", "divergence", "error"]);
  });

  it("does not narrate or persist cancellation after simulation", async () => {
    mocks.drain.mockImplementation(async () => { mocks.abort.abort(); return report(); });
    await POST(request(), context);
    expect(mocks.build).not.toHaveBeenCalled();
    expect(mocks.register).not.toHaveBeenCalled();
    expect(mocks.frames.map((f) => f.event)).toEqual(["start", "divergence"]);
  });

  it("does not persist cancellation during narration", async () => {
    mocks.build.mockImplementation(async () => { mocks.abort.abort(); return { data: { entries: [] } }; });
    await POST(request(), context);
    expect(mocks.register).not.toHaveBeenCalled();
    expect(mocks.frames.map((f) => f.event)).toEqual(["start", "divergence"]);
  });

  it("constructs a recorded-death chronicle before publishing with parent metadata and quiet death tick", async () => {
    const run = report();
    mocks.drain.mockImplementation(async (_generator, onYear) => {
      await onYear({ year: 1328, snapshot: run.snapshots.get(1328) });
      return run;
    });
    mocks.build.mockImplementation(async () => {
      expect(mocks.register).not.toHaveBeenCalled();
      return { data: { entries: [] } };
    });
    await POST(request(), context);
    expect(mocks.register).toHaveBeenCalledOnce();
    expect(mocks.frames.map((f) => f.event)).toEqual(["start", "divergence", "tick", "done"]);
    expect(mocks.frames[2]!.data).toMatchObject({ year: 1328, entries: [] });
    expect(mocks.build.mock.calls[0]![0]).toMatchObject({ id: "candidate", parentBranchId: "base", forkYear: 1327, label: "Changed in 1327" });
    expect(mocks.build.mock.calls[0]![1].map((b: { id: string }) => b.id)).toEqual(["base", "candidate"]);
  });
});

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

describe("POST /api/lives/:lifeId/rewrite/stream — incremental-simulation capability: live SSE ticks", () => {
  it("resumes simulateYears from the fork year: every tick is >= forkYear, all before 'done', with ghosts present", async () => {
    // Preserve the transport/fork assertions while simulation, narration, and persistence stay mocked.
    mocks.stream = true;
    const run = report();
    const forkYear = 1327;
    mocks.drain.mockImplementation(async (_generator, onYear) => {
      for (const year of [forkYear, 1328]) await onYear({ year, snapshot: run.snapshots.get(1328) });
      return run;
    });
    mocks.build.mockResolvedValue({ data: {
      entries: [], scene: { people: [{ id: "protagonist" }] }, protagonist: { deathYear: 1328 },
    } });
    const res = await POST(request(), context);
    expect(res.status).toBe(200);
    const frames = await collectFrames(res);
    const doneIndex = frames.findIndex((f) => f.event === "done");
    expect(doneIndex).toBeGreaterThan(-1);
    const doneData = frames[doneIndex]!.data as Extract<LifeStreamEvent, { type: "done" }>;
    expect(doneData.ghosts).toBeDefined();
    const tickFrames = frames.filter((f) => f.event === "tick") as { event: string; data: Extract<LifeStreamEvent, { type: "tick" }> }[];
    expect(tickFrames.length).toBeGreaterThan(0);
    expect(tickFrames.every((f) => frames.indexOf(f) < doneIndex)).toBe(true);
    expect(tickFrames.every((f) => f.data.year >= forkYear)).toBe(true);
    expect(tickFrames[0]!.data.year).toBe(forkYear);
    const years = tickFrames.map((f) => f.data.year);
    expect(years).toEqual(Array.from({ length: years.length }, (_, i) => forkYear + i));
    expect(years.at(-1)).toBe(doneData.chronicle.protagonist.deathYear);
    for (const f of tickFrames) expect(f.data.scene.people.some((p) => p.id === "protagonist")).toBe(true);
    expect(doneData.chronicle.scene.people.length).toBeGreaterThan(0);
    expect(mocks.register).toHaveBeenCalledOnce();
  });
});

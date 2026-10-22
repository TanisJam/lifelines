import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SimulationAbortedError, type SimulateReport } from "@/domain/simulate";
import { createMind } from "@/domain/mind";
import type { Chronicle, LifeStreamEvent } from "@/contracts/life";

const mocks = vi.hoisted(() => ({
  drain: vi.fn(), generate: vi.fn(), register: vi.fn(), build: vi.fn(), provisional: vi.fn(), stream: false,
  abort: new AbortController(), frames: [] as { event: string; data: unknown }[],
}));
vi.mock("@/server/abuse-guard", () => ({ guardSimulation: async () => ({ engine: { decisionMaker: {}, engineSource: "rules" } }) }));
vi.mock("@/server/decision-engine", () => ({ snapshotDecisionMakerStats: () => ({}), decisionMakerRunStats: () => ({ cacheHits: 0 }) }));
vi.mock("@/domain/worldgen", () => ({ generateWorld: mocks.generate }));
vi.mock("@/domain/simulate", async (original) => ({ ...await original<typeof import("@/domain/simulate")>(), simulateYears: vi.fn(), drainSimulation: mocks.drain }));
vi.mock("@/server/life-store", () => ({ newLifeId: () => "life", newLifeBranchId: () => "candidate", registerLife: mocks.register }));
vi.mock("@/server/life-scene", () => ({ createSceneTracker: () => ({ observe: vi.fn(), scene: () => ({ people: [{ id: "protagonist" }] }) }) }));
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
const request = () => new Request("http://local/api/lives/stream", { method: "POST", body: JSON.stringify({ name: "Testa", sex: "f", seed: "route" }) });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Network is forbidden in route tests"); }));
  mocks.abort = new AbortController();
  mocks.frames = [];
  mocks.stream = false;
  mocks.provisional.mockResolvedValue([]);
  const run = report();
  mocks.generate.mockReturnValue({ config: run.result.config, people: run.result.people, events: [] });
  mocks.drain.mockResolvedValue(run);
  mocks.build.mockResolvedValue({ data: { entries: [] } });
});

afterEach(() => vi.unstubAllGlobals());

describe("creation publication boundary", () => {
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
    const response = await POST(request());
    await started;
    await response.body!.cancel();
    release();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(mocks.register).not.toHaveBeenCalled();
  });

  it("skips publication when the simulation drain is aborted", async () => {
    mocks.drain.mockRejectedValue(new SimulationAbortedError());
    await POST(request());
    expect(mocks.register).not.toHaveBeenCalled();
    expect(mocks.frames.map((f) => f.event)).toEqual(["start"]);
  });
  it("does not persist an actual alive cap even if narration would accept it", async () => {
    mocks.drain.mockResolvedValue(report(true));
    await POST(request());
    expect(mocks.register).not.toHaveBeenCalled();
    expect(mocks.build).not.toHaveBeenCalled();
    expect(mocks.frames.map((f) => f.event)).toEqual(["start", "error"]);
  });

  it.each(["returned", "thrown"])("does not persist %s narration failure", async (kind) => {
    if (kind === "returned") mocks.build.mockResolvedValue({ error: "Narration failed" });
    else mocks.build.mockRejectedValue(new Error("Narration failed"));
    await POST(request());
    expect(mocks.register).not.toHaveBeenCalled();
    expect(mocks.frames.map((f) => f.event)).toEqual(["start", "error"]);
  });

  it("does not narrate or persist cancellation after simulation", async () => {
    mocks.drain.mockImplementation(async () => { mocks.abort.abort(); return report(); });
    await POST(request());
    expect(mocks.build).not.toHaveBeenCalled();
    expect(mocks.register).not.toHaveBeenCalled();
    expect(mocks.frames.map((f) => f.event)).toEqual(["start"]);
  });

  it("does not persist cancellation during narration", async () => {
    mocks.build.mockImplementation(async () => { mocks.abort.abort(); return { data: { entries: [] } }; });
    await POST(request());
    expect(mocks.register).not.toHaveBeenCalled();
    expect(mocks.frames.map((f) => f.event)).toEqual(["start"]);
  });

  it("constructs a recorded-death chronicle before publishing and preserves quiet death ticks", async () => {
    const run = report();
    mocks.drain.mockImplementation(async (_generator, onYear) => {
      await onYear({ year: 1328, snapshot: run.snapshots.get(1328) });
      return run;
    });
    mocks.build.mockImplementation(async () => {
      expect(mocks.register).not.toHaveBeenCalled();
      return { data: { entries: [] } };
    });
    await POST(request());
    expect(mocks.register).toHaveBeenCalledOnce();
    expect(mocks.frames.map((f) => f.event)).toEqual(["start", "tick", "done"]);
    expect(mocks.frames[1]!.data).toMatchObject({ year: 1328, entries: [] });
    expect(mocks.build.mock.calls[0]![0]).toMatchObject({ id: "candidate", result: run.result });
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

describe("POST /api/lives/stream — incremental-simulation capability: live SSE ticks", () => {
  it("sends a 'tick' frame for every simulated year of the protagonist's life, all before 'done'", async () => {
    // Preserve the transport/entry assertions with an offline simulation and narrator, not a provider or DB.
    mocks.stream = true;
    const run = report();
    const scene = { people: [{ id: "protagonist" }] };
    const entry = { id: "death", year: 1328, at: 1328.5, who: ["protagonist"], kind: "death", level: 3, title: "Death", prose: "Died", links: [] };
    mocks.provisional.mockImplementation(async (_id, year) => year === 1328 ? [entry] : []);
    mocks.drain.mockImplementation(async (_generator, onYear) => {
      for (const year of [1327, 1328]) await onYear({ year, snapshot: run.snapshots.get(1328) });
      return run;
    });
    mocks.build.mockResolvedValue({ data: {
      lifeId: "life", branchId: "candidate", protagonist: { birthYear: 1327, deathYear: 1328 },
      entries: [entry], scene,
    } });
    const res = await POST(request());
    expect(res.status).toBe(200);
    const frames = await collectFrames(res);
    const doneIndex = frames.findIndex((f) => f.event === "done");
    expect(doneIndex).toBeGreaterThan(-1);
    const doneData = frames[doneIndex]!.data as Extract<LifeStreamEvent, { type: "done" }>;
    const chronicle: Chronicle = doneData.chronicle;
    const tickFrames = frames.filter((f) => f.event === "tick") as { event: string; data: Extract<LifeStreamEvent, { type: "tick" }> }[];
    expect(tickFrames.length).toBeGreaterThan(0);
    expect(tickFrames.every((f) => frames.indexOf(f) < doneIndex)).toBe(true);
    const expectedYears = Array.from({ length: chronicle.protagonist.deathYear! - chronicle.protagonist.birthYear + 1 }, (_, i) => chronicle.protagonist.birthYear + i);
    expect(tickFrames.map((f) => f.data.year)).toEqual(expectedYears);
    for (const f of tickFrames) expect(f.data.scene.people.some((p) => p.id === "protagonist")).toBe(true);
    const lastScene = tickFrames[tickFrames.length - 1]!.data.scene;
    const doneIds = new Set(chronicle.scene.people.map((p) => p.id));
    for (const p of lastScene.people) expect(doneIds.has(p.id)).toBe(true);
    const doneEntries = new Map(chronicle.entries.map((e) => [e.id, e]));
    for (const f of tickFrames) {
      const sceneIds = new Set(f.data.scene.people.map((p) => p.id));
      for (const e of f.data.entries) {
        expect(e.at).toBeGreaterThanOrEqual(f.data.year);
        expect(e.at).toBeLessThan(f.data.year + 1);
        for (const id of e.who) expect(sceneIds.has(id)).toBe(true);
        if (doneEntries.has(e.id)) expect(doneEntries.get(e.id)!.at).toBe(e.at);
      }
    }
    expect(mocks.register).toHaveBeenCalledOnce();
  });
});

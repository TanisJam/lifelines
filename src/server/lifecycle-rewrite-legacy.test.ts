import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { createMind } from "@/domain/mind";
import type { SimulationResult, YearSnapshot } from "@/domain/types";

const state = vi.hoisted(() => ({ lifecycleRewrite: vi.fn() }));
vi.mock("@/server/lifecycle-rewrite", () => ({ streamLifecycleRewrite: state.lifecycleRewrite }));
vi.mock("@/server/abuse-guard", () => ({ guardSimulation: async () => ({ engine: { decisionMaker: {}, engineSource: "rules" } }) }));
vi.mock("@/server/decision-engine", () => ({ snapshotDecisionMakerStats: () => ({}), decisionMakerRunStats: () => ({ cacheHits: 0 }) }));
vi.mock("@/domain/simulate", () => ({
  SimulationAbortedError: class SimulationAbortedError extends Error {},
  simulateYears: () => [],
  drainSimulation: async () => ({ result: resultFixture, snapshots, decisionCalls: 0, wallTimeMs: 0, hazardFallbacks: {} }),
}));
vi.mock("@/domain/validate-override", () => ({ validateOverride: () => ({ ok: true }) }));
vi.mock("@/server/life-chronicle", () => ({
  buildCandidateLifeChronicle: async () => ({ data: { entries: [] } }),
  buildProvisionalTickEntries: async () => [],
}));
vi.mock("@/server/life-scene", () => ({ friendSeenBefore: () => [], createSceneTracker: () => ({ observe: () => {}, scene: () => ({ people: [] }) }) }));
vi.mock("@/server/completed-life", () => ({ assertCompletedLife: () => {} }));

const people = {
  protagonist: {
    id: "protagonist", name: "Testa", sex: "f" as const, birthYear: 1327,
    deathYear: 1328, traits: [], job: "none" as const, founder: false,
    mind: createMind("legacy-rewrite", "protagonist", 1327),
  },
};
const config = { seed: "legacy-rewrite", startYear: 1327, endYear: 1328, town: { name: "Testford" } } as SimulationResult["config"];
const decision = { id: "choice", year: 1327, chosen: "old", options: [{ id: "old", label: "Old" }, { id: "new", label: "New" }], resultingEventIds: [], kind: "vignette" as const, personId: "protagonist" };
const resultFixture = { config, people, events: [], decisions: [decision] } as unknown as SimulationResult;
const snapshots = new Map<number, YearSnapshot>([[1326, { year: 1326, people, events: [], decisions: [] } as YearSnapshot]]);

interface RewriteSignature { status: number; events: string[]; shape: unknown[] }

function schemaOf(value: unknown): unknown {
  if (Array.isArray(value)) return value.length ? [schemaOf(value[0])] : [];
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, schemaOf(child)]));
  return value === null ? "null" : typeof value;
}

async function postRewrite(lifeId: string): Promise<RewriteSignature> {
  const { POST } = await import("@/app/api/lives/[lifeId]/rewrite/stream/route");
  const response = await POST(new Request(`http://local/api/lives/${lifeId}/rewrite/stream`, {
    method: "POST", body: JSON.stringify({ branchId: "legacy-root", decisionId: "choice", optionId: "new" }),
  }), { params: Promise.resolve({ lifeId }) });
  const text = await response.text();
  if (!response.headers.get("content-type")?.includes("text/event-stream")) {
    return { status: response.status, events: [], shape: [JSON.parse(text) as unknown] };
  }
  const shape = text.trim().split("\n\n").filter(Boolean).map(frame => {
    const event = frame.split("\n").find(line => line.startsWith("event:"))?.slice(6).trim() ?? "message";
    const data = frame.split("\n").find(line => line.startsWith("data:"))?.slice(5).trim();
    return { event, data: data ? schemaOf(JSON.parse(data)) : null };
  });
  return { status: response.status, events: shape.map(frame => frame.event), shape };
}

it.skipIf(!process.env.U7_LEGACY_DB)("child legacy rewrite remains on the legacy path", async () => {
  vi.stubEnv("DATA_DIR", process.env.U7_LEGACY_DATA_DIR!);
  const { openDb } = await import("./db");
  const db = openDb(join(process.env.U7_LEGACY_DATA_DIR!, "lifelines.db"));
  try {
    const dbModule = await import("./db");
    vi.spyOn(dbModule, "getDb").mockReturnValue(db);
    state.lifecycleRewrite.mockImplementation(async () => new Response("unexpected lifecycle rewrite", { status: 590 }));
    const signature = await postRewrite("u7-legacy");
    if (state.lifecycleRewrite.mock.calls.length) throw new Error("Lifecycle rewrite path called for legacy life");
    writeFileSync(process.env.U7_LEGACY_RESULT!, JSON.stringify(signature));
  } finally { db.close(); vi.unstubAllEnvs(); }
}, 120_000);

it("keeps a legacy public rewrite unchanged across a fresh process", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lifelines-u7-legacy-"));
  const dataDir = join(dir, "data"), dbPath = join(dataDir, "lifelines.db"), expectedPath = join(dir, "parent.json"), childPath = join(dir, "child.json");
  const lifeId = "u7-legacy";
  try {
    const { mkdirSync } = await import("node:fs");
    mkdirSync(dataDir, { recursive: true });
    vi.stubEnv("DATA_DIR", dataDir);
    const { openDb } = await import("./db");
    const { createLifeStore } = await import("./life-store");
    const db = openDb(dbPath);
    vi.spyOn(await import("./db"), "getDb").mockReturnValue(db);
    const store = createLifeStore(dbPath);
    store.registerLife(lifeId, "legacy-root", config, "Testa", "f", resultFixture, snapshots);
    state.lifecycleRewrite.mockImplementation(async () => new Response("unexpected lifecycle rewrite", { status: 590 }));
    const beforeRestart = await postRewrite(lifeId);
    expect(beforeRestart.status).toBe(200);
    expect(beforeRestart.events).toEqual(["start", "divergence", "done"]);
    expect(state.lifecycleRewrite).not.toHaveBeenCalled();
    writeFileSync(expectedPath, JSON.stringify(beforeRestart));
    db.close();
    store.close();
    vi.unstubAllEnvs();
    const childEnv = { ...process.env };
    delete childEnv.VITEST;
    delete childEnv.VITEST_POOL_ID;
    delete childEnv.VITEST_WORKER_ID;
    Object.assign(childEnv, { U7_LEGACY_DB: dbPath, U7_LEGACY_DATA_DIR: dataDir, U7_LEGACY_RESULT: childPath });

    const childRun = spawnSync("pnpm", ["--config.verify-deps-before-run=ignore", "exec", "vitest", "run", "src/server/lifecycle-rewrite-legacy.test.ts", "--maxWorkers=1", "-t", "child legacy rewrite"], {
      env: childEnv, timeout: 120_000, encoding: "utf8", maxBuffer: 10_000_000,
    });
    if (childRun.status !== 0) throw new Error(`${childRun.stdout}\n${childRun.stderr}\n${childRun.error?.message ?? ""}`);
    const child = JSON.parse(readFileSync(childPath, "utf8")) as RewriteSignature;
    expect(child).toEqual(JSON.parse(readFileSync(expectedPath, "utf8")));
  } finally { vi.unstubAllEnvs(); rmSync(dir, { recursive: true, force: true }); }
}, 240_000);

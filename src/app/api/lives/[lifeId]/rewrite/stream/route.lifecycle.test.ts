import { beforeEach, expect, it, vi } from "vitest";
import { lifecycleCreateQueueState, requestLifecycleCreateSlot } from "@/server/lifecycle-create-queue";

const m = vi.hoisted(() => ({ resolve: vi.fn(), lookup: vi.fn(), resolveCapsule: vi.fn(), forkLoad: vi.fn(), load: vi.fn(), stream: vi.fn(), guard: vi.fn(), legacy: vi.fn(), allocate: vi.fn(), lifecycle: true }));
vi.mock("@/server/lifecycle-read", () => ({ isLifecycleLife: () => m.lifecycle, resolveLifecycleBranch: m.resolve }));
vi.mock("@/server/db", () => ({ getDb: () => ({}) }));
vi.mock("@/server/lifecycle-branch-store", () => ({ LifecycleBranchStore: class { decisionById = m.lookup; resolve = m.resolveCapsule; } }));
vi.mock("@/server/lifecycle-repository", () => ({ LifecycleRepository: class { load = m.load; }, loadStoredLifecycleFork: m.forkLoad }));
vi.mock("@/server/lifecycle-rewrite", () => ({ streamLifecycleRewrite: m.stream }));
vi.mock("@/server/abuse-guard", () => ({ guardSimulation: m.guard }));
vi.mock("@/server/life-store", () => ({ getLife: m.legacy, getLifeBranch: vi.fn(), listLifeBranches: vi.fn(), newLifeBranchId: m.allocate, registerLifeBranch: vi.fn() }));
import { POST } from "./route";

const target = { id: "choice", year: 1328, kind: "immigration", personId: "world", chosen: "old", options: [{ id: "old" }, { id: "new" }] };
const body = { branchId: "root", decisionId: "choice", optionId: "new" };
const req = (data: unknown = body, signal?: AbortSignal) => new Request("http://local/rewrite", { method: "POST", body: JSON.stringify(data), signal });
const ctx = { params: Promise.resolve({ lifeId: "life" }) };
beforeEach(() => {
  vi.clearAllMocks(); m.lifecycle = true;
  m.resolve.mockReturnValue({ kind: "found", selected: { branchId: "root", binding: { version: "canonical-lifecycle-cb1-1", capsuleDigest: "a".repeat(64) } } });
  m.lookup.mockReturnValue({ kind: "found", target });
  m.guard.mockResolvedValue({ engine: {} });
  m.load.mockResolvedValue({ capsule: { genesis: {}, output: { owned: { decisions: [target] } } } });
  m.allocate.mockReturnValue("child"); m.stream.mockResolvedValue(undefined);
});
it("validates fields before branch resolution", async () => {
  const response = await POST(req({}), ctx);
  expect(response.status).toBe(400); expect(await response.json()).toEqual({ error: '"branchId" is required.' }); expect(m.resolve).not.toHaveBeenCalled();
});
it("returns the shared resolver's missing branch response", async () => {
  m.resolve.mockReturnValue({ kind: "branch-missing" });
  const response = await POST(req(), ctx); expect(response.status).toBe(404); expect(await response.json()).toEqual({ error: "Branch not found." });
});
it("rejects unknown targets and options before admission", async () => {
  m.lookup.mockReturnValueOnce({ kind: "unknown" });
  const missing = await POST(req(), ctx); expect(await missing.json()).toEqual({ error: 'No such decision "choice" in this branch.' });
  const option = await POST(req({ ...body, optionId: "bad" }), ctx); expect(await option.json()).toEqual({ error: '"bad" is not one of this decision\'s options.' });
  expect(m.guard).not.toHaveBeenCalled(); expect(m.load).not.toHaveBeenCalled();
});
it("rejects the same choice without replay or allocation", async () => {
  const response = await POST(req({ ...body, optionId: "old" }), ctx);
  expect(response.status).toBe(400); expect(m.load).not.toHaveBeenCalled(); expect(m.allocate).not.toHaveBeenCalled(); expect(m.stream).not.toHaveBeenCalled();
});
it("waits for the shared create slot before loading, then releases it", async () => {
  const ticket = requestLifecycleCreateSlot();
  try {
    const pending = POST(req(), ctx);
    await vi.waitFor(() => expect(lifecycleCreateQueueState().waiting).toBe(1));
    expect(m.load).not.toHaveBeenCalled();
    ticket.release(); const response = await pending; await response.text();
    expect(m.load).toHaveBeenCalledOnce(); expect(m.stream).toHaveBeenCalledOnce(); expect(lifecycleCreateQueueState()).toEqual({ active: 0, waiting: 0 });
  } finally { ticket.release(); }
});
it("retains legacy missing-life behavior", async () => {
  m.lifecycle = false; m.legacy.mockReturnValue(undefined);
  const response = await POST(req(), ctx); expect(response.status).toBe(404); expect(await response.json()).toEqual({ error: "Life not found." });
});
it("checks a missing index only after ticket admission", async () => {
  m.lookup.mockReturnValue({ kind: "absent" });
  const ticket = requestLifecycleCreateSlot();
  try {
    const pending = POST(req({ ...body, optionId: "old" }), ctx);
    await vi.waitFor(() => expect(lifecycleCreateQueueState().waiting).toBe(1));
    expect(m.load).not.toHaveBeenCalled(); ticket.release();
    const response = await pending; expect(response.status).toBe(400);
    expect(await response.text()).toContain("already the choice");
    expect(m.allocate).not.toHaveBeenCalled(); expect(m.stream).not.toHaveBeenCalled();
    expect(lifecycleCreateQueueState()).toEqual({ active: 0, waiting: 0 });
  } finally { ticket.release(); }
});
it("releases a queued ticket when the request aborts", async () => {
  const ticket = requestLifecycleCreateSlot(), controller = new AbortController();
  try {
    const pending = POST(req(body, controller.signal), ctx);
    await vi.waitFor(() => expect(lifecycleCreateQueueState().waiting).toBe(1));
    controller.abort(); await expect(pending).rejects.toThrow();
    expect(lifecycleCreateQueueState()).toEqual({ active: 1, waiting: 0 });
    expect(m.load).not.toHaveBeenCalled();
  } finally { ticket.release(); }
  expect(lifecycleCreateQueueState()).toEqual({ active: 0, waiting: 0 });
});
it("returns 429 for a full shared queue without leaking a ticket", async () => {
  const tickets = Array.from({ length: 5 }, () => requestLifecycleCreateSlot());
  try {
    const response = await POST(req(), ctx);
    expect(response.status).toBe(429); expect(lifecycleCreateQueueState()).toEqual({ active: 1, waiting: 4 });
    expect(m.load).not.toHaveBeenCalled();
  } finally { for (const ticket of tickets.reverse()) ticket.release(); }
  expect(lifecycleCreateQueueState()).toEqual({ active: 0, waiting: 0 });
});
it("releases the ticket and sends an error if parent loading throws", async () => {
  m.load.mockRejectedValue(new Error("load failed"));
  await expect(POST(req(), ctx)).rejects.toThrow("load failed");
  expect(lifecycleCreateQueueState()).toEqual({ active: 0, waiting: 0 });
});
it("passes the request signal and encodes lifecycle events as SSE", async () => {
  const controller = new AbortController();
  m.stream.mockImplementation(async ({ send, signal }) => { expect(signal.aborted).toBe(false); await send({ type: "tick", year: 1328, entries: [] }); controller.abort(); expect(signal.aborted).toBe(true); });
  const response = await POST(req(body, controller.signal), ctx);
  expect(await response.text()).toContain('event: tick\ndata: {"type":"tick","year":1328,"entries":[]}');
  expect(lifecycleCreateQueueState()).toEqual({ active: 0, waiting: 0 });
});

it("loads nested parent fork only after admission", async () => {
  const binding = { version: "canonical-lifecycle-fork-binding-v1", capsuleDigest: "a".repeat(64) };
  const capsule = { genesis: {}, lineage: { choices: [] }, output: { owned: { decisions: [target] } } };
  m.resolve.mockReturnValue({ kind: "found", selected: { branchId: "root", binding } });
  m.resolveCapsule.mockResolvedValue({ capsule }); m.forkLoad.mockResolvedValue({ binding, capsule });
  const response = await POST(req(), ctx); await response.text();
  expect(m.forkLoad).toHaveBeenCalledOnce(); expect(m.load).not.toHaveBeenCalled();
  expect(m.stream.mock.calls[0][0]).toMatchObject({ parentCapsule: capsule, parent: { lineage: capsule.lineage } });
  expect(lifecycleCreateQueueState()).toEqual({ active: 0, waiting: 0 });
});
it("rejects a real indexed three-year parent without replay or publishing a row", async () => {
  vi.resetModules();
  for (const id of ["@/server/lifecycle-read", "@/server/db", "@/server/lifecycle-branch-store", "@/server/lifecycle-repository", "@/server/lifecycle-rewrite", "@/server/life-store"]) vi.doUnmock(id);
  const { getDb } = await import("@/server/db");
  const { LifecycleRepository } = await import("@/server/lifecycle-repository");
  const { LifecycleBranchStore } = await import("@/server/lifecycle-branch-store");
  const { createLifecycleGenesis } = await import("@/domain/e-lifecycle-genesis");
  const { createLifecycleRuntime } = await import("@/domain/e-lifecycle-runtime");
  const { createLifecycleCompactCapsule } = await import("@/domain/e-lifecycle-capsule");
  const { initializeWorld } = await import("@/domain/world-origin");
  const fork = await import("@/domain/e-lifecycle-fork");
  const { POST: realPost } = await import("./route");
  const initialization = { seed: "fork-a", startYear: 1327, endYear: 1329, founderCount: 6, protagonist: { name: "Alice", sex: "random" as const } };
  const { world } = initializeWorld(initialization);
  const genesis = createLifecycleGenesis({ initialization, protagonistId: "protagonist", resources: Object.fromEntries(Object.keys(world.people).map(id => [id, { grain: 2, effort: 3, need: 1 }])) });
  const runtime = createLifecycleRuntime(genesis, { journal: "compact" });
  for (let year = 1327; year <= 1329; year++) await runtime.advance(year);
  const capsule = await createLifecycleCompactCapsule({ genesis, output: runtime.snapshot() }, "compact");
  const db = getDb(), repo = new LifecycleRepository(db), store = new LifecycleBranchStore(db), person = world.people.protagonist;
  const binding = await repo.publish({ lifeId: "u6b-real", branchId: "u6b-root", config: world.config, protagonistName: person.name, protagonistSex: person.sex, capsule });
  store.prepareDecisionsFromLoaded("u6b-real", "u6b-root", binding.capsuleDigest, { binding, capsule });
  const decision = capsule.output.owned.decisions[0];
  const before = db.prepare("SELECT count(*) AS n FROM lifecycle_forks_v1").get()?.n;
  const loadSpy = vi.spyOn(LifecycleRepository.prototype, "load"), forkSpy = vi.spyOn(fork, "forkLifecycle");
  try {
    const response = await realPost(req({ branchId: "u6b-root", decisionId: decision.id, optionId: decision.chosen }), { params: Promise.resolve({ lifeId: "u6b-real" }) });
    expect(response.status).toBe(400); expect(loadSpy).not.toHaveBeenCalled(); expect(forkSpy).not.toHaveBeenCalled();
    expect(db.prepare("SELECT count(*) AS n FROM lifecycle_forks_v1").get()?.n).toBe(before);
  } finally { loadSpy.mockRestore(); forkSpy.mockRestore(); }
  const option = decision.options.find(item => item.id !== decision.chosen);
  if (!option) throw new Error("Fixture has no alternate choice");
  const response = await realPost(req({ branchId: "u6b-root", decisionId: decision.id, optionId: option.id }), { params: Promise.resolve({ lifeId: "u6b-real" }) });
  const frames = await response.text();
  expect(frames).toContain("event: start\n");
  expect(frames).toContain("event: done\n");
  expect(db.prepare("SELECT count(*) AS n FROM lifecycle_forks_v1").get()?.n).toBe(Number(before) + 1);
}, 180000);
it("returns missing life from the shared resolver before the guard", async () => {
  m.resolve.mockReturnValue({ kind: "life-missing" });
  const response = await POST(req(), ctx);
  expect(response.status).toBe(404); expect(await response.json()).toEqual({ error: "Life not found." }); expect(m.guard).not.toHaveBeenCalled();
});
it("preserves a guard refusal before claiming the lifecycle slot", async () => {
  m.guard.mockResolvedValue(new Response("guard", { status: 403 }));
  const response = await POST(req(), ctx);
  expect(response.status).toBe(403); expect(lifecycleCreateQueueState()).toEqual({ active: 0, waiting: 0 }); expect(m.load).not.toHaveBeenCalled();
});
it("releases the ticket if rewriting throws", async () => {
  m.stream.mockRejectedValue(new Error("rewrite failed"));
  const response = await POST(req(), ctx); expect(await response.text()).toContain("rewrite failed");
  expect(lifecycleCreateQueueState()).toEqual({ active: 0, waiting: 0 });
});

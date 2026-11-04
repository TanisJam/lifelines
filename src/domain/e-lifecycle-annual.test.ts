import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { canonicalLifecycleData, createLifecycleGenesis, LIFECYCLE_GENESIS_VERSIONS, LIFECYCLE_THREAD_VERSIONS } from "./e-lifecycle-genesis";
import { createLifecycleRuntime } from "./e-lifecycle-runtime";
import { initializeWorld } from "./world-origin";

for (const [profile, versions, expected] of [
  ["original", LIFECYCLE_GENESIS_VERSIONS, "2bc747bbe0c1589252e234b32fc610317f62166de6f8f708b04c1bd51e77770e"],
  ["thread", LIFECYCLE_THREAD_VERSIONS, "e22335289530b0bcd824dfc5775a252a9aec0620386995eb46cb4d5ed24a3078"],
] as const) {
  it(`pins ${profile} annual runtime output`, async () => {
    const initialization = { seed: "annual-golden", startYear: 1327, endYear: 1328, founderCount: 6, protagonist: { name: "Alice", sex: "f" as const } };
    const { world } = initializeWorld(initialization);
    const genesis = createLifecycleGenesis({ initialization, protagonistId: "protagonist", versions,
      resources: Object.fromEntries(Object.keys(world.people).map(id => [id, { grain: 2, effort: 3, need: 1 }])) });
    const runtime = createLifecycleRuntime(genesis, { journal: "compact" });
    await runtime.advance(1327);
    const output = await runtime.advance(1328);
    expect(createHash("sha256").update(canonicalLifecycleData(output)).digest("hex")).toBe(expected);
  });
}

it("runs a detached year with a supplied source without changing the input state", async () => {
  const { instantiateLifecycleGenesis } = await import("./e-lifecycle-genesis");
  const { executeLifecycleAnnual } = await import("./e-lifecycle-annual");
  const { createRulesYearSource } = await import("./e-year-source");
  const initialization = { seed: "annual-source", startYear: 1327, endYear: 1327, founderCount: 6, protagonist: { name: "Alice", sex: "f" as const } };
  const { world } = initializeWorld(initialization);
  const input = createLifecycleGenesis({ initialization, protagonistId: "protagonist", versions: LIFECYCLE_THREAD_VERSIONS,
    resources: Object.fromEntries(Object.keys(world.people).map(id => [id, { grain: 2, effort: 3, need: 1 }])) });
  const { genesis, config, protagonistId, owned, favors } = instantiateLifecycleGenesis(input);
  const state = { owned, favors, threads: { version: "thread-state-1" as const, threads: [] } };
  const before = canonicalLifecycleData(state);
  let called = false;
  const { draft, record } = await executeLifecycleAnnual(state, 1327, config, protagonistId, genesis.versions, "compact", ownedDraft => {
    called = true;
    return createRulesYearSource(genesis.source, config, ownedDraft, protagonistId, config.startYear);
  });
  const runtime = createLifecycleRuntime(input, { journal: "compact" });
  const output = await runtime.advance(1327);
  expect(called).toBe(true);
  expect(canonicalLifecycleData(state)).toBe(before);
  expect(canonicalLifecycleData(record)).toBe(canonicalLifecycleData(output.journal[0]));
  expect(record.final).toBe(draft);
  expect(draft.owned.people).toBe(draft.favors.people);
});

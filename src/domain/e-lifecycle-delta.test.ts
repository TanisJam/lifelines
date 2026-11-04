import { expect, it } from "vitest";
import { canonicalLifecycleData, createLifecycleGenesis } from "./e-lifecycle-genesis";
import { createLifecycleRuntime } from "./e-lifecycle-runtime";
import { initializeWorld } from "./world-origin";
import { createLifecycleDeltaJournal, appendLifecycleDelta, reconstructLifecycleDelta } from "./e-lifecycle-delta";

it("reconstructs each annual state with shared aliases and rejects changed history", async () => {
  const initialization = { seed: "cap-0", startYear: 1327, endYear: 1427, protagonist: { name: "Probe", sex: "f" as const } };
  const { world } = initializeWorld(initialization);
  const genesis = createLifecycleGenesis({ initialization, protagonistId: "protagonist", resources: Object.fromEntries(Object.keys(world.people).map(id => [id, { grain: 2, effort: 3, need: 1 }])) });
  const runtime = createLifecycleRuntime(genesis, { journal: "compact" });
  let previous = runtime.initial;
  let journal = createLifecycleDeltaJournal(previous);
  for (let i = 0; i < 3; i++) {
    const output = await runtime.advance(previous.frontier + 1);
    journal = appendLifecycleDelta(journal, previous, output);
    const reconstructed = reconstructLifecycleDelta(journal, i);
    expect(canonicalLifecycleData(reconstructed)).toBe(canonicalLifecycleData({ owned: output.owned, favors: output.favors }));
    expect(Object.isFrozen(reconstructed.owned.people)).toBe(true);
    expect(reconstructed.favors.people).toBe(reconstructed.owned.people);
    expect(reconstructed.favors.legacyEvents).toBe(reconstructed.owned.events);
    previous = output;
  }
  const altered = structuredClone(previous) as unknown as import("./e-lifecycle-runtime").LifecycleState;
  altered.owned.events[0] = { ...altered.owned.events[0]!, year: -1 };
  expect(() => appendLifecycleDelta(journal, previous, altered)).toThrow(/append-only/);
}, 120_000);

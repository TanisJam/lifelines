// Heavy: replays a 23-year world per fork. Coordinator-run only (RAM rule D16), never by workers.
import { describe, expect, it } from "vitest";
import { LIFECYCLE_CHOICE_VERSION } from "./e-lifecycle-choice";
import { forkLifecycle } from "./e-lifecycle-fork";
import { canonicalLifecycleDataEqual, createLifecycleGenesis, LIFECYCLE_THREAD_VERSIONS } from "./e-lifecycle-genesis";
import { createLifecycleRuntime } from "./e-lifecycle-runtime";
import { initializeWorld } from "./world-origin";

// Seed "thread-long-3" opens the protagonist's first help thread in 1347 (eligible for payoff in 1350).
async function threadedLife() {
  const initialization = { seed: "thread-long-3", startYear: 1327, endYear: 1349, founderCount: 6, protagonist: { name: "Alice", sex: "random" as const } };
  const { world } = initializeWorld(initialization);
  const genesis = createLifecycleGenesis({ initialization, protagonistId: "protagonist", versions: LIFECYCLE_THREAD_VERSIONS,
    resources: Object.fromEntries(Object.keys(world.people).map(id => [id, { grain: 2, effort: 3, need: 1 }])) });
  const runtime = createLifecycleRuntime(genesis, { journal: "compact" });
  for (let year = 1327; year <= 1349; year++) if ((await runtime.advance(year)).status === "complete") break;
  return { genesis, output: runtime.snapshot() };
}

const choose = (year: number, decisionId: string, optionId: string) => ({ version: LIFECYCLE_CHOICE_VERSION, decisionId, optionId, year });

describe("cb3 fork thread continuity", () => {
  it("keeps an open setup across F, matches the threaded prefix and lets a same-year death close it", async () => {
    const parent = await threadedLife();
    expect(parent.output.frontier).toBe(1349);
    const opened = parent.output.journal.find(entry => entry.year === 1347)!.final.threads!.threads.filter(thread => thread.status === "open");
    expect(opened).toHaveLength(1);

    const target = parent.output.owned.decisions.find(entry => entry.year === 1348 && entry.id.startsWith("immigration:world#"))
      ?? parent.output.owned.decisions.find(entry => entry.year === 1348 && !entry.personId?.startsWith("protagonist") && entry.options.length > 1)!;
    const id = target.id;
    const fork = await forkLifecycle(parent, choose(1348, id, target.options.find(option => option.id !== target.chosen)!.id));
    const inherited = parent.output.journal.filter(entry => entry.year < 1348);
    expect(canonicalLifecycleDataEqual(fork.output.journal.slice(0, inherited.length), inherited)).toBe(true);
    expect(inherited.at(-1)!.threadBeats!.beats.some(beat => beat.kind === "setup")).toBe(true);
    expect(fork.output.journal.find(entry => entry.year === 1348)!.final.threads!.threads
      .find(thread => thread.id === opened[0].id)).toMatchObject({ status: "open", openedYear: 1347 });

    const death = parent.output.owned.decisions.find(entry => entry.year === 1348 && entry.id.startsWith("death:protagonist#"))!;
    const died = await forkLifecycle(parent, choose(1348, death.id, "die"));
    expect([died.output.frontier, died.output.status]).toEqual([1348, "complete"]);
    expect(died.output.threads!.threads.find(thread => thread.id === opened[0].id))
      .toMatchObject({ status: "dead", terminalYear: 1348 });
  }, 180000);
});

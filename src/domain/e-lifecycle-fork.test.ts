import { describe, expect, it, vi } from "vitest";
import { LIFECYCLE_CHOICE_VERSION } from "./e-lifecycle-choice";
import { assertLifecycleForkPrefix, forkLifecycle, LIFECYCLE_FORK_VERSION } from "./e-lifecycle-fork";
import { canonicalLifecycleDataEqual, createLifecycleGenesis, LIFECYCLE_GENESIS_VERSIONS, LIFECYCLE_THREAD_VERSIONS } from "./e-lifecycle-genesis";
import { createLifecycleRuntime, type LifecycleJournalMode, type LifecycleYearRecord } from "./e-lifecycle-runtime";
import * as sourceModule from "./e-year-source";
import { initializeWorld } from "./world-origin";

function record(year: number): LifecycleYearRecord {
  return { year, versions: {} as LifecycleYearRecord["versions"],
    final: { owned: { decisions: [{ id: `decision-${year}` }] },
      favors: { events: [{ id: `economic-${year}` }] },
      threads: { version: "thread-state-1", threads: [{ id: `thread-${year}` }] } },
    threadBeats: { version: "thread-beats-1", beats: [{ id: `beat-${year}` }] },
  } as unknown as LifecycleYearRecord;
}

describe("fork prefix comparison", () => {
  it("compares every inherited native, economic, thread and beat record without mutating the parent", () => {
    const parent = [record(1), record(2), record(3)];
    const before = structuredClone(parent);
    const replay = structuredClone(parent.slice(0, 2));
    expect(() => assertLifecycleForkPrefix(parent, replay, 3)).not.toThrow();
    expect(parent).toEqual(before);
    for (const path of ["native", "economic", "thread", "beat"]) {
      const altered = structuredClone(replay);
      const value = altered[1] as unknown as { final: { owned: { decisions: { id: string }[] }; favors: { events: { id: string }[] }; threads: { threads: { id: string }[] } }; threadBeats: { beats: { id: string }[] } };
      if (path === "native") value.final.owned.decisions[0].id = "changed";
      if (path === "economic") value.final.favors.events[0].id = "changed";
      if (path === "thread") value.final.threads.threads[0].id = "changed";
      if (path === "beat") value.threadBeats.beats[0].id = "changed";
      expect(() => assertLifecycleForkPrefix(parent, altered, 3)).toThrow();
    }
    expect(parent).toEqual(before);
  });

  it("rejects missing, extra, reordered and non-prefix years", () => {
    const parent = [record(1), record(2), record(3)];
    for (const replay of [[record(1)], [record(1), record(2), record(3)], [record(2), record(1)], [record(1), record(4)]]) {
      expect(() => assertLifecycleForkPrefix(parent, replay, 3)).toThrow();
    }
  });
});

async function lifeOf(seed: string, journal: LifecycleJournalMode = "compact", endYear = 1329, versions: typeof LIFECYCLE_GENESIS_VERSIONS | typeof LIFECYCLE_THREAD_VERSIONS = LIFECYCLE_GENESIS_VERSIONS) {
  const initialization = { seed, startYear: 1327, endYear, founderCount: 6, protagonist: { name: "Alice", sex: "random" as const } };
  const { world } = initializeWorld(initialization);
  const genesis = createLifecycleGenesis({ initialization, protagonistId: "protagonist", versions,
    resources: Object.fromEntries(Object.keys(world.people).map(id => [id, { grain: 2, effort: 3, need: 1 }])) });
  const runtime = createLifecycleRuntime(genesis, { journal });
  for (let year = 1327; year <= endYear; year++) if ((await runtime.advance(year)).status === "complete") break;
  return { genesis, output: runtime.snapshot() };
}

function choose(year: number, decisionId: string, optionId: string) {
  return { version: LIFECYCLE_CHOICE_VERSION, decisionId, optionId, year };
}

function decision(parent: Awaited<ReturnType<typeof lifeOf>>, id: string) {
  return parent.output.owned.decisions.find(entry => entry.id === id)!;
}

describe("fork executor", () => {
  it("forks the first, a middle and the last closed year with an exact inherited prefix", async () => {
    const parent = await lifeOf("fork-a", "audit");
    for (const year of [1327, 1328, 1329]) {
      const id = `immigration:world#${year}.1`;
      const other = decision(parent, id).options.map(option => option.id).find(option => option !== decision(parent, id).chosen)!;
      const fork = await forkLifecycle(parent, choose(year, id, other));
      expect(fork.lineage).toEqual({ version: LIFECYCLE_FORK_VERSION, parentGenesisDigest: parent.output.genesisDigest,
        forkYear: year, choices: [choose(year, id, other)], evidence: [{ decisionId: id, optionId: other, year, appliedCount: 1 }] });
      expect(fork.output.journal.map(entry => entry.year)).toEqual([1327, 1328, 1329]);
      const inherited = parent.output.journal.filter(entry => entry.year < year);
      expect(canonicalLifecycleDataEqual(fork.output.journal.slice(0, inherited.length), inherited)).toBe(true);
      const rewritten = fork.output.journal.find(entry => entry.year === year)!.final.owned.decisions.find(entry => entry.id === id)!;
      expect([rewritten.chosen, rewritten.source]).toEqual([other, "forced"]);
      expect(fork.output.owned.decisions.filter(entry => entry.source === "forced").map(entry => entry.id)).toEqual([id]);
      expect(Object.isFrozen(fork.output.journal.at(-1)!.final.owned)).toBe(true);
    }
  });

  it("leaves the parent input deeply unchanged", async () => {
    const parent = structuredClone(await lifeOf("fork-a"));
    const before = structuredClone(parent);
    const id = "immigration:world#1328.1";
    const other = decision(parent, id).options.map(option => option.id).find(option => option !== decision(parent, id).chosen)!;
    await forkLifecycle(parent, choose(1328, id, other));
    expect(parent).toEqual(before);
    expect(Object.isFrozen(parent.output.owned)).toBe(false);
  });

  it("stops an early death at its year and a survivor exactly at the last year, including a final-year fork", async () => {
    const survivor = await lifeOf("fork-b");
    const died = await forkLifecycle(survivor, choose(1328, "death:protagonist#1.1", "die"));
    expect([died.output.frontier, died.output.status, died.output.journal.map(entry => entry.year)]).toEqual([1328, "complete", [1327, 1328]]);

    const dead = await lifeOf("fork-c");
    expect([dead.output.frontier, dead.output.status]).toEqual([1328, "complete"]);
    const saved = await forkLifecycle(dead, choose(1328, "death:protagonist#1.1", "survive"));
    // The rescued protagonist lives on through the origin endYear (1329) and is never run past it.
    expect([saved.output.frontier, saved.output.journal.map(entry => entry.year)]).toEqual([1329, [1327, 1328, 1329]]);
    const capped = await forkLifecycle(dead, choose(1328, "death:protagonist#1.1", "survive"), { lastYear: 1328 });
    expect([capped.output.frontier, capped.output.status, capped.output.journal.map(entry => entry.year)]).toEqual([1328, "incomplete", [1327, 1328]]);
    await expect(forkLifecycle(dead, choose(1328, "death:protagonist#1.1", "survive"), { lastYear: 1330 }))
      .rejects.toThrow("Invalid lifecycle fork last year");
  });

  it("rejects an abort observed at a closed year boundary and returns nothing partial", async () => {
    const parent = await lifeOf("fork-a");
    const id = "immigration:world#1328.1";
    const other = decision(parent, id).options.map(option => option.id).find(option => option !== decision(parent, id).chosen)!;
    const controller = new AbortController();
    controller.abort(new Error("stop"));
    await expect(forkLifecycle(parent, choose(1328, id, other), { signal: controller.signal })).rejects.toThrow("stop");
    // An abort raised while year F runs is observed only once F has closed, before F+1.
    const late = new AbortController();
    const pending = forkLifecycle(parent, choose(1328, id, other), { signal: late.signal });
    late.abort(new Error("late stop"));
    await expect(pending).rejects.toThrow("late stop");
    // The last year closes at a boundary too: an abort raised while it runs rejects the fork.
    const final = new AbortController();
    const real = sourceModule.createLifecycleChoiceYearSource;
    const spy = vi.spyOn(sourceModule, "createLifecycleChoiceYearSource").mockImplementation((...args) => {
      const source = real(...args);
      return { ...source, execute: async (year: number) => {
        final.abort(new Error("final stop"));
        return source.execute(year);
      } };
    });
    try {
      const lastId = "immigration:world#1329.1";
      const lastOption = decision(parent, lastId).options.map(option => option.id).find(option => option !== decision(parent, lastId).chosen)!;
      await expect(forkLifecycle(parent, choose(1329, lastId, lastOption), { signal: final.signal })).rejects.toThrow("final stop");
    } finally { spy.mockRestore(); }
  });

  it("forks the final year into a death in that same year", async () => {
    const parent = await lifeOf("fork-a");
    // Death decision ordinals advance per roll, so locate the protagonist's 1329 roll by kind and year.
    const id = parent.output.owned.decisions.find(entry => entry.year === 1329 && entry.id.startsWith("death:protagonist#"))!.id;
    const fork = await forkLifecycle(parent, choose(1329, id, "die"));
    expect([fork.output.frontier, fork.output.status, fork.output.owned.people.protagonist.deathYear]).toEqual([1329, "complete", 1329]);
  });

  it("rejects a failure after the forced year without leaving partial state or touching the parent", async () => {
    const parent = structuredClone(await lifeOf("fork-a"));
    const before = structuredClone(parent);
    const id = "immigration:world#1328.1";
    const other = decision(parent, id).options.map(option => option.id).find(option => option !== decision(parent, id).chosen)!;
    const real = sourceModule.createRulesYearSource;
    const spy = vi.spyOn(sourceModule, "createRulesYearSource").mockImplementation((...args) => {
      const source = real(...args);
      return { ...source, execute: async (year: number) => {
        if (year === 1329) throw new Error("suffix failure");
        return source.execute(year);
      } };
    });
    try {
      await expect(forkLifecycle(parent, choose(1328, id, other))).rejects.toThrow("suffix failure");
    } finally { spy.mockRestore(); }
    expect(parent).toEqual(before);
  });

  it("refuses a choice that does not match a decision of the fork year", async () => {
    const parent = await lifeOf("fork-a");
    await expect(forkLifecycle(parent, choose(1328, "immigration:world#1327.1", "arrive"))).rejects.toThrow("Lifecycle choice does not match target");
    await expect(forkLifecycle(parent, choose(1328, "immigration:world#1328.1", "nonexistent"))).rejects.toThrow("Lifecycle choice does not match target");
    await expect(forkLifecycle(parent, choose(1331, "immigration:world#1331.1", "arrive"))).rejects.toThrow("Invalid lifecycle fork last year");
  });

  it("refuses a tampered parent prefix and nested fork lineage", async () => {
    const parent = structuredClone(await lifeOf("fork-a"));
    const id = "immigration:world#1328.1";
    const other = decision(parent, id).options.map(option => option.id).find(option => option !== decision(parent, id).chosen)!;
    (parent.output.journal[0].final.owned.decisions[0] as { chosen: string }).chosen = "tampered";
    await expect(forkLifecycle(parent, choose(1328, id, other))).rejects.toThrow("Lifecycle fork prefix mismatch");
    await expect(forkLifecycle({ ...parent, lineage: {} }, choose(1328, id, other))).rejects.toThrow("Invalid lifecycle fork lineage");
  });
});


describe("nested fork lineage", () => {
  for (const year of [1327, 1328, 1329]) {
    it(`retains ancestor choices strictly before ${year}`, async () => {
      const root = await lifeOf("fork-a");
      const ancestorId = "immigration:world#1328.1";
      const ancestorOption = decision(root, ancestorId).options.find(o => o.id !== decision(root, ancestorId).chosen)!.id;
      const parent = await forkLifecycle(root, choose(1328, ancestorId, ancestorOption));
      const id = `immigration:world#${year}.1`;
      const target = parent.output.journal.find(r => r.year === year)!.final.owned.decisions.find(d => d.id === id)!;
      const option = target.options.find(o => o.id !== target.chosen)!.id;
      const child = await forkLifecycle(parent, choose(year, id, option));
      expect(child.lineage.choices.map(c => c.year)).toEqual(year > 1328 ? [1328, year] : [year]);
      expect(child.lineage.evidence).toHaveLength(year > 1328 ? 2 : 1);
      expect(canonicalLifecycleDataEqual(child.output.journal.filter(r => r.year < year), parent.output.journal.filter(r => r.year < year))).toBe(true);
    });
  }
  it("refuses tampered lineage metadata", async () => {
    const root = await lifeOf("fork-a");
    const id = "immigration:world#1328.1";
    const option = decision(root, id).options.find(o => o.id !== decision(root, id).chosen)!.id;
    const parent = await forkLifecycle(root, choose(1328, id, option));
    for (const lineage of [{ ...parent.lineage, version: "bad" }, { ...parent.lineage, parentGenesisDigest: "bad" },
      { ...parent.lineage, choices: [choose(1329, id, option), choose(1328, id, option)] },
      { ...parent.lineage, choices: [choose(1328, id, option), choose(1328, id, option)] }]) {
      await expect(forkLifecycle({ ...parent, lineage }, choose(1327, "immigration:world#1327.1", "arrive"))).rejects.toThrow("Invalid lifecycle fork lineage");
    }
  });
  it("preserves thread prefix and leaves legacy profiles without thread fields", async () => {
    for (const [versions, mode] of [[LIFECYCLE_GENESIS_VERSIONS, "audit"], [LIFECYCLE_GENESIS_VERSIONS, "compact"], [LIFECYCLE_THREAD_VERSIONS, "compact"]] as const) {
      const parent = await lifeOf("fork-a", mode, 1329, versions);
      const id = "immigration:world#1328.1";
      const option = decision(parent, id).options.find(o => o.id !== decision(parent, id).chosen)!.id;
      const fork = await forkLifecycle(parent, choose(1328, id, option));
      expect(canonicalLifecycleDataEqual(fork.output.journal[0], parent.output.journal[0])).toBe(true);
      expect("threads" in fork.output.journal[0].final).toBe(versions === LIFECYCLE_THREAD_VERSIONS);
      expect("threadBeats" in fork.output.journal[0]).toBe(versions === LIFECYCLE_THREAD_VERSIONS);
    }
  });
  it("leaves the parent unchanged when the forced year fails", async () => {
    const parent = structuredClone(await lifeOf("fork-a"));
    const before = structuredClone(parent);
    await expect(forkLifecycle(parent, choose(1328, "immigration:world#1328.1", "invalid"))).rejects.toThrow();
    expect(parent).toEqual(before);
  });

});

import { describe, expect, it } from "vitest";
import { createLifecycleGenesis, LIFECYCLE_GENESIS_VERSIONS, LIFECYCLE_THREAD_VERSIONS } from "@/domain/e-lifecycle-genesis";
import { createLifecycleRuntime } from "@/domain/e-lifecycle-runtime";
import { initializeWorld } from "@/domain/world-origin";
import { LIFECYCLE_VIEW_VERSION, LIFECYCLE_PERSON_SHEET_VIEW_VERSION } from "./lifecycle-projection-store";
import { createLifecycleTickAccumulator, projectLifecycleChronicle, projectLifecycleTick, type LifecycleProjectionSource } from "./lifecycle-projection";

const init = { seed: "thread-view", startYear: 1327, endYear: 1330, founderCount: 4, protagonist: { name: "Alice", sex: "f" as const } };
const { world } = initializeWorld(init);
const genesis = createLifecycleGenesis({ initialization: init, protagonistId: "protagonist", versions: LIFECYCLE_THREAD_VERSIONS, resources: Object.fromEntries(Object.keys(world.people).map(id => [id, { grain: 2, effort: 3, need: 1 }])) });
const other = Object.keys(world.people).find(id => id !== "protagonist")!;
const actors = ["protagonist", other];
const setup = { kind: "setup", thread: "help/grant/help", source: "grant", year: 1327, actors, causes: [], effects: [{ kind: "grain", from: actors[0], to: actors[1], amount: 1 }, { kind: "obligation", id: "grant/help", creditor: actors[0], debtor: actors[1], origin: "grant", status: "open" }] };
const payoff = { kind: "payoff", thread: setup.thread, source: "response", year: 1330, actors, causes: ["grant", "request"], selected: "help", effects: [{ kind: "settlement", id: "grant/help", origin: "grant", creditor: actors[0], debtor: actors[1], status: "fulfilled" }, { kind: "assistance", from: actors[1], to: actors[0], amount: 1 }] };
function source(include = true): LifecycleProjectionSource {
  const owned = { people: world.people, events: [], decisions: [] };
  const journal = Array.from({ length: 4 }, (_, i) => ({ year: 1327 + i, final: { owned }, ...(include ? { threadBeats: { version: "thread-beats-1", beats: i === 0 ? [setup] : i === 3 ? [payoff] : [] } } : {}) }));
  const selectedGenesis = include ? genesis : { ...genesis, versions: LIFECYCLE_GENESIS_VERSIONS };
  return { genesis: selectedGenesis, output: { versions: selectedGenesis.versions, protagonistId: "protagonist", status: "incomplete", frontier: 1330, owned, journal } } as unknown as LifecycleProjectionSource;
}

describe("thread view", () => {
  it.each(["en", "es"] as const)("projects identical setup and payoff in tick and chronicle (%s)", async locale => {
    const s = source();
    const all = (await projectLifecycleChronicle({ source: s, identity: { lifeId: "life", branchId: "branch" }, locale })).view.entries;
    const setupTick = (await projectLifecycleTick({ source: s, year: 1327, locale })).view.entries;
    const payoffTick = (await projectLifecycleTick({ source: s, year: 1330, locale })).view.entries;
    expect(all.map(entry => entry.id)).toEqual(["grant", "response"]);
    expect(setupTick).toEqual([all[0]]);
    expect(payoffTick).toEqual([all[1]]);
    expect(all[0]!.year).toBe(1327);
    expect(all[1]!.year).toBe(1330);
    expect(all[0]!.who).toEqual(actors);
    expect(all[1]!.who).toEqual(actors);
    expect(all[1]!.cause).toMatchObject({ entryId: "grant", year: 1327 });
    expect((await projectLifecycleTick({ source: s, year: 1330, locale, accumulator: createLifecycleTickAccumulator() })).view.entries).toEqual(payoffTick);
  });

  it("does not duplicate repeated beats", async () => {
    const s = source();
    const records = s.output.journal as unknown as { threadBeats: { beats: unknown[] } }[];
    records[0]!.threadBeats.beats.push(setup);
    const entries = (await projectLifecycleTick({ source: s, year: 1327 })).view.entries;
    expect(entries.filter(e => e.id === "grant")).toHaveLength(1);
  });
  it("rejects a payoff whose setup is less than three years earlier", async () => {
    const s = source();
    const records = s.output.journal as unknown as { threadBeats: { beats: unknown[] } }[];
    records[3]!.threadBeats.beats = [];
    records[2]!.threadBeats.beats = [{ ...payoff, year: 1329 }];
    await expect(projectLifecycleTick({ source: s, year: 1329 })).rejects.toThrow();
  });
  it("does not reveal later beats or identities in an earlier tick", async () => {
    const s = source();
    const tick = (await projectLifecycleTick({ source: s, year: 1327 })).view;
    expect(tick.entries.map(e => e.id)).toEqual(["grant"]);
    expect(JSON.stringify(tick)).not.toContain("response");
  });
  it("rejects a payoff linked to a different setup", async () => {
    const s = source();
    const records = s.output.journal as unknown as { threadBeats: { beats: unknown[] } }[];
    records[3]!.threadBeats.beats = [{ ...payoff, causes: ["other"], effects: [{ ...payoff.effects[0], origin: "other" }, payoff.effects[1]] }];
    await expect(projectLifecycleTick({ source: s, year: 1330 })).rejects.toThrow();
  });
  it("uses year-local identities and rejects unborn actors", async () => {
    const s = source();
    const records = s.output.journal as unknown as { final: { owned: { people: typeof world.people } } }[];
    records[0]!.final.owned = { ...records[0]!.final.owned, people: { ...world.people, [other]: { ...world.people[other]!, birthYear: 1328 } } };
    await expect(projectLifecycleTick({ source: s, year: 1327 })).rejects.toThrow("Invalid thread identity");
  });
  it("ignores future identities and relationships when projecting an earlier tick", async () => {
    const s = source();
    const before = (await projectLifecycleTick({ source: s, year: 1327 })).view;
    const records = s.output.journal as unknown as { final: { owned: { people: typeof world.people } } }[];
    const laterPeople = { ...world.people, [other]: { ...world.people[other]!, name: "Future Name" } };
    records[3]!.final = { ...records[3]!.final, owned: { ...records[3]!.final.owned, people: laterPeople } };
    expect((await projectLifecycleTick({ source: s, year: 1327 })).view).toEqual(before);
    expect(JSON.stringify(before)).not.toContain("Future Name");
  });
  it("keeps a live accumulator equivalent across successive ticks", async () => {
    const runtime = createLifecycleRuntime(genesis, { journal: "compact" });
    const accumulator = createLifecycleTickAccumulator();
    for (let year = 1327; year <= 1328; year++) {
      const output = await runtime.advance(year);
      const s = { genesis, output } as LifecycleProjectionSource;
      expect((await projectLifecycleTick({ source: s, year, accumulator })).view)
        .toEqual((await projectLifecycleTick({ source: s, year })).view);
    }
  });
  it("changes only the chronicle view index version", () => {
    expect(LIFECYCLE_VIEW_VERSION).toBe("lifecycle-chronicle-view-3");
    expect(LIFECYCLE_PERSON_SHEET_VIEW_VERSION).toBe("lifecycle-person-sheet-view-1");
  });
  it("does not invent arcs for old records", async () => {
    const s = source(false);
    const records = s.output.journal as unknown as { threadBeats?: unknown }[];
    records[0]!.threadBeats = { version: "thread-beats-1", beats: [setup] };
    expect((await projectLifecycleChronicle({ source: s, identity: { lifeId: "life", branchId: "branch" } })).view.entries).toEqual([]);
  });
});

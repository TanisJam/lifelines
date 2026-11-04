import { describe, expect, it, vi } from "vitest";
import * as runtimeModule from "@/domain/e-lifecycle-runtime";
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

  it.each(["en", "es"] as const)("pins exact setup and payoff prose in both views (%s)", async locale => {
    const s = source();
    const all = (await projectLifecycleChronicle({ source: s, identity: { lifeId: "life", branchId: "branch" }, locale })).view.entries;
    const a = `${world.people[actors[0]]!.name} [${actors[0]}]`;
    const b = `${world.people[actors[1]]!.name} [${actors[1]}]`;
    const expected = locale === "en" ? [
      `${a} transferred 1 unit of grain to ${b}. An open help obligation was recorded.`,
      `${b} → ${a}. Recorded help response: help. The help obligation was recorded as fulfilled; 1 unit of assistance was recorded. This response concerned the obligation from the earlier grain grant.`,
    ] : [
      `${a} transfirió 1 unidad de grano a ${b}. Se registró una obligación de ayuda abierta.`,
      `${b} → ${a}. Respuesta de ayuda registrada: ayuda. La obligación de ayuda quedó registrada como cumplida; se registró 1 unidad de asistencia. Esta respuesta correspondió a la obligación de la entrega anterior de grano.`,
    ];
    expect(all.map(entry => entry.prose)).toEqual(expected);
    for (const [index, year] of [1327, 1330].entries()) {
      expect((await projectLifecycleTick({ source: s, year, locale })).view.entries[0]!.prose).toBe(expected[index]);
    }
  });
  it("omits a thread closed by death without changing other entries", async () => {
    // D26: a death closure never adds a chronicle entry.
    const s = source();
    const before = (await projectLifecycleChronicle({ source: s, identity: { lifeId: "life", branchId: "branch" } })).view.entries;
    const records = s.output.journal as unknown as { threadBeats: { beats: unknown[] } }[];
    records[0]!.threadBeats.beats.push({ kind: "death", year: 1327, source: "death-beat", actors: [] });
    expect((await projectLifecycleChronicle({ source: s, identity: { lifeId: "life", branchId: "branch" } })).view.entries).toEqual(before);
    expect((await projectLifecycleTick({ source: s, year: 1327 })).view.entries).toEqual([before[0]]);
  });
  it("rejects a thread source without the protagonist", async () => {
    const s = source();
    const records = s.output.journal as unknown as { threadBeats: { beats: unknown[] } }[];
    records[0]!.threadBeats.beats = [{ ...setup, actors: [other, "someone"] }];
    await expect(projectLifecycleTick({ source: s, year: 1327 })).rejects.toThrow("Invalid thread source");
  });
  it("rejects a thread source colliding with a native event ID", async () => {
    const s = source();
    const event = { id: "grant", year: 1327, kind: "town", actors: [], causes: [], payload: {} };
    const output = s.output as unknown as { owned: { events: unknown[] }; journal: { final: { owned: { events: unknown[] } } }[] };
    output.owned.events = [event];
    output.journal[0]!.final.owned.events = [event];
    await expect(projectLifecycleTick({ source: s, year: 1327 })).rejects.toThrow("Invalid thread source");
  });
  it("rejects a payoff linked to a setup from another thread", async () => {
    const s = source();
    const records = s.output.journal as unknown as { threadBeats: { beats: unknown[] } }[];
    records[3]!.threadBeats.beats = [{ ...payoff, thread: "help/another", effects: [{ ...payoff.effects[0], id: "another" }, payoff.effects[1]] }];
    await expect(projectLifecycleTick({ source: s, year: 1330 })).rejects.toThrow("Invalid thread payoff cause");
  });
  it("rejects a payoff with reversed actor order", async () => {
    const s = source();
    const records = s.output.journal as unknown as { threadBeats: { beats: unknown[] } }[];
    records[3]!.threadBeats.beats = [{ ...payoff, actors: [...actors].reverse(), effects: [
      { ...payoff.effects[0], creditor: actors[1], debtor: actors[0] },
      { ...payoff.effects[1], from: actors[0], to: actors[1] },
    ] }];
    await expect(projectLifecycleTick({ source: s, year: 1330 })).rejects.toThrow("Invalid thread payoff cause");
  });
  it("uses the year scene for who in both tick and chronicle", async () => {
    const s = source();
    const records = s.output.journal as unknown as { final: { owned: { people: typeof world.people; events: unknown[] } } }[];
    const people = { ...world.people, protagonist: { ...world.people.protagonist!, motherId: undefined, fatherId: undefined, spouseId: undefined, relationships: [] } };
    for (const record of records) record.final.owned = { ...record.final.owned, people, events: [] };
    const marriage = { id: "later-marriage", year: 1330, kind: "marriage", actors, causes: [], payload: {} };
    records[3]!.final.owned.events = [marriage];
    (s.output as unknown as { owned: { people: typeof world.people; events: unknown[] } }).owned = { ...s.output.owned, people, events: [marriage] };
    const tick = (await projectLifecycleTick({ source: s, year: 1327 })).view;
    const all = (await projectLifecycleChronicle({ source: s, identity: { lifeId: "life", branchId: "branch" } })).view.entries;
    expect(tick.scene.people.map(person => person.id)).not.toContain(other);
    expect(tick.entries.find(entry => entry.id === "grant")!.who).toEqual(["protagonist"]);
    expect(all.find(entry => entry.id === "grant")!.who).toEqual(["protagonist"]);
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
    const provenance = vi.spyOn(runtimeModule, "isLifecycleRuntimeOutput").mockReturnValue(true);
    let priorRecord: (typeof runtime.initial.journal)[number] | undefined;
    try {
      for (let year = 1327; year <= 1328; year++) {
        const output = structuredClone(await runtime.advance(year));
        if (priorRecord) (output.journal as unknown as unknown[])[0] = priorRecord;
        const records = output.journal as unknown as { threadBeats: { beats: unknown[] } }[];
        records[0]!.threadBeats.beats = [setup];
        priorRecord = output.journal[0];
        const s = { genesis, output } as LifecycleProjectionSource;
        const withAccumulator = (await projectLifecycleTick({ source: s, year, accumulator })).view;
        const withoutAccumulator = (await projectLifecycleTick({ source: s, year })).view;
        expect(withAccumulator).toEqual(withoutAccumulator);
        const setupWith = (await projectLifecycleTick({ source: s, year: 1327, accumulator })).view.entries;
        const setupWithout = (await projectLifecycleTick({ source: s, year: 1327 })).view.entries;
        expect(setupWith.find(entry => entry.id === "grant")).toBeDefined();
        expect(setupWith).toEqual(setupWithout);
      }
    } finally { provenance.mockRestore(); }
  });
  it("changes only the chronicle view index version", () => {
    expect(LIFECYCLE_VIEW_VERSION).toBe("lifecycle-chronicle-view-3");
    expect(LIFECYCLE_PERSON_SHEET_VIEW_VERSION).toBe("lifecycle-person-sheet-view-1");
  });
  it("preserves baseline legacy tick and chronicle bytes with native events", async () => {
    const s = source(false);
    const event = { id: "native-move", year: 1327, kind: "move", actors: ["protagonist"], causes: [], payload: { away: true } };
    const output = s.output as unknown as { owned: { events: unknown[] }; journal: { final: { owned: { events: unknown[] } }; threadBeats?: unknown }[] };
    output.owned.events = [event];
    for (const record of output.journal) record.final.owned.events = [event];
    output.journal[0]!.threadBeats = { version: "thread-beats-1", beats: [setup] };
    const tick = await projectLifecycleTick({ source: s, year: 1327 });
    const chronicle = await projectLifecycleChronicle({ source: s, identity: { lifeId: "life", branchId: "branch" } });
    expect(tick.view.entries.some(entry => entry.id === "native-move")).toBe(true);
    expect(tick.view.entries.some(entry => entry.id === "grant")).toBe(false);
    expect(JSON.stringify({ tick: tick.view, chronicle: chronicle.view })).toMatchSnapshot();
  });
  it("does not invent arcs for old records", async () => {
    const s = source(false);
    const records = s.output.journal as unknown as { threadBeats?: unknown }[];
    records[0]!.threadBeats = { version: "thread-beats-1", beats: [setup] };
    expect((await projectLifecycleChronicle({ source: s, identity: { lifeId: "life", branchId: "branch" } })).view.entries).toEqual([]);
  });
});

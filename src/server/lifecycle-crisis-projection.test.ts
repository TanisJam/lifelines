import { describe, expect, it } from "vitest";
import { createLifecycleGenesis } from "@/domain/e-lifecycle-genesis";
import { initializeWorld } from "@/domain/world-origin";
import { eventTimes } from "@/domain/month";
import type { Event, Person } from "@/domain/types";
import { createLifecycleTickAccumulator, projectLifecycleChronicle, projectLifecycleTick, type LifecycleProjectionSource } from "./lifecycle-projection";

const init = { seed: "crisis-fixture", startYear: 1348, endYear: 1362, founderCount: 4, protagonist: { name: "Alice", sex: "f" as const } };
const { world } = initializeWorld(init);
const genesis = createLifecycleGenesis({ initialization: init, protagonistId: "protagonist", resources: Object.fromEntries(Object.keys(world.people).map(id => [id, { grain: 2, effort: 3, need: 1 }])) });
const person = world.people.protagonist!;
const town = (id: string, year: number, eventType = "black-death"): Event => ({ id, year, kind: "town", actors: [], causes: [], payload: { eventType } });
const move = (id: string, year: number, away: boolean): Event => ({ id, year, kind: "move", actors: ["protagonist"], causes: [], payload: { away } });
const death = (id: string, year: number, cause = "illness"): Event => ({ id, year, kind: "death", actors: ["protagonist"], causes: [], payload: { cause } });
function source(events: Event[], options: { end?: number; protagonist?: Partial<Person> } = {}): LifecycleProjectionSource {
  const end = options.end ?? 1349;
  const protagonist = { ...person, birthYear: 1320, ...options.protagonist };
  const people = { ...world.people, protagonist };
  const owned = { people, events, decisions: [] };
  const journal = Array.from({ length: end - 1348 + 1 }, (_, i) => ({ year: 1348 + i, final: { owned: { people, events: events.filter(e => e.year <= 1348 + i), decisions: [] } } }));
  return { genesis, output: { versions: genesis.versions, protagonistId: "protagonist", status: protagonist.deathYear === undefined ? "incomplete" : "complete", frontier: end, owned, journal } } as unknown as LifecycleProjectionSource;
}
const identity = { lifeId: "life", branchId: "branch" };
const entries = async (s: LifecycleProjectionSource, locale: "en" | "es" = "en") => (await projectLifecycleChronicle({ source: s, identity, locale })).view.entries;
const crisis = (es: Awaited<ReturnType<typeof entries>>) => es.filter(e => e.kind === "town");

describe("recorded lifecycle crisis context", () => {
  it.each(["en", "es"] as const)("projects recorded crisis-only years consistently in %s", async locale => {
    const s = source([town("a", 1348), town("b", 1349)]);
    const before = structuredClone(s);
    const all = crisis(await entries(s, locale));
    expect(all.map(e => e.id)).toEqual(["a", "b"]);
    expect(all[0]!.prose).toBe(locale === "en" ? `The Black Death reached ${world.config.town.name}.` : `La peste negra llegó a ${world.config.town.name}.`);
    const tick = await projectLifecycleTick({ source: s, year: 1349, locale });
    const cached = await projectLifecycleTick({ source: s, year: 1349, locale, accumulator: createLifecycleTickAccumulator() });
    expect(crisis(tick.view.entries)).toEqual([all[1]]);
    expect(cached.view.entries).toEqual(tick.view.entries);
    expect(await entries(s, locale)).toEqual(await entries(s, locale));
    expect(s).toEqual(before);
  });
  it("requires actual supported records, window, birth and observed frontier", async () => {
    expect(crisis(await entries(source([])))).toEqual([]);
    const s = source([town("early", 1348, "second-pestilence"), town("late", 1350), town("pest", 1361, "second-pestilence"), town("other", 1348, "festival")], { end: 1361, protagonist: { birthYear: 1349 } });
    expect(crisis(await entries(s)).map(e => e.id)).toEqual(["pest"]);
    expect(crisis(await entries(source([town("future", 1349)], { end: 1348 })))).toEqual([]);
  });
  it("retains distinct records and never asserts personal illness", async () => {
    const all = crisis(await entries(source([town("a", 1348), town("b", 1348)])));
    expect(all.map(e => e.id).sort()).toEqual(["a", "b"]);
    for (const e of all) { expect(e.level).toBe(2); expect(e.prose).not.toMatch(/infect|died|disease|illness/i); expect(e.turn).toBeUndefined(); expect(e.who).toEqual([]); }
  });
  it("suppresses context during absence and after recorded death using unchanged moments", async () => {
    const a = town("a", 1348); const b = town("b", 1349);
    expect(crisis(await entries(source([move("leave", 1348, true), b], { protagonist: { away: true } })))).toEqual([]);
    const d = death("d", 1348); const events = [a, d, b];
    const times = eventTimes(init.seed, events.filter(e => e.year === 1348), "protagonist");
    const all = crisis(await entries(source(events, { protagonist: { deathYear: 1348 } })));
    expect(all.some(e => e.id === "a")).toBe(times.get("a")! < times.get("d")!);
    expect(all.some(e => e.id === "b")).toBe(false);
  });
  it("uses same-year departure and return at their derived moments", async () => {
    for (const moves of [[move("leave", 1348, true)], [move("leave", 1348, true), move("return", 1348, false)]]) {
      const c = town("a", 1348); const events = [...moves, c];
      const times = eventTimes(init.seed, events, "protagonist");
      const prior = moves.filter(m => times.get(m.id)! < times.get(c.id)!).sort((x, y) => times.get(x.id)! - times.get(y.id)!);
      const expected = prior.at(-1)?.payload.away !== true;
      expect(crisis(await entries(source(events))).length > 0).toBe(expected);
    }
  });
});

it("preserves an unrelated personal event without attributing it to a crisis", async () => {
  const personal: Event = { id: "ill", year: 1348, kind: "illness", actors: ["protagonist"], causes: [], payload: {} };
  const without = await entries(source([personal]));
  const withCrisis = await entries(source([personal, town("plague", 1348)]));
  const original = without.find(entry => entry.id === "ill")!;
  expect(original).toBeDefined();
  expect(withCrisis.find(entry => entry.id === "ill")).toMatchObject({ id: original.id, title: original.title, prose: original.prose, links: original.links, cause: original.cause, turn: original.turn });
  expect(original.prose).not.toMatch(/plague|pestilence/i);
});

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
  it.each(["en", "es"] as const)("requires actual supported records, window, birth and observed frontier (%s)", async locale => {
    expect(crisis(await entries(source([]), locale))).toEqual([]);
    const s = source([town("early", 1348, "second-pestilence"), town("late", 1350), town("pest", 1361, "second-pestilence"), town("other", 1348, "festival")], { end: 1361, protagonist: { birthYear: 1349 } });
    expect(crisis(await entries(s, locale)).map(e => e.id)).toEqual(["pest"]);
    expect(crisis(await entries(source([town("future", 1349)], { end: 1348 }), locale))).toEqual([]);
  });
  it("retains distinct records and never asserts personal illness", async () => {
    const all = crisis(await entries(source([town("a", 1348), town("b", 1348)])));
    expect(all.map(e => e.id).sort()).toEqual(["a", "b"]);
    for (const e of all) { expect(e.level).toBe(2); expect(e.prose).not.toMatch(/infect|died|disease|illness/i); expect(e.turn).toBeUndefined(); expect(e.who).toEqual([]); }
  });
  it.each(["en", "es"] as const)("suppresses context during absence and after recorded death using unchanged moments (%s)", async locale => {
    const a = town("a", 1348); const b = town("b", 1349);
    expect(crisis(await entries(source([move("leave", 1348, true), b], { protagonist: { away: true } }), locale))).toEqual([]);
    const d = death("d", 1348); const events = [a, d, b];
    const times = eventTimes(init.seed, events.filter(e => e.year === 1348), "protagonist");
    const all = crisis(await entries(source(events, { protagonist: { deathYear: 1348 } }), locale));
    expect(all.some(e => e.id === "a")).toBe(times.get("a")! < times.get("d")!);
    expect(all.some(e => e.id === "b")).toBe(false);
  });
  it.each(["en", "es"] as const)("uses same-year departure and return at their derived moments (%s)", async locale => {
    for (const moves of [[move("leave", 1348, true)], [move("leave", 1348, true), move("return", 1348, false)]]) {
      const c = town("a", 1348); const events = [...moves, c];
      const times = eventTimes(init.seed, events, "protagonist");
      const prior = moves.filter(m => times.get(m.id)! < times.get(c.id)!).sort((x, y) => times.get(x.id)! - times.get(y.id)!);
      const expected = prior.at(-1)?.payload.away !== true;
      expect(crisis(await entries(source(events), locale)).length > 0).toBe(expected);
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

it("keeps the static non-crisis illness entry stable", async () => {
  const illness: Event = { id: "ill", year: 1348, kind: "illness", actors: ["protagonist"], causes: [], payload: {} };
  const item = (await entries(source([illness]))).find(entry => entry.id === "ill")!;
  expect({ id: item.id, year: item.year, kind: item.kind, title: item.title, prose: item.prose, level: item.level, links: item.links, at: item.at, who: item.who }).toMatchInlineSnapshot(`
    {
      "at": 1348.7916666666667,
      "id": "ill",
      "kind": "illness",
      "level": 1,
      "links": [],
      "prose": "Alice fell ill.",
      "title": "Falls ill",
      "who": [
        "protagonist",
      ],
      "year": 1348,
    }
  `);
});

it.each(["en", "es"] as const)("uses year-local residence for an absence and a later return (%s)", async locale => {
  const events = [move("leave", 1348, true), town("crisis", 1349), move("return", 1349, false)];
  const s = source(events);
  const journal = s.output.journal as unknown as { final: { owned: { people: Record<string, Person> } } }[];
  journal[0]!.final.owned.people = { ...world.people, protagonist: { ...person, birthYear: 1320, away: true } };
  const times = eventTimes(init.seed, events.filter(e => e.year === 1349), "protagonist");
  const expected = times.get("return")! < times.get("crisis")!;
  expect(crisis(await entries(s, locale)).some(e => e.id === "crisis")).toBe(expected);
});

it.each(["en", "es"] as const)("keeps recorded plague causes on personal death without inventing a link (%s)", async locale => {
  const d = death("death", 1348, "black-death");
  const result = await entries(source([town("plague", 1348), d], { protagonist: { deathYear: 1348 } }), locale);
  const personal = result.find(entry => entry.id === "death")!;
  expect(personal).toBeDefined();
  expect(personal.prose.toLowerCase()).toMatch(/plague|black death|peste/);
  expect(personal.cause?.entryId).toBeUndefined();
});

it.each(["en", "es"] as const)("cuts live tick context at a same-year death without retiming (%s)", async locale => {
  const d = death("d", 1348);
  const ids = Array.from({ length: 80 }, (_, i) => `plague-${i}`);
  const crisisEvent = ids.map(id => town(id, 1348)).find(c => eventTimes(init.seed, [d, c], "protagonist").get(c.id)! > eventTimes(init.seed, [d, c], "protagonist").get(d.id)!)!;
  expect(crisisEvent).toBeDefined();
  const s = source([d, crisisEvent], { protagonist: { deathYear: 1348 } });
  expect(crisis((await projectLifecycleTick({ source: s, year: 1348, locale })).view.entries)).toEqual([]);
  expect(crisis(await entries(s, locale))).toEqual([]);
});

it.each(["en", "es"] as const)("derives absence from prior moves when snapshots do not carry residence (%s)", async locale => {
  const s = source([move("leave", 1348, true), town("later", 1349)]);
  expect(crisis(await entries(s, locale)).some(e => e.id === "later")).toBe(false);
});

it.each(["en", "es"] as const)("recognizes native residence moves recorded by destination (%s)", async locale => {
  const c = town("crisis", 1349);
  const leave: Event = { id: "leave-native", year: 1348, kind: "move", actors: ["protagonist"], causes: [], payload: { destination: "away" } };
  expect(crisis(await entries(source([leave, c]), locale))).toEqual([]);
});

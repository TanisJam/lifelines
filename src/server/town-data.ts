import { narrateEvent } from "@/domain/narrate";
import type { Person, SimulationResult } from "@/domain/types";

export interface TownEventEntry {
  readonly eventId: string;
  readonly year: number;
  readonly eventType: string;
  readonly prose: string;
}

export interface NotableDeath {
  readonly personId: string;
  readonly name: string;
  readonly year: number;
  readonly age: number;
  readonly prose: string;
}

export interface Dynasty {
  readonly surname: string;
  readonly count: number;
  readonly living: number;
  readonly founders: number;
  readonly sample: readonly string[];
}

export interface TownChronicle {
  readonly townEvents: readonly TownEventEntry[];
  readonly notableDeaths: readonly NotableDeath[];
  readonly dynasties: readonly Dynasty[];
  readonly biggestFeuds: readonly { readonly a: string; readonly b: string; readonly escalations: number; readonly resolved: boolean }[];
}

function surnameOf(name: string): string {
  const parts = name.split(" ");
  return parts.length > 1 ? parts.slice(1).join(" ") : name;
}

/**
 * Read from the same event log everything else in Lifelines is read from (decision 001) — the
 * town view the handoff describes as secondary but still real: "who lived here, which people are
 * related, what major events happened, which lives intersected" (round 6, decision 029).
 */
export function buildTownChronicle(result: SimulationResult, townName: string, seed: string): TownChronicle {
  const people = result.people;

  const townEvents = result.events
    .filter((e) => e.kind === "town")
    .map((e) => ({ eventId: e.id, year: e.year, eventType: String(e.payload.eventType ?? "event"), prose: narrateEvent(e, people, seed, townName, result.events) }));

  const deaths = result.events
    .filter((e) => e.kind === "death")
    .map((e) => {
      const personId = e.actors[0];
      const person = personId ? people[personId] : undefined;
      if (!person) return null;
      const age = typeof e.payload.age === "number" ? e.payload.age : 0;
      return { personId: person.id, name: person.name, year: e.year, age, prose: narrateEvent(e, people, seed, townName, result.events), relationships: person.mind.relationships.length };
    })
    .filter((d): d is NonNullable<typeof d> => d !== null)
    // "Notable" = lived long (a full life) or well-connected (many recorded relationships) — a
    // deterministic proxy for narrative weight, not an AI call per death (the significance scorer
    // is reserved for a person's OWN chronicle, per the existing call-budget note).
    .sort((a, b) => b.age + b.relationships * 5 - (a.age + a.relationships * 5))
    .slice(0, 10)
    .map(({ personId, name, year, age, prose }) => ({ personId, name, year, age, prose }));

  const surnameGroups = new Map<string, Person[]>();
  for (const person of Object.values(people)) {
    const surname = surnameOf(person.name);
    const list = surnameGroups.get(surname) ?? [];
    list.push(person);
    surnameGroups.set(surname, list);
  }
  const dynasties = [...surnameGroups.entries()]
    .map(([surname, members]) => ({
      surname,
      count: members.length,
      living: members.filter((m) => m.deathYear === undefined).length,
      founders: members.filter((m) => m.founder).length,
      sample: members
        .slice(0, 4)
        .map((m) => m.name)
        .filter((n, i, arr) => arr.indexOf(n) === i),
    }))
    .filter((d) => d.count >= 3)
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  const feudPairs = new Map<string, { a: string; b: string; escalations: number; resolved: boolean }>();
  for (const e of result.events) {
    if (e.kind !== "feud" && e.kind !== "reconciliation") continue;
    const [a, b] = e.actors;
    if (!a || !b) continue;
    const key = [a, b].sort().join("::");
    const existing = feudPairs.get(key) ?? { a, b, escalations: 0, resolved: false };
    if (e.kind === "feud") existing.escalations += 1;
    if (e.kind === "reconciliation") existing.resolved = true;
    feudPairs.set(key, existing);
  }
  const biggestFeuds = [...feudPairs.values()]
    .filter((f) => people[f.a] && people[f.b])
    .map((f) => ({ a: people[f.a]!.name, b: people[f.b]!.name, escalations: f.escalations, resolved: f.resolved }))
    .sort((x, y) => y.escalations - x.escalations)
    .slice(0, 6);

  return { townEvents, notableDeaths: deaths, dynasties, biggestFeuds };
}

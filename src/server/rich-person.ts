import type { SimulationResult } from "@/domain/types";

/**
 * Picks the person to land on right after world creation (round 6, decision
 * 029; scoring fixed in round 7, decision 030). Round 6 scored by raw
 * decision count, which landed on founders like Sable Underhill — married
 * at world start, no birth/childhood/youth in the log, only 9 entries.
 *
 * Round 7 fix: score primarily by EVENT-KIND VARIETY (how many distinct
 * kinds of things happened to them — birth, marriage, feud, dream, death,
 * ...), not raw count, and strongly prefer someone BORN IN-SIM (so their
 * whole life, including birth and childhood, is in the log) and DEAD BY THE
 * END (so the chronicle is a complete life, not a life-in-progress).
 */
export function pickRichPerson(result: SimulationResult): string | undefined {
  const eventKindsByPerson = new Map<string, Set<string>>();
  const eventCountByPerson = new Map<string, number>();
  for (const event of result.events) {
    for (const actorId of event.actors) {
      if (!result.people[actorId]) continue;
      const kinds = eventKindsByPerson.get(actorId) ?? new Set<string>();
      kinds.add(event.kind);
      eventKindsByPerson.set(actorId, kinds);
      eventCountByPerson.set(actorId, (eventCountByPerson.get(actorId) ?? 0) + 1);
    }
  }

  const score = (personId: string): number => {
    const person = result.people[personId]!;
    const variety = eventKindsByPerson.get(personId)?.size ?? 0;
    const count = eventCountByPerson.get(personId) ?? 0;
    const bornInSim = person.birthYear >= result.config.startYear;
    const deadByEnd = person.deathYear !== undefined && person.deathYear <= result.config.endYear;
    // Variety dominates (weight 100); total event count is only a tiebreaker (weight 1); a
    // complete, self-contained life (born in-sim AND dead by the end) gets a large flat bonus so
    // it consistently beats a founder with a superficially longer but incomplete event list.
    return variety * 100 + count + (bornInSim ? 500 : 0) + (deadByEnd ? 500 : 0);
  };

  const bornInSimAndDead = Object.values(result.people).filter((p) => p.birthYear >= result.config.startYear && p.deathYear !== undefined && p.deathYear <= result.config.endYear);
  const pool = bornInSimAndDead.length > 0 ? bornInSimAndDead : Object.values(result.people);

  const best = pool.reduce<{ id: string; score: number } | undefined>((acc, p) => {
    const s = score(p.id);
    if (!acc || s > acc.score) return { id: p.id, score: s };
    return acc;
  }, undefined);

  return best?.id;
}

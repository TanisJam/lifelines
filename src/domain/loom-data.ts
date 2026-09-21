import type { Bond } from "./mind";
import type { SimulationResult } from "./types";

/** One lane's worth of positioning data for The Loom (decision 011). Derived once per render from a `SimulationResult`, not stored. */
export interface LoomPerson {
  readonly id: string;
  readonly name: string;
  readonly sex: "f" | "m";
  readonly birthYear: number;
  readonly deathYear: number | null;
  readonly spouseId: string | null;
  readonly motherId: string | null;
  readonly fatherId: string | null;
  readonly founder: boolean;
  readonly movedAway: boolean;
  /** Set for immigrants: the year their lane starts (they weren't born in town). */
  readonly arrivedYear: number | null;
  /** The year they married their current spouse, for drawing the connector. */
  readonly marriageYear: number | null;
  /** Top relationships (round 4 fix B3: hover arcs for grudges/friendships), from `mind.relationships`. */
  readonly relationships: readonly { personId: string; bond: Bond; strength: number }[];
}

/**
 * Builds lane data for every person in a branch, plus a lane order.
 * Base order is a family-grouped DFS heuristic (spouses adjacent, children
 * right after their mother, sorted by age) from the founding families; a
 * second pass then nudges any marriage formed DURING the simulation (not
 * just at world-gen) so its two spouses end up adjacent too — "a married
 * couple's lanes run adjacent... from the marriage onward" (round 4 fix
 * B3). This is a simple heuristic, not full StoryFlow crossing
 * minimization: later marriages can still cause some crossing as their
 * lane gets pulled next to their spouse's.
 */
export function buildLoomPeople(result: SimulationResult): { people: readonly LoomPerson[]; laneOrder: readonly string[] } {
  const people: LoomPerson[] = Object.values(result.people).map((p) => {
    const arrivalEvent = result.events.find((e) => e.kind === "move" && e.payload.arrived === true && e.actors.includes(p.id));
    const marriageEvent = p.spouseId ? result.events.filter((e) => e.kind === "marriage" && e.actors.includes(p.id) && e.actors.includes(p.spouseId!)).sort((a, b) => b.year - a.year)[0] : undefined;
    const lastMove = result.events.filter((e) => e.kind === "move" && e.actors.includes(p.id)).sort((a, b) => b.year - a.year)[0];
    return {
      id: p.id,
      name: p.name,
      sex: p.sex,
      birthYear: p.birthYear,
      deathYear: p.deathYear ?? null,
      spouseId: p.spouseId ?? null,
      motherId: p.motherId ?? null,
      fatherId: p.fatherId ?? null,
      founder: p.founder,
      movedAway: lastMove?.payload.away === true,
      arrivedYear: arrivalEvent ? arrivalEvent.year : null,
      marriageYear: marriageEvent ? marriageEvent.year : null,
      relationships: p.mind.relationships.map((r) => ({ personId: r.personId, bond: r.bond, strength: r.strength })),
    };
  });

  const byId = new Map(people.map((p) => [p.id, p]));
  const byMother = new Map<string, LoomPerson[]>();
  for (const p of people) {
    if (!p.motherId) continue;
    if (!byMother.has(p.motherId)) byMother.set(p.motherId, []);
    byMother.get(p.motherId)!.push(p);
  }

  const visited = new Set<string>();
  const order: string[] = [];
  function visit(id: string): void {
    if (visited.has(id)) return;
    visited.add(id);
    order.push(id);
    const person = byId.get(id);
    if (person?.spouseId && !visited.has(person.spouseId)) visit(person.spouseId);
    const kids = (byMother.get(id) ?? []).slice().sort((a, b) => a.birthYear - b.birthYear || a.id.localeCompare(b.id));
    for (const kid of kids) visit(kid.id);
  }

  const roots = people.filter((p) => !p.motherId && !p.fatherId).sort((a, b) => a.birthYear - b.birthYear || a.id.localeCompare(b.id));
  for (const root of roots) visit(root.id);
  // Stragglers (shouldn't normally happen — e.g. a child whose mother isn't in this branch's people for some reason).
  for (const p of people) visit(p.id);

  // Second pass: pull spouses from marriages formed DURING the simulation
  // (not captured by the founders-first DFS above) next to each other.
  const marriages = result.events.filter((e) => e.kind === "marriage").sort((a, b) => a.year - b.year);
  for (const marriage of marriages) {
    const [aId, bId] = marriage.actors;
    if (!aId || !bId) continue;
    const aIndex = order.indexOf(aId);
    const bIndex = order.indexOf(bId);
    if (aIndex === -1 || bIndex === -1 || Math.abs(aIndex - bIndex) === 1) continue;
    // Move b to sit immediately after a.
    order.splice(bIndex, 1);
    const newAIndex = order.indexOf(aId);
    order.splice(newAIndex + 1, 0, bId);
  }

  return { people, laneOrder: order };
}

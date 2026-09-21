import type { Person, SimulationResult } from "./types";

export interface PersonDiff {
  readonly personId: string;
  readonly name: string;
  readonly field: "alive" | "job" | "spouse" | "location";
  readonly before: string;
  readonly after: string;
}

export interface PersonPresence {
  readonly personId: string;
  readonly name: string;
  readonly birthYear: number;
}

export interface BranchDiff {
  readonly forkYear: number;
  /** Count of distinct people affected: field changes, plus people newly born or never born. */
  readonly changedPeopleCount: number;
  readonly diffs: readonly PersonDiff[];
  /** People who exist in the forked branch but never existed in the original (a different couple, or the same couple at a different time, had them). */
  readonly newPeople: readonly PersonPresence[];
  /** People who existed in the original branch but don't in the forked one (their birth's prerequisites no longer happened). */
  readonly missingPeople: readonly PersonPresence[];
}

function describeAlive(person: Person): string {
  return person.deathYear === undefined ? "alive" : `died ${person.deathYear}`;
}

function describeSpouse(person: Person, people: Readonly<Record<string, Person>>): string {
  if (!person.spouseId) return "unmarried";
  return people[person.spouseId]?.name ?? person.spouseId;
}

/**
 * Compares two branches (typically the original and a fork) person by
 * person and reports what changed — the visible "butterfly effect" of an
 * edit. Covers both field-level changes for people present in both branches
 * (alive/dead, job, spouse) AND people who exist in only one branch: a
 * changed marriage or a parent's changed fate can mean a child who was born
 * in one branch was never conceived in the other, or vice versa. Without
 * this, a fork that erases or creates people would silently under-report
 * how much actually changed.
 */
export function diffBranches(original: SimulationResult, forked: SimulationResult, forkYear: number): BranchDiff {
  const diffs: PersonDiff[] = [];
  const originalIds = new Set(Object.keys(original.people));
  const forkedIds = new Set(Object.keys(forked.people));
  const sharedIds = [...originalIds].filter((id) => forkedIds.has(id));

  for (const id of sharedIds) {
    const before = original.people[id]!;
    const after = forked.people[id]!;
    const name = after.name;

    const aliveBefore = describeAlive(before);
    const aliveAfter = describeAlive(after);
    if (aliveBefore !== aliveAfter) diffs.push({ personId: id, name, field: "alive", before: aliveBefore, after: aliveAfter });

    if (before.job !== after.job) diffs.push({ personId: id, name, field: "job", before: before.job, after: after.job });

    const spouseBefore = describeSpouse(before, original.people);
    const spouseAfter = describeSpouse(after, forked.people);
    if (spouseBefore !== spouseAfter) diffs.push({ personId: id, name, field: "spouse", before: spouseBefore, after: spouseAfter });
  }

  const newPeople: PersonPresence[] = [...forkedIds]
    .filter((id) => !originalIds.has(id))
    .map((id) => ({ personId: id, name: forked.people[id]!.name, birthYear: forked.people[id]!.birthYear }))
    .sort((a, b) => a.birthYear - b.birthYear);

  const missingPeople: PersonPresence[] = [...originalIds]
    .filter((id) => !forkedIds.has(id))
    .map((id) => ({ personId: id, name: original.people[id]!.name, birthYear: original.people[id]!.birthYear }))
    .sort((a, b) => a.birthYear - b.birthYear);

  const changedPeopleCount = new Set([...diffs.map((d) => d.personId), ...newPeople.map((p) => p.personId), ...missingPeople.map((p) => p.personId)]).size;

  return { forkYear, changedPeopleCount, diffs, newPeople, missingPeople };
}

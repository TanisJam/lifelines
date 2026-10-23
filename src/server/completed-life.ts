import type { SimulationResult, YearSnapshot } from "@/domain/types";

/** Admission only: never invent death or treat a simulation horizon as completion. */
export function assertCompletedLife(result: SimulationResult, snapshots: ReadonlyMap<number, YearSnapshot>): void {
  const protagonist = result.people.protagonist;
  const deathYear = protagonist?.deathYear;
  if (!protagonist || deathYear === undefined) throw new Error("This life has not yet ended.");

  const { startYear, endYear } = result.config;
  if (protagonist.id !== "protagonist" || !Number.isSafeInteger(protagonist.birthYear) ||
      !Number.isSafeInteger(deathYear) || !Number.isSafeInteger(startYear) || !Number.isSafeInteger(endYear) ||
      deathYear < protagonist.birthYear || deathYear < startYear || deathYear > endYear) {
    throw new Error("Invalid completed-life years.");
  }

  const deaths = result.events.filter((event) => event.kind === "death" && event.actors[0] === "protagonist");
  const death = deaths[0];
  if (deaths.length !== 1 || !death || !death.id || death.year !== deathYear ||
      result.events.filter((event) => event.id === death.id).length !== 1) {
    throw new Error("Completed life requires one consistent canonical protagonist death.");
  }
  if (result.events.some((event) => !Number.isSafeInteger(event.year) || event.year > deathYear) ||
      result.decisions.some((decision) => !Number.isSafeInteger(decision.year) || decision.year > deathYear)) {
    throw new Error("Completed life contains invalid or post-death history.");
  }

  // The death must have actually been executed, not merely declared in a result or completion flag.
  const final = snapshots.get(deathYear);
  const finalDeaths = final?.events.filter((event) => event.kind === "death" && event.actors[0] === "protagonist");
  if (!final || final.people.protagonist?.id !== "protagonist" ||
      final.people.protagonist.birthYear !== protagonist.birthYear || final.people.protagonist.deathYear !== deathYear ||
      finalDeaths?.length !== 1 || finalDeaths[0]!.id !== death.id || finalDeaths[0]!.year !== deathYear) {
    throw new Error("Completed-life frontier must include the canonical death year.");
  }
  for (const [year, snapshot] of snapshots) {
    if (!Number.isSafeInteger(year) || snapshot.year !== year || year > deathYear ||
        (year < deathYear && snapshot.people.protagonist?.deathYear !== undefined)) {
      throw new Error("Invalid or post-death completed-life frontier.");
    }
    // The synthetic PRE-START baseline (`startYear - 1`) is captured from the initialised world, which
    // already carries its seeded history - including events dated inside the first simulated year (a
    // `period-marker` at 1327, founding marriages, etc.). It is not a simulated year, so the
    // "this year's history only" rule below does not apply to it.
    if (year < startYear) continue;
    if (snapshot.events.some((event) => !Number.isSafeInteger(event.year) || event.year > year) ||
        snapshot.decisions.some((decision) => !Number.isSafeInteger(decision.year) || decision.year > year)) {
      throw new Error("Invalid or post-death completed-life frontier.");
    }
  }
}

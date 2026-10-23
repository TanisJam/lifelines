import type { LifeScene, ScenePerson } from "../contracts/life";
import { replayAnnualRuntime, type RuntimeOutput } from "../domain/e-runtime";
import { selectHistoricalEvidence } from "../domain/e-selection";
import { journalPlacements } from "./historical-journal-placement";

/** Explicit, inactive historical projection. Admission checks every retained checkpoint,
 * including future ones; physical dates come only from the exact selected replay.
 * Only the subject and selected beat/causal-evidence actors enter the scene. Neither
 * the registry's family fields nor runtime favor ties imply scene relationships.
 * Living spans end at the complete selected year's last journal slot, including
 * hidden/ineligible entries, or at asOfYear when that year has no entries.
 * Recorded subject death takes precedence without clamping.
 * All returned containers and people are detached and frozen (no mutable Maps).
 */
export function deriveHistoricalScene(input: {
  readonly history: unknown;
  readonly subjectActorID: string;
  readonly asOfYear: number;
}): LifeScene {
  // Descriptor admission must precede any reads, even of the envelope itself.
  const projection = selectHistoricalEvidence(input);
  const checkpoint = (input.history as readonly RuntimeOutput[])
    .find(output => output.frontier === projection.asOfYear)!;
  const selected = replayAnnualRuntime(checkpoint);
  const placements = journalPlacements(selected.journal);
  const selectedEntries = selected.journal.find(record => record.plan.year === projection.asOfYear)?.entries;
  const lastEntry = selectedEntries?.[selectedEntries.length - 1];
  const livingEnd = lastEntry === undefined ? projection.asOfYear : placements[lastEntry.id];
  const introductions = new Map<string, number>();
  const deaths = new Map<string, number>();
  for (const person of Object.values(selected.origin.initial.people)) {
    introductions.set(person.id, person.birthYear);
    if (person.deathYear !== undefined) deaths.set(person.id, person.deathYear);
  }
  // Scan ALL physical entries, not just visible evidence. Creation/death may be
  // absent from the selected prose, but their complete-year slots remain truth.
  for (const record of selected.journal) {
    for (const entry of record.entries) {
      if (entry.phase !== "physical" || entry.outcome !== "committed") continue;
      const operation = record.plan.physical[entry.declarationIndex];
      if (operation.kind === "create") introductions.set(operation.person.id, placements[entry.id]);
      else if (operation.kind === "death") deaths.set(operation.actor, placements[entry.id]);
    }
  }
  const ids = new Set([projection.subject.id]);
  for (const node of [...projection.beats, ...projection.evidence]) {
    for (const actor of node.actors) ids.add(actor.id);
  }
  const people = [...ids].map((id): ScenePerson => {
    const person = selected.state.people[id];
    const appearsAt = introductions.get(id);
    if (appearsAt === undefined) throw new Error("Actor has no physical introduction");
    const self = id === projection.subject.id;
    const diedAt = deaths.get(id);
    return Object.freeze({ id, name: person.name, sex: person.sex, born: person.birthYear,
      appearsAt, ...(diedAt === undefined ? {} : { diedAt }),
      relCode: self ? "self" : "participant", group: self ? "self" : "others" });
  });
  const subject = people[0];
  return Object.freeze({ timeBasis: "journal-ordered", people: Object.freeze(people),
    edges: Object.freeze([]), village: Object.freeze([]), bands: Object.freeze([]),
    span: Object.freeze({ start: subject.born, end: subject.diedAt ?? livingEnd }) });
}

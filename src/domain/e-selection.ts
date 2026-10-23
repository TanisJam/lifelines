import { isDeepStrictEqual } from "node:util";
import { replayAnnualRuntime, type RuntimeEntry, type PhysicalOperation, type ResourceOperation } from "./e-runtime";
import { requireFavorData, type HelpFavorEffect } from "./effects";
import { requireFields, requireId, requireInteger } from "./obligations";
import type { Event } from "./types";

export const HISTORICAL_EVIDENCE_VERSION = "historical-rules-e4-evidence-1" as const;
type Immutable<T> = T extends object ? { readonly [K in keyof T]: Immutable<T[K]> } : T;
export interface HistoricalIdentity { id: string; name: string }
type RecordedFact =
  | Exclude<HelpFavorEffect, { kind: "tie" | "appraisal" }>
  | { kind: "creation"; actor: string; birthYear: number }
  | { kind: "death"; actor: string; year: number }
  | { kind: "residence"; actor: string; status: "home" | "away" }
  | ResourceOperation
  | { kind: "origin"; backfilled?: boolean; age?: number; awayFromTown?: boolean;
      cause?: string; marker?: string; role?: string };
export interface HistoricalEvidence {
  id: string; year: number; position: number | null; kind: string;
  actors: HistoricalIdentity[]; causes: string[]; facts: RecordedFact[];
  response?: "help" | "refuse";
}
export interface HistoricalProjection {
  version: typeof HISTORICAL_EVIDENCE_VERSION; asOfYear: number;
  subject: HistoricalIdentity; beats: HistoricalEvidence[]; evidence: HistoricalEvidence[];
}
function freeze<T>(value: T): Immutable<T> {
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value as Immutable<T>;
}

/** Internal rules-only admission of complete retained outputs, not provenance or a wire codec. */
export function selectHistoricalEvidence(input: unknown): Immutable<HistoricalProjection> {
  requireFavorData(input, true); // Guard all descriptors before even reading the envelope.
  if (input === null || typeof input !== "object" || Array.isArray(input)) throw new Error("Expected selection input");
  requireFields(input, ["history", "subjectActorID", "asOfYear"]);
  const { history, subjectActorID, asOfYear } = input as Record<string, unknown>;
  requireId(subjectActorID);
  requireInteger(asOfYear, Number.MIN_SAFE_INTEGER);
  if (Object.is(asOfYear, -0)) throw new Error("Negative zero year");
  if (!Array.isArray(history) || history.length < 2) throw new Error("Initial and annual checkpoints required");
  const admitted = history.map(replayAnnualRuntime);
  const initial = admitted[0];
  if (initial.frontier !== null || initial.journal.length !== 0) throw new Error("Initial admission root required");
  for (let i = 1; i < admitted.length; i++) {
    const previous = admitted[i - 1], current = admitted[i];
    if (current.frontier === null || (previous.frontier !== null && current.frontier <= previous.frontier)
      || current.journal.length !== i
      || !isDeepStrictEqual(current.origin, initial.origin)
      || !isDeepStrictEqual(current.genesis, initial.genesis)
      || !isDeepStrictEqual(current.journal.slice(0, i - 1), previous.journal)) {
      throw new Error("Retained checkpoint origin or prefix disagreement");
    }
  }
  const selected = admitted.find(output => output.frontier === asOfYear);
  if (!selected) throw new Error("Exact retained annual frontier required");
  if (!Object.hasOwn(selected.state.people, subjectActorID)) throw new Error("Subject outside historical registry");

  // Names come from introductions only. Never borrow final Person or consumed Mind.
  const identities = new Map<string, HistoricalIdentity>();
  for (const person of Object.values(initial.state.people)) identities.set(person.id, { id: person.id, name: person.name });
  const entries = selected.journal.flatMap(record => record.entries);
  for (const record of selected.journal) {
    for (const operation of record.plan.physical) {
      if (operation.kind === "create") identities.set(operation.person.id, { id: operation.person.id, name: operation.person.name });
    }
  }
  function actor(id: string): HistoricalIdentity {
    const identity = identities.get(id);
    if (!identity) throw new Error("Actor has no historical introduction");
    return identity;
  }
  const nodes = new Map<string, HistoricalEvidence>();
  // Only genuine origin events; later legacy physical aliases are represented by journal nodes.
  // Avoid recursively mapping the legacy JsonValue union in this read-only traversal.
  const originEvents = initial.origin.initial.events as unknown as readonly Event[];
  for (const event of originEvents) {
    if (event.year > asOfYear) continue;
    if (nodes.has(event.id)) throw new Error("Duplicate origin evidence");
    const allowed = ["backfilled", "age", "awayFromTown", "cause", "marker", "role"];
    if (!["birth", "marriage", "death", "period-marker"].includes(event.kind)
      || Object.keys(event.payload).some(key => !allowed.includes(key))) throw new Error("Unsupported origin fact");
    nodes.set(event.id, { id: event.id, year: event.year, position: null, kind: event.kind,
      actors: event.actors.map(actor), causes: [...event.causes],
      facts: [{ kind: "origin", ...structuredClone(event.payload as unknown as Record<string, string | number | boolean>) } as RecordedFact] });
  }
  function facts(entry: Immutable<RuntimeEntry>): RecordedFact[] {
    const record = selected!.journal.find(record => record.plan.year === entry.year)!;
    if (entry.phase === "physical") {
      const op: Immutable<PhysicalOperation> = record.plan.physical[entry.declarationIndex];
      if (op.kind === "create") return [{ kind: "creation", actor: op.person.id, birthYear: op.person.birthYear }];
      if (op.kind === "death") return [{ kind: "death", actor: op.actor, year: entry.year }];
      return [{ kind: "residence", actor: op.actor, status: op.status }];
    }
    if (entry.phase === "resources") return [structuredClone(record.plan.resources[entry.declarationIndex]) as ResourceOperation];
    // Replay has admitted exact effects. Supplemental ties are not prose motives.
    return structuredClone(entry.effects.filter(effect => {
      const kind = (effect as { kind: string }).kind;
      return ["grain", "obligation", "settlement", "assistance"].includes(kind);
    })) as RecordedFact[];
  }
  for (const entry of entries) {
    if (nodes.has(entry.id)) throw new Error("Duplicate canonical evidence");
    nodes.set(entry.id, { id: entry.id, year: entry.year, position: entry.position, kind: entry.kind,
      actors: entry.actors.map(actor), causes: [...entry.causes], facts: facts(entry),
      ...(entry.kind === "help-response" ? { response: entry.authority!.selected } : {}) });
  }
  const beats = entries.filter(entry => entry.outcome === "committed"
    && ["grain-grant", "help-response"].includes(entry.kind) && entry.actors.includes(subjectActorID))
    .map(entry => nodes.get(entry.id)!);
  const included = new Set<string>(), visiting = new Set<string>();
  function visit(id: string): void {
    if (visiting.has(id)) throw new Error("Cyclic evidence causes");
    if (included.has(id)) return;
    const node = nodes.get(id);
    if (!node) throw new Error("Missing historical cause");
    visiting.add(id);
    for (const cause of node.causes) {
      const antecedent = nodes.get(cause);
      if (!antecedent || antecedent.year > node.year
        || (antecedent.position !== null && node.position !== null && antecedent.position >= node.position)) {
        throw new Error("Missing or forward historical cause");
      }
      visit(cause);
    }
    visiting.delete(id); included.add(id);
  }
  beats.forEach(beat => visit(beat.id));
  const evidence = [...nodes.values()].filter(node => included.has(node.id))
    .sort((a, b) => a.year - b.year || (a.position ?? -1) - (b.position ?? -1));
  return freeze(structuredClone({ version: HISTORICAL_EVIDENCE_VERSION, asOfYear,
    subject: actor(subjectActorID), beats, evidence }));
}

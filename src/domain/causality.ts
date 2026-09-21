import type { Event } from "./types";

export interface CauseNode {
  readonly event: Event;
  readonly causes: readonly CauseNode[];
}

/**
 * Walks an event's `causes[]` chain backward into a tree, so the UI can
 * answer "why did this happen?" by following cause -> cause -> cause. Cuts
 * cycles defensively (the engine never creates them, but editable data
 * should not be able to hang the walk).
 */
export function walkCauses(eventId: string, eventsById: ReadonlyMap<string, Event>, seen: ReadonlySet<string> = new Set()): CauseNode | undefined {
  const event = eventsById.get(eventId);
  if (!event) return undefined;
  if (seen.has(eventId)) return { event, causes: [] };
  const nextSeen = new Set(seen);
  nextSeen.add(eventId);
  const causes = event.causes.map((id) => walkCauses(id, eventsById, nextSeen)).filter((n): n is CauseNode => n !== undefined);
  return { event, causes };
}

export function indexEventsById(events: readonly Event[]): Map<string, Event> {
  return new Map(events.map((e) => [e.id, e]));
}

import { activeFeudPair, activeRomancePairs } from "./events";
import type { Event, Person } from "./types";

/**
 * Decision 084: the people whose decisions shape the protagonist's own story — the protagonist,
 * their spouse, parents, siblings and children, and anyone they have an open romance or feud with.
 * `simulate.ts` gives these people the full decision context and everyone else a compact one
 * (`PersonYearBatch.detail`), which is what keeps a Jev-driven village affordable. Empty when there
 * is no protagonist, so a protagonist-less run keeps the full context for everyone.
 */
export function storyCircle(protagonistId: string | undefined, people: Readonly<Record<string, Person>>, events: readonly Event[]): Set<string> {
  const circle = new Set<string>();
  const protagonist = protagonistId ? people[protagonistId] : undefined;
  if (!protagonist) return circle;

  const add = (id: string | undefined): void => {
    if (id) circle.add(id);
  };
  add(protagonist.id);
  add(protagonist.spouseId);
  add(protagonist.motherId);
  add(protagonist.fatherId);
  for (const other of Object.values(people)) {
    const isChild = other.motherId === protagonist.id || other.fatherId === protagonist.id;
    const isSibling =
      other.id !== protagonist.id &&
      ((protagonist.motherId !== undefined && other.motherId === protagonist.motherId) || (protagonist.fatherId !== undefined && other.fatherId === protagonist.fatherId));
    if (isChild || isSibling) add(other.id);
  }
  for (const partnerId of activeRomancePairs(events, protagonist.id)) add(partnerId);
  add(activeFeudPair(events, protagonist.id));
  return circle;
}

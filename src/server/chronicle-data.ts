import { familyRelation } from "@/domain/narrate";
import type { Event, Person } from "@/domain/types";

/**
 * A short NOUN PHRASE for a causal annotation — "her courtship with Greta Ravensworth (1506)",
 * not a re-rendered event title (round 8 fix, decision 033: "Follows meets greta ravensworth in
 * 1506" had a lowercase proper noun AND read as a verb-titled sentence fragment, not a phrase that
 * fits after "Follows"). `viewerId` decides the possessive pronoun and which actor is "the other
 * one" when the event has two actors.
 */
export function causeNounPhrase(event: Event, viewerId: string, people: Readonly<Record<string, Person>>): string | null {
  const viewer = people[viewerId];
  const pronoun = viewer ? (viewer.sex === "f" ? "her" : "his") : "their";
  const otherId = event.actors.find((id) => id !== viewerId);
  const other = otherId ? people[otherId]?.name : undefined;

  switch (event.kind) {
    case "romance":
      return other ? `${pronoun} courtship with ${other}` : `${pronoun} courtship`;
    case "breakup":
      return other ? `${pronoun} breakup with ${other}` : `${pronoun} breakup`;
    case "marriage":
      return other ? `${pronoun} marriage to ${other}` : `${pronoun} marriage`;
    case "feud":
      return other ? `${pronoun} feud with ${other}` : `${pronoun} feud`;
    case "reconciliation":
      return other ? `${pronoun} peace with ${other}` : `${pronoun} reconciliation`;
    case "illness":
      return `${pronoun} illness`;
    case "breakdown":
      return `${pronoun} breaking point`;
    case "job":
      return `${pronoun} work as ${String(event.payload.job ?? "a tradesperson")}`;
    case "move":
      return event.payload.away ? `${pronoun} move away` : `${pronoun} arrival in town`;
    case "death": {
      const deceasedId = event.actors[0];
      const deceased = deceasedId ? people[deceasedId] : undefined;
      const relation = viewer && deceased ? familyRelation(viewer, deceased) : undefined;
      return relation && deceased ? `${relation === "husband" || relation === "wife" ? pronoun : `${pronoun} ${relation}'s`} death` : deceased ? `${deceased.name}'s death` : null;
    }
    case "town":
      return `the ${String(event.payload.eventType ?? "town event")}`;
    case "dream":
      return event.payload.outcome === "realized" ? `${pronoun} dream coming true` : null;
    default:
      return null;
  }
}

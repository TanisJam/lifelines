import { ageInYear } from "@/domain/actuarial";
import type { DecisionRecord } from "@/domain/decisions";
import { familyRelation, lifeSummary, narratePersonTimeline } from "@/domain/narrate";
import type { Event, Person } from "@/domain/types";
import { getDecisionMaker } from "@/server/decision-engine";
import { getBranch, getWorld, listBranches } from "@/server/world-store";

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

/**
 * Assembles everything the Living Chronicle needs for one person (round 6, decision 029): person
 * info + `lifeSummary`, the left rail's relationship list, the right rail's branch list, and the
 * full `{title, prose, causes, decision}` timeline. Shared by the page (SSR, first paint) and the
 * API route (client refetch after an in-place rewrite) so the two can never disagree about shape.
 */
export async function getChronicleData(worldId: string, personId: string, branchIdParam?: string) {
  const world = getWorld(worldId);
  if (!world) return { error: "World not found." as const, status: 404 as const };

  const branchId = branchIdParam ?? world.originalBranchId;
  const branch = getBranch(worldId, branchId);
  if (!branch) return { error: "Branch not found." as const, status: 404 as const };

  const people = branch.result.people;
  const person = people[personId];
  if (!person) return { error: "Person not found." as const, status: 404 as const };

  const timeline = await narratePersonTimeline(personId, branch.result.events, people, getDecisionMaker(), 8, world.config.seed, world.config.town.name);
  const now = world.config.endYear;

  const decisionByEventId = new Map<string, DecisionRecord>();
  for (const decision of branch.result.decisions) {
    for (const eventId of decision.resultingEventIds) decisionByEventId.set(eventId, decision);
  }

  const relatedIds = new Set<string>();
  const relationships: { personId: string; name: string; relation: string; strength: number | null }[] = [];
  const pushRelated = (id: string | undefined, relation: string, strength: number | null) => {
    if (!id || relatedIds.has(id) || !people[id]) return;
    relatedIds.add(id);
    relationships.push({ personId: id, name: people[id]!.name, relation, strength });
  };
  if (person.spouseId) pushRelated(person.spouseId, familyRelation(person, people[person.spouseId]!) ?? "spouse", null);
  pushRelated(person.motherId, "mother", null);
  pushRelated(person.fatherId, "father", null);
  for (const child of Object.values(people)) {
    if (child.motherId === personId || child.fatherId === personId) pushRelated(child.id, child.sex === "m" ? "son" : "daughter", null);
  }
  for (const rel of person.mind.relationships) pushRelated(rel.personId, rel.bond, rel.strength);

  const branches = listBranches(worldId).map((b) => ({ id: b.id, label: b.label, forkYear: b.forkYear ?? null, parentBranchId: b.parentBranchId ?? null }));

  return {
    data: {
      worldId,
      branchId,
      townName: world.config.town.name,
      person: {
        ...person,
        alive: person.deathYear === undefined,
        age: person.deathYear !== undefined ? ageInYear(person.birthYear, person.deathYear) : ageInYear(person.birthYear, now),
        spouseName: person.spouseId ? (people[person.spouseId]?.name ?? null) : null,
      },
      lifeSummary: lifeSummary(person, people, branch.result.events, world.config.town.name),
      relationships,
      branches,
      currentBranch: { id: branch.id, label: branch.label, forkYear: branch.forkYear ?? null },
      timeline: timeline.map((t) => ({
        eventId: t.event.id,
        year: t.event.year,
        kind: t.event.kind,
        actors: t.event.actors,
        title: t.title,
        prose: t.prose,
        significance: t.significance,
        isKeyMoment: t.significance >= 0.75,
        // Round 8 fix (decision 033, "causal annotations read badly"): a proper noun phrase
        // ("her courtship with Greta Ravensworth"), never a re-rendered title. Dropped entirely
        // when the cause isn't strictly EARLIER than this entry (a same-year "child" decision
        // cited as the cause of its own birth event pointed at nothing useful — "Follows child in
        // 1517"), when no noun phrase could be built for that event kind, or beyond the first —
        // "at most one per entry, and only when the cause is in an earlier year".
        causes: t.event.causes
          .map((causeId) => branch.result.events.find((e) => e.id === causeId))
          .filter((causeEvent): causeEvent is Event => !!causeEvent && causeEvent.year < t.event.year)
          .map((causeEvent) => {
            const phrase = causeNounPhrase(causeEvent, personId, people);
            if (!phrase) return null;
            return { eventId: causeEvent.id, phrase, year: causeEvent.year, inThisLife: timeline.some((e) => e.event.id === causeEvent.id) };
          })
          .filter((c): c is { eventId: string; phrase: string; year: number; inThisLife: boolean } => c !== null)
          .slice(0, 1),
        decision: decisionByEventId.get(t.event.id) ?? null,
      })),
    },
  };
}

export type ChronicleData = Awaited<ReturnType<typeof getChronicleData>> extends { data: infer D } ? D : never;

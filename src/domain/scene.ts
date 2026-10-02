import type { EdgeKind, LifeScene, RelCode, SceneBand, SceneEdge, ScenePerson, SceneGroup, VillageSoul } from "@/contracts/life";
import { eventTimes } from "./month";
import { BLACK_DEATH_YEARS, SECOND_PESTILENCE_YEARS } from "./period/events";
import type { Event, Person } from "./types";

/**
 * Pure derivation of the night-sky scene graph from a finished (or in-progress) simulation. No I/O:
 * the caller supplies the people, events and — for friendship, which lives only in per-year
 * snapshots — the friend bonds it already resolved. Everything is keyed by person id so a scene
 * built from a later state is a superset of one built earlier.
 */

export interface SceneFriend {
  readonly id: string;
  /** First year the bond existed; `null` when it predates the life. */
  readonly fromAt: number | null;
  /** Year the bond was dropped, if it was. */
  readonly untilAt?: number;
}

export interface SceneInput {
  readonly seed: string;
  readonly people: Readonly<Record<string, Person>>;
  readonly events: readonly Event[];
  readonly protagonistId: string;
  /** Friend bonds, strongest first; only the first {@link MAX_FRIENDS} present in `people` are kept. */
  readonly friends?: readonly SceneFriend[];
  /** The latest simulated year, used to clip plague bands of a life still being written. Defaults to the last event year. */
  readonly through?: number;
}

export const MAX_FRIENDS = 6;

/** Locale-independent id ordering, so a scene is identical on every host. */
const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const PLAGUES: readonly { readonly kind: SceneBand["kind"]; readonly years: ReadonlySet<number> }[] = [
  { kind: "black-death", years: BLACK_DEATH_YEARS },
  { kind: "second-pestilence", years: SECOND_PESTILENCE_YEARS },
];

export function deriveLifeScene(input: SceneInput): LifeScene {
  const { seed, people, events, protagonistId } = input;
  const protagonist = people[protagonistId];
  if (!protagonist) throw new Error(`deriveLifeScene: unknown protagonist ${protagonistId}`);

  const times = eventTimes(seed, events, protagonistId);
  const timeOf = (e: Event | undefined): number | undefined => (e ? times.get(e.id) : undefined);
  const birthAt = new Map<string, number>();
  const arrivalAt = new Map<string, number>();
  const departureAt = new Map<string, number>();
  const diedAt = new Map<string, number>();
  for (const e of events) {
    const t = timeOf(e)!;
    const subject = e.actors[0];
    if (!subject) continue;
    if (e.kind === "birth" && !birthAt.has(subject)) birthAt.set(subject, t);
    else if (e.kind === "death" && !diedAt.has(subject)) diedAt.set(subject, t);
    else if (e.kind === "move" && e.payload.arrived === true && !arrivalAt.has(subject)) arrivalAt.set(subject, t);
    else if (e.kind === "move" && e.payload.away === true && !departureAt.has(subject)) departureAt.set(subject, t);
  }

  const start = birthAt.get(protagonistId) ?? protagonist.birthYear;
  const end = diedAt.get(protagonistId) ?? null;
  // Founders carry only a `deathYear`; an event-derived time wins when one exists.
  const deathOf = (id: string): number | undefined => diedAt.get(id) ?? people[id]?.deathYear;
  const bornOf = (id: string): number => birthAt.get(id) ?? people[id]?.birthYear ?? start;

  // --- Membership -------------------------------------------------------------------------------
  const group = new Map<string, { group: SceneGroup; relCode: RelCode; anchor?: string }>();
  const add = (id: string | undefined, g: SceneGroup, relCode: RelCode, anchor?: string): void => {
    if (!id || !people[id] || group.has(id)) return;
    group.set(id, { group: g, relCode, ...(anchor ? { anchor } : {}) });
  };
  const all = Object.values(people);
  const parentIds = [protagonist.motherId, protagonist.fatherId];
  const marriages = events.filter((e) => e.kind === "marriage" && e.actors.length >= 2);
  const partnerOf = (id: string): string[] => marriages.filter((m) => m.actors.includes(id)).map((m) => m.actors.find((a) => a !== id)!);

  add(protagonistId, "self", "self");
  for (const id of parentIds) add(id, "parents", "parent");
  for (const other of all) {
    const sharesParent = (protagonist.motherId !== undefined && other.motherId === protagonist.motherId) || (protagonist.fatherId !== undefined && other.fatherId === protagonist.fatherId);
    if (other.id !== protagonistId && sharesParent) add(other.id, "siblings", "sibling");
  }
  for (const id of partnerOf(protagonistId)) add(id, "spouses", "spouse");
  add(protagonist.spouseId, "spouses", "spouse");
  const children = all.filter((c) => c.motherId === protagonistId || c.fatherId === protagonistId).sort((a, b) => bornOf(a.id) - bornOf(b.id) || byCodeUnit(a.id, b.id));
  for (const child of children) add(child.id, "children", "child");
  for (const e of events) {
    if (e.kind !== "romance" || !e.actors.includes(protagonistId)) continue;
    add(e.actors.find((a) => a !== protagonistId), "others", "lover");
  }
  for (const e of events) {
    if (e.kind !== "feud" || !e.actors.includes(protagonistId)) continue;
    add(e.actors.find((a) => a !== protagonistId), "others", "rival");
  }
  const keptFriends = (input.friends ?? []).filter((f) => people[f.id]).slice(0, MAX_FRIENDS);
  for (const friend of keptFriends) add(friend.id, "others", "friend");
  for (const child of children) {
    for (const id of partnerOf(child.id)) add(id, "outer", "childSpouse", child.id);
    for (const grandchild of all) {
      if (grandchild.motherId === child.id || grandchild.fatherId === child.id) add(grandchild.id, "outer", "grandchild", child.id);
    }
  }

  // --- Edges ------------------------------------------------------------------------------------
  const inScene = (id: string): boolean => group.has(id);
  const edges: SceneEdge[] = [];
  const pairSeen = new Set<string>();
  const pushEdge = (a: string, b: string, kind: EdgeKind, fromAt: number | null, untilAt?: number): void => {
    // Romances and feuds recur: each episode is its own edge, keyed by when it began.
    const episode = kind === "lover" || kind === "rival" ? `@${fromAt}` : "";
    const key = `${kind}:${[a, b].sort().join("|")}${episode}`;
    if (!inScene(a) || !inScene(b) || a === b || (kind !== "parent" && pairSeen.has(key))) return;
    pairSeen.add(key);
    edges.push({ a, b, kind, fromAt, ...(untilAt !== undefined ? { untilAt } : {}) });
  };
  const firstBetween = (kind: Event["kind"], a: string, b: string, after: number): Event | undefined =>
    events.find((e) => e.kind === kind && e.actors.includes(a) && e.actors.includes(b) && (timeOf(e) ?? 0) >= after);

  for (const child of all) {
    if (!inScene(child.id)) continue;
    const born = birthAt.get(child.id);
    for (const parentId of [child.motherId, child.fatherId]) {
      if (parentId) pushEdge(parentId, child.id, "parent", born !== undefined && born >= start ? born : null);
    }
  }
  for (const m of marriages) {
    const [a, b] = m.actors as [string, string];
    const until = Math.min(deathOf(a) ?? Infinity, deathOf(b) ?? Infinity);
    pushEdge(a, b, "spouse", timeOf(m)!, Number.isFinite(until) ? until : undefined);
  }
  for (const p of all) {
    if (p.spouseId && inScene(p.id) && inScene(p.spouseId) && p.id < p.spouseId) {
      const until = Math.min(deathOf(p.id) ?? Infinity, deathOf(p.spouseId) ?? Infinity);
      pushEdge(p.id, p.spouseId, "spouse", null, Number.isFinite(until) ? until : undefined);
    }
  }
  for (const e of events) {
    if (!e.actors.includes(protagonistId) || e.actors.length < 2) continue;
    const other = e.actors.find((a) => a !== protagonistId)!;
    const from = timeOf(e)!;
    if (e.kind === "romance") {
      const resolved = firstBetween("breakup", protagonistId, other, from) ?? firstBetween("marriage", protagonistId, other, from);
      pushEdge(protagonistId, other, "lover", from, timeOf(resolved));
    } else if (e.kind === "feud") {
      pushEdge(protagonistId, other, "rival", from, timeOf(firstBetween("reconciliation", protagonistId, other, from)));
    }
  }
  for (const friend of keptFriends) pushEdge(protagonistId, friend.id, "friend", friend.fromAt, friend.untilAt);

  // --- People -----------------------------------------------------------------------------------
  const earliestEdge = new Map<string, number>();
  for (const edge of edges) {
    if (edge.fromAt === null) continue;
    for (const id of [edge.a, edge.b]) earliestEdge.set(id, Math.min(earliestEdge.get(id) ?? Infinity, edge.fromAt));
  }
  const scenePeople: ScenePerson[] = [...group.entries()]
    .map(([id, g]) => {
      const person = people[id]!;
      const entered = birthAt.get(id) ?? arrivalAt.get(id) ?? start;
      const appearsAt = id === protagonistId ? start : Math.min(end ?? Infinity, Math.max(start, Math.min(entered, earliestEdge.get(id) ?? Infinity)));
      const died = deathOf(id);
      return {
        id,
        name: person.name,
        sex: person.sex,
        relCode: g.relCode,
        group: g.group,
        born: bornOf(id),
        appearsAt,
        ...(died !== undefined ? { diedAt: died } : {}),
        ...(g.anchor ? { anchor: g.anchor } : {}),
      };
    })
    .sort((a, b) => a.appearsAt - b.appearsAt || a.born - b.born || byCodeUnit(a.id, b.id));

  // --- Village, bands ---------------------------------------------------------------------------
  const village: VillageSoul[] = all
    .filter((p) => !inScene(p.id) && !p.away)
    .map((p) => {
      const d = deathOf(p.id) ?? departureAt.get(p.id);
      return { k: p.id, b: arrivalAt.get(p.id) ?? bornOf(p.id), ...(d !== undefined ? { d } : {}) };
    })
    .filter((s) => s.d === undefined || s.d >= start)
    .sort((a, b) => byCodeUnit(a.k, b.k));

  const horizon = end ?? (input.through ?? events.reduce((latest, e) => Math.max(latest, e.year), start)) + 1;
  const bands: SceneBand[] = [];
  for (const plague of PLAGUES) {
    const years = [...plague.years];
    const from = Math.max(Math.min(...years), start);
    const to = Math.min(Math.max(...years) + 1, horizon);
    if (from < to) bands.push({ kind: plague.kind, from, to });
  }

  return { people: scenePeople, edges, village, bands, span: { start, end } };
}

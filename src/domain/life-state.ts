/**
 * Engine life course (life-state capability): the persisted, per-person state machine tracking
 * marital status, residence and vocation, plus the ordinal-id bookkeeping from `decision-id.ts`
 * (`slots`) and a placeholder for future situational flags (`situations` — feuds, trials, patron,
 * conversion; none wired yet). PR1 shipped `slots` only; this slice extends (never replaces) that
 * type, so an already-persisted `{ slots }` value stays a valid, if partial, snapshot of history —
 * anything read through `ensureLifeState`/`deriveLifeState` below fills in the rest at read time.
 */
import { hasMovedAway } from "./events";
import type { Event, JsonValue, Person } from "./types";

/** One decision kind's history for one subject: how many times it has occurred, and how many
 * offers have gone by since the last occurrence (reset to 0 whenever it occurs again). */
export interface SlotEntry {
  readonly occurred: number;
  readonly attempts: number;
}

/** Keyed by `slotKey(kind, subject)`. */
export type SlotState = Readonly<Record<string, SlotEntry>>;

export const EMPTY_SLOTS: SlotState = {};

/** A slot's key: one bookkeeping entry per (decision kind, subject) pair. */
export function slotKey(kind: string, subject: string): string {
  return `${kind}:${subject}`;
}

/**
 * Advances one slot after a decision at it was minted (see `mintDecisionId`): when it actually
 * occurred, `occurred` goes up by one and `attempts` resets to 0 (a fresh count starts toward the
 * next occurrence); when it was only offered (not recorded), `attempts` goes up by one and
 * `occurred` is left as-is. Every other key in `slots` is untouched.
 */
export function advanceSlot(slots: SlotState, key: string, occurred: boolean): SlotState {
  const entry = slots[key] ?? { occurred: 0, attempts: 0 };
  const next: SlotEntry = occurred ? { occurred: entry.occurred + 1, attempts: 0 } : { occurred: entry.occurred, attempts: entry.attempts + 1 };
  return { ...slots, [key]: next };
}

// --- Marital axis ----------------------------------------------------------------------------

export type MaritalStatus = "single" | "courting" | "married" | "widowed";

export interface MaritalState {
  readonly status: MaritalStatus;
  readonly since: number;
  readonly partnerId?: string;
}

// --- Residence axis ----------------------------------------------------------------------------

export type ResidenceStatus = "home" | "away";

export interface ResidenceState {
  readonly status: ResidenceStatus;
  readonly since: number;
  readonly place?: string;
}

// --- Vocation axis -----------------------------------------------------------------------------

export type VocationStatus = "child" | "idle" | "apprenticed" | "in-service" | "working" | "religious";

export interface VocationState {
  readonly status: VocationStatus;
  readonly since: number;
  readonly masterId?: string;
}

/**
 * A later-PR situational flag (feud, trial, patron, conversion — design decision, out of scope for
 * this slice). Kept as a typed, empty array on every `LifeState` so a future PR can add a new
 * situation kind additively (spec's "Extensible without breaking storage" requirement) without
 * invalidating a life already persisted by this slice.
 */
export interface Situation {
  readonly id: string;
  readonly kind: string;
  readonly since: number;
  readonly counterpartIds: readonly string[];
  readonly stage: string;
  readonly data: Readonly<Record<string, JsonValue>>;
}

export const EMPTY_SITUATIONS: readonly Situation[] = [];

/** The full, persisted per-person state machine (design revision 2). Extends the PR1 slots-only slice. */
export interface LifeState {
  readonly marital: MaritalState;
  readonly residence: ResidenceState;
  readonly vocation: VocationState;
  readonly marriageableSince?: number;
  readonly slots: SlotState;
  readonly situations: readonly Situation[];
}

/**
 * Engine life course PR6: stamps `marriageableSince` the first year `simulate.ts` observes this
 * person as age-eligible for marriage (see `hazards.ts#minEligibleAge`) — idempotent (a no-op once
 * already set), so calling it every eligible year is safe. This is the time-in-state clock Y1's
 * hazard ramp reads (`year - marriageableSince`, design's `D_k(t) = 1 + rho*min(t,8)`); a widow(er)
 * re-entering the pool uses a separate flat base instead (see `hazards.ts#computeHazard`), so an old
 * `marriageableSince` from decades earlier never distorts a remarriage hazard.
 */
export function markMarriageable(state: LifeState, year: number): LifeState {
  if (state.marriageableSince !== undefined) return state;
  return { ...state, marriageableSince: year };
}

// --- Reducer -------------------------------------------------------------------------------------

export interface MaritalTransition {
  readonly axis: "marital";
  readonly to: MaritalStatus;
  readonly partnerId?: string;
}
export interface ResidenceTransition {
  readonly axis: "residence";
  readonly to: ResidenceStatus;
  readonly place?: string;
}
export interface VocationTransition {
  readonly axis: "vocation";
  readonly to: VocationStatus;
  readonly masterId?: string;
}
export type LifeTransition = MaritalTransition | ResidenceTransition | VocationTransition;

/**
 * Legal next statuses per axis. `working -> working` is a real, exercised transition (a career
 * change fires a fresh `job` event for someone already employed — see `simulate.ts`'s away-settling
 * comment and `narrate.test.ts`'s career-change fixture), so it stays legal; every other axis never
 * re-fires its own current status in the code paths wired this slice (a marriage/move/widowhood
 * event is only ever pushed for someone not already in the target status), so those stay excluded
 * and a same-status attempt throws — it would be a programming error, not a documented behavior.
 */
/**
 * PR6: candidate gathering's pre-existing "multi-suitor" property — the per-personId batches Y1/A1
 * feed are each independently drawn (design decision 1's own per-person exclusive event-pick), so a
 * person can be entangled in more than one romantic thread the SAME year (claimed as one Y1's
 * partner while also independently seeking someone else, or carrying an old, never-formally-resolved
 * romance alongside a real marriage — `activeRomancePair` in `events.ts` returns the most recent
 * UNRESOLVED pairing per partner, not "the" current relationship). None of this was visible before
 * this slice, because no earlier PR ever wrote it back into `lifeState`; PR6 is the first to do so,
 * which is what surfaces it as a legality question here rather than a silent narrative inconsistency.
 * `simulate.ts` closes the two reachable-and-fixable gaps directly (Y1 won't offer someone the
 * `claimedPartners` set already excludes from a symmetric issue elsewhere, and A1 no longer offers a
 * stale romance to someone already married) — every OTHER self/cross re-fire is accepted here as a
 * genuine, if redundant, re-application (same precedent as vocation's `working -> working` below)
 * rather than treated as a data-corruption throw.
 */
const LEGAL_MARITAL_TRANSITIONS: Readonly<Record<MaritalStatus, readonly MaritalStatus[]>> = {
  single: ["single", "courting", "married", "widowed"],
  courting: ["single", "married", "courting", "widowed"],
  // `widowed` on a spouse's death; `single` on the A4 betrayal "leave" path (an existing event that
  // clears both spouseIds while both stay alive — discovered by the invariant test below, not
  // named in the original task list, but required to keep it true; see `simulate.ts`'s A4 case).
  married: ["widowed", "single", "married"],
  widowed: ["courting", "married", "widowed"],
};

const LEGAL_RESIDENCE_TRANSITIONS: Readonly<Record<ResidenceStatus, readonly ResidenceStatus[]>> = {
  home: ["away"],
  away: ["home"],
};

const LEGAL_VOCATION_TRANSITIONS: Readonly<Record<VocationStatus, readonly VocationStatus[]>> = {
  child: ["idle", "apprenticed", "in-service", "working", "religious"],
  idle: ["apprenticed", "in-service", "working", "religious"],
  apprenticed: ["in-service", "working", "idle"],
  "in-service": ["working", "idle"],
  working: ["idle", "religious", "working"],
  religious: [],
};

/**
 * Applies one axis transition (design decision 5: "lifeState is authoritative for status/since;
 * `spouseId` stays as the pointer; one reducer module"). Throws on an illegal transition — a
 * programming error (an event firing a transition the state machine doesn't allow), never a
 * data-quality issue to degrade gracefully from. Every other axis on `state` is left untouched.
 */
export function applyLifeTransition(state: LifeState, transition: LifeTransition, year: number): LifeState {
  switch (transition.axis) {
    case "marital": {
      const legal = LEGAL_MARITAL_TRANSITIONS[state.marital.status];
      if (!legal.includes(transition.to)) throw new Error(`Illegal marital transition: ${state.marital.status} -> ${transition.to}`);
      const partnerId = transition.to === "married" || transition.to === "courting" ? transition.partnerId : undefined;
      return { ...state, marital: { status: transition.to, since: year, partnerId } };
    }
    case "residence": {
      const legal = LEGAL_RESIDENCE_TRANSITIONS[state.residence.status];
      if (!legal.includes(transition.to)) throw new Error(`Illegal residence transition: ${state.residence.status} -> ${transition.to}`);
      const place = transition.to === "away" ? transition.place : undefined;
      return { ...state, residence: { status: transition.to, since: year, place } };
    }
    case "vocation": {
      const legal = LEGAL_VOCATION_TRANSITIONS[state.vocation.status];
      if (!legal.includes(transition.to)) throw new Error(`Illegal vocation transition: ${state.vocation.status} -> ${transition.to}`);
      const masterId = transition.to === "apprenticed" || transition.to === "in-service" ? transition.masterId : undefined;
      return { ...state, vocation: { status: transition.to, since: year, masterId } };
    }
  }
}

// --- Hydration / read-time fallback ---------------------------------------------------------------

function latestEventYear(events: readonly Event[], match: (e: Event) => boolean): number | undefined {
  const matches = events.filter(match).sort((a, b) => a.year - b.year);
  return matches.length > 0 ? matches[matches.length - 1]!.year : undefined;
}

function deriveMaritalState(person: Person, events: readonly Event[]): MaritalState {
  if (person.spouseId) {
    const partnerId = person.spouseId;
    const since = latestEventYear(events, (e) => e.kind === "marriage" && e.actors.includes(person.id) && e.actors.includes(partnerId)) ?? person.birthYear;
    return { status: "married", since, partnerId };
  }
  const widowedSince = latestEventYear(events, (e) => e.kind === "widowed" && e.actors[0] === person.id);
  if (widowedSince !== undefined) return { status: "widowed", since: widowedSince };
  return { status: "single", since: person.birthYear };
}

function deriveResidenceState(person: Person, events: readonly Event[]): ResidenceState {
  const moves = events.filter((e) => e.kind === "move" && e.actors[0] === person.id).sort((a, b) => a.year - b.year);
  const last = moves[moves.length - 1];
  if (last && hasMovedAway(events, person.id)) {
    const place = typeof last.payload.destination === "string" ? last.payload.destination : undefined;
    return { status: "away", since: last.year, place };
  }
  return { status: "home", since: last ? last.year : person.birthYear };
}

function deriveVocationState(person: Person, events: readonly Event[]): VocationState {
  if (person.job === "none") return { status: "child", since: person.birthYear };
  const since = latestEventYear(events, (e) => e.kind === "job" && e.actors[0] === person.id) ?? person.birthYear;
  return { status: "working", since };
}

/**
 * Legacy read-time fallback (spec "Legacy read-time fallback"): a `Person` stored before
 * `lifeState` existed derives one from its OTHER already-persisted fields — `spouseId`, the event
 * log's `move` history (via `hasMovedAway`), and its current `job` — never from `person.lifeState`
 * itself (there is none). Pure: it never writes back to `person`, so the caller decides whether and
 * when to persist the result.
 */
export function deriveLifeState(person: Person, events: readonly Event[]): LifeState {
  return {
    marital: deriveMaritalState(person, events),
    residence: deriveResidenceState(person, events),
    vocation: deriveVocationState(person, events),
    slots: person.lifeState?.slots ?? EMPTY_SLOTS,
    situations: person.lifeState?.situations ?? EMPTY_SITUATIONS,
  };
}

/**
 * `person.lifeState` if already set, else the derived fallback (see `deriveLifeState`). The single
 * entry point `simulate.ts` reads before applying any transition, so a person's very first
 * lifeState touch this run bootstraps from their real history (with no prior events, that derives
 * single/home/child since their birth year — the sensible default for a freshly created person)
 * instead of silently discarding it.
 */
export function ensureLifeState(person: Person, events: readonly Event[]): LifeState {
  return person.lifeState ?? deriveLifeState(person, events);
}

// --- Spec-facing view ------------------------------------------------------------------------------

export type ResidenceView = "home" | "away" | "apprenticed" | "in-service";

/**
 * Maps the design's separate residence/vocation axes to the spec's single 4-valued residence term
 * (design's "Terminology mapping" table): an apprenticed or in-service vocation wins over the
 * person's physical home/away location, since those situations are their own spec category
 * regardless of whether the household happens to be in the home village or not.
 */
export function residenceView(ls: LifeState): ResidenceView {
  if (ls.vocation.status === "apprenticed") return "apprenticed";
  if (ls.vocation.status === "in-service") return "in-service";
  return ls.residence.status;
}

import { type MintedId, mintDecisionId } from "./decision-id";
import { activeRomancePairs, makeEventId } from "./events";
import { advanceSlot, applyLifeTransition, EMPTY_SLOTS, ensureLifeState } from "./life-state";
import { addMemory, pushThought } from "./mind";
import type { Event, EventKind, JsonValue, Person, SocialClass } from "./types";

// Shared by the annual vital phase and interleaved social/childbirth outcomes.
// These helpers mutate the caller-owned registry and logs; they never clone/backfill them.
export function pushEvent(events: Event[], year: number, kind: EventKind, actors: readonly string[], payload: Record<string, JsonValue>, causes: readonly string[]): Event {
  const event: Event = { id: makeEventId(events, year, kind, actors), year, kind, actors, payload, causes };
  events.push(event);
  return event;
}

/**
 * Decision 054's widowhood handling, extracted (fixed after review, R3-001) so BOTH death paths
 * that can end a marriage — the general biology death-resolution block AND decision 051's
 * maternal-death-in-childbirth roll, which previously skipped it entirely, leaving a widower's
 * `spouseId` set forever and no `widowed` event for him — share one source of truth. Clears
 * `spouseId` on both sides, records a `widowed` event causally linked to the death, and lets an
 * artisan's widow keep the shop (only when SHE doesn't already have a trade of her own) exactly as
 * decision 054 specified. No-ops (returns no event ids) when `deceased` has no living spouse.
 */
export function resolveWidowhood(
  seed: string,
  events: Event[],
  people: Record<string, Person>,
  deceased: Person,
  deceasedSocialClass: SocialClass,
  year: number,
  deathEventId: string,
): readonly string[] {
  if (!deceased.spouseId) return [];
  const survivor = people[deceased.spouseId];
  if (!survivor || survivor.deathYear !== undefined) return [];
  // Read BEFORE clearing spouseId below — see the marriage-side note in the `A1` case for why.
  const survivorState = ensureLifeState(survivor, events);
  survivor.spouseId = undefined;
  deceased.spouseId = undefined;
  survivor.lifeState = applyLifeTransition(survivorState, { axis: "marital", to: "widowed" }, year);
  const keepsTrade = deceasedSocialClass === "artisan" && deceased.job !== "none" && survivor.sex === "f" && survivor.job === "none";
  if (keepsTrade) {
    survivor.job = deceased.job;
    survivor.socialClass = "artisan";
  }
  const widowedEvent = pushEvent(events, year, "widowed", [survivor.id, deceased.id], keepsTrade ? { keptTrade: true } : {}, [deathEventId]);
  pushThought(survivor.mind, "grief", `losing ${deceased.name}`, 75, 8, year, "lovePropensity", deceased.id);
  addMemory(seed, survivor.id, year, survivor.mind, `was widowed when ${deceased.name} died in ${year}`, "grief", deceased.id);
  return [widowedEvent.id];
}

/**
 * PR6 corrective (validator finding, engram #6280 "the dead-suitor lockout"): `activeRomancePair`
 * (events.ts) only treats a romance as resolved once a `breakup` or `marriage` event exists for that
 * exact pair — a partner's DEATH never resolved it, so the survivor stayed permanently barred from
 * Y1 (`!person.spouseId && activeRomancePair(...) === undefined`) and from A1 (which needs a living
 * partner). Measured: 26 of 53 romances ended this way, 18 of 91 unmarried adults locked out ~12.9
 * years on average. Called for EVERY death (general biology and decision 051's maternal-death path
 * both), regardless of the deceased's own marital status — a still-unresolved romance can persist
 * even for someone who separately married someone else (the pre-existing multi-suitor property; see
 * decision 065's "Real pre-existing bugs" note), so this always attempts to close it. No-ops when
 * the deceased had no unresolved romance, or its partner is dead or already resolved otherwise.
 *
 * Decision 079: resolves EVERY simultaneous unresolved romance the deceased had (`activeRomancePairs`),
 * not just one — found via a real 60-seed run (`lockout-check-12`) where a person had two SAME-YEAR
 * romances; the original single-partner version (`activeRomancePair`) only ever closed the first one
 * found, leaving the OTHER suitor permanently locked out — the exact "dead-suitor lockout" bug this
 * function exists to fix, just for the second (and later) simultaneous suitor instead of the first.
 * Higher population/marriage activity from decision 079's own population-growth tuning made this
 * pre-existing multi-suitor gap common enough to trip the curated invariant test below for the first
 * time (see that test's own doc comment for the exact reproduction).
 */
export function resolveCourtshipOnDeath(events: Event[], people: Record<string, Person>, deceased: Person, year: number, deathEventId: string): readonly string[] {
  const resultingIds: string[] = [];
  for (const partnerId of activeRomancePairs(events, deceased.id)) {
    const partner = people[partnerId];
    if (!partner || partner.deathYear !== undefined) continue;
    const partnerState = ensureLifeState(partner, events);
    // Only reset the marital AXIS if this romance was actually the survivor's current relationship
    // (`"courting"`) — a stale, never-resolved thread from years ago shouldn't overwrite a partner who
    // has since gone on to marry someone else; the `breakup` event alone is enough to unblock them.
    if (partnerState.marital.status === "courting") {
      partner.lifeState = applyLifeTransition(partnerState, { axis: "marital", to: "single" }, year);
    }
    const breakupEvent = pushEvent(events, year, "breakup", [deceased.id, partnerId], { causeOfDeath: true }, [deathEventId]);
    resultingIds.push(breakupEvent.id);
  }
  return resultingIds;
}

/**
 * Peeks the next id for `(kind, subject)` without mutating anything — safe to call before deciding
 * whether the resulting decision will actually be recorded (biology's `RECORD_THRESHOLD` gate runs
 * AFTER this). `subject === "world"` (immigration) needs no `people` lookup at all (see
 * `mintDecisionId`).
 */
export function mintId(people: Readonly<Record<string, Person>>, kind: string, subject: string, year: number): MintedId {
  const slots = subject === "world" ? EMPTY_SLOTS : (people[subject]?.lifeState?.slots ?? EMPTY_SLOTS);
  return mintDecisionId(kind, subject, year, slots);
}

/**
 * Commits a minted id's slot advance onto its subject's `lifeState.slots` (see
 * `life-state.ts#advanceSlot`) — call exactly once per minted id, with `occurred` reflecting
 * whether the decision it belongs to was actually recorded. A `world` subject needs no commit (its
 * ordinal is the year itself, never persisted state). Reads through `ensureLifeState` first so a
 * subject's very first commit this run bootstraps the rest of `lifeState` from their real history
 * (see `life-state.ts`) instead of overwriting it with a slots-only fragment.
 */
export function commitId(people: Record<string, Person>, events: readonly Event[], subject: string, minted: MintedId, occurred: boolean): void {
  if (subject === "world") return;
  const person = people[subject];
  if (!person) return;
  const state = ensureLifeState(person, events);
  person.lifeState = { ...state, slots: advanceSlot(state.slots, minted.key, occurred) };
}

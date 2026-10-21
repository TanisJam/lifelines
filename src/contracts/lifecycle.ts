/**
 * Additive contract types for the new-engine (lifecycle capsule) read path — RI1b, spec S8.
 * Types only, no runtime code.
 *
 * A `LifecycleProjection` is a DERIVED VIEW. It is never persisted as authority, never stored as
 * the thing a later read trusts, and never read back as one: the lifecycle capsule (cold-admitted
 * and fully replayed) stays the only authority for what happened.
 */
import type { LifeStreamEvent } from "./life";

/** The route's own (life, branch) identity. Not simulation data: no projection derives it. */
export interface LifecycleViewIdentity {
  readonly lifeId: string;
  readonly branchId: string;
}

/**
 * One field of the app's view model the trusted lifecycle output cannot supply. The projection
 * reports it instead of inventing, approximating or falling back to a legacy-only source.
 */
export interface LifecycleViewGap {
  /** Dotted path of the affected view-model field, e.g. `chronicle.branches`. */
  readonly field: string;
  /** Why the trusted output carries no such information. */
  readonly reason: string;
  /** What the projection put at that path instead, so the gap is visible rather than silent. */
  readonly representation: string;
}

/** A derived view plus the explicit list of fields it could not fill from the trusted output. */
export interface LifecycleProjection<T> {
  readonly view: T;
  readonly gaps: readonly LifecycleViewGap[];
}

/** The SSE `tick` payload (`LifeStreamEvent`) without its discriminant: year, entries, scene. */
export type LifecycleTickView = Omit<Extract<LifeStreamEvent, { readonly type: "tick" }>, "type">;

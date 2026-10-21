import type { Chronicle, LifeSex, LifeStreamEvent } from "@/contracts/life";
import { createLifecycleCompactCapsule } from "@/domain/e-lifecycle-capsule";
import { createLifecycleGenesis } from "@/domain/e-lifecycle-genesis";
import { runLifecycle } from "@/domain/e-lifecycle-run";
import type { Locale } from "@/domain/locale";
import { initializeWorld } from "@/domain/world-origin";
import { projectLifecycleChronicle, projectLifecycleTick } from "./lifecycle-projection";
import type { LifecyclePublication } from "./lifecycle-repository";

/**
 * Create-side orchestration for a new-engine life (RI1c, spec S7): genesis, one bounded lifecycle
 * run, one SSE `tick` per regenerated journal year, the projection, and the persist. No `Request`,
 * `Response` or stream lives here — the route owns the HTTP/SSE surface and hands this module a
 * frame emitter and the frame-flush discipline, so the whole unit is testable without HTTP.
 *
 * The lifecycle capsule is the only authority: the run's own output is projected, and persistence
 * goes through `LifecycleRepository.publish`, which FULL-regenerates under current authority. A
 * projection is a derived view and is never persisted as one.
 */

/** Mirrors the legacy create route's `START_YEAR`: the run begins at the start of the 1327–1361 period. */
export const LIFECYCLE_START_YEAR = 1327;
/**
 * The initialised world's declared span (the legacy `MAX_LIFESPAN_YEARS`). It is NOT the run budget
 * and carries no completion semantics: the run stops at `LIFECYCLE_HORIZON_YEARS` below, and a
 * protagonist still alive there is persisted as alive, never as a death (spec S1).
 */
export const LIFECYCLE_MAX_STEPS = 100;
/**
 * The product horizon: a life is the protagonist's chronicle up to 15 journal years (spec S1).
 * Completion and horizon are different states — a death inside the horizon yields a `complete`
 * life, while a protagonist still alive here yields an `incomplete` life that IS persisted. This is
 * a run budget, never a death year: nothing is forced, reseeded or manufactured (spec S2).
 */
export const LIFECYCLE_HORIZON_YEARS = 15;
const LIFECYCLE_END_YEAR = LIFECYCLE_START_YEAR + LIFECYCLE_MAX_STEPS;

const PROTAGONIST_ID = "protagonist";

/**
 * The certified representative-workload allocation, applied uniformly to every person in the
 * initialised world (the same `grain 2 / effort 3 / need 1` the engine's own fixtures use). It is a
 * calibration input, not a story decision: mortality calibration is a SEPARATE unit tracked as CQ1.
 * As measured for RI1 (L8), the engine currently ends the protagonist's life at age 1–2 under this
 * allocation; this wiring does not change mortality and must not paper over it.
 */
const REPRESENTATIVE_ALLOCATION = Object.freeze({ grain: 2, effort: 3, need: 1 });

/** The persistence seam this module needs: `LifecycleRepository.publish`, nothing more. */
export interface LifecycleLifePublisher {
  publish(input: LifecyclePublication): Promise<unknown>;
}

export interface LifecycleLifeRequest {
  /** Injected persistence capability; the route supplies its `LifecycleRepository`. */
  readonly repository: LifecycleLifePublisher;
  /** The route's own identity, carried into the projection and the binding verbatim. */
  readonly lifeId: string;
  readonly branchId: string;
  readonly name: string;
  /** `"random"` is passed through to the world origin, which owns the seeded resolution. */
  readonly sex: LifeSex | "random";
  readonly seed: string;
  /** Absent means "let the initialised world name its own village", never an invented name. */
  readonly villageName?: string;
  readonly locale: Locale;
  /** Per-request cancellation; the run stops only at a committed-year boundary. */
  readonly signal: AbortSignal;
  /** Emits one contract event per frame, in order. The route maps it onto its SSE transport. */
  readonly emit: (event: LifeStreamEvent) => void;
  /** The route's frame-flush discipline (`yieldToEventLoop`), awaited after every tick. */
  readonly flushFrame: () => Promise<void>;
  /** New committed years only; defaults to the product horizon and is explicit for tests. */
  readonly maxSteps?: number;
}

/**
 * Runs one new-engine life end to end and emits the existing `LifeStreamEvent` frames. A death
 * inside the horizon yields a `complete` life; a protagonist still alive at the horizon yields an
 * `incomplete` life that is PERSISTED just the same. A real failure (an abort, an admission or
 * projection refusal, a persistence error) refuses and persists nothing.
 */
export async function streamLifecycleLife(request: LifecycleLifeRequest): Promise<void> {
  const { repository, lifeId, branchId, name, sex, seed, locale, signal, emit, flushFrame } = request;
  const maxSteps = request.maxSteps ?? LIFECYCLE_HORIZON_YEARS;
  const startedAt = performance.now();

  // World initialisation is the ONLY source of the village name and of the resolved sex; the
  // requested sex (including "random") is passed through unchanged. Omitted optionals stay absent:
  // the origin validates own-undefined differently from an absent key.
  const initialization = {
    seed,
    startYear: LIFECYCLE_START_YEAR,
    endYear: LIFECYCLE_END_YEAR,
    ...(request.villageName === undefined ? {} : { townName: request.villageName }),
    protagonist: { name, sex },
  };
  const { world, origin } = initializeWorld(initialization);
  const resolvedSex = origin.sex.resolved;
  if (resolvedSex === null) throw new Error("The lifecycle world did not resolve the protagonist's sex.");
  const protagonist = world.people[PROTAGONIST_ID];
  if (!protagonist) throw new Error("The lifecycle world has no protagonist.");

  emit({
    type: "start",
    lifeId,
    branchId,
    villageName: world.config.town.name,
    protagonist: { name: protagonist.name, sex: resolvedSex, birthYear: protagonist.birthYear },
  });

  const genesis = createLifecycleGenesis({
    initialization,
    protagonistId: PROTAGONIST_ID,
    resources: Object.fromEntries(Object.keys(world.people).map((id) => [id, REPRESENTATIVE_ALLOCATION])),
  });

  const result = await runLifecycle({ kind: "start", genesis }, { maxSteps, signal });
  if (result.status === "aborted") return;

  const capsule = result.capsule;
  const source = { genesis: capsule.genesis, output: capsule.output };

  // One tick per regenerated journal year, in journal order: quiet years are never skipped and no
  // year is reordered or invented. Each year is flushed before the next one is projected.
  for (const record of capsule.output.journal) {
    const projection = await projectLifecycleTick({ source, year: record.year, locale });
    if (signal.aborted) return;
    emit({ type: "tick", ...projection.view });
    await flushFrame();
  }

  // A `complete` life (a death inside the horizon) projects its chronicle BEFORE anything is
  // persisted, so an admission or projection refusal still writes nothing. A life still alive at
  // the horizon has no death and therefore no completion chronicle: its trusted output is
  // persisted as-is, alive, and is NEVER coerced into a death to satisfy a view (specs S1/S2).
  let chronicle: Chronicle | undefined;
  if (result.status === "complete") {
    try {
      const projection = await projectLifecycleChronicle({ source, identity: { lifeId, branchId }, locale });
      // `projection.gaps` is honest and expected: a view-model field the trusted output cannot
      // supply is reported (see RI1b), never invented, and never a reason to fail the request.
      chronicle = projection.view;
    } catch (error) {
      // A projection REFUSAL (malformed or foreign input) is an error event, not a silent success.
      if (signal.aborted) return;
      emit({ type: "error", message: error instanceof Error ? error.message : String(error) });
      return;
    }
  }
  if (signal.aborted) return;

  // Both statuses persist: the compact capsule stores the run's own `status` and `frontier`, so an
  // alive life is loadable as alive at the horizon. Only a real failure above or here writes nothing.
  await repository.publish({
    lifeId,
    branchId,
    config: world.config,
    protagonistName: protagonist.name,
    protagonistSex: resolvedSex,
    capsule: await createLifecycleCompactCapsule({ genesis: capsule.genesis, output: capsule.output }),
  });

  // Only AFTER a successful publish is the life visible. An abort that arrives during the save
  // leaves a saved life but no `done` frame: the client that asked is already gone.
  if (signal.aborted) return;
  // An alive life is persisted but has no `done` yet: the honest alive chronicle is a read-side
  // view (spec S5) that this unit does not build, and inventing one here is forbidden.
  if (chronicle === undefined) return;
  emit({
    type: "done",
    chronicle,
    // The new engine makes no Jev calls at all: these are its own counters, never fabricated.
    stats: { jevCalls: 0, cacheHits: 0, wallTimeMs: Math.round(performance.now() - startedAt) },
  });
}

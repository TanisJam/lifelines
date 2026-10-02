import type { Chronicle, ChronicleEntry, LifeScene } from "@/contracts/life";
import { timeline } from "./dial";

/** What the sky shows while a life is being written: the scene so far, the entries streamed so far, and how far the clock may run. */
export interface LiveModel {
  readonly scene: LifeScene;
  readonly entries: readonly ChronicleEntry[];
  /** Last tick year + 1; the end of the life once saved. The clock never passes it. */
  readonly frontier: number;
  /** True once `done` arrived: the life exists in storage (person sheet, reload). */
  readonly saved: boolean;
}

/** The `start` event: an empty sky waiting for the first tick. */
export function startModel(birthYear: number): LiveModel {
  return { scene: { people: [], edges: [], village: [], bands: [], span: { start: birthYear, end: null } }, entries: [], frontier: birthYear, saved: false };
}

/** One streamed year: the scene replaces the last (it already holds everything so far), new entries append by id, the frontier advances. */
export function mergeTick(model: LiveModel, tick: { readonly year: number; readonly entries: readonly ChronicleEntry[]; readonly scene: LifeScene }): LiveModel {
  const known = new Set(model.entries.map((e) => e.id));
  const fresh = tick.entries.filter((e) => !known.has(e.id));
  return {
    scene: tick.scene,
    entries: fresh.length === 0 ? model.entries : [...model.entries, ...fresh],
    frontier: Math.max(model.frontier, tick.year + 1),
    saved: false,
  };
}

/** The saved life replaces the streamed one; the clock is untouched, and the frontier opens to the end of the life. */
export function reconcileDone(chronicle: Pick<Chronicle, "scene" | "entries">): LiveModel {
  return { scene: chronicle.scene, entries: chronicle.entries, frontier: timeline(chronicle.scene, chronicle.scene.span.start).end, saved: true };
}

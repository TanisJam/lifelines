import type { Chronicle, ChronicleEntry, LifeScene, LifeSex, LifeStreamEvent } from "@/contracts/life";
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

/** What the `start` event says about the life; everything else arrives with the ticks and done. */
export interface LiveHeader {
  readonly lifeId: string;
  readonly branchId: string;
  readonly villageName: string;
  readonly protagonist: { readonly name: string; readonly sex: LifeSex; readonly birthYear: number };
}

export interface LiveLifeState {
  readonly header: LiveHeader | null;
  readonly model: LiveModel | null;
  /** The saved chronicle, once `done` arrived. */
  readonly saved: Chronicle | null;
}

export type LiveAction = { readonly type: "reset" } | Extract<LifeStreamEvent, { type: "start" | "tick" | "done" }>;

export const initialLive: LiveLifeState = { header: null, model: null, saved: null };

/** Folds the stream into the live state. Ticks before `start` (or after a reset) are ignored. */
export function liveReducer(state: LiveLifeState, action: LiveAction): LiveLifeState {
  switch (action.type) {
    case "reset":
      return initialLive;
    case "start":
      return { header: { lifeId: action.lifeId, branchId: action.branchId, villageName: action.villageName, protagonist: action.protagonist }, model: startModel(action.protagonist.birthYear), saved: null };
    case "tick":
      return state.model ? { ...state, model: mergeTick(state.model, action) } : state;
    case "done":
      return state.model ? { ...state, model: reconcileDone(action.chronicle), saved: action.chronicle } : state;
  }
}

/** The chronicle the sky draws from: the saved one, or a stand-in built from the stream so far (no summary, branches or cast yet). */
export function liveChronicle(state: LiveLifeState): Chronicle | null {
  if (state.saved) return state.saved;
  const { header, model } = state;
  if (!header || !model) return null;
  const self = model.scene.people.find((p) => p.group === "self");
  const { protagonist } = header;
  return {
    lifeId: header.lifeId,
    branchId: header.branchId,
    villageName: header.villageName,
    protagonist: { ...protagonist, deathYear: Math.floor(self?.diedAt ?? protagonist.birthYear), ageAtDeath: 0, causeOfDeath: "" },
    summary: "",
    summaryLinks: [],
    epilogue: [],
    entries: model.entries,
    branches: [],
    cast: [],
    scene: model.scene,
  };
}

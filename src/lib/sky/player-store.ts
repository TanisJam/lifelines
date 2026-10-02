import type { Frame } from "./scene-model";

export type Speed = 1 | 2 | 4;

/** The slow-changing part of the player: what React renders from. */
export interface PlayerState {
  readonly playing: boolean;
  readonly speed: Speed;
  /** Playing but starved of frontier (live generation has not caught up). */
  readonly waiting: boolean;
}

export const nextSpeed = (speed: Speed): Speed => (speed === 1 ? 2 : speed === 2 ? 4 : 1);

export type FrameListener = (frame: Frame) => void;

/**
 * Two channels between the engine and the React shell. `state` changes a few times a minute and is read
 * with useSyncExternalStore; frames arrive 60 times a second and go straight to imperative listeners
 * (odometer, scrubber) so nothing re-renders per frame.
 */
export function createPlayerStore(initial: PlayerState = { playing: false, speed: 1, waiting: false }) {
  let state = initial;
  const subscribers = new Set<() => void>();
  const frameListeners = new Set<FrameListener>();
  return {
    get: (): PlayerState => state,
    subscribe(listener: () => void): () => void {
      subscribers.add(listener);
      return () => subscribers.delete(listener);
    },
    set(patch: Partial<PlayerState>): void {
      const next = { ...state, ...patch };
      if (next.playing === state.playing && next.speed === state.speed && next.waiting === state.waiting) return;
      state = next;
      subscribers.forEach((s) => s());
    },
    onFrame(listener: FrameListener): () => void {
      frameListeners.add(listener);
      return () => frameListeners.delete(listener);
    },
    emitFrame(frame: Frame): void {
      frameListeners.forEach((l) => l(frame));
    },
  };
}

export type PlayerStore = ReturnType<typeof createPlayerStore>;

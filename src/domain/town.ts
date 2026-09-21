import { keyedRng } from "./rng";

/**
 * Concrete town texture (round 5 pivot, decision 026 — the Living
 * Chronicle handoff asks for prose as specific as "during the winter storm
 * that destroys the northern bridge", not generic "a fire happened").
 * Deterministic per (seed, town) so the same world always has the same
 * landmarks, and every reference to one is backed by an actual event: only
 * a real `town` event with `payload.landmark` set ever claims a landmark
 * was damaged, and only `narrateEventForViewer`'s birth/romance cases ever
 * attach a season — never invented ad hoc in prose.
 */

export const LANDMARK_POOL = ["the mill", "the north bridge", "the chapel", "the fairground", "the market square", "the old well", "the granary", "the tannery"] as const;
export type Landmark = (typeof LANDMARK_POOL)[number];

export const SEASONS = ["the depths of winter", "the first days of spring", "high summer", "the golden days of autumn"] as const;
export type Season = (typeof SEASONS)[number];

/** This town's own set of landmarks (a subset of the pool, deterministic per seed+town). */
export function pickLandmarks(seed: string, townName: string, count = 5): Landmark[] {
  const rng = keyedRng(seed, townName, 0, "landmarks");
  const pool: Landmark[] = [...LANDMARK_POOL];
  const picked: Landmark[] = [];
  for (let i = 0; i < count && pool.length > 0; i++) {
    const idx = Math.floor(rng() * pool.length);
    picked.push(pool.splice(idx, 1)[0]!);
  }
  return picked;
}

/** A purely atmospheric, deterministic season for one event (same seed+key+year always agrees). */
export function seasonFor(seed: string, key: string, year: number, salt: string): Season {
  const rng = keyedRng(seed, key, year, `season-${salt}`);
  return SEASONS[Math.floor(rng() * SEASONS.length)]!;
}

/** Deterministically picks one of this town's landmarks (e.g. which one a fire damages this year). */
export function pickLandmarkFor(seed: string, key: string, year: number, landmarks: readonly Landmark[]): Landmark {
  const rng = keyedRng(seed, key, year, "landmark-pick");
  return landmarks[Math.floor(rng() * landmarks.length)] ?? "the mill";
}

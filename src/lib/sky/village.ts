import type { Vec } from "./motion";

/** FNV-1a: a stable 32-bit hash of a placement key. */
function hash(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}

/** Deterministic unit stream for a key (mulberry32), so placement never depends on array order. */
function stream(key: string): () => number {
  let a = hash(key);
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface VillagePos {
  readonly x: number;
  readonly y: number;
  readonly size: number;
  readonly base: number;
  readonly delay: number;
  readonly twinkle: boolean;
}

/** Where a background soul sits, from its stable key: inside the village disc, never from an array index. */
export function villagePos(key: string): VillagePos {
  const rand = stream(key);
  const r = 40 + Math.sqrt(rand()) * 262;
  const a = rand() * Math.PI * 2;
  return { x: r * Math.cos(a), y: r * Math.sin(a), size: 0.6 + rand() * 1.3, base: 0.3 + rand() * 0.45, delay: rand() * 5.6, twinkle: rand() < 0.4 };
}

export const villageSpot = (key: string): Vec => {
  const p = villagePos(key);
  return [p.x, p.y];
};

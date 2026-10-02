/** Small streaming helpers shared by the fixture create/rewrite generators (decision 040). */

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

import type { ChronicleEntry, LifeScene } from "@/contracts/life";

/** Groups entries by year, in ascending year order — one SSE `tick` per year, per the contract. */
export function groupByYear(entries: readonly ChronicleEntry[]): (readonly [number, ChronicleEntry[]])[] {
  const map = new Map<number, ChronicleEntry[]>();
  for (const e of entries) {
    const arr = map.get(e.year) ?? [];
    arr.push(e);
    map.set(e.year, arr);
  }
  return [...map.entries()].sort((a, b) => a[0] - b[0]);
}

/** One `[year, entries]` per year from `from` to `to`, quiet years included (empty entries), like the live stream. */
export function yearTicks(entries: readonly ChronicleEntry[], from: number, to: number): (readonly [number, ChronicleEntry[]])[] {
  const byYear = new Map(groupByYear(entries));
  return Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => [from + i, byYear.get(from + i) ?? []] as const);
}

/** The scene as it stands at the end of `year`: later people, bonds and souls are not there yet, and still-open ends are open. */
export function sceneAt(scene: LifeScene, year: number): LifeScene {
  const cutoff = year + 1;
  /** Drops `key` when its value is not yet in the past at `cutoff`. */
  function openEnd<T extends object, K extends keyof T>(item: T, key: K): T {
    const value = item[key];
    if (typeof value !== "number" || value < cutoff) return item;
    const copy = { ...item };
    delete copy[key];
    return copy;
  }
  const people = scene.people.filter((p) => p.appearsAt < cutoff).map((p) => openEnd(p, "diedAt"));
  const ids = new Set(people.map((p) => p.id));
  return {
    people,
    edges: scene.edges.filter((e) => ids.has(e.a) && ids.has(e.b) && (e.fromAt === null || e.fromAt < cutoff)).map((e) => openEnd(e, "untilAt")),
    village: scene.village.filter((v) => v.b < cutoff).map((v) => openEnd(v, "d")),
    bands: scene.bands.filter((b) => b.from < cutoff).map((b) => ({ ...b, to: Math.min(b.to, cutoff) })),
    span: { start: scene.span.start, end: scene.span.end !== null && scene.span.end < cutoff ? scene.span.end : null },
  };
}

export function lowerFirst(s: string): string {
  return s.length === 0 ? s : s.charAt(0).toLowerCase() + s.slice(1);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Renames the protagonist throughout a chronicle's prose. Fixture data is hand-written around
 * two canonical names (Elin Marrow, Rosalind Thorn); the start screen lets the player type any
 * name, so the creation stream substitutes it in wherever it appears literally (full name, and
 * the bare first name as a whole word — most of the fixture prose uses pronouns, not the name).
 * Disclosed limitation: sex-specific nouns ("daughter") are not re-derived from the requested
 * sex — the two fixture lives are both written for a female protagonist.
 */
export function renameProtagonistJson(json: string, canonicalFullName: string, displayFullName: string): string {
  if (canonicalFullName === displayFullName) return json;
  let out = json.split(canonicalFullName).join(displayFullName);
  const canonicalFirst = canonicalFullName.split(" ")[0];
  const displayFirst = displayFullName.split(" ")[0] || displayFullName;
  if (canonicalFirst && canonicalFirst !== displayFirst) {
    out = out.replace(new RegExp(`\\b${escapeRegExp(canonicalFirst)}\\b`, "g"), displayFirst);
  }
  return out;
}

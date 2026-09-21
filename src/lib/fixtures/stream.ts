/** Small streaming helpers shared by the fixture create/rewrite generators (decision 040). */

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

import type { ChronicleEntry } from "@/contracts/life";

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

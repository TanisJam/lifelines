import type { ChronicleEntry } from "@/contracts/life";
import { entryText, typeParts, type EntryText, type TypePart } from "./typewriter";

/** One row of the reel: what the sim-clock typewriter writes and where the entry sits in time. */
export interface ReelEntry {
  readonly id: string;
  readonly at: number;
  readonly year: number;
  /** A decision point (level 3): shown with a diamond and its decider. */
  readonly turn: boolean;
  readonly text: EntryText;
  readonly parts: readonly TypePart[];
  /** Scene people the entry involves. */
  readonly who: readonly string[];
}

/** The reel's rows: period summaries stay in the chronicle but never on the reel; sorted by moment (ties by id). */
export function reelEntries(entries: readonly ChronicleEntry[]): ReelEntry[] {
  return entries
    .filter((e) => e.kind !== "period")
    .map((e) => {
      const text = entryText(e);
      return { id: e.id, at: e.at, year: e.year, turn: e.level === 3, text, parts: typeParts(text), who: e.who };
    })
    .sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

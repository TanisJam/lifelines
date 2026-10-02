import type { ChronicleEntry } from "@/contracts/life";
import { parseProseMarkers } from "@/lib/prose-markers";

/** Sim-years per character: the title is inked slowly, the rest faster. The typewriter runs on the life's own clock, so it pauses and scrubs with it. */
export const TYPE_TITLE = 0.016;
export const TYPE_FAST = 0.0045;

export interface TypePart {
  readonly text: string;
  /** Sim-years per character. */
  readonly rate: number;
}

export interface Typed {
  /** Characters down, per part. */
  readonly counts: readonly number[];
  readonly done: boolean;
  /** Index of the part being typed (it carries the caret), or -1 once everything is down. */
  readonly caret: number;
}

/** What is typed `elapsed` sim-years after the entry's moment. Pure: no play history enters. */
export function typed(parts: readonly TypePart[], elapsed: number): Typed {
  let left = elapsed;
  let caret = -1;
  let allFull = true;
  const counts = parts.map((part, i) => {
    const n = Math.max(0, Math.min(part.text.length, Math.floor(left / part.rate)));
    left -= part.text.length * part.rate;
    const full = n === part.text.length;
    if (!full && caret === -1 && (n > 0 || allFull)) caret = i;
    if (!full) allFull = false;
    return n;
  });
  return { counts, done: counts.every((n, i) => n === parts[i]!.text.length), caret };
}

/** A string that changes exactly when what is on screen changes, so callers can skip redundant DOM writes. */
export const typedKey = (state: Typed): string => `${state.counts.join(",")}|${state.caret}`;

export interface LinkRange {
  readonly start: number;
  readonly end: number;
  readonly personId: string;
}

export interface EntryText {
  readonly title: string;
  /** The deciding party of a turn ("Her choice"). */
  readonly by?: string;
  /** Prose with `{{id}}` markers resolved to names. */
  readonly prose: string;
  /** Where each linked name sits inside `prose`. */
  readonly links: readonly LinkRange[];
}

export function entryText(entry: Pick<ChronicleEntry, "title" | "prose" | "links" | "turn">): EntryText {
  let prose = "";
  const links: LinkRange[] = [];
  for (const part of parseProseMarkers(entry.prose, entry.links)) {
    if (part.kind === "link") links.push({ start: prose.length, end: prose.length + part.name.length, personId: part.personId });
    prose += part.kind === "link" ? part.name : part.text;
  }
  return { title: entry.title, ...(entry.turn ? { by: entry.turn.decidedBy } : {}), prose, links };
}

export const typeParts = (text: EntryText): TypePart[] => [
  { text: text.title, rate: TYPE_TITLE },
  ...(text.by === undefined ? [] : [{ text: text.by, rate: TYPE_FAST }]),
  { text: text.prose, rate: TYPE_FAST },
];

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ESCAPES[c]!);

/** The first `n` characters of `text` as safe HTML; linked names (even half-typed) become anchors carrying their person id. */
export function typedMarkup(text: string, links: readonly LinkRange[], n: number): string {
  let html = "";
  let at = 0;
  for (const link of links) {
    if (link.start >= n) break;
    html += esc(text.slice(at, link.start));
    html += `<a href="#" data-person-link="${esc(link.personId)}">${esc(text.slice(link.start, Math.min(link.end, n)))}</a>`;
    at = Math.min(link.end, n);
  }
  return html + esc(text.slice(at, n));
}

/** Sim-years an entry takes to type out completely, after its moment. */
export const typeDuration = (entry: Pick<ChronicleEntry, "title" | "prose" | "links" | "turn">): number =>
  typeParts(entryText(entry)).reduce((total, part) => total + part.text.length * part.rate, 0);

/** The moment the last entry finishes typing; `-Infinity` for none. */
export const typingEnd = (entries: readonly Pick<ChronicleEntry, "at" | "title" | "prose" | "links" | "turn">[]): number =>
  entries.reduce((end, entry) => Math.max(end, entry.at + typeDuration(entry)), -Infinity);

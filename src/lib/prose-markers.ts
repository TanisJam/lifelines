/**
 * Pure parsing for chronicle prose. Prose marks a linked person as `{{personId}}`
 * (see `docs/design/single-life-contract.md` and `ChronicleEntry.links` in
 * `src/contracts/life.ts`); this turns a prose string into a sequence of plain-text
 * and person-link parts, resolving each marker's display name through `links`.
 *
 * Framework-free on purpose (no React) so it can be unit tested directly and reused
 * by both the chronicle timeline and the summary paragraph, which both carry markers.
 */

import type { ChronicleEntry, PersonLink } from "@/contracts/life";

export type ProsePart = { readonly kind: "text"; readonly text: string } | { readonly kind: "link"; readonly personId: string; readonly name: string };

const MARKER = /\{\{([^{}]+)\}\}/g;

export function parseProseMarkers(prose: string, links: readonly PersonLink[]): readonly ProsePart[] {
  const byId = new Map(links.map((l) => [l.personId, l.name]));
  const parts: ProsePart[] = [];
  let lastIndex = 0;
  MARKER.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = MARKER.exec(prose))) {
    if (match.index > lastIndex) parts.push({ kind: "text", text: prose.slice(lastIndex, match.index) });
    const personId = match[1];
    const name = byId.get(personId);
    // A marker no link resolves must never reach the reader as an id: it degrades to nothing.
    if (name === undefined) {
      lastIndex = match.index + match[0].length;
      continue;
    }
    parts.push({ kind: "link", personId, name });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < prose.length) parts.push({ kind: "text", text: prose.slice(lastIndex) });
  return parts;
}

function invalidTokens(): never {
  throw new TypeError("Invalid proseTokens: expected literal tokens resolving exactly to prose");
}

/** Read only own data, never a token or link field getter. */
function ownData(record: object, key: string, enumerable = false): unknown {
  const field = Object.getOwnPropertyDescriptor(record, key);
  if (!field || !("value" in field) || (enumerable && !field.enumerable)) invalidTokens();
  return field.value;
}

/** Opt-in tokens are literal; the legacy parser above remains unchanged. */
export function resolveEntryProse(entry: Pick<ChronicleEntry, "prose" | "links" | "proseTokens">): readonly ProsePart[] {
  const field = Object.getOwnPropertyDescriptor(entry, "proseTokens");
  if (!field) {
    // Inherited opt-in is ambiguous: reject without evaluating an inherited getter.
    if ("proseTokens" in entry) invalidTokens();
    return parseProseMarkers(entry.prose, entry.links);
  }
  if (!("value" in field)) invalidTokens();
  const tokens: unknown = field.value;
  if (tokens === undefined) return parseProseMarkers(entry.prose, entry.links);
  if (!Array.isArray(tokens) || Reflect.ownKeys(tokens).length !== tokens.length + 1) invalidTokens();

  const byId = new Map<string, string>();
  for (const link of entry.links) {
    if (link === null || typeof link !== "object") invalidTokens();
    const id = ownData(link, "personId");
    const name = ownData(link, "name");
    if (typeof id !== "string" || id.length === 0 || typeof name !== "string") invalidTokens();
    byId.set(id, name);
  }

  const parts: ProsePart[] = [];
  let plaintext = "";
  for (let i = 0; i < tokens.length; i++) {
    const token = ownData(tokens, String(i), true);
    if (token === null || typeof token !== "object" || Array.isArray(token)) invalidTokens();
    const kind = ownData(token, "kind", true);
    if (kind !== "text" && kind !== "link") invalidTokens();
    const key = kind === "text" ? "text" : "personId";
    const keys = Reflect.ownKeys(token);
    if (keys.length !== 2 || !keys.includes("kind") || !keys.includes(key)) invalidTokens();
    const value = ownData(token, key, true);
    if (typeof value !== "string") invalidTokens();
    if (kind === "text") {
      parts.push({ kind, text: value });
      plaintext += value;
    } else {
      if (value.length === 0 || !byId.has(value)) invalidTokens();
      const name = byId.get(value)!;
      parts.push({ kind, personId: value, name });
      plaintext += name;
    }
  }
  if (plaintext !== entry.prose) invalidTokens();
  return parts;
}

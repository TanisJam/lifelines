/**
 * Pure parsing for chronicle prose. Prose marks a linked person as `{{personId}}`
 * (see `docs/design/single-life-contract.md` and `ChronicleEntry.links` in
 * `src/contracts/life.ts`); this turns a prose string into a sequence of plain-text
 * and person-link parts, resolving each marker's display name through `links`.
 *
 * Framework-free on purpose (no React) so it can be unit tested directly and reused
 * by both the chronicle timeline and the summary paragraph, which both carry markers.
 */

import type { PersonLink } from "@/contracts/life";

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

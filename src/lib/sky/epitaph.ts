import type { PersonLink } from "@/contracts/life";
import { parseProseMarkers } from "@/lib/prose-markers";

/** The summary as plain text (`{{id}}` markers resolved to names), cut after its first sentence: the line a finished life leaves under its title. */
export function firstSentence(summary: string, links: readonly PersonLink[]): string {
  const plain = parseProseMarkers(summary, links)
    .map((part) => (part.kind === "link" ? part.name : part.text))
    .join("")
    .trim();
  const end = plain.search(/[.!?](\s|$)/);
  return end === -1 ? plain : plain.slice(0, end + 1);
}

import type { Chronicle } from "@/contracts/life";
import type { Locale } from "@/domain/locale";

/** Heuristics over a projected chronicle, not proof of narrative quality. */
export function checkStoryQuality(chronicle: Chronicle, options: { source: "synthetic" | "real"; locale: Locale; protagonistId: string }) {
  const normalize = (text: string) => text.normalize("NFKC").toLocaleLowerCase(options.locale).replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const duplicates = (values: string[]) => {
    const seen = new Set<string>();
    let count = 0;
    for (const value of values) if (value) { if (seen.has(value)) count++; else seen.add(value); }
    return count;
  };
  const sentences = chronicle.entries.flatMap(entry => entry.prose.split(/[.!?]+/u).map(normalize));
  const identicalSentences = duplicates(sentences);
  const identicalReflections = duplicates(chronicle.entries.filter(entry => entry.kind === "reflection").map(entry => normalize(entry.prose)));
  const byId = new Map(chronicle.entries.map(entry => [entry.id, entry]));
  const linked = chronicle.entries.filter(entry => {
    const earlier = entry.cause?.entryId && byId.get(entry.cause.entryId);
    return earlier && earlier.year < entry.year;
  }).length;
  const end = chronicle.protagonist.deathYear ?? chronicle.protagonist.horizonYear ?? chronicle.protagonist.birthYear;
  const applicableYears = [1348, 1349].filter(year => year >= chronicle.protagonist.birthYear && year <= end);
  const missingYears = applicableYears.filter(year => !chronicle.entries.some(entry => entry.year === year && entry.who.includes(options.protagonistId) && /\b(?:black death|plague|peste|epidemia)\b/iu.test(`${entry.title} ${entry.prose}`)));
  const defects = options.locale === "es" ? chronicle.entries.flatMap(entry => {
    const matches = `${entry.title} ${entry.prose}`.match(/\b(?:marrying|married|marriage|husband|wife)\b|sin él o ella/giu) ?? [];
    return matches.map(match => ({ entryId: entry.id, match }));
  }) : [];
  return {
    source: options.source, locale: options.locale,
    repetition: { pass: identicalSentences === 0 && identicalReflections === 0, identicalSentences, identicalReflections },
    arcs: { pass: linked > 0, linked, totalEntries: chronicle.entries.length },
    crisisCoverage: { pass: missingYears.length === 0, applicableYears, missingYears },
    localization: { pass: defects.length === 0, defects },
  };
}

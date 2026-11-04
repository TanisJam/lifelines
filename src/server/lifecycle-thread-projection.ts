/** Projection of committed thread facts; the journal remains the authority. */
import type { ChronicleEntry, LifeScene } from "@/contracts/life";
import { renderThreadFavorBeat } from "@/domain/e-favor-templates";
import type { ThreadBeat } from "@/domain/e-thread-ledger";
import type { Locale } from "@/domain/locale";
import type { Person } from "@/domain/types";

export type ThreadYear = { readonly year: number; readonly threadBeats?: { readonly version: string; readonly beats: readonly ThreadBeat[] }; readonly final: { readonly owned: { readonly people: Readonly<Record<string, Person>> } } };

/** Builds an independent economic source index, never treating economic IDs as native event IDs. */
export function threadEntries(input: { journal: readonly ThreadYear[]; year: number; protagonistId: string; locale: Locale; scene: LifeScene; nativeIds: ReadonlySet<string> }): ChronicleEntry[] {
  const { journal, year, protagonistId, locale, scene, nativeIds } = input;
  const sources = new Map<string, { beat: ThreadBeat; entry: ChronicleEntry }>();
  const setups = new Map<string, { beat: ThreadBeat; entry: ChronicleEntry }>();
  const sceneIds = new Set(scene.people.map(person => person.id));
  for (const record of journal) {
    if (record.year > year) break;
    if (!record.threadBeats) continue;
    if (record.threadBeats.version !== "thread-beats-1" || !Array.isArray(record.threadBeats.beats as unknown)) throw new Error("Invalid thread beat version");
    for (const beat of record.threadBeats.beats) {
      if (beat.kind === "death") continue;
      if (beat.year !== record.year || !beat.actors.includes(protagonistId) || nativeIds.has(beat.source)) throw new Error("Invalid thread source");
      const prior = sources.get(beat.source);
      if (prior) {
        if (JSON.stringify(prior.beat) !== JSON.stringify(beat)) throw new Error("Conflicting thread source");
        continue;
      }
      const identities = beat.actors.map(id => {
        const person = record.final.owned.people[id];
        if (!person || person.birthYear > beat.year) throw new Error("Invalid thread identity");
        return { id, name: person.name };
      });
      const prose = renderThreadFavorBeat(beat, identities, locale);
      let cause: ChronicleEntry["cause"];
      if (beat.kind === "payoff") {
        const settlement = beat.effects?.find(effect => effect.kind === "settlement");
        const setup = settlement?.kind === "settlement" ? setups.get(settlement.origin) : undefined;
        if (!setup || setup.beat.thread !== beat.thread || beat.year - setup.beat.year < 3 ||
          setup.beat.actors.some((id, index) => id !== beat.actors[index])) throw new Error("Invalid thread payoff cause");
        cause = { entryId: setup.entry.id, phrase: locale === "en" ? "Earlier grain grant" : "Entrega anterior de grano", year: setup.entry.year };
      }
      const entry: ChronicleEntry = { id: beat.source, year: beat.year, level: 2, kind: `thread-${beat.kind}`,
        title: beat.kind === "setup" ? (locale === "en" ? "A grain grant" : "Una entrega de grano") : (locale === "en" ? "A help response" : "Una respuesta de ayuda"),
        prose, links: [], at: beat.year + 0.5, who: beat.actors.filter(id => sceneIds.has(id)), ...(cause ? { cause } : {}) };
      sources.set(beat.source, { beat, entry });
      if (beat.kind === "setup") setups.set(beat.source, { beat, entry });
    }
  }
  return [...sources.values()].filter(item => item.beat.year === year).map(item => item.entry);
}

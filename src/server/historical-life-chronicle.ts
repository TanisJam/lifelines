import type { LifeScene, PersonLink, ProseToken } from "../contracts/life";
import { renderHistoricalFavorTemplates, type HistoricalFavorTemplates } from "../domain/e-favor-templates";
import { replayAnnualRuntime, type RuntimeOutput } from "../domain/e-runtime";
import type { Locale } from "../domain/locale";
import { journalPlacements } from "./historical-journal-placement";
import { deriveHistoricalScene } from "./historical-scene";

export const HISTORICAL_PARTIAL_CHRONICLE_VERSION = "historical-rules-e4-partial-chronicle-1" as const;
type TemplateEntry = HistoricalFavorTemplates["entries"][number];
export type HistoricalPartialEntry = TemplateEntry & {
  readonly at: number;
  readonly who: readonly string[];
  readonly prose: string;
  readonly links: readonly PersonLink[];
  readonly proseTokens: readonly ProseToken[];
};
export interface HistoricalPartialChronicle {
  readonly version: typeof HISTORICAL_PARTIAL_CHRONICLE_VERSION;
  readonly asOfYear: number;
  readonly entries: readonly HistoricalPartialEntry[];
  readonly scene: LifeScene;
  readonly evidence: HistoricalFavorTemplates["evidence"];
}

function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

/** Recorded creditor/debtor roles, never marker parsing or name replacement.
 * ID suffixes are literal text even when an ID or name contains marker syntax.
 */
function tokens(entry: TemplateEntry, locale: Locale): readonly ProseToken[] {
  const [creditor, debtor] = entry.actors;
  const grant = entry.kind === "grain-grant";
  const first = grant ? creditor : debtor;
  const second = grant ? debtor : creditor;
  let between: string;
  let ending: string;
  if (grant) {
    between = locale === "en" ? " transferred 1 unit of grain to " : " transfirió 1 unidad de grano a ";
    ending = locale === "en" ? ". An open help obligation was recorded."
      : ". Se registró una obligación de ayuda abierta.";
  } else {
    between = " → ";
    const help = entry.response === "help";
    ending = locale === "en"
      ? (help ? ". Recorded help response: help. The help obligation was recorded as fulfilled; 1 unit of assistance was recorded."
        : ". Recorded help response: refuse. The help obligation was recorded as broken.")
      : (help ? ". Respuesta de ayuda registrada: ayuda. La obligación de ayuda quedó registrada como cumplida; se registró 1 unidad de asistencia."
        : ". Respuesta de ayuda registrada: rechazo. La obligación de ayuda quedó registrada como incumplida.");
  }
  return [
    { kind: "link", personId: first.id },
    { kind: "text", text: ` [${first.id}]${between}` },
    { kind: "link", personId: second.id },
    { kind: "text", text: ` [${second.id}]${ending}` },
  ];
}

/** Inactive partial projection, not a full Chronicle or a route/UI activation.
 * Templates admit descriptors and every retained checkpoint FIRST. Scene admission
 * intentionally runs again. Only the exact selected replay's COMPLETE journals
 * supply placements, including hidden/ineligible slots; future data never supplies
 * labels, chronology or death. Existing evidence and template metadata are intact.
 * All returned objects are detached and recursively frozen, without freezing input.
 */
export function buildHistoricalLifeChronicle(input: {
  readonly history: unknown;
  readonly subjectActorID: string;
  readonly asOfYear: number;
}, locale: Locale): HistoricalPartialChronicle {
  const templates = renderHistoricalFavorTemplates(input, locale);
  const scene = deriveHistoricalScene(input);
  const checkpoint = (input.history as readonly RuntimeOutput[])
    .find(output => output.frontier === templates.asOfYear)!;
  const placements = journalPlacements(replayAnnualRuntime(checkpoint).journal);
  const entries = templates.entries.map((entry): HistoricalPartialEntry => ({
    ...entry,
    at: placements[entry.id],
    who: entry.actors.map(actor => actor.id),
    prose: entry.text,
    links: entry.actors.map(actor => ({ personId: actor.id, name: actor.name })),
    proseTokens: tokens(entry, locale),
  }));
  return freeze(structuredClone({ version: HISTORICAL_PARTIAL_CHRONICLE_VERSION,
    asOfYear: templates.asOfYear, entries, scene, evidence: templates.evidence }));
}

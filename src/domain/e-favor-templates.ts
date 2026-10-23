import { HISTORICAL_EVIDENCE_VERSION, selectHistoricalEvidence, type HistoricalEvidence } from "./e-selection";
import { isLocale, type Locale } from "./locale";

export const FAVOR_TEMPLATE_VERSION = "historical-rules-e4-templates-1" as const;
type Immutable<T> = T extends object ? { readonly [K in keyof T]: Immutable<T[K]> } : T;
type Selected = ReturnType<typeof selectHistoricalEvidence>;
export type HistoricalFavorTemplates = Immutable<{
  version: typeof FAVOR_TEMPLATE_VERSION;
  historicalVersion: typeof HISTORICAL_EVIDENCE_VERSION;
  locale: Locale;
  asOfYear: number;
  subject: Selected["subject"];
  evidence: Selected["evidence"];
  entries: (HistoricalEvidence & { sourceEvidenceID: string; text: string })[];
}>;

function freeze<T>(value: T): Immutable<T> {
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value as Immutable<T>;
}

/** Only locally admitted selection reaches this renderer; versions are compatibility, not credentials. */
function render(selected: Selected, locale: Locale): HistoricalFavorTemplates {
  if (selected.version !== HISTORICAL_EVIDENCE_VERSION) throw new Error("Unsupported historical evidence version");
  const entries = selected.beats.map(beat => {
    if (beat.actors.length !== 2) throw new Error("Unsupported favor parties");
    const [creditor, debtor] = beat.actors.map(actor => actor.id);
    const identities = new Map(beat.actors.map(actor => [actor.id, actor]));
    const label = (id: string) => {
      const actor = identities.get(id);
      if (!actor) throw new Error("Missing favor identity");
      return `${actor.name} [${actor.id}]`;
    };
    let text: string;
    if (beat.kind === "grain-grant") {
      if (beat.facts.length !== 2
        || !beat.facts.some(f => f.kind === "grain" && f.from === creditor && f.to === debtor && f.amount === 1)
        || !beat.facts.some(f => f.kind === "obligation" && f.creditor === creditor && f.debtor === debtor
          && f.origin === beat.id && f.status === "open")) throw new Error("Unsupported grant facts");
      text = locale === "en"
        ? `${label(creditor)} transferred 1 unit of grain to ${label(debtor)}. An open help obligation was recorded.`
        : `${label(creditor)} transfirió 1 unidad de grano a ${label(debtor)}. Se registró una obligación de ayuda abierta.`;
    } else if (beat.kind === "help-response" && (beat.response === "help" || beat.response === "refuse")) {
      const help = beat.response === "help";
      if (beat.facts.length !== (help ? 2 : 1)
        || !beat.facts.some(f => f.kind === "settlement" && f.creditor === creditor && f.debtor === debtor
          && f.status === (help ? "fulfilled" : "broken"))
        || (help && !beat.facts.some(f => f.kind === "assistance" && f.from === debtor && f.to === creditor && f.amount === 1))) {
        throw new Error("Unsupported response facts");
      }
      const response = locale === "en"
        ? (help ? "Recorded help response: help. The help obligation was recorded as fulfilled; 1 unit of assistance was recorded."
          : "Recorded help response: refuse. The help obligation was recorded as broken.")
        : (help ? "Respuesta de ayuda registrada: ayuda. La obligación de ayuda quedó registrada como cumplida; se registró 1 unidad de asistencia."
          : "Respuesta de ayuda registrada: rechazo. La obligación de ayuda quedó registrada como incumplida.");
      text = `${label(debtor)} → ${label(creditor)}. ${response}`;
    } else throw new Error("Unsupported favor beat");
    return { ...beat, sourceEvidenceID: beat.id, text };
  });
  return freeze(structuredClone({ version: FAVOR_TEMPLATE_VERSION, historicalVersion: selected.version,
    locale, asOfYear: selected.asOfYear, subject: selected.subject, evidence: selected.evidence, entries }));
}

/** Inactive rules-only plain text; literal names are not HTML-safe output or authenticated provenance. */
export function renderHistoricalFavorTemplates(input: unknown, locale: Locale): HistoricalFavorTemplates {
  if (typeof locale !== "string" || !isLocale(locale)) throw new Error("Explicit en/es locale required");
  return render(selectHistoricalEvidence(input), locale);
}

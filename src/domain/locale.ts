/**
 * Decision 059 (bilingual app): the two chronicle locales. English is the default and canonical
 * locale — every call site that doesn't pass a `Locale` explicitly gets English, byte-identical to
 * what it produced before this decision, so the existing (English-only) tests keep passing without
 * change. Kept in `domain/` rather than `src/i18n/` so the simulation core stays the single source
 * of truth for what a "locale" is (screaming/hexagonal architecture: the app-layer `src/i18n`
 * dictionaries and `proxy.ts` import this type, not the other way around).
 */
export const LOCALES = ["en", "es"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}

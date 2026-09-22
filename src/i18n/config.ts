/**
 * Decision 059: the app-layer face of `src/domain/locale.ts`. Re-exported under its own module so
 * `proxy.ts`, `app/[lang]/**`, and the dictionaries import a stable `@/i18n/config` path rather than
 * reaching into `@/domain` directly for a routing concern — the domain stays the source of truth for
 * what a locale IS (see that file's own comment), this module is just where the app layer gets it.
 */
export { DEFAULT_LOCALE as defaultLocale, isLocale, LOCALES as locales } from "@/domain/locale";
export type { Locale } from "@/domain/locale";

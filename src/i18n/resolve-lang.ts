import { notFound } from "next/navigation";
import { isLocale, type Locale } from "./config";

/**
 * Narrows a route's raw `params.lang` (always typed `string` by Next's generated `PageProps`/
 * `LayoutProps` helpers, never the literal `Locale` union) to a real `Locale`, 404ing on a miss —
 * the official guide's own `hasLocale`/`notFound()` pattern
 * (`node_modules/next/dist/docs/01-app/02-guides/internationalization.md`). Shared by every
 * server-component page under `app/[lang]/**` so the same rule (and the same 404, not a silent
 * fallback to English) applies everywhere.
 */
export function resolveLang(lang: string): Locale {
  if (!isLocale(lang)) notFound();
  return lang;
}

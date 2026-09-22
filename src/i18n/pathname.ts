import { locales } from "./config";

/**
 * Strips a leading `/en` or `/es` segment from a pathname (decision 059) — for logic that should
 * stay locale-agnostic, like "which nav item is active" or "is this the full-bleed chronicle
 * shell." Every real in-app pathname carries a locale prefix once routing moved under `app/[lang]`,
 * but this stays defensive (returns the input unchanged) for a path that somehow doesn't.
 */
export function stripLocale(pathname: string | null): string {
  if (!pathname) return "/";
  for (const locale of locales) {
    if (pathname === `/${locale}`) return "/";
    if (pathname.startsWith(`/${locale}/`)) return pathname.slice(locale.length + 1);
  }
  return pathname;
}

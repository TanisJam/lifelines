import type { Locale } from "./config";
import type { Dictionary } from "./dictionary";
import { en } from "./dictionaries/en";
import { es } from "./dictionaries/es";

const dictionaries: Readonly<Record<Locale, Dictionary>> = { en, es };

/**
 * Decision 059, following the official guide's `getDictionary` pattern
 * (`node_modules/next/dist/docs/01-app/02-guides/internationalization.md`) — synchronous rather than
 * the guide's `async`/dynamic-`import()` version, since both dictionaries here are small, plain,
 * already-imported objects (see `dictionaries/en.ts`'s own comment for why: several call sites are
 * Client Components). Kept as a function rather than exporting the map directly so a call site never
 * has to know the fallback rule for an invalid locale.
 */
export function getDictionary(locale: Locale): Dictionary {
  return dictionaries[locale] ?? dictionaries.en;
}

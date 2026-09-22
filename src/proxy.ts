import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { defaultLocale, isLocale, type Locale, locales } from "@/i18n/config";

/**
 * Decision 059 (bilingual app). Next 16 renamed the `middleware` file convention to `proxy`
 * (`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md`'s own
 * "Migration to Proxy" section — `middleware.ts` is deprecated, same runtime behavior, new name);
 * this negotiates the locale and redirects a bare path to `/en/...` or `/es/...`, following the
 * official internationalization guide's own `proxy.js` example
 * (`node_modules/next/dist/docs/01-app/02-guides/internationalization.md`), with one deliberate
 * addition: a `lifelines-locale` cookie, set once a reader is on a locale-prefixed path, so a
 * follow-up visit to `/` (a fresh tab, a bookmark) lands back on the language they were already
 * reading rather than re-negotiating `Accept-Language` every time.
 */
const LOCALE_COOKIE = "lifelines-locale";

/**
 * A small, dependency-free `Accept-Language` parser (the proposal's "no new library" — no
 * `@formatjs/intl-localematcher`/`negotiator`, unlike the guide's own example): splits the header
 * into `(tag, quality)` pairs, sorts by quality descending, and returns the first tag whose primary
 * subtag (`es-ES` -> `es`) is one of `locales`. Malformed entries are skipped, never thrown on.
 */
function negotiateLocale(acceptLanguage: string): Locale | undefined {
  const ranked = acceptLanguage
    .split(",")
    .map((entry) => {
      const [rawTag, ...params] = entry.trim().split(";");
      const tag = rawTag?.trim().toLowerCase();
      if (!tag) return undefined;
      const qParam = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      const quality = qParam ? Number.parseFloat(qParam.slice(2)) : 1;
      return { tag, quality: Number.isFinite(quality) ? quality : 1 };
    })
    .filter((entry): entry is { tag: string; quality: number } => !!entry)
    .sort((a, b) => b.quality - a.quality);

  for (const { tag } of ranked) {
    const primary = tag.split("-")[0];
    if (primary && isLocale(primary)) return primary;
  }
  return undefined;
}

/** Cookie, then `Accept-Language`, then the default locale — in that order. */
function resolveLocale(request: NextRequest): Locale {
  const cookieLocale = request.cookies.get(LOCALE_COOKIE)?.value;
  if (cookieLocale && isLocale(cookieLocale)) return cookieLocale;

  const acceptLanguage = request.headers.get("accept-language");
  if (acceptLanguage) {
    const negotiated = negotiateLocale(acceptLanguage);
    if (negotiated) return negotiated;
  }

  return defaultLocale;
}

export function proxy(request: NextRequest): NextResponse | undefined {
  const { pathname } = request.nextUrl;

  const pathnameHasLocale = locales.some((locale) => pathname === `/${locale}` || pathname.startsWith(`/${locale}/`));
  if (pathnameHasLocale) return undefined;

  const locale = resolveLocale(request);
  request.nextUrl.pathname = `/${locale}${pathname}`;
  const response = NextResponse.redirect(request.nextUrl);
  response.cookies.set(LOCALE_COOKIE, locale, { path: "/", sameSite: "lax" });
  return response;
}

export const config = {
  matcher: [
    /*
     * `src/app/api/**` must NEVER move under `/[lang]` (the API routes are locale-agnostic and the
     * client calls them by their fixed path) — excluded here, not by folder placement alone, since
     * without this the redirect above would happily rewrite `/api/lives` to `/en/api/lives` and
     * 404 every request. Also skips Next internals, and any request for a file with an extension
     * (favicon.ico, the `public/` assets, etc).
     */
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)",
  ],
};

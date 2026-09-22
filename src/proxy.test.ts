import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { proxy } from "./proxy";

function requestFor(path: string, opts: { acceptLanguage?: string; cookie?: string } = {}): NextRequest {
  const headers = new Headers();
  if (opts.acceptLanguage) headers.set("accept-language", opts.acceptLanguage);
  if (opts.cookie) headers.set("cookie", opts.cookie);
  return new NextRequest(new URL(path, "https://lifelines.example"), { headers });
}

/**
 * Decision 059: the proxy resolves a locale from (in order) the `lifelines-locale` cookie, then
 * `Accept-Language`, then the default locale — and redirects a bare path to that locale's prefix. A
 * request that already carries a locale prefix passes through untouched (`undefined`, matching
 * `NextResponse.next()`'s "no interception" semantics for this test's purposes).
 */
describe("decision 059: proxy locale resolution", () => {
  it("passes through untouched when the path already carries a supported locale prefix", () => {
    expect(proxy(requestFor("/en/lives"))).toBeUndefined();
    expect(proxy(requestFor("/es/lives"))).toBeUndefined();
    expect(proxy(requestFor("/en"))).toBeUndefined();
  });

  it("redirects a bare path to the default locale when there is no signal at all", () => {
    const res = proxy(requestFor("/lives"));
    expect(res).toBeDefined();
    expect(res!.status).toBe(307);
    expect(new URL(res!.headers.get("location")!).pathname).toBe("/en/lives");
  });

  it("redirects to the locale preferred by Accept-Language, honoring quality weights", () => {
    const res = proxy(requestFor("/", { acceptLanguage: "fr;q=0.9, es;q=0.8, en;q=0.5" }));
    expect(new URL(res!.headers.get("location")!).pathname).toBe("/es");
  });

  it("matches a region-qualified tag (es-MX) to its base language (es)", () => {
    const res = proxy(requestFor("/lives", { acceptLanguage: "es-MX,es;q=0.9" }));
    expect(new URL(res!.headers.get("location")!).pathname).toBe("/es/lives");
  });

  it("falls back to the default locale when Accept-Language names only unsupported languages", () => {
    const res = proxy(requestFor("/lives", { acceptLanguage: "fr-FR,de;q=0.8" }));
    expect(new URL(res!.headers.get("location")!).pathname).toBe("/en/lives");
  });

  it("prefers a previously-set locale cookie over Accept-Language", () => {
    const res = proxy(requestFor("/lives", { acceptLanguage: "en", cookie: "lifelines-locale=es" }));
    expect(new URL(res!.headers.get("location")!).pathname).toBe("/es/lives");
  });

  it("sets the locale cookie on the redirect response, so a later bare-path visit is stable", () => {
    const res = proxy(requestFor("/", { acceptLanguage: "es" }));
    expect(res!.cookies.get("lifelines-locale")?.value).toBe("es");
  });

  it("preserves the query string across the redirect", () => {
    const res = proxy(requestFor("/lives?branch=abc123", { acceptLanguage: "es" }));
    const location = new URL(res!.headers.get("location")!);
    expect(location.pathname).toBe("/es/lives");
    expect(location.searchParams.get("branch")).toBe("abc123");
  });
});

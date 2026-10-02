"use client";

import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { OpenBookIcon, SproutIcon, SunEmblem, VineCorner } from "@/components/ornaments";
import type { Locale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { stripLocale } from "@/i18n/pathname";

/**
 * The generic site header/footer, hidden on the Living Chronicle page (round 7, decision 031 —
 * porting the mock's visual design faithfully): the mock's `.cw-topbar` is a full, self-contained
 * app shell for that page, and stacking our generic header above it doesn't match the mock at
 * all. Every OTHER page (start screen, "Your lives") keeps the original site chrome. Round 9
 * (decision 041) adds `/life/[lifeId]`, the single-life chronicle route — a full-bleed `.cw-app`
 * shell. (The legacy `/world/**` village flow this once shared the check with was removed; see
 * decision 060.)
 *
 * Decision 059: every pathname now carries a `/en`/`/es` prefix (`app/[lang]/**`), so the
 * chronicle-path/active-nav checks below run against `stripLocale(pathname)`, not the raw
 * pathname — otherwise `/es/life/abc` would no longer match `isChroniclePath`'s regex at all.
 */
function isChroniclePath(pathname: string | null): boolean {
  const path = stripLocale(pathname);
  return /^\/life\/[^/]+/.test(path);
}

function isActive(pathname: string | null, href: string): boolean {
  const path = stripLocale(pathname);
  if (href === "/") return path === "/";
  return path.startsWith(href);
}

export function GlobalHeader() {
  const pathname = usePathname();
  const { lang } = useParams<{ lang: Locale }>();
  const dict = getDictionary(lang);
  const navItems = [
    { href: "/", label: dict.nav.home, icon: SproutIcon },
    { href: "/lives", label: dict.nav.yourLives, icon: OpenBookIcon },
  ] as const;

  if (isChroniclePath(pathname)) return null;
  return (
    <>
      <header className="relative border-b border-border/70 bg-background-alt/60 px-4 py-4 sm:px-6">
        <VineCorner className="pointer-events-none absolute top-2 left-2 h-8 w-8 text-ll-leaf opacity-70 sm:h-10 sm:w-10" />
        <VineCorner className="pointer-events-none absolute top-2 right-2 h-8 w-8 -scale-x-100 text-ll-leaf opacity-70 sm:h-10 sm:w-10" />
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-1">
          <Link href={`/${lang}`} className="flex items-center gap-2">
            <SunEmblem className="h-6 w-6 text-ll-sun" />
            <span className="font-heading text-2xl font-medium tracking-wide text-foreground">Lifelines</span>
          </Link>
          <p className="font-label text-[10px] tracking-[0.14em] text-muted-foreground uppercase">{dict.nav.tagline}</p>
          <nav className="mt-2 hidden items-center gap-5 sm:flex">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={`/${lang}${item.href === "/" ? "" : item.href}`}
                className={`font-label text-xs tracking-widest uppercase transition-colors ${
                  isActive(pathname, item.href) ? "text-brass" : "text-muted-foreground hover:text-brass"
                }`}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      {/* Bottom tab bar (design-system.md §6): mobile only, ≤5 items, icon + serif label. */}
      <nav className="fixed inset-x-0 bottom-0 z-50 flex justify-around border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] sm:hidden">
        {navItems.map((item) => {
          const active = isActive(pathname, item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={`/${lang}${item.href === "/" ? "" : item.href}`}
              className={`flex min-h-11 min-w-14 flex-col items-center gap-0.5 px-2 py-2 font-body text-[11px] ${active ? "text-brass" : "text-muted-foreground"}`}
            >
              <Icon className={active ? "text-brass" : "text-muted-foreground"} />
              {item.label}
              {active && <span className="mt-0.5 h-0.5 w-4 rounded-full bg-brass" aria-hidden="true" />}
            </Link>
          );
        })}
      </nav>
    </>
  );
}

export function GlobalFooter() {
  const pathname = usePathname();
  const { lang } = useParams<{ lang: Locale }>();
  const dict = getDictionary(lang);
  if (isChroniclePath(pathname)) return null;
  return (
    <footer className="border-t border-border/70 py-6 text-center font-label text-xs uppercase tracking-widest text-muted-foreground">
      <p>{dict.nav.footerTagline}</p>
    </footer>
  );
}

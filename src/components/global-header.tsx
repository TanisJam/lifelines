"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ThemeToggle } from "@/components/theme-toggle";
import { OpenBookIcon, SproutIcon, SunEmblem, VineCorner } from "@/components/ornaments";

/**
 * The generic site header/footer, hidden on the Living Chronicle page (round 7, decision 031 —
 * porting the mock's visual design faithfully): the mock's `.cw-topbar` is a full, self-contained
 * app shell for that page, and stacking our generic header above it doesn't match the mock at
 * all. Every OTHER page (start screen, "Your lives", the legacy village) keeps the original site
 * chrome. Round 9 (decision 041) adds `/life/[lifeId]`, the new single-life chronicle route,
 * alongside the legacy `/world/.../person/...` chronicle it superseded — both are full-bleed
 * `.cw-app` shells.
 */
function isChroniclePath(pathname: string | null): boolean {
  return !!pathname && (/^\/world\/[^/]+\/person\/[^/]+/.test(pathname) || /^\/life\/[^/]+/.test(pathname));
}

/**
 * Top-level destinations reachable from the app's persistent chrome (design-system.md §6, the
 * masthead nav and the mobile bottom tab bar) — no new routes, just the ones that already exist:
 * the start screen and "Your lives". The legacy village (`/world`) is intentionally not linked.
 */
const NAV_ITEMS = [
  { href: "/", label: "Home", icon: SproutIcon },
  { href: "/lives", label: "Your lives", icon: OpenBookIcon },
] as const;

function isActive(pathname: string | null, href: string): boolean {
  if (href === "/") return pathname === "/";
  return !!pathname && pathname.startsWith(href);
}

export function GlobalHeader() {
  const pathname = usePathname();
  if (isChroniclePath(pathname)) return null;
  return (
    <>
      <header className="relative border-b border-border/70 bg-background-alt/60 px-4 py-4 sm:px-6">
        <VineCorner className="pointer-events-none absolute top-2 left-2 h-8 w-8 text-ll-leaf opacity-70 sm:h-10 sm:w-10" />
        <VineCorner className="pointer-events-none absolute top-2 right-2 h-8 w-8 -scale-x-100 text-ll-leaf opacity-70 sm:h-10 sm:w-10" />
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-1">
          <Link href="/" className="flex items-center gap-2">
            <SunEmblem className="h-6 w-6 text-ll-sun" />
            <span className="font-heading text-2xl font-medium tracking-wide text-foreground">Lifelines</span>
          </Link>
          <p className="font-label text-[10px] tracking-[0.14em] text-muted-foreground uppercase">Same people. Brighter tomorrows.</p>
          <nav className="mt-2 hidden items-center gap-5 sm:flex">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`font-label text-xs tracking-widest uppercase transition-colors ${
                  isActive(pathname, item.href) ? "text-brass" : "text-muted-foreground hover:text-brass"
                }`}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="absolute top-4 right-12 sm:right-14">
            <ThemeToggle />
          </div>
        </div>
      </header>

      {/* Bottom tab bar (design-system.md §6): mobile only, ≤5 items, icon + serif label. */}
      <nav className="fixed inset-x-0 bottom-0 z-50 flex justify-around border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] sm:hidden">
        {NAV_ITEMS.map((item) => {
          const active = isActive(pathname, item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
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
  if (isChroniclePath(pathname)) return null;
  return (
    <footer className="border-t border-border/70 py-6 text-center font-label text-xs uppercase tracking-widest text-muted-foreground">
      <p>Simulate first, then describe.</p>
    </footer>
  );
}

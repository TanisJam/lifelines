"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ThemeToggle } from "@/components/theme-toggle";

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

export function GlobalHeader() {
  const pathname = usePathname();
  if (isChroniclePath(pathname)) return null;
  return (
    <header className="border-b border-border/70 bg-background-alt/60">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
        <Link href="/" className="font-heading text-2xl font-semibold tracking-wide text-foreground">
          Lifelines
        </Link>
        <ThemeToggle />
      </div>
    </header>
  );
}

export function GlobalFooter() {
  const pathname = usePathname();
  if (isChroniclePath(pathname)) return null;
  return (
    <footer className="border-t border-border/70 py-6 text-center font-label text-xs uppercase tracking-widest text-muted-foreground">
      <p>Simulate first, then describe.</p>
      <Link href="/world" className="mt-2 inline-block text-[10px] normal-case tracking-normal text-muted-foreground/70 underline decoration-dotted underline-offset-4 hover:text-brass">
        The village (legacy)
      </Link>
    </footer>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ThemeToggle } from "@/components/theme-toggle";

/**
 * The generic site header/footer, hidden on the Living Chronicle page (round 7, decision 031 —
 * porting the mock's visual design faithfully): the mock's `.topbar` is a full, self-contained
 * app shell for that page (brand mark, People/Town/History pills), and stacking our generic
 * header above it doesn't match the mock at all. Every OTHER page (home, Tapestry, Town) keeps
 * the original site chrome.
 */
function isChroniclePath(pathname: string | null): boolean {
  return !!pathname && /^\/world\/[^/]+\/person\/[^/]+/.test(pathname);
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
  return <footer className="border-t border-border/70 py-6 text-center font-label text-xs uppercase tracking-widest text-muted-foreground">Simulate first, then describe.</footer>;
}

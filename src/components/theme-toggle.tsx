"use client";

import { useEffect, useState } from "react";

type Theme = "light" | "dark";

function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute("data-theme", theme);
  try {
    localStorage.setItem("lifelines-theme", theme);
  } catch {
    // Private browsing / blocked storage: theme just won't persist across reloads.
  }
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    const current = document.documentElement.getAttribute("data-theme") as Theme | null;
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    // Reads external (DOM/media-query) state once on mount to sync this component's
    // display with whatever the pre-hydration inline script already applied.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTheme(current ?? (prefersDark ? "dark" : "light"));
  }, []);

  if (!theme) return <div className="h-9 w-16" aria-hidden />;

  const next: Theme = theme === "dark" ? "light" : "dark";

  return (
    <button
      type="button"
      onClick={() => {
        applyTheme(next);
        setTheme(next);
      }}
      className="cursor-pointer rounded-full border border-border px-3 py-1.5 font-label text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:border-brass hover:text-brass"
      aria-label={`Switch to ${next} mode`}
    >
      {theme === "dark" ? "Dark" : "Light"}
    </button>
  );
}

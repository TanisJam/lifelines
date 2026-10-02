"use client";

import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { SkyView } from "@/components/sky/sky-view";
import type { Locale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { getChronicle } from "@/lib/life-client";
import type { Chronicle as ChronicleData } from "@/contracts/life";

/**
 * A saved life as a night sky (the default view). A client component rather than a server-fetched one: the real
 * `/api/lives/:lifeId` endpoint lives in the engine worktree and doesn't exist here yet, and the
 * fixture layer (`NEXT_PUBLIC_LIFE_FIXTURE=1`) only runs client-side, so both backends are reached
 * the same way `life-client.ts` reaches every other endpoint — a plain client fetch.
 */
export default function LifePage() {
  const params = useParams<{ lang: Locale; lifeId: string }>();
  const searchParams = useSearchParams();
  // Keyed on lifeId only, so navigating to a genuinely different life (e.g. from "Your lives")
  // remounts this loader — the idiomatic way to reset state on a prop change without an
  // unconditional setState at the top of an effect. `branch` is read once, below, deliberately
  // NOT as part of this key: see `ChronicleLoader`'s own comment for why.
  return <ChronicleLoader key={params.lifeId} lifeId={params.lifeId} lang={params.lang} initialBranchId={searchParams.get("branch") ?? undefined} />;
}

function ChronicleLoader({ lifeId, lang, initialBranchId }: { lifeId: string; lang: Locale; initialBranchId?: string }) {
  const dict = getDictionary(lang);
  // Frozen at mount, deliberately not re-read from the URL afterward. Branch changes (a rewrite, the
  // history switcher) sync the address bar with a raw, write-only `history.replaceState`, and Next's
  // App Router observes the History API globally: if this effect depended on a *live* `branch` search
  // param, that same replaceState call would re-trigger this fetch and silently overwrite the in-memory
  // state (`ghosts` in particular, which only exists on the SSE `done` payload, never on a plain GET).
  const [branchIdAtMount] = useState(initialBranchId);
  const [data, setData] = useState<ChronicleData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getChronicle(lifeId, branchIdAtMount, lang)
      .then((chronicle) => {
        if (!cancelled) setData(chronicle);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : dict.life.loadError);
      });
    return () => {
      cancelled = true;
    };
  }, [lifeId, branchIdAtMount, lang, dict.life.loadError]);

  if (error) {
    return (
      <div className="mx-auto flex min-h-[50vh] max-w-xl flex-col items-center justify-center gap-3 px-4 text-center">
        <p className="text-crimson">{error}</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="mx-auto flex min-h-[50vh] max-w-xl flex-col items-center justify-center gap-3 px-4 text-center">
        <p className="font-label text-xs uppercase tracking-[0.3em] text-brass">{dict.life.opening}</p>
      </div>
    );
  }

  return <SkyView chronicle={data} dict={dict} lang={lang} />;
}

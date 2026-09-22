"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import type { LifeListItem } from "@/contracts/life";
import type { Locale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { getLives } from "@/lib/life-client";

/** "Your lives" (decision 041): a plain list from `GET /api/lives`. Decision 059: `lang` also rides along to the request, so `causeOfDeath` renders in the reader's locale. */
export default function LivesPage() {
  const { lang } = useParams<{ lang: Locale }>();
  const dict = getDictionary(lang);
  const [lives, setLives] = useState<LifeListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getLives(lang)
      .then(setLives)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : dict.lives.loadError));
  }, [lang, dict.lives.loadError]);

  return (
    <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
      <div className="mb-10 space-y-2 text-center">
        <p className="font-label text-xs uppercase tracking-[0.3em] text-brass">{dict.lives.kicker}</p>
        <h1 className="font-heading text-4xl font-semibold text-foreground">{dict.lives.title}</h1>
      </div>

      {error && <p className="text-center text-sm text-crimson">{error}</p>}
      {!lives && !error && <p className="text-center text-sm text-muted-foreground">{dict.lives.loading}</p>}
      {lives && lives.length === 0 && <p className="text-center text-sm text-muted-foreground">{dict.lives.empty}</p>}

      <ul className="space-y-3">
        {lives?.map((life) => (
          <li key={life.lifeId}>
            <Link
              href={`/${lang}/life/${life.lifeId}`}
              className="block rounded-lg border border-border bg-card px-5 py-4 text-left shadow-sm transition-colors hover:border-brass"
            >
              <div className="flex items-baseline justify-between gap-4">
                <span className="font-heading text-xl font-semibold text-foreground">{life.name}</span>
                <span className="font-label text-xs uppercase tracking-widest text-muted-foreground">
                  {life.birthYear}–{life.deathYear}
                </span>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{dict.lives.entry(life.ageAtDeath, life.causeOfDeath, life.branchCount)}</p>
            </Link>
          </li>
        ))}
      </ul>

      <div className="mt-10 text-center">
        <Link href={`/${lang}`} className="font-label text-xs uppercase tracking-widest text-muted-foreground underline decoration-dotted underline-offset-4 hover:text-brass">
          {dict.lives.writeAnother}
        </Link>
      </div>
    </div>
  );
}

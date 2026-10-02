"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import type { LifeSex } from "@/contracts/life";
import { SkyView } from "@/components/sky/sky-view";
import { useLiveLife } from "@/components/sky/use-live-life";
import { TurnstileWidget } from "@/components/turnstile-widget";
import type { Locale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { guardErrorMessage } from "@/lib/guard-error";
import { getLives } from "@/lib/life-client";
import { useTurnstileSiteKey } from "@/lib/turnstile-client";

function randomVillageName(): string {
  const syllables = ["mor", "ash", "vel", "thorn", "wyn", "gale", "bram", "rook", "fen", "lark", "myr", "dusk", "combe", "hollow", "mere"];
  const length = 2 + Math.floor(Math.random() * 2);
  return Array.from({ length }, () => syllables[Math.floor(Math.random() * syllables.length)]).join("");
}

type Stage = "form" | "creating";

/**
 * The start screen (decision 041, product decision 034's single-life pivot). One life, one CTA:
 * name a newborn and watch their whole life get written. Village name is a collapsed, optional
 * field — the primary decision is the name and whether it's a daughter, a son, or fate's choice.
 *
 * Decision 059: `lang` (from the `app/[lang]` route param) both picks the UI dictionary and rides
 * along in the create-life request body (`CreateLifeRequest.lang`), so the chronicle this life
 * lands on is narrated in the reader's own locale from the moment it's first written.
 *
 * Creating a life hosts the live night sky right here: it grows tick by tick over one engine, and when the
 * life is saved the address bar moves to the life's own URL with a shallow `history.replaceState` (never
 * `router.*`), so the page, the sky, its clock and its focus all stay exactly as they are.
 */
export default function HomePage() {
  const { lang } = useParams<{ lang: Locale }>();
  const dict = getDictionary(lang);
  const SEX_OPTIONS: { value: LifeSex | "random"; label: string }[] = [
    { value: "f", label: dict.home.sexDaughter },
    { value: "m", label: dict.home.sexSon },
    { value: "random", label: dict.home.sexRandom },
  ];
  const [name, setName] = useState("");
  const [sex, setSex] = useState<LifeSex | "random">("random");
  const [villageOpen, setVillageOpen] = useState(false);
  const [villageName, setVillageName] = useState("");
  const [stage, setStage] = useState<Stage>("form");
  const [error, setError] = useState<string | null>(null);
  // Decision 084: a life with Jev takes minutes; the sky shows each year as it is written.
  const live = useLiveLife();
  const [hasLives, setHasLives] = useState(false);
  const turnstileSiteKey = useTurnstileSiteKey();
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);

  useEffect(() => {
    getLives(lang)
      .then((lives) => setHasLives(lives.length > 0))
      .catch(() => setHasLives(false));
  }, [lang]);

  async function write(): Promise<void> {
    if (!name.trim()) {
      setError(dict.home.nameRequiredError);
      return;
    }
    setError(null);
    setStage("creating");

    try {
      await live.start({ name: name.trim(), sex, villageName: villageName.trim() || undefined, lang, turnstileToken: turnstileToken ?? undefined }, (saved) => {
        window.history.replaceState(null, "", `/${lang}/life/${saved.lifeId}?branch=${saved.branchId}`);
      });
    } catch (err) {
      live.reset();
      setError(guardErrorMessage(err, dict, "Something went wrong."));
      setStage("form");
    }
  }

  if (stage === "creating") {
    if (live.chronicle) return <SkyView chronicle={live.chronicle} dict={dict} lang={lang} saved={live.saved} frontier={live.frontier} />;
    return (
      <div className="mx-auto flex min-h-[70vh] max-w-2xl flex-col items-center justify-center gap-6 px-4 text-center sm:px-6">
        <p className="font-label text-xs uppercase tracking-[0.3em] text-brass">{dict.home.writingKicker(name.trim())}</p>
        {error && <p className="text-center text-sm text-crimson">{error}</p>}
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col items-center gap-8 px-4 py-20 text-center sm:px-6">
      <div className="space-y-4">
        <p className="font-label text-xs uppercase tracking-[0.3em] text-brass">{dict.home.kicker}</p>
        <h1 className="font-heading text-5xl font-semibold leading-tight sm:text-6xl">Lifelines</h1>
        <p className="mx-auto max-w-xl text-lg leading-relaxed text-muted-foreground">{dict.home.description}</p>
      </div>

      <div className="w-full max-w-md space-y-5 rounded-lg border border-border bg-card p-6 text-left shadow-sm">
        <div>
          <label htmlFor="name" className="font-label text-xs uppercase tracking-widest text-muted-foreground">
            {dict.home.nameLabel}
          </label>
          <input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={dict.home.namePlaceholder}
            className="mt-2 min-h-11 w-full rounded-md border border-border bg-background px-3 py-2 text-base text-foreground outline-none focus:border-brass focus:ring-2 focus:ring-ring/40"
          />
        </div>

        <div>
          <div className="font-label text-xs uppercase tracking-widest text-muted-foreground">{dict.home.sexLabel}</div>
          <div className="mt-2 flex gap-2">
            {SEX_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setSex(opt.value)}
                aria-pressed={sex === opt.value}
                className={`min-h-11 flex-1 cursor-pointer rounded-md border px-2 py-2 text-xs font-label uppercase tracking-wide transition-colors ${
                  sex === opt.value ? "border-brass bg-brass text-background" : "border-border text-muted-foreground hover:border-brass hover:text-brass"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <button type="button" onClick={() => setVillageOpen((v) => !v)} className="cursor-pointer text-xs text-muted-foreground underline decoration-dotted underline-offset-4 hover:text-brass">
            {villageOpen ? dict.home.hideVillage : dict.home.chooseVillage}
          </button>
          {villageOpen && (
            <div className="mt-2 flex gap-2">
              <input
                value={villageName}
                onChange={(e) => setVillageName(e.target.value)}
                placeholder={dict.home.villagePlaceholder}
                className="min-h-11 flex-1 rounded-md border border-border bg-background px-3 py-2 text-base text-foreground outline-none focus:border-brass focus:ring-2 focus:ring-ring/40"
              />
              <button
                type="button"
                onClick={() => setVillageName(randomVillageName())}
                className="min-h-11 cursor-pointer rounded-md border border-border px-3 font-label text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:border-brass hover:text-brass"
              >
                {dict.home.randomize}
              </button>
            </div>
          )}
        </div>

        {turnstileSiteKey && (
          <div className="flex justify-center">
            <TurnstileWidget siteKey={turnstileSiteKey} onToken={setTurnstileToken} />
          </div>
        )}

        <button
          type="button"
          onClick={write}
          disabled={!!turnstileSiteKey && !turnstileToken}
          className="min-h-11 w-full cursor-pointer rounded-md bg-brass px-4 py-2.5 font-label text-sm uppercase tracking-widest text-background transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {dict.home.submit}
        </button>

        {error && <p className="text-center text-sm text-crimson">{error}</p>}
      </div>

      {hasLives && (
        <Link href={`/${lang}/lives`} className="font-label text-xs uppercase tracking-widest text-muted-foreground underline decoration-dotted underline-offset-4 hover:text-brass">
          {dict.home.yourLivesLink}
        </Link>
      )}
    </div>
  );
}

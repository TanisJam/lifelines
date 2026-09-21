"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { LifeSex, LifeStreamEvent } from "@/contracts/life";
import { createLifeStream, getLives } from "@/lib/life-client";

function randomVillageName(): string {
  const syllables = ["mor", "ash", "vel", "thorn", "wyn", "gale", "bram", "rook", "fen", "lark", "myr", "dusk", "combe", "hollow", "mere"];
  const length = 2 + Math.floor(Math.random() * 2);
  return Array.from({ length }, () => syllables[Math.floor(Math.random() * syllables.length)]).join("");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type Stage = "form" | "creating";

const SEX_OPTIONS: { value: LifeSex | "random"; label: string }[] = [
  { value: "f", label: "a daughter" },
  { value: "m", label: "a son" },
  { value: "random", label: "let fate decide" },
];

/**
 * The start screen (decision 041, product decision 034's single-life pivot). One life, one CTA:
 * name a newborn and watch their whole life get written. Village name is a collapsed, optional
 * field — the primary decision is the name and whether it's a daughter, a son, or fate's choice.
 */
export default function HomePage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [sex, setSex] = useState<LifeSex | "random">("random");
  const [villageOpen, setVillageOpen] = useState(false);
  const [villageName, setVillageName] = useState("");
  const [stage, setStage] = useState<Stage>("form");
  const [error, setError] = useState<string | null>(null);
  const [protagonistName, setProtagonistName] = useState<string | null>(null);
  const [year, setYear] = useState<number | null>(null);
  const [recentTitles, setRecentTitles] = useState<string[]>([]);
  const [done, setDone] = useState<{ name: string; birthYear: number; deathYear: number } | null>(null);
  const [hasLives, setHasLives] = useState(false);

  useEffect(() => {
    getLives()
      .then((lives) => setHasLives(lives.length > 0))
      .catch(() => setHasLives(false));
  }, []);

  async function write(): Promise<void> {
    if (!name.trim()) {
      setError("Name her, or him, first.");
      return;
    }
    setError(null);
    setStage("creating");
    setRecentTitles([]);
    setDone(null);
    setYear(null);
    setProtagonistName(null);

    try {
      let landedLifeId = "";
      let landedBranchId = "";
      await createLifeStream({ name: name.trim(), sex, villageName: villageName.trim() || undefined }, (event: LifeStreamEvent) => {
        if (event.type === "start") {
          setProtagonistName(event.protagonist.name);
          setYear(event.protagonist.birthYear);
        } else if (event.type === "tick") {
          setYear(event.year);
          if (event.entries.length > 0) setRecentTitles(event.entries.slice(-3).map((e) => e.title));
        } else if (event.type === "done") {
          landedLifeId = event.chronicle.lifeId;
          landedBranchId = event.chronicle.branchId;
          setDone({ name: event.chronicle.protagonist.name, birthYear: event.chronicle.protagonist.birthYear, deathYear: event.chronicle.protagonist.deathYear });
        } else if (event.type === "error") {
          throw new Error(event.message);
        }
      });
      if (landedLifeId) {
        // "On done, show '<Name>, <birth>–<death>' briefly, then transition to the chronicle."
        await sleep(900);
        router.push(`/life/${landedLifeId}?branch=${landedBranchId}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setStage("form");
    }
  }

  if (stage === "creating") {
    return (
      <div className="mx-auto flex min-h-[70vh] max-w-2xl flex-col items-center justify-center gap-6 px-4 text-center sm:px-6">
        {done ? (
          <>
            <p className="font-label text-xs uppercase tracking-[0.3em] text-brass">A life, written</p>
            <h1 className="font-heading text-4xl font-semibold text-foreground sm:text-5xl">
              {done.name}, {done.birthYear}–{done.deathYear}
            </h1>
          </>
        ) : (
          <>
            <p className="font-label text-xs uppercase tracking-[0.3em] text-brass">Writing the life of {protagonistName ?? name}&hellip;</p>
            {year !== null && (
              <p className="font-heading text-5xl font-semibold tabular-nums text-foreground" aria-live="polite">
                {year}
              </p>
            )}
            <div className="h-20 space-y-1">
              {recentTitles.map((t, i) => (
                <p key={i} className="text-muted-foreground">
                  {t}
                </p>
              ))}
            </div>
          </>
        )}
        {error && <p className="text-center text-sm text-crimson">{error}</p>}
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col items-center gap-8 px-4 py-20 text-center sm:px-6">
      <div className="space-y-4">
        <p className="font-label text-xs uppercase tracking-[0.3em] text-brass">A life simulator</p>
        <h1 className="font-heading text-5xl font-semibold leading-tight sm:text-6xl">Lifelines</h1>
        <p className="mx-auto max-w-xl text-lg leading-relaxed text-muted-foreground">
          Name a newborn, and watch one life get written — year by year, birth to death — in a medieval village. Then change any
          moment, hers or someone else&apos;s or chance&apos;s, and watch the rest of that life get rewritten.
        </p>
      </div>

      <div className="w-full max-w-md space-y-5 rounded-lg border border-border bg-card p-6 text-left shadow-sm">
        <div>
          <label htmlFor="name" className="font-label text-xs uppercase tracking-widest text-muted-foreground">
            Name
          </label>
          <input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Elin"
            className="mt-2 min-h-11 w-full rounded-md border border-border bg-background px-3 py-2 text-base text-foreground outline-none focus:border-brass focus:ring-2 focus:ring-ring/40"
          />
        </div>

        <div>
          <div className="font-label text-xs uppercase tracking-widest text-muted-foreground">A daughter, a son, or fate</div>
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
            {villageOpen ? "Hide village" : "Choose a village (optional)"}
          </button>
          {villageOpen && (
            <div className="mt-2 flex gap-2">
              <input
                value={villageName}
                onChange={(e) => setVillageName(e.target.value)}
                placeholder="leave blank to randomize"
                className="min-h-11 flex-1 rounded-md border border-border bg-background px-3 py-2 text-base text-foreground outline-none focus:border-brass focus:ring-2 focus:ring-ring/40"
              />
              <button
                type="button"
                onClick={() => setVillageName(randomVillageName())}
                className="min-h-11 cursor-pointer rounded-md border border-border px-3 font-label text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:border-brass hover:text-brass"
              >
                Randomize
              </button>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={write}
          className="min-h-11 w-full cursor-pointer rounded-md bg-brass px-4 py-2.5 font-label text-sm uppercase tracking-widest text-background transition-opacity hover:opacity-90"
        >
          Write their life
        </button>

        {error && <p className="text-center text-sm text-crimson">{error}</p>}
      </div>

      {hasLives && (
        <Link href="/lives" className="font-label text-xs uppercase tracking-widest text-muted-foreground underline decoration-dotted underline-offset-4 hover:text-brass">
          Your lives
        </Link>
      )}
    </div>
  );
}

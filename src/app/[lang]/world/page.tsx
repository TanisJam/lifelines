"use client";

import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import type { Locale } from "@/i18n/config";
import { streamSSE } from "@/lib/sse";

function randomSeedWord(): string {
  const syllables = ["mor", "ash", "vel", "thorn", "wyn", "gale", "bram", "rook", "fen", "lark", "myr", "dusk"];
  const length = 2 + Math.floor(Math.random() * 2);
  return Array.from({ length }, () => syllables[Math.floor(Math.random() * syllables.length)]).join("");
}

interface StreamedDecision {
  readonly chosen: string;
  readonly options: readonly { id: string; label: string }[];
  readonly resultingEventIds: readonly string[];
}

function shortLines(newDecisions: readonly StreamedDecision[]): string[] {
  return newDecisions
    .filter((d) => d.resultingEventIds.length > 0)
    .map((d) => d.options.find((o) => o.id === d.chosen)?.label)
    .filter((label): label is string => !!label)
    .slice(0, 3);
}

/**
 * The pre-pivot "found a whole town" flow (decision 026/029), kept reachable as a legacy page
 * (decision 041 — single-life pivot) behind the footer's "The village (legacy)" link, since it
 * still calls real, working endpoints (`/api/worlds/**`) that this worktree must not break.
 */
/** Decision 059: see `world/[worldId]/page.tsx`'s own comment — this legacy page routes under `[lang]` but keeps its English-only UI. */
export default function LegacyWorldPage() {
  const router = useRouter();
  const { lang } = useParams<{ lang: Locale }>();
  const [seed, setSeed] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [townName, setTownName] = useState<string | null>(null);
  const [year, setYear] = useState<number | null>(null);
  const [population, setPopulation] = useState<number | null>(null);
  const [recentLines, setRecentLines] = useState<string[]>([]);

  async function foundTown(): Promise<void> {
    setLoading(true);
    setError(null);
    setTownName(null);
    setRecentLines([]);
    try {
      await streamSSE("/api/worlds/stream", { seed: seed.trim() || undefined }, (event, data) => {
        if (event === "start") {
          const d = data as { peopleCount: number; config: { town: { name: string } } };
          setTownName(d.config.town.name);
        } else if (event === "tick") {
          const d = data as { year: number; population: number; newDecisions: StreamedDecision[] };
          setYear(d.year);
          setPopulation(d.population);
          const lines = shortLines(d.newDecisions);
          if (lines.length > 0) setRecentLines(lines);
        } else if (event === "done") {
          const d = data as { worldId: string; branchId: string; richPersonId?: string };
          if (d.richPersonId) router.push(`/${lang}/world/${d.worldId}/person/${d.richPersonId}?branch=${d.branchId}`);
          else router.push(`/${lang}/world/${d.worldId}?branch=${d.branchId}`);
        } else if (event === "error") {
          throw new Error((data as { message: string }).message);
        }
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto flex min-h-[70vh] max-w-2xl flex-col items-center justify-center gap-6 px-4 text-center sm:px-6">
        <p className="font-label text-xs uppercase tracking-[0.3em] text-brass">{townName ? `Writing the lives of ${townName}…` : "Founding a town…"}</p>
        {year !== null && (
          <p className="font-heading text-5xl font-semibold tabular-nums text-foreground">
            {year}
            <span className="ml-3 align-middle text-lg font-normal text-muted-foreground">{population} living</span>
          </p>
        )}
        <div className="h-16 space-y-1">
          {recentLines.map((line, i) => (
            <p key={i} className="text-muted-foreground">
              {line}
            </p>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col items-center gap-10 px-4 py-20 text-center sm:px-6">
      <div className="space-y-4">
        <p className="font-label text-xs uppercase tracking-[0.3em] text-brass">The village (legacy)</p>
        <h1 className="font-heading text-5xl font-semibold leading-tight sm:text-6xl">Found a whole town</h1>
        <p className="mx-auto max-w-xl text-lg leading-relaxed text-muted-foreground">
          The pre-pivot multi-life view: simulate a small town, year by year, and browse its whole population through The Loom
          and the town chronicle, instead of a single named life.
        </p>
      </div>

      <div className="w-full max-w-md space-y-4 rounded-lg border border-border bg-card p-6 text-left shadow-sm">
        <label htmlFor="seed" className="font-label text-xs uppercase tracking-widest text-muted-foreground">
          World seed
        </label>
        <div className="flex gap-2">
          <input
            id="seed"
            value={seed}
            onChange={(e) => setSeed(e.target.value)}
            placeholder="leave blank to randomize"
            className="min-h-11 flex-1 rounded-md border border-border bg-background px-3 py-2 text-base text-foreground outline-none focus:border-brass focus:ring-2 focus:ring-ring/40"
          />
          <button
            type="button"
            onClick={() => setSeed(randomSeedWord())}
            className="min-h-11 cursor-pointer rounded-md border border-border px-3 font-label text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:border-brass hover:text-brass"
          >
            Randomize
          </button>
        </div>
        <p className="text-xs text-muted-foreground">The same seed always founds the identical town — the simulation is fully deterministic.</p>

        <button
          type="button"
          onClick={foundTown}
          disabled={loading}
          className="min-h-11 w-full cursor-pointer rounded-md bg-brass px-4 py-2.5 font-label text-sm uppercase tracking-widest text-background transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? "Founding..." : "Found this town"}
        </button>

        {error && <p className="text-center text-sm text-crimson">{error}</p>}
      </div>
    </div>
  );
}

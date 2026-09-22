import Link from "next/link";
import { notFound } from "next/navigation";
import { diffBranches } from "@/domain/diff";
import { narratePersonTimeline } from "@/domain/narrate";
import { resolveLang } from "@/i18n/resolve-lang";
import { getDecisionMaker } from "@/server/decision-engine";
import { getBranch, getWorld } from "@/server/world-store";

const FIELD_LABELS: Record<string, string> = { alive: "Life", job: "Career", spouse: "Marriage", location: "Location" };

/** Decision 059: see `world/[worldId]/page.tsx`'s own comment — this legacy page routes under `[lang]` but keeps its English-only UI. */
export default async function ComparePage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string; worldId: string }>;
  searchParams: Promise<{ a?: string; b?: string; person?: string }>;
}) {
  const { lang: langParam, worldId } = await params;
  const lang = resolveLang(langParam);
  const { a, b, person: personId } = await searchParams;

  const world = getWorld(worldId);
  if (!world) notFound();

  const branchAId = a ?? world.originalBranchId;
  const branchA = getBranch(worldId, branchAId);
  if (!branchA) notFound();

  const branchB = b ? getBranch(worldId, b) : undefined;
  if (!branchB) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10 text-center sm:px-6">
        <p className="text-muted-foreground">No fork to compare yet. Open a person&apos;s chronicle and rewrite a moment in their history first.</p>
        <Link href={`/${lang}/world/${worldId}?branch=${branchAId}`} className="mt-4 inline-block text-brass underline underline-offset-4">
          &larr; Back to the town
        </Link>
      </div>
    );
  }

  const forkYear = branchB.forkYear ?? world.config.startYear;
  const diff = diffBranches(branchA.result, branchB.result, forkYear);

  const person = personId ? branchB.result.people[personId] : undefined;
  const decisionMaker = getDecisionMaker();
  const [timelineA, timelineB] = person
    ? await Promise.all([
        narratePersonTimeline(personId!, branchA.result.events, branchA.result.people, decisionMaker, 8, world.config.seed),
        narratePersonTimeline(personId!, branchB.result.events, branchB.result.people, decisionMaker, 8, world.config.seed),
      ])
    : [[], []];

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <Link href={`/${lang}/world/${worldId}?branch=${branchB.id}`} className="mb-6 inline-block font-label text-xs uppercase tracking-widest text-muted-foreground hover:text-brass">
        &larr; {world.config.town.name}
      </Link>

      <div className="mb-8 space-y-2">
        <p className="font-label text-xs uppercase tracking-[0.3em] text-brass">The butterfly effect</p>
        <h1 className="font-heading text-4xl font-semibold">Fork at {forkYear}</h1>
        <p className="text-muted-foreground">
          <strong>{branchA.label}</strong> vs <strong>{branchB.label}</strong> — {diff.changedPeopleCount} {diff.changedPeopleCount === 1 ? "person" : "people"} ended up with a
          different fate.
        </p>
      </div>

      <section className="mb-10 overflow-hidden rounded-lg border border-border">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-background-alt">
            <tr>
              <th className="px-3 py-2 text-left font-label text-xs uppercase tracking-widest text-muted-foreground">Person</th>
              <th className="px-3 py-2 text-left font-label text-xs uppercase tracking-widest text-muted-foreground">Changed</th>
              <th className="px-3 py-2 text-left font-label text-xs uppercase tracking-widest text-muted-foreground">{branchA.label}</th>
              <th className="px-3 py-2 text-left font-label text-xs uppercase tracking-widest text-muted-foreground">{branchB.label}</th>
            </tr>
          </thead>
          <tbody>
            {diff.diffs.length === 0 && diff.newPeople.length === 0 && diff.missingPeople.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-4 text-center text-muted-foreground">
                  No visible differences yet — the edit hasn&apos;t rippled out to a change in life, career, or marriage.
                </td>
              </tr>
            )}
            {diff.diffs.map((d, i) => (
              <tr key={`${d.personId}-${d.field}-${i}`} className="border-t border-border">
                <td className="px-3 py-2">
                  <Link href={`/${lang}/world/${worldId}/compare?a=${branchAId}&b=${branchB.id}&person=${d.personId}`} className="text-brass underline underline-offset-4">
                    {d.name}
                  </Link>
                </td>
                <td className="px-3 py-2">{FIELD_LABELS[d.field] ?? d.field}</td>
                <td className="px-3 py-2 text-muted-foreground">{d.before}</td>
                <td className="px-3 py-2">{d.after}</td>
              </tr>
            ))}
            {diff.missingPeople.map((p) => (
              <tr key={`missing-${p.personId}`} className="border-t border-border bg-crimson/5">
                <td className="px-3 py-2">{p.name}</td>
                <td className="px-3 py-2">Existence</td>
                <td className="px-3 py-2 text-muted-foreground">born {p.birthYear}</td>
                <td className="px-3 py-2 text-crimson">never born</td>
              </tr>
            ))}
            {diff.newPeople.map((p) => (
              <tr key={`new-${p.personId}`} className="border-t border-border bg-brass/5">
                <td className="px-3 py-2">
                  <Link href={`/${lang}/world/${worldId}/compare?a=${branchAId}&b=${branchB.id}&person=${p.personId}`} className="text-brass underline underline-offset-4">
                    {p.name}
                  </Link>
                </td>
                <td className="px-3 py-2">Existence</td>
                <td className="px-3 py-2 text-muted-foreground">never existed</td>
                <td className="px-3 py-2">born {p.birthYear}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {person && (
        <section>
          <h2 className="mb-4 font-heading text-2xl font-semibold">{person.name}, side by side</h2>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            {[
              { label: branchA.label, timeline: timelineA },
              { label: branchB.label, timeline: timelineB },
            ].map((col) => (
              <div key={col.label}>
                <p className="mb-2 font-label text-xs uppercase tracking-widest text-muted-foreground">{col.label}</p>
                <ol className="space-y-2 border-l border-border pl-4">
                  {col.timeline.map((entry) => (
                    <li key={entry.event.id} className={entry.event.year >= forkYear ? "rounded bg-brass/5 p-1.5" : "p-1.5"}>
                      <span className="font-label text-[11px] text-muted-foreground">{entry.event.year}</span> <span className="text-sm">{entry.prose}</span>
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

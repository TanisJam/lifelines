import Link from "next/link";
import { notFound } from "next/navigation";
import { buildTownChronicle } from "@/server/town-data";
import { getBranch, getWorld } from "@/server/world-store";

/**
 * The Town chronicle (round 6, decision 029) — secondary, per the handoff ("it should never
 * replace the single-person life as the central product experience"), reachable from the top bar
 * of the Living Chronicle. Reads the same event log as every other view (decision 001): town
 * events, notable deaths, dynasties (surname groups) and the biggest feuds.
 */
export default async function TownPage({ params, searchParams }: { params: Promise<{ worldId: string }>; searchParams: Promise<{ branch?: string }> }) {
  const { worldId } = await params;
  const { branch: branchParam } = await searchParams;

  const world = getWorld(worldId);
  if (!world) notFound();
  const branchId = branchParam ?? world.originalBranchId;
  const branch = getBranch(worldId, branchId);
  if (!branch) notFound();

  const chronicle = buildTownChronicle(branch.result, world.config.town.name, world.config.seed);
  const livingCount = Object.values(branch.result.people).filter((p) => p.deathYear === undefined).length;

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <div className="mb-8 flex flex-wrap items-center gap-3 border-b border-border/70 pb-4">
        <Link href={`/world/${worldId}?branch=${branchId}`} className="font-label text-xs uppercase tracking-widest text-muted-foreground hover:text-brass">
          &larr; Tapestry
        </Link>
      </div>

      <h1 className="font-heading text-4xl font-semibold text-foreground sm:text-5xl">{world.config.town.name}</h1>
      <p className="mt-2 text-muted-foreground">
        {world.config.startYear}&ndash;{world.config.endYear} &middot; {Object.keys(branch.result.people).length} lives recorded &middot; {livingCount} living
      </p>

      {chronicle.townEvents.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-3 font-heading text-2xl font-semibold text-foreground">Town events</h2>
          <ul className="space-y-2">
            {chronicle.townEvents.map((e) => (
              <li key={e.eventId} className="rounded-md border border-border bg-card p-3">
                <p className="font-label text-xs uppercase tracking-widest text-muted-foreground">{e.year}</p>
                <p className="text-foreground">{e.prose}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-10">
        <h2 className="mb-3 font-heading text-2xl font-semibold text-foreground">Notable deaths</h2>
        <ul className="space-y-2">
          {chronicle.notableDeaths.map((d) => (
            <li key={d.personId} className="rounded-md border border-border bg-card p-3">
              <p className="font-label text-xs uppercase tracking-widest text-muted-foreground">{d.year}</p>
              <p className="text-foreground">
                <Link href={`/world/${worldId}/person/${d.personId}?branch=${branchId}`} className="text-brass underline decoration-brass/40 underline-offset-2 hover:decoration-brass">
                  {d.name}
                </Link>{" "}
                &mdash; {d.prose}
              </p>
            </li>
          ))}
        </ul>
      </section>

      {chronicle.dynasties.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-3 font-heading text-2xl font-semibold text-foreground">Dynasties</h2>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {chronicle.dynasties.map((d) => (
              <li key={d.surname} className="rounded-md border border-border bg-card p-3">
                <p className="font-heading text-lg font-semibold text-foreground">{d.surname}</p>
                <p className="text-xs text-muted-foreground">
                  {d.count} across the town&apos;s history &middot; {d.living} living &middot; {d.founders} founder{d.founders === 1 ? "" : "s"}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">{d.sample.join(", ")}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {chronicle.biggestFeuds.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-3 font-heading text-2xl font-semibold text-foreground">The biggest feuds</h2>
          <ul className="space-y-2">
            {chronicle.biggestFeuds.map((f, i) => (
              <li key={i} className="rounded-md border border-border bg-card p-3 text-foreground">
                {f.a} &amp; {f.b} — {f.escalations} round{f.escalations === 1 ? "" : "s"} of conflict{f.resolved ? ", eventually reconciled" : ", never resolved"}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { diffBranches } from "@/domain/diff";
import { buildLoomPeople } from "@/domain/loom-data";
import { Loom } from "@/components/loom";
import { resolveLang } from "@/i18n/resolve-lang";
import { pickRichPerson } from "@/server/rich-person";
import { getBranch, getWorld, listBranches } from "@/server/world-store";

/** Decision 059: the legacy multi-town flow (`app/[lang]/world/**`) still routes correctly under `[lang]` (every internal link below is locale-prefixed), but keeps its English-only UI copy — a disclosed, deliberate scope cut (see `docs/decisions.md`'s "059" entry); the primary reading experience (`/[lang]/life/[lifeId]`) is what's fully localized. */
export default async function WorldPage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string; worldId: string }>;
  searchParams: Promise<{ branch?: string; compare?: string }>;
}) {
  const { lang: langParam, worldId } = await params;
  const lang = resolveLang(langParam);
  const { branch: branchParam, compare: compareParam } = await searchParams;

  const world = getWorld(worldId);
  if (!world) notFound();

  const branchId = branchParam ?? world.originalBranchId;
  const branch = getBranch(worldId, branchId);
  if (!branch) notFound();

  const branches = listBranches(worldId);
  const { people, laneOrder } = buildLoomPeople(branch.result);
  const aliveCount = people.filter((p) => p.deathYear === null).length;

  const compareBranch = compareParam ? getBranch(worldId, compareParam) : undefined;
  const ghost = compareBranch ? buildLoomPeople(compareBranch.result) : undefined;
  const diff = compareBranch ? diffBranches(compareBranch.result, branch.result, branch.forkYear ?? world.config.startYear) : undefined;

  const richPersonId = pickRichPerson(branch.result);

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <div className="mb-4 flex flex-wrap items-center gap-3 border-b border-border/70 pb-4">
        {richPersonId && (
          <Link href={`/${lang}/world/${worldId}/person/${richPersonId}?branch=${branchId}`} className="font-label text-xs uppercase tracking-widest text-muted-foreground hover:text-brass">
            &larr; Chronicle
          </Link>
        )}
        <Link href={`/${lang}/world/${worldId}/town?branch=${branchId}`} className="font-label text-xs uppercase tracking-widest text-muted-foreground hover:text-brass">
          Town
        </Link>
      </div>
      <div className="mb-6 space-y-2">
        <p className="font-label text-xs uppercase tracking-[0.3em] text-brass">
          Seed &ldquo;{world.config.seed}&rdquo; &middot; {world.config.startYear}&ndash;{world.config.endYear} &middot; {branch.label}
        </p>
        <h1 className="font-heading text-4xl font-semibold">{world.config.town.name} — the Tapestry</h1>
        <p className="text-muted-foreground">
          {people.length} people in this branch&apos;s history &middot; {aliveCount} still alive in {world.config.endYear} &middot; {branch.result.decisions.length} decisions
          recorded &middot; click a dot on the loom below to inspect it
        </p>
      </div>

      <Loom
        lang={lang}
        worldId={worldId}
        branchId={branchId}
        branchLabel={branch.label}
        townName={world.config.town.name}
        startYear={world.config.startYear}
        endYear={world.config.endYear}
        people={people}
        laneOrder={laneOrder}
        decisions={branch.result.decisions}
        branches={branches.map((b) => ({ id: b.id, label: b.label, forkYear: b.forkYear ?? null }))}
        ghost={compareBranch && ghost ? { branchId: compareBranch.id, label: compareBranch.label, people: ghost.people, laneOrder: ghost.laneOrder } : undefined}
        diff={diff}
      />
    </div>
  );
}

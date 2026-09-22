import { notFound } from "next/navigation";
import { LegacyChronicle } from "@/components/legacy-chronicle";
import { resolveLang } from "@/i18n/resolve-lang";
import { getChronicleData } from "@/server/chronicle-data";

/**
 * The Living Chronicle (round 6, decision 029): the person page is the primary landing
 * experience — this server component does the one data fetch (`getChronicleData`, shared with
 * the client's re-fetch route) and hands it to the interactive `<Chronicle>` component, which
 * owns the change modal and the in-place rewrite.
 *
 * Decision 059: see `world/[worldId]/page.tsx`'s own comment — this legacy page routes under `[lang]` but keeps its English-only UI.
 */
export default async function PersonPage({ params, searchParams }: { params: Promise<{ lang: string; worldId: string; personId: string }>; searchParams: Promise<{ branch?: string }> }) {
  const { lang: langParam, worldId, personId } = await params;
  const lang = resolveLang(langParam);
  const { branch: branchId } = await searchParams;

  const result = await getChronicleData(worldId, personId, branchId);
  if ("error" in result) notFound();

  return <LegacyChronicle initial={result.data} lang={lang} />;
}

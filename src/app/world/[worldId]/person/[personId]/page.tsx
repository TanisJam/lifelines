import { notFound } from "next/navigation";
import { Chronicle } from "@/components/chronicle";
import { getChronicleData } from "@/server/chronicle-data";

/**
 * The Living Chronicle (round 6, decision 029): the person page is the primary landing
 * experience — this server component does the one data fetch (`getChronicleData`, shared with
 * the client's re-fetch route) and hands it to the interactive `<Chronicle>` component, which
 * owns the change modal and the in-place rewrite.
 */
export default async function PersonPage({ params, searchParams }: { params: Promise<{ worldId: string; personId: string }>; searchParams: Promise<{ branch?: string }> }) {
  const { worldId, personId } = await params;
  const { branch: branchId } = await searchParams;

  const result = await getChronicleData(worldId, personId, branchId);
  if ("error" in result) notFound();

  return <Chronicle initial={result.data} />;
}

import { NextResponse } from "next/server";
import { getChronicleData } from "@/server/chronicle-data";

export const runtime = "nodejs";

/**
 * The Living Chronicle's one data endpoint for a person (round 6, decision 029) — used both for
 * the client's re-fetch after an in-place rewrite, and (via `getChronicleData` directly, no HTTP
 * round trip) for the page's own server-side render.
 */
export async function GET(request: Request, context: { params: Promise<{ worldId: string; personId: string }> }): Promise<NextResponse> {
  const { worldId, personId } = await context.params;
  const url = new URL(request.url);
  const branchId = url.searchParams.get("branchId") ?? undefined;

  const result = await getChronicleData(worldId, personId, branchId);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.data);
}

import { NextResponse } from "next/server";
import { buildLifeChronicle } from "@/server/life-chronicle";

export const runtime = "nodejs";

/** `GET /api/lives/:lifeId?branchId=` — the full `Chronicle` (defaults to the latest branch). */
export async function GET(request: Request, context: { params: Promise<{ lifeId: string }> }): Promise<NextResponse> {
  const { lifeId } = await context.params;
  const url = new URL(request.url);
  const branchId = url.searchParams.get("branchId") ?? undefined;

  const result = await buildLifeChronicle(lifeId, branchId);
  if (!result.data) return NextResponse.json({ error: result.error }, { status: result.status ?? 500 });
  return NextResponse.json(result.data);
}

import { NextResponse } from "next/server";
import { buildPersonSheet } from "@/server/life-chronicle";

export const runtime = "nodejs";

/** `GET /api/lives/:lifeId/people/:personId?branchId=` — a read-only side sheet for the person-link modal. */
export async function GET(request: Request, context: { params: Promise<{ lifeId: string; personId: string }> }): Promise<NextResponse> {
  const { lifeId, personId } = await context.params;
  const url = new URL(request.url);
  const branchId = url.searchParams.get("branchId") ?? undefined;

  const result = await buildPersonSheet(lifeId, personId, branchId);
  if (!result.data) return NextResponse.json({ error: result.error }, { status: result.status ?? 500 });
  return NextResponse.json(result.data);
}

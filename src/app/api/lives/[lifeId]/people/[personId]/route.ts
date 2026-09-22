import { NextResponse } from "next/server";
import { isLocale } from "@/domain/locale";
import { buildPersonSheet } from "@/server/life-chronicle";

export const runtime = "nodejs";

/** `GET /api/lives/:lifeId/people/:personId?branchId=&lang=` — a read-only side sheet for the person-link modal. See `lives/[lifeId]/route.ts` for why `lang` is a query param here (decision 059). */
export async function GET(request: Request, context: { params: Promise<{ lifeId: string; personId: string }> }): Promise<NextResponse> {
  const { lifeId, personId } = await context.params;
  const url = new URL(request.url);
  const branchId = url.searchParams.get("branchId") ?? undefined;
  const langParam = url.searchParams.get("lang");
  const locale = langParam && isLocale(langParam) ? langParam : "en";

  const result = await buildPersonSheet(lifeId, personId, branchId, locale);
  if (!result.data) return NextResponse.json({ error: result.error }, { status: result.status ?? 500 });
  return NextResponse.json(result.data);
}

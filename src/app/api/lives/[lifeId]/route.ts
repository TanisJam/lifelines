import { NextResponse } from "next/server";
import { isLocale } from "@/domain/locale";
import { buildLifeChronicle } from "@/server/life-chronicle";

export const runtime = "nodejs";

/**
 * `GET /api/lives/:lifeId?branchId=&lang=` — the full `Chronicle` (defaults to the latest branch).
 * Decision 059: `lang` is a query param, not a path segment — this route lives outside `app/[lang]`
 * (API routes never move under the locale segment; see `docs/decisions.md`'s "059" entry).
 */
export async function GET(request: Request, context: { params: Promise<{ lifeId: string }> }): Promise<NextResponse> {
  const { lifeId } = await context.params;
  const url = new URL(request.url);
  const branchId = url.searchParams.get("branchId") ?? undefined;
  const langParam = url.searchParams.get("lang");
  const locale = langParam && isLocale(langParam) ? langParam : "en";

  const result = await buildLifeChronicle(lifeId, branchId, locale);
  if (!result.data) return NextResponse.json({ error: result.error }, { status: result.status ?? 500 });
  return NextResponse.json(result.data);
}

/**
 * Typed client for the single-life contract (`docs/design/single-life-contract.md`,
 * `src/contracts/life.ts`). Every function here has the same signature whether it talks to
 * the real API (`src/app/api/lives/**`, built by the engine worktree) or the fixture layer
 * under `src/lib/fixtures/` — callers never branch on fixture mode themselves.
 *
 * Fixture mode is selected by `NEXT_PUBLIC_LIFE_FIXTURE=1` (decision 040). It exists so the UI
 * can be built and demoed before the engine's endpoints exist.
 */

import type { Chronicle, CreateLifeRequest, LifeListItem, LifeStreamEvent, PersonSheet, RewriteRequest } from "@/contracts/life";

export type LifeStreamHandler = (event: LifeStreamEvent) => void;

function fixtureMode(): boolean {
  return process.env.NEXT_PUBLIC_LIFE_FIXTURE === "1";
}

/**
 * Parses one `text/event-stream` frame (everything between two `\n\n` separators) into a
 * `LifeStreamEvent`, or `null` for a blank/malformed frame. Per the contract, `data:` already
 * carries the full JSON object including its own `type` field, so `event:` is informational only
 * and isn't required to reconstruct the event. Pure and framework-free: exported for unit tests.
 */
export function parseLifeStreamFrame(frame: string): LifeStreamEvent | null {
  let dataText = "";
  for (const line of frame.split("\n")) {
    if (line.startsWith("data:")) dataText += line.slice(5).trim();
  }
  if (!dataText) return null;
  try {
    const parsed = JSON.parse(dataText) as Record<string, unknown>;
    if (typeof parsed.type !== "string") return null;
    return parsed as unknown as LifeStreamEvent;
  } catch {
    return null;
  }
}

async function readErrorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    return body.error || `Request failed (${res.status})`;
  } catch {
    return `Request failed (${res.status})`;
  }
}

/** Consumes a POST `text/event-stream` response body (browsers' `EventSource` is GET-only). */
async function consumeStream(url: string, body: unknown, onEvent: LifeStreamHandler, signal?: AbortSignal): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) throw new Error(await readErrorMessage(res));

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const event = parseLifeStreamFrame(frame);
      if (event) onEvent(event);
    }
  }
}

/** POST /api/lives/stream — creates a new life, streaming `start`/`tick`/`done`/`error`. */
export async function createLifeStream(req: CreateLifeRequest, onEvent: LifeStreamHandler, signal?: AbortSignal): Promise<void> {
  if (fixtureMode()) {
    const { streamCreateLife } = await import("@/lib/fixtures");
    return streamCreateLife(req, onEvent, signal);
  }
  return consumeStream("/api/lives/stream", req, onEvent, signal);
}

/** POST /api/lives/:lifeId/rewrite/stream — reruns the life from a changed turn. */
export async function rewriteStream(lifeId: string, req: RewriteRequest, onEvent: LifeStreamHandler, signal?: AbortSignal): Promise<void> {
  if (fixtureMode()) {
    const { streamRewrite } = await import("@/lib/fixtures");
    return streamRewrite(lifeId, req, onEvent, signal);
  }
  return consumeStream(`/api/lives/${encodeURIComponent(lifeId)}/rewrite/stream`, req, onEvent, signal);
}

/** GET /api/lives?lang= — "Your lives". */
export async function getLives(lang?: string): Promise<LifeListItem[]> {
  if (fixtureMode()) {
    const { fixtureLives } = await import("@/lib/fixtures");
    return fixtureLives();
  }
  const res = await fetch(`/api/lives${lang ? `?lang=${encodeURIComponent(lang)}` : ""}`);
  if (!res.ok) throw new Error(await readErrorMessage(res));
  return (await res.json()) as LifeListItem[];
}

/** Builds a `?branchId=&lang=` query string, omitting either part when absent — shared by `getChronicle`/`getPersonSheet` (decision 059 added `lang`; both params stay optional so an un-migrated caller keeps working). */
function branchAndLangQuery(branchId?: string, lang?: string): string {
  const params = new URLSearchParams();
  if (branchId) params.set("branchId", branchId);
  if (lang) params.set("lang", lang);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

/** GET /api/lives/:lifeId?branchId=&lang= — the full chronicle (defaults to the latest branch, English). */
export async function getChronicle(lifeId: string, branchId?: string, lang?: string): Promise<Chronicle> {
  if (fixtureMode()) {
    const { fixtureChronicle } = await import("@/lib/fixtures");
    return fixtureChronicle(lifeId, branchId);
  }
  const res = await fetch(`/api/lives/${encodeURIComponent(lifeId)}${branchAndLangQuery(branchId, lang)}`);
  if (!res.ok) throw new Error(await readErrorMessage(res));
  return (await res.json()) as Chronicle;
}

/** GET /api/lives/:lifeId/people/:personId?branchId=&lang= — the read-only side sheet. */
export async function getPersonSheet(lifeId: string, personId: string, branchId?: string, lang?: string): Promise<PersonSheet> {
  if (fixtureMode()) {
    const { fixturePersonSheet } = await import("@/lib/fixtures");
    return fixturePersonSheet(lifeId, personId, branchId);
  }
  const res = await fetch(`/api/lives/${encodeURIComponent(lifeId)}/people/${encodeURIComponent(personId)}${branchAndLangQuery(branchId, lang)}`);
  if (!res.ok) throw new Error(await readErrorMessage(res));
  return (await res.json()) as PersonSheet;
}

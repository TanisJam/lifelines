import type { Chronicle, LifeListItem } from "@/contracts/life";
import { DEFAULT_LOCALE, type Locale } from "@/domain/locale";
import { getDb } from "./db";
import type { ChronicleResult, PersonSheetResult } from "./life-chronicle";
import { projectLifecycleChronicle, projectLifecyclePersonSheet } from "./lifecycle-projection";
import { LifecycleProjectionStore } from "./lifecycle-projection-store";
import { LifecycleRepository, type LoadedLifecycle } from "./lifecycle-repository";

/**
 * Read activation for new-engine lives (RI1d, specs S2/S8).
 *
 * DISPATCH, NEVER REWRITE. `isLifecycleLife` is the routing fact: a life with a `lifecycle_lives`
 * row is served here, and every other life keeps the legacy path in `life-chronicle.ts` with its
 * exact order of operations and error texts. A lifecycle life is never read through the legacy
 * store, and a legacy life is never read through the lifecycle repository.
 *
 * AUTHORITY. The capsule remains the only authority: it is content-addressed, and the binding row
 * owns the only (life, branch) -> capsule digest mapping. `lifecycle_lives` is a persistence fact
 * (which life exists, and on which single branch) and never a source of view-model fields.
 *
 * THE INDEX IS NOT A SECOND TRUTH. Reads consult `lifecycle_projections_v1` FIRST, keyed by that same
 * capsule digest plus the current `LIFECYCLE_VIEW_VERSION` and the request locale. A hit serves the
 * stored view and skips the simulation; a miss cold-admits and FULLY replays the capsule, then
 * indexes the result so the next read is a hit. Because the row is addressed by the digest of the
 * capsule it came from, it cannot describe a different life, and a view-logic change ships as a new
 * version instead of migrating rows. A row whose `lifeId` disagrees with the binding is a refusal.
 *
 * GAPS ARE HONEST, REFUSALS ARE NOT SWALLOWED. A projection reports the view-model fields the
 * trusted output cannot supply (see `lifecycle-projection.ts`) and that is not an error. A refusal
 * from the loader or the projection surfaces as this module's `{ error, status }` envelope, so the
 * routes keep their current response shapes instead of returning a partial or repaired view.
 */

const LIFE_NOT_FOUND = { error: "Life not found.", status: 404 } as const;
const PERSON_NOT_FOUND = { error: "Person not found.", status: 404 } as const;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The dispatch key: true only when the lifecycle tables own this life. Sync and cheap — it is an
 * existence fact, not a view, so it never needs the replay.
 */
export function isLifecycleLife(lifeId: string): boolean {
  return getDb().prepare("SELECT 1 FROM lifecycle_lives WHERE id = ?").get(lifeId) !== undefined;
}

/**
 * The one branch a lifecycle life lives on. The engine has exactly one branch, and this row records
 * which branch the binding was published for — a persistence fact, never a view-model field.
 */
function storedBranchId(lifeId: string): string | undefined {
  const row = getDb().prepare("SELECT branch_id FROM lifecycle_lives WHERE id = ?").get(lifeId) as { readonly branch_id: string } | undefined;
  return row?.branch_id;
}

type Opened =
  | { readonly kind: "life"; readonly loaded: LoadedLifecycle }
  | { readonly kind: "missing" }
  | { readonly kind: "refused"; readonly error: string };

/**
 * Resolves the life's own branch, then cold-admits and FULLY replays its capsule. A different
 * branch id is simply not this life (the engine has one branch), and a life with no row is the
 * legacy not-found. A loader refusal is returned, never retried, coerced or replaced.
 */
async function openLifecycleLife(lifeId: string, branchIdParam: string | undefined): Promise<Opened> {
  const stored = storedBranchId(lifeId);
  if (stored === undefined) return { kind: "missing" };
  const branchId = branchIdParam ?? stored;
  if (branchId !== stored) return { kind: "missing" };
  try {
    const loaded = await new LifecycleRepository(getDb()).load(lifeId, branchId);
    return loaded === undefined ? { kind: "missing" } : { kind: "life", loaded };
  } catch (error) {
    return { kind: "refused", error: messageOf(error) };
  }
}

/** The stored view, admitted only when it claims the life the binding owns. */
function storedChronicle(value: unknown, lifeId: string): Chronicle {
  const record = value as { readonly lifeId?: unknown; readonly protagonist?: Record<string, unknown> } | null;
  const protagonist = record?.protagonist;
  if (record === null || typeof record !== "object" || typeof record.lifeId !== "string"
    || protagonist === null || typeof protagonist !== "object"
    || typeof protagonist.name !== "string" || typeof protagonist.birthYear !== "number") {
    throw new Error("Corrupt lifecycle projection row");
  }
  if (record.lifeId !== lifeId) throw new Error("Lifecycle projection identity disagreement");
  return value as Chronicle;
}

/**
 * The index is an OPTIMIZATION. Any failure to read it - incompatible schema, unparseable row, a row
 * written for another life - is a miss that falls through to the replay, never a read failure. A life
 * that a replay can serve must never be made unreadable by its cache.
 */
function readIndexed(lifeId: string, branchId: string, capsuleDigest: string, locale: Locale): Chronicle | undefined {
  try {
    const store = new LifecycleProjectionStore(getDb());
    const view = store.read({ lifeId, branchId, capsuleDigest, locale });
    return view === undefined ? undefined : storedChronicle(view, lifeId);
  } catch {
    return undefined;
  }
}

/** Best-effort indexing after a successful replay: the caller already holds the derived view. */
function indexView(lifeId: string, branchId: string, capsuleDigest: string, locale: Locale, view: Chronicle): void {
  try {
    new LifecycleProjectionStore(getDb()).write({ lifeId, branchId, capsuleDigest }, [{ locale, view }]);
  } catch {
    // A cache that cannot write is a slower read, not a failed one.
  }
}

type Indexed =
  | { readonly kind: "view"; readonly view: Chronicle }
  | { readonly kind: "life"; readonly loaded: LoadedLifecycle }
  | { readonly kind: "missing" }
  | { readonly kind: "refused"; readonly error: string };

/** Index-first open: the stored view when the digest and version address one, the replay otherwise. */
async function openChronicleView(lifeId: string, branchIdParam: string | undefined, locale: Locale): Promise<Indexed> {
  const stored = storedBranchId(lifeId);
  if (stored === undefined) return { kind: "missing" };
  const branchId = branchIdParam ?? stored;
  if (branchId !== stored) return { kind: "missing" };
  const repository = new LifecycleRepository(getDb());
  try {
    const binding = repository.binding(lifeId, branchId);
    if (binding === undefined) return { kind: "missing" };
    const indexed = readIndexed(lifeId, branchId, binding.capsuleDigest, locale);
    if (indexed !== undefined) return { kind: "view", view: indexed };
    const loaded = await repository.load(lifeId, branchId);
    return loaded === undefined ? { kind: "missing" } : { kind: "life", loaded };
  } catch (error) {
    return { kind: "refused", error: messageOf(error) };
  }
}

function listItemOf(view: Chronicle): LifeListItem {
  const protagonist = view.protagonist;
  return {
    lifeId: view.lifeId,
    name: protagonist.name,
    birthYear: protagonist.birthYear,
    deathYear: protagonist.deathYear,
    ageAtDeath: protagonist.ageAtDeath,
    causeOfDeath: protagonist.causeOfDeath,
    ...(protagonist.horizonYear === undefined ? {} : { horizonYear: protagonist.horizonYear }),
    branchCount: 1,
  };
}

/** `GET /api/lives/:lifeId?branchId=&lang=`: the indexed view, or one cold replay that indexes itself. */
export async function buildLifecycleChronicle(lifeId: string, branchId?: string, locale: Locale = DEFAULT_LOCALE): Promise<ChronicleResult> {
  const opened = await openChronicleView(lifeId, branchId, locale);
  if (opened.kind === "missing") return { ...LIFE_NOT_FOUND };
  if (opened.kind === "refused") return { error: opened.error, status: 500 };
  if (opened.kind === "view") return { data: opened.view };
  const { loaded } = opened;
  try {
    const projection = await projectLifecycleChronicle({
      source: { genesis: loaded.capsule.genesis, output: loaded.capsule.output },
      // Route identity, copied from the binding this replay was keyed by — never derived from data.
      identity: { lifeId: loaded.binding.lifeId, branchId: loaded.binding.branchId },
      locale,
    });
    indexView(loaded.binding.lifeId, loaded.binding.branchId, loaded.binding.capsuleDigest, locale, projection.view);
    return { data: projection.view };
  } catch (error) {
    return { error: messageOf(error), status: 500 };
  }
}

/** `GET /api/lives/:lifeId/people/:personId?branchId=&lang=` for a lifecycle life. */
export async function buildLifecyclePersonSheet(
  lifeId: string,
  personId: string,
  branchId?: string,
  locale: Locale = DEFAULT_LOCALE,
): Promise<PersonSheetResult> {
  const opened = await openLifecycleLife(lifeId, branchId);
  if (opened.kind === "missing") return { ...LIFE_NOT_FOUND };
  if (opened.kind === "refused") return { error: opened.error, status: 500 };
  const { loaded } = opened;
  // Existence is read from the same regenerated output the sheet is derived from: an unknown person
  // is the honest legacy not-found, never a fabricated sheet.
  if (!Object.hasOwn(loaded.capsule.output.owned.people, personId)) return { ...PERSON_NOT_FOUND };
  try {
    const projection = await projectLifecyclePersonSheet({
      source: { genesis: loaded.capsule.genesis, output: loaded.capsule.output },
      personId,
      locale,
    });
    return { data: projection.view };
  } catch (error) {
    return { error: messageOf(error), status: 500 };
  }
}

/**
 * `GET /api/lives`'s lifecycle rows: one per lifecycle life, newest first by the life's own
 * `created_at`. Every field comes from that life's own full replay, and `branchCount` is `1` because
 * the engine makes exactly one branch — never an invented count. `causeOfDeath` is the projection's
 * display text, produced by the same `deathCauseDisplay` mapping the legacy list uses today. A life
 * alive at its horizon keeps an explicit `null` in every death field plus its `horizonYear` (spec
 * S5); a completed life carries its own death and no horizon year. A refusal propagates: a listing
 * that cannot be regenerated is not quietly dropped or filled from the stored row.
 */
export async function listLifecycleSummaries(locale: Locale = DEFAULT_LOCALE): Promise<LifeListItem[]> {
  const rows = getDb()
    .prepare("SELECT id, branch_id FROM lifecycle_lives ORDER BY created_at DESC, rowid DESC")
    .all() as { readonly id: string; readonly branch_id: string }[];
  const repository = new LifecycleRepository(getDb());
  const items: LifeListItem[] = [];
  for (const row of rows) {
    const binding = repository.binding(row.id, row.branch_id);
    if (binding === undefined) throw new Error(`Missing lifecycle capsule for ${row.id}`);
    const indexed = readIndexed(row.id, binding.branchId, binding.capsuleDigest, locale);
    if (indexed !== undefined) {
      items.push(listItemOf(indexed));
      continue;
    }
    const loaded = await repository.load(row.id, row.branch_id);
    if (loaded === undefined) throw new Error(`Missing lifecycle capsule for ${row.id}`);
    const projection = await projectLifecycleChronicle({
      source: { genesis: loaded.capsule.genesis, output: loaded.capsule.output },
      identity: { lifeId: loaded.binding.lifeId, branchId: loaded.binding.branchId },
      locale,
    });
    indexView(loaded.binding.lifeId, loaded.binding.branchId, loaded.binding.capsuleDigest, locale, projection.view);
    items.push(listItemOf(projection.view));
  }
  return items;
}

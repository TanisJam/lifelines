import type { LifeListItem } from "@/contracts/life";
import { DEFAULT_LOCALE, type Locale } from "@/domain/locale";
import { getDb } from "./db";
import type { ChronicleResult, PersonSheetResult } from "./life-chronicle";
import { projectLifecycleChronicle, projectLifecyclePersonSheet, projectLifecycleProtagonist } from "./lifecycle-projection";
import { LifecycleRepository, type LoadedLifecycle } from "./lifecycle-repository";

/**
 * Read activation for new-engine lives (RI1d, specs S2/S8).
 *
 * DISPATCH, NEVER REWRITE. `isLifecycleLife` is the routing fact: a life with a `lifecycle_lives`
 * row is served here, and every other life keeps the legacy path in `life-chronicle.ts` with its
 * exact order of operations and error texts. A lifecycle life is never read through the legacy
 * store, and a legacy life is never read through the lifecycle repository.
 *
 * AUTHORITY. Nothing stored is authority here. Each read cold-admits the capsule and FULLY replays
 * every year through `LifecycleRepository.load`, then derives the view from that regenerated output.
 * The `lifecycle_lives` row is a persistence fact (which life exists, and on which single branch it
 * lives) and never a source of view-model fields: a forged name or config there changes nothing
 * served. The same digest/byte discipline applies in both directions — a payload that disagrees with
 * regeneration is a refusal, never a repair.
 *
 * GAPS ARE HONEST, REFUSALS ARE NOT SWALLOWED. A projection reports the view-model fields the
 * trusted output cannot supply (see `lifecycle-projection.ts`) and that is not an error. A refusal
 * from the loader or the projection surfaces as this module's `{ error, status }` envelope, so the
 * routes keep their current response shapes instead of returning a partial or repaired view.
 *
 * NO CACHE, DELIBERATELY. Nothing here memoizes a replay or stores a projection; a list request
 * replays every lifecycle life it lists. This read is correct rather than fast, by decision: a
 * stored projection would be a second source of truth for what happened.
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

/** `GET /api/lives/:lifeId?branchId=&lang=` for a lifecycle life, from its regenerated capsule only. */
export async function buildLifecycleChronicle(lifeId: string, branchId?: string, locale: Locale = DEFAULT_LOCALE): Promise<ChronicleResult> {
  const opened = await openLifecycleLife(lifeId, branchId);
  if (opened.kind === "missing") return { ...LIFE_NOT_FOUND };
  if (opened.kind === "refused") return { error: opened.error, status: 500 };
  const { loaded } = opened;
  try {
    const projection = await projectLifecycleChronicle({
      source: { genesis: loaded.capsule.genesis, output: loaded.capsule.output },
      // Route identity, copied from the binding this replay was keyed by — never derived from data.
      identity: { lifeId: loaded.binding.lifeId, branchId: loaded.binding.branchId },
      locale,
    });
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
 * display text, produced by the same `deathCauseDisplay` mapping the legacy list uses today. A
 * refusal propagates: a listing that cannot be regenerated is not quietly dropped or filled from the
 * stored row.
 */
export async function listLifecycleSummaries(locale: Locale = DEFAULT_LOCALE): Promise<LifeListItem[]> {
  const rows = getDb()
    .prepare("SELECT id, branch_id FROM lifecycle_lives ORDER BY created_at DESC, rowid DESC")
    .all() as { readonly id: string; readonly branch_id: string }[];
  const repository = new LifecycleRepository(getDb());
  const items: LifeListItem[] = [];
  for (const row of rows) {
    const loaded = await repository.load(row.id, row.branch_id);
    if (loaded === undefined) throw new Error(`Missing lifecycle capsule for ${row.id}`);
    const protagonist = projectLifecycleProtagonist({
      source: { genesis: loaded.capsule.genesis, output: loaded.capsule.output },
      locale,
    }).view;
    items.push({
      lifeId: loaded.binding.lifeId,
      name: protagonist.name,
      birthYear: protagonist.birthYear,
      deathYear: protagonist.deathYear,
      ageAtDeath: protagonist.ageAtDeath,
      causeOfDeath: protagonist.causeOfDeath,
      branchCount: 1,
    });
  }
  return items;
}

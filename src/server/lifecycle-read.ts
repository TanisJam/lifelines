import type { Chronicle, LifeListItem, PersonSheet } from "@/contracts/life";
import { DEFAULT_LOCALE, LOCALES, type Locale } from "@/domain/locale";
import { getDictionary } from "@/i18n/get-dictionary";
import { getDb, withTransaction } from "./db";
import type { ChronicleResult, PersonSheetResult } from "./life-chronicle";
import { projectLifecycleChronicle, projectLifecyclePersonSheet } from "./lifecycle-projection";
import { LifecyclePersonSheetStore, LifecycleProjectionStore } from "./lifecycle-projection-store";
import { LifecycleRepository, loadStoredLifecycleFork, type LifecycleBranchBinding, type LifecycleForkBranchBinding } from "./lifecycle-repository";
import { LifecycleBranchStore } from "./lifecycle-branch-store";
import type { LifecycleProjectionSource } from "./lifecycle-projection";
import { deserializeCompactLifecycleDag } from "../domain/e-lifecycle-dag";
import { admitLifecycleGenesis } from "../domain/e-lifecycle-genesis";
import { deserializeLifecycleCompactCapsule } from "../domain/e-lifecycle-capsule";

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
 * (which life exists, and which branch is its root) and never a source of view-model fields.
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
const BRANCH_NOT_FOUND = { error: "Branch not found.", status: 404 } as const;
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

type BranchBinding = LifecycleBranchBinding | LifecycleForkBranchBinding;
type BranchEntry = {
  readonly branchId: string; readonly binding: BranchBinding; readonly publishOrder: number;
  readonly parentDigest?: string; readonly forkYear?: number; readonly decisionId?: string; readonly optionId?: string;
};
type Resolution = { readonly kind: "life-missing" } | { readonly kind: "branch-missing" } | {
  readonly kind: "found"; readonly selected: BranchEntry; readonly branches: readonly BranchEntry[];
};

/** Resolve the complete committed ancestry, retaining publication order for latest selection. */
export function resolveLifecycleBranch(lifeId: string, branchId?: string): Resolution {
  const db = getDb();
  const root = db.prepare("SELECT branch_id FROM lifecycle_lives WHERE id = ?").get(lifeId);
  if (!root) return { kind: "life-missing" };
  const repository = new LifecycleRepository(db);
  const store = new LifecycleBranchStore(db);
  const rootId = String(root.branch_id);
  const binding = repository.binding(lifeId, rootId);
  if (!binding) throw new Error("Missing lifecycle root binding");
  // Even a warm derived view cannot substitute for a missing canonical row.
  const key = Buffer.from(binding.capsuleDigest, "utf16le");
  const rootV2 = db.prepare("SELECT genesis_table, max_steps FROM lifecycle_capsules_v2 WHERE key = ?").get(key);
  if (rootV2) {
    if (typeof rootV2.genesis_table !== "string" || typeof rootV2.max_steps !== "number" || !Number.isSafeInteger(rootV2.max_steps) || rootV2.max_steps < 0 ||
      admitLifecycleGenesis(deserializeCompactLifecycleDag(rootV2.genesis_table)).digest !== binding.genesisDigest) {
      throw new Error("Lifecycle binding/capsule disagreement");
    }
  } else if (!db.prepare("SELECT 1 FROM lifecycle_capsules_v1 WHERE key = ?").get(key)) {
    throw new Error("Missing lifecycle capsule");
  }
  const branches: BranchEntry[] = [{ branchId: rootId, binding, publishOrder: 0 }];
  const queue = [binding.genesisDigest];
  const seen = new Set(queue);
  for (let i = 0; i < queue.length; i++) {
    for (const row of store.children(lifeId, queue[i])) {
      const id = String(row.branch_id), digest = String(row.digest);
      const forkBinding = store.binding(lifeId, id);
      if (!forkBinding || forkBinding.capsuleDigest !== digest || forkBinding.genesisDigest !== binding.genesisDigest || seen.has(digest) || id === rootId) {
        throw new Error("Corrupt lifecycle branch ancestry");
      }
      seen.add(digest);
      queue.push(digest);
      branches.push({ branchId: id, binding: forkBinding, publishOrder: Number(row.publish_order),
        parentDigest: String(row.parent_digest), forkYear: Number(row.fork_year),
        decisionId: String(row.decision_id), optionId: String(row.option_id) });
    }
  }
  const count = db.prepare("SELECT count(*) AS count FROM lifecycle_forks_v1 WHERE life_id = ?").get(lifeId);
  if (Number(count?.count) !== branches.length - 1) throw new Error("Corrupt lifecycle branch ancestry");
  branches.sort((a, b) => a.publishOrder - b.publishOrder);
  const selected = branchId === undefined ? branches[branches.length - 1] : branches.find(branch => branch.branchId === branchId);
  return selected ? { kind: "found", selected, branches } : { kind: "branch-missing" };
}

/** Validate canonical envelopes even on cache hits; full root replay runs on a miss. */
async function checkFork(lifeId: string, binding: BranchBinding): Promise<unknown | undefined> {
  if (binding.version !== "canonical-lifecycle-fork-binding-v1") {
    const key = Buffer.from(binding.capsuleDigest, "utf16le");
    const db = getDb();
    if (!db.prepare("SELECT 1 FROM lifecycle_capsules_v2 WHERE key = ?").get(key)) {
      const row = db.prepare("SELECT wire FROM lifecycle_capsules_v1 WHERE key = ?").get(key);
      if (!row || !(row.wire instanceof Uint8Array) || row.wire.byteLength % 2) throw new Error("Corrupt lifecycle capsule");
      const capsule = await deserializeLifecycleCompactCapsule(Buffer.from(row.wire).toString("utf16le"));
      if (capsule.digest !== binding.capsuleDigest || capsule.genesis.digest !== binding.genesisDigest || capsule.manifest.capsuleSchema !== binding.capsuleSchema) {
        throw new Error("Lifecycle binding/capsule disagreement");
      }
    }
    return undefined;
  }
  const store = new LifecycleBranchStore(getDb());
  const stored = await store.resolve(lifeId, binding.capsuleDigest);
  if (!stored) throw new Error("Missing lifecycle fork capsule");
  await loadStoredLifecycleFork(binding, stored.capsule, digest => store.resolve(lifeId, digest));
  return stored.capsule;
}

async function loadBranch(lifeId: string, binding: BranchBinding, capsule?: unknown) {
  if (binding.version !== "canonical-lifecycle-fork-binding-v1") {
    const loaded = await new LifecycleRepository(getDb()).load(lifeId, binding.branchId);
    if (!loaded) throw new Error("Missing lifecycle capsule");
    return loaded;
  }
  const store = new LifecycleBranchStore(getDb());
  const stored = capsule ?? (await store.resolve(lifeId, binding.capsuleDigest))?.capsule;
  if (!stored) throw new Error("Missing lifecycle fork capsule");
  return loadStoredLifecycleFork(binding, stored, digest => store.resolve(lifeId, digest));
}

/** The stored view, admitted only when it claims the life the binding owns. */
function storedChronicle(value: unknown, lifeId: string, branchId: string): Chronicle {
  const record = value as { readonly lifeId?: unknown; readonly branchId?: unknown; readonly protagonist?: Record<string, unknown> } | null;
  const protagonist = record?.protagonist;
  if (record === null || typeof record !== "object" || typeof record.lifeId !== "string"
    || protagonist === null || typeof protagonist !== "object"
    || typeof protagonist.name !== "string" || typeof protagonist.birthYear !== "number") {
    throw new Error("Corrupt lifecycle projection row");
  }
  if (record.lifeId !== lifeId || record.branchId !== branchId) throw new Error("Lifecycle projection identity disagreement");
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
    return view === undefined ? undefined : storedChronicle(view, lifeId, branchId);
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

/**
 * The COMPLETE indexed sheet set of one life and locale, or undefined when it cannot be trusted.
 *
 * "Cannot be trusted" covers both an absent index and a partial one: the store only answers when its
 * completeness marker agrees with the stored row count. Treating any non-empty set as complete is what
 * turned one missing row into a 404 for a person who exists, which is never an acceptable answer.
 */
function readIndexedSheets(lifeId: string, branchId: string, capsuleDigest: string, locale: Locale): Map<string, unknown> | undefined {
  try {
    return new LifecyclePersonSheetStore(getDb()).readComplete({ lifeId, branchId, capsuleDigest, locale });
  } catch {
    return undefined;
  }
}

/**
 * Best-effort indexing after a successful regeneration: the caller already holds the derived sheets.
 * The write runs in ONE transaction so a failure leaves no rows at all - a partial set with no
 * completeness marker reads as a miss and heals again, while a partial set that was committed would
 * have looked complete and answered 404s forever.
 */
function indexSheets(
  lifeId: string, branchId: string, capsuleDigest: string,
  sheets: readonly { readonly locale: Locale; readonly personId: string; readonly view: unknown }[],
): void {
  try {
    const db = getDb();
    withTransaction(db, () => new LifecyclePersonSheetStore(db).write(
      { lifeId, branchId, capsuleDigest }, sheets, { replace: true }));
  } catch {
    // Rolled back: a cache that cannot write is a slower read, not a failed one.
  }
}

type Indexed =
  | { readonly kind: "view"; readonly view: Chronicle; readonly branches: readonly BranchEntry[] }
  | { readonly kind: "life"; readonly source: LifecycleProjectionSource; readonly binding: BranchBinding; readonly branches: readonly BranchEntry[] }
  | { readonly kind: "life-missing" }
  | { readonly kind: "branch-missing" }
  | { readonly kind: "refused"; readonly error: string };

async function openChronicleView(lifeId: string, branchId: string | undefined, locale: Locale): Promise<Indexed> {
  try {
    const resolved = resolveLifecycleBranch(lifeId, branchId);
    if (resolved.kind !== "found") return resolved;
    const binding = resolved.selected.binding;
    const capsule = await checkFork(lifeId, binding);
    const indexed = readIndexed(lifeId, binding.branchId, binding.capsuleDigest, locale);
    if (indexed !== undefined) return { kind: "view", view: indexed, branches: resolved.branches };
    const loaded = await loadBranch(lifeId, binding, capsule);
    new LifecycleBranchStore(getDb()).prepareDecisionsFromLoaded(lifeId, binding.branchId, binding.capsuleDigest, loaded);
    return { kind: "life", binding, branches: resolved.branches, source: { genesis: loaded.capsule.genesis, output: loaded.capsule.output } as LifecycleProjectionSource };
  } catch (error) {
    return { kind: "refused", error: messageOf(error) };
  }
}

function listItemOf(view: Chronicle, branchCount: number): LifeListItem {
  const protagonist = view.protagonist;
  return {
    lifeId: view.lifeId, name: protagonist.name, birthYear: protagonist.birthYear,
    deathYear: protagonist.deathYear, ageAtDeath: protagonist.ageAtDeath, causeOfDeath: protagonist.causeOfDeath,
    ...(protagonist.horizonYear === undefined ? {} : { horizonYear: protagonist.horizonYear }), branchCount,
  };
}

function composeBranches(view: Chronicle, entries: readonly BranchEntry[], locale: Locale): Chronicle {
  const labels = getDictionary(locale).chronicle;
  const byDigest = new Map(entries.map(entry => [entry.publishOrder === 0 ? entry.binding.genesisDigest : entry.binding.capsuleDigest, entry.branchId]));
  return { ...view, branches: entries.map(entry => {
    const parentBranchId = entry.parentDigest === undefined ? null : byDigest.get(entry.parentDigest);
    if (parentBranchId === undefined) throw new Error("Corrupt lifecycle branch ancestry");
    const forkYear = entry.forkYear ?? null;
    return { branchId: entry.branchId, parentBranchId, forkYear, label: forkYear === null ? labels.originalLife : labels.changedInYear(forkYear) };
  }) };
}

/** `GET /api/lives/:lifeId?branchId=&lang=`: the indexed view, or one cold replay that indexes itself. */
export async function buildLifecycleChronicle(lifeId: string, branchId?: string, locale: Locale = DEFAULT_LOCALE): Promise<ChronicleResult> {
  const opened = await openChronicleView(lifeId, branchId, locale);
  if (opened.kind === "life-missing") return { ...LIFE_NOT_FOUND };
  if (opened.kind === "branch-missing") return { ...BRANCH_NOT_FOUND };
  if (opened.kind === "refused") return { error: opened.error, status: 500 };
  if (opened.kind === "view") return { data: composeBranches(opened.view, opened.branches, locale) };
  const { source, binding } = opened;
  try {
    const projection = await projectLifecycleChronicle({
      source,
      // Route identity, copied from the binding this replay was keyed by — never derived from data.
      identity: { lifeId: binding.lifeId, branchId: binding.branchId },
      locale,
    });
    indexView(binding.lifeId, binding.branchId, binding.capsuleDigest, locale, projection.view);
    return { data: composeBranches(projection.view, opened.branches, locale) };
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
  let binding: BranchBinding;
  let capsule: unknown;
  try {
    const resolved = resolveLifecycleBranch(lifeId, branchId);
    if (resolved.kind === "life-missing") return { ...LIFE_NOT_FOUND };
    if (resolved.kind === "branch-missing") return { ...BRANCH_NOT_FOUND };
    binding = resolved.selected.binding;
    capsule = await checkFork(lifeId, binding);
  } catch (error) {
    return { error: messageOf(error), status: 500 };
  }
  const branch = binding.branchId;

  // Index-first: a life published with its sheets never regenerates a year to answer this.
  const indexed = readIndexedSheets(lifeId, branch, binding.capsuleDigest, locale);
  if (indexed !== undefined) {
    const sheet = indexed.get(personId);
    // Rows exist for this life and locale, so an absent id means the person is genuinely not in it.
    return sheet === undefined ? { ...PERSON_NOT_FOUND } : { data: sheet as PersonSheet };
  }

  // Cold: this life predates the sheet index (or its rows were never written). ONE regeneration heals
  // every locale at once, which is the same bounded cost the chronicle miss already pays.
  let loaded: Awaited<ReturnType<typeof loadBranch>>;
  try {
    loaded = await loadBranch(lifeId, binding, capsule);
  } catch (error) {
    return { error: messageOf(error), status: 500 };
  }
  // Existence is read from the same regenerated output the sheet is derived from: an unknown person
  // is the honest legacy not-found, never a fabricated sheet.
  if (!Object.hasOwn(loaded.capsule.output.owned.people, personId)) return { ...PERSON_NOT_FOUND };
  const source = { genesis: loaded.capsule.genesis, output: loaded.capsule.output } as LifecycleProjectionSource;
  try {
    const sheets: { locale: Locale; personId: string; view: unknown }[] = [];
    for (const target of LOCALES) {
      for (const id of Object.keys(loaded.capsule.output.owned.people)) {
        sheets.push({ locale: target, personId: id,
          view: (await projectLifecyclePersonSheet({ source, personId: id, locale: target })).view });
      }
    }
    indexSheets(loaded.binding.lifeId, loaded.binding.branchId, loaded.binding.capsuleDigest, sheets);
    const sheet = sheets.find((entry) => entry.locale === locale && entry.personId === personId);
    return sheet === undefined ? { ...PERSON_NOT_FOUND } : { data: sheet.view as PersonSheet };
  } catch (error) {
    return { error: messageOf(error), status: 500 };
  }
}

/** List each life's latest committed branch and its actual branch count. */
export async function listLifecycleSummaries(locale: Locale = DEFAULT_LOCALE): Promise<LifeListItem[]> {
  const rows = getDb().prepare("SELECT id FROM lifecycle_lives ORDER BY created_at DESC, rowid DESC").all();
  const items: LifeListItem[] = [];
  for (const row of rows) {
    const lifeId = String(row.id);
    const resolved = resolveLifecycleBranch(lifeId);
    if (resolved.kind !== "found") throw new Error(`Missing lifecycle life ${lifeId}`);
    const opened = await openChronicleView(lifeId, resolved.selected.branchId, locale);
    if (opened.kind === "refused") throw new Error(opened.error);
    if (opened.kind === "life-missing" || opened.kind === "branch-missing") throw new Error(`Missing lifecycle capsule for ${lifeId}`);
    if (opened.kind === "view") {
      items.push(listItemOf(opened.view, resolved.branches.length));
    } else {
      const { binding, source } = opened;
      const projection = await projectLifecycleChronicle({ source, identity: { lifeId, branchId: binding.branchId }, locale });
      indexView(lifeId, binding.branchId, binding.capsuleDigest, locale, projection.view);
      items.push(listItemOf(projection.view, resolved.branches.length));
    }
  }
  return items;
}

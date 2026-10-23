import type { DatabaseSync, StatementSync } from "node:sqlite";
import { isLocale, type Locale } from "../domain/locale";

/**
 * Persistence for the DERIVED chronicle view of a lifecycle life (task P3).
 *
 * THIS IS AN INDEX, NOT AUTHORITY. The capsule stays the only authority for what happened, and the
 * binding row owns the only (life, branch) -> capsule digest mapping.
 *
 * WHY THE KEY IS THE LIFE, NOT THE DIGEST. A capsule is content-addressed, so two lives created from
 * the same seed, name and sex produce IDENTICAL capsule bytes and therefore the same digest. The
 * derived view is not identical though: it embeds the route's (lifeId, branchId). Keying by the digest
 * alone made every later life collide with the first one's rows. The primary key is therefore the life
 * identity, and `capsule_digest` is stored and VERIFIED on read so a row can never outlive a different
 * capsule for that life.
 *
 * `LIFECYCLE_VIEW_VERSION` invalidates the index when the projection logic changes. It is part of the
 * primary key and never UPDATEd: a new view ships as new rows and the old rows stop being selected.
 *
 * What this buys: a read stops re-executing the simulation. What it costs: the stored view is not
 * authenticated beyond its digest column, so anyone with WRITE access to this database can forge one.
 * The capsule path could not be forged that way, because every read replayed it. That trade is the
 * deliberate point of the task, and it is only sound because SQLite file access is already the trust
 * boundary for the stored capsules, bindings and protagonist rows.
 */
export const LIFECYCLE_VIEW_VERSION = "lifecycle-chronicle-view-1" as const;
export const LIFECYCLE_VIEW_TABLE = "lifecycle_projections_v1";

/**
 * Person sheets are indexed separately from the chronicle (task P9).
 *
 * They cannot be derived from the chronicle view: a sheet needs the person's own record (job, birth and
 * death years, `mind` for the portrait) and the whole event list to narrate a timeline, and the chronicle
 * keeps only the entries it chose to tell. Indexing the sheets themselves costs ~0.2 ms and ~400 B per
 * person because the replay is already in memory at publish time, which is what keeps the LAST replaying
 * read path off the request path.
 *
 * Separate table and separate version on purpose: a chronicle-only change must not invalidate 125 sheet
 * rows per life, and a sheet change must not invalidate the chronicle.
 */
export const LIFECYCLE_PERSON_SHEET_VIEW_VERSION = "lifecycle-person-sheet-view-1" as const;
export const LIFECYCLE_PERSON_SHEET_TABLE = "lifecycle_person_sheets_v1";
export const LIFECYCLE_PERSON_SHEET_SETS_TABLE = "lifecycle_person_sheet_sets_v1";

const columns = `(
  life_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  view_version TEXT NOT NULL,
  locale TEXT NOT NULL,
  capsule_digest TEXT NOT NULL,
  view_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (life_id, branch_id, view_version, locale)
) STRICT`;
const schema = `CREATE TABLE ${LIFECYCLE_VIEW_TABLE} ${columns}`;
const personColumns = `(
  life_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  view_version TEXT NOT NULL,
  locale TEXT NOT NULL,
  person_id TEXT NOT NULL,
  capsule_digest TEXT NOT NULL,
  view_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (life_id, branch_id, view_version, locale, person_id)
) STRICT`;
const personSchema = `CREATE TABLE ${LIFECYCLE_PERSON_SHEET_TABLE} ${personColumns}`;
/**
 * One completeness marker per (life, branch, view version, locale), written in the SAME transaction as
 * the sheets it describes and AFTER them.
 *
 * Without it, "this locale has some rows" was read as "this locale is complete", so a single missing
 * row - a failed heal on a full disk, a manual DELETE - made a real person answer 404 without ever
 * regenerating. The count is what makes a partial index self-identify as partial, independent of how
 * it got that way.
 */
const personSetColumns = `(
  life_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  view_version TEXT NOT NULL,
  locale TEXT NOT NULL,
  capsule_digest TEXT NOT NULL,
  person_count INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (life_id, branch_id, view_version, locale)
) STRICT`;
const personSetSchema = `CREATE TABLE ${LIFECYCLE_PERSON_SHEET_SETS_TABLE} ${personSetColumns}`;
const normalizeSql = (sql: string) => sql.replace(/\s+/g, " ").trim().toLowerCase();

export interface LifecycleViewKey {
  readonly lifeId: string;
  readonly branchId: string;
  readonly capsuleDigest: string;
  readonly locale: Locale;
}

/** One locale's view to index. `view` is the exact `Chronicle` the read route would otherwise derive. */
export interface LifecycleProjectionWrite {
  readonly locale: Locale;
  readonly view: unknown;
}

/**
 * Accepts only this exact versioned physical schema, mirroring `lifecycle_capsules_v1`: a similar
 * table with extra columns, triggers, indexes or a different type is refused rather than reused.
 */
function ensureSchema(db: DatabaseSync, table: string, columnsSql: string, expectedSql: string): void {
  const existing = db.prepare("SELECT type, sql FROM main.sqlite_schema WHERE name = ?").get(table) as
    { readonly type?: string; readonly sql?: string } | undefined;
  if (existing === undefined) { db.exec(`CREATE TABLE main.${table} ${columnsSql}`); return; }
  if (existing.type !== "table" || typeof existing.sql !== "string"
    || normalizeSql(existing.sql) !== normalizeSql(expectedSql)) {
    throw new Error(`Incompatible ${table} schema`);
  }
}

export class LifecycleProjectionStore {
  private readonly select: StatementSync;
  private readonly insert: StatementSync;

  constructor(private readonly db: DatabaseSync) {
    ensureSchema(db, LIFECYCLE_VIEW_TABLE, columns, schema);
    this.select = db.prepare(
      `SELECT capsule_digest, view_json FROM main.${LIFECYCLE_VIEW_TABLE}
       WHERE life_id = ? AND branch_id = ? AND view_version = ? AND locale = ?`);
    this.insert = db.prepare(
      `INSERT INTO main.${LIFECYCLE_VIEW_TABLE}
         (life_id, branch_id, view_version, locale, capsule_digest, view_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(life_id, branch_id, view_version, locale) DO NOTHING`);
  }

  /**
   * The indexed view for exactly this life and locale, or undefined when absent. A row carrying a
   * different capsule digest cannot belong to this life any more, so it reads as a miss instead of
   * being served or thrown.
   */
  read(key: LifecycleViewKey): unknown {
    const row = this.select.get(key.lifeId, key.branchId, LIFECYCLE_VIEW_VERSION, key.locale) as
      { readonly capsule_digest?: unknown; readonly view_json?: unknown } | undefined;
    if (row === undefined) return undefined;
    if (row.capsule_digest !== key.capsuleDigest || typeof row.view_json !== "string") return undefined;
    return JSON.parse(row.view_json);
  }

  /** Index one life's views. Repeat writes are no-ops: the first admitted bytes win. */
  write(key: Omit<LifecycleViewKey, "locale">, views: readonly LifecycleProjectionWrite[]): void {
    const now = Date.now();
    for (const { locale, view } of views) {
      if (!isLocale(locale)) throw new Error(`Unsupported lifecycle projection locale: ${String(locale)}`);
      this.insert.run(key.lifeId, key.branchId, LIFECYCLE_VIEW_VERSION, locale, key.capsuleDigest,
        JSON.stringify(view), now);
    }
  }
}

/** One person's sheet to index. `view` is the exact `PersonSheet` the route would otherwise derive. */
export interface LifecyclePersonSheetWrite {
  readonly locale: Locale;
  readonly personId: string;
  readonly view: unknown;
}

export interface LifecyclePersonSheetKey extends Omit<LifecycleViewKey, "locale"> {
  readonly locale: Locale;
}

/**
 * The indexed person sheets of one life (task P9).
 *
 * Read here returns the WHOLE sheet set for a locale rather than a single person, because the caller
 * needs one query to answer both questions that matter: "is this life indexed at all?" (no rows means
 * the life predates this view and one cold regeneration must heal it) and "does this person exist?"
 * (rows exist, this id is not among them, so the legacy 404 is the honest answer). Answering those two
 * from separate lookups would let a half-written index report a real person as missing.
 *
 * Like the chronicle index this is an optimization, never authority: the capsule stays the only
 * authority, rows are keyed by the ADMITTED capsule digest, and a row whose digest no longer matches
 * reads as a miss.
 */
export class LifecyclePersonSheetStore {
  private readonly selectAll: StatementSync;
  private readonly selectSet: StatementSync;
  private readonly insert: StatementSync;
  private readonly replace: StatementSync;
  private readonly insertSet: StatementSync;
  private readonly replaceSet: StatementSync;

  constructor(private readonly db: DatabaseSync) {
    ensureSchema(db, LIFECYCLE_PERSON_SHEET_TABLE, personColumns, personSchema);
    ensureSchema(db, LIFECYCLE_PERSON_SHEET_SETS_TABLE, personSetColumns, personSetSchema);
    this.selectSet = db.prepare(
      `SELECT capsule_digest, person_count FROM main.${LIFECYCLE_PERSON_SHEET_SETS_TABLE}
       WHERE life_id = ? AND branch_id = ? AND view_version = ? AND locale = ?`);
    this.insertSet = db.prepare(
      `INSERT INTO main.${LIFECYCLE_PERSON_SHEET_SETS_TABLE}
         (life_id, branch_id, view_version, locale, capsule_digest, person_count, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(life_id, branch_id, view_version, locale) DO NOTHING`);
    // The marker must follow the same rule as the rows it describes. With DO NOTHING the heal could
    // replace every row and still leave a marker carrying a stale digest, so the locale would miss and
    // re-regenerate the whole life on every single read - the cost this index exists to remove.
    this.replaceSet = db.prepare(
      `INSERT OR REPLACE INTO main.${LIFECYCLE_PERSON_SHEET_SETS_TABLE}
         (life_id, branch_id, view_version, locale, capsule_digest, person_count, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`);
    this.selectAll = db.prepare(
      `SELECT person_id, view_json FROM main.${LIFECYCLE_PERSON_SHEET_TABLE}
       WHERE life_id = ? AND branch_id = ? AND view_version = ? AND locale = ? AND capsule_digest = ?
       ORDER BY person_id`);
    this.insert = db.prepare(
      `INSERT INTO main.${LIFECYCLE_PERSON_SHEET_TABLE}
         (life_id, branch_id, view_version, locale, person_id, capsule_digest, view_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(life_id, branch_id, view_version, locale, person_id) DO NOTHING`);
    this.replace = db.prepare(
      `INSERT OR REPLACE INTO main.${LIFECYCLE_PERSON_SHEET_TABLE}
         (life_id, branch_id, view_version, locale, person_id, capsule_digest, view_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  }

  /**
   * Every indexed sheet of this life and locale, in person-id order. An EMPTY map means "not indexed",
   * and the caller may regenerate - never "this life has no people", which the routes treat as a miss
   * when it would otherwise turn a stale index into a wrong 404 for every person.
   */
  readAll(key: LifecyclePersonSheetKey): Map<string, unknown> {
    const rows = this.selectAll.all(key.lifeId, key.branchId, LIFECYCLE_PERSON_SHEET_VIEW_VERSION, key.locale,
      key.capsuleDigest) as { readonly person_id?: unknown; readonly view_json?: unknown }[];
    const sheets = new Map<string, unknown>();
    for (const row of rows) {
      if (typeof row.person_id !== "string" || typeof row.view_json !== "string") {
        throw new Error("Corrupt lifecycle person sheet row");
      }
      const view = JSON.parse(row.view_json) as { readonly personId?: unknown } | null;
      // A row that claims a different person than its key is refused, never served under that key.
      if (view === null || typeof view !== "object" || view.personId !== row.person_id) {
        throw new Error("Lifecycle person sheet identity disagreement");
      }
      sheets.set(row.person_id, view);
    }
    return sheets;
  }

  /**
   * The set only when its marker says it is COMPLETE and the stored row count agrees with it, else
   * undefined. This is the read-side answer to "may I trust these rows?", and it must never be
   * replaced by `size !== 0`: a partial set that answers reads turns a missing row into a 404 for a
   * person who exists.
   */
  readComplete(key: LifecyclePersonSheetKey): Map<string, unknown> | undefined {
    const sheets = this.readAll(key);
    if (sheets.size === 0) return undefined;
    const marker = this.selectSet.get(key.lifeId, key.branchId, LIFECYCLE_PERSON_SHEET_VIEW_VERSION,
      key.locale) as { readonly capsule_digest?: unknown; readonly person_count?: unknown } | undefined;
    if (marker === undefined) return undefined;
    if (marker.capsule_digest !== key.capsuleDigest || marker.person_count !== sheets.size) return undefined;
    return sheets;
  }

  /**
   * Index one life's sheets, per locale, and mark each locale complete LAST.
   *
   * MUST run inside the caller's transaction: the marker and its rows have to commit or roll back
   * together, otherwise a failure halfway leaves rows that look like a complete index. The publish
   * path already owns a transaction; the read path's heal opens its own.
   *
   * `replace` is for the heal only. A create indexes each key once and keeps the first bytes; a heal
   * regenerated the set from authority and must be able to overwrite a row that cannot even be
   * parsed, or every read of that locale would miss and regenerate forever.
   */
  write(
    key: Omit<LifecycleViewKey, "locale">,
    sheets: readonly LifecyclePersonSheetWrite[],
    options: { readonly replace?: boolean } = {},
  ): void {
    const statement = options.replace === true ? this.replace : this.insert;
    const now = Date.now();
    const counts = new Map<Locale, number>();
    for (const { locale, personId, view } of sheets) {
      if (!isLocale(locale)) throw new Error(`Unsupported lifecycle person sheet locale: ${String(locale)}`);
      const record = view as { readonly personId?: unknown } | null;
      if (record === null || typeof record !== "object" || record.personId !== personId) {
        throw new Error("Lifecycle person sheet identity disagreement");
      }
      statement.run(key.lifeId, key.branchId, LIFECYCLE_PERSON_SHEET_VIEW_VERSION, locale, personId,
        key.capsuleDigest, JSON.stringify(view), now);
      counts.set(locale, (counts.get(locale) ?? 0) + 1);
    }
    const marker = options.replace === true ? this.replaceSet : this.insertSet;
    for (const [locale, count] of counts) {
      marker.run(key.lifeId, key.branchId, LIFECYCLE_PERSON_SHEET_VIEW_VERSION, locale,
        key.capsuleDigest, count, now);
    }
  }
}

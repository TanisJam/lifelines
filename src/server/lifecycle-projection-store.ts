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
function ensureSchema(db: DatabaseSync): void {
  const existing = db.prepare("SELECT type, sql FROM main.sqlite_schema WHERE name = ?").get(LIFECYCLE_VIEW_TABLE) as
    { readonly type?: string; readonly sql?: string } | undefined;
  if (existing === undefined) { db.exec(`CREATE TABLE main.${LIFECYCLE_VIEW_TABLE} ${columns}`); return; }
  if (existing.type !== "table" || typeof existing.sql !== "string"
    || normalizeSql(existing.sql) !== normalizeSql(schema)) {
    throw new Error(`Incompatible ${LIFECYCLE_VIEW_TABLE} schema`);
  }
}

export class LifecycleProjectionStore {
  private readonly select: StatementSync;
  private readonly insert: StatementSync;

  constructor(private readonly db: DatabaseSync) {
    ensureSchema(db);
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

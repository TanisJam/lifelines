import type { DatabaseSync, StatementSync } from "node:sqlite";
import type { FavorRecords } from "./favor-repository";

// Physical format v1: little-endian UTF-16 code units, not SQLite TEXT/UTF-8.
// This deliberately preserves NUL and unpaired surrogates in both keys and wires.
const schema = "CREATE TABLE favor_records_v1 (key BLOB NOT NULL PRIMARY KEY, wire BLOB NOT NULL) STRICT";
const normalizeSql = (sql: string) => sql.replace(/\s+/g, " ").trim().toLowerCase();

function requireString(value: unknown): asserts value is string {
  if (typeof value !== "string") throw new TypeError("Favor records require primitive strings");
}
function encode(value: string): Buffer { return Buffer.from(value, "utf16le"); }
function decode(value: unknown): string {
  if (!(value instanceof Uint8Array) || value.byteLength % 2 !== 0) {
    throw new Error("Invalid favor_records_v1 UTF-16LE BLOB");
  }
  return Buffer.from(value).toString("utf16le");
}

/** Injected trusted capability; the caller owns the connection and its lifetime.
 * No database opening, closing, settings, migrations or retry policy belongs here.
 * Raw SQL owners can mutate records: immutability is an adapter contract, not auth.
 */
export class SqliteFavorRecords implements FavorRecords {
  private readonly select: StatementSync;
  private readonly insertStatement: StatementSync;

  constructor(private readonly db: DatabaseSync) {
    const [select, insert] = this.transaction(() => {
      const existing = db.prepare("SELECT type, sql FROM main.sqlite_schema WHERE name = ?").get("favor_records_v1");
      if (existing === undefined) db.exec(schema);
      else if (existing.type !== "table" || typeof existing.sql !== "string" || normalizeSql(existing.sql) !== normalizeSql(schema)) {
        // Intentionally conservative: accept only this exact versioned physical schema,
        // never silently accept constraints, alternate types or views with similar columns.
        throw new Error("Incompatible favor_records_v1 schema");
      }
      const additions = db.prepare("SELECT name FROM main.sqlite_schema WHERE tbl_name = ? AND (type = 'trigger' OR (type = 'index' AND sql IS NOT NULL))").all("favor_records_v1");
      if (additions.length !== 0) throw new Error("Incompatible favor_records_v1 schema extensions");
      return [
        db.prepare("SELECT wire FROM main.favor_records_v1 WHERE key = ?"),
        db.prepare("INSERT INTO main.favor_records_v1 (key, wire) VALUES (?, ?) ON CONFLICT(key) DO NOTHING"),
      ] as const;
    });
    this.select = select;
    this.insertStatement = insert;
  }

  read(key: string): string | undefined {
    requireString(key);
    const row = this.select.get(encode(key));
    return row === undefined ? undefined : decode(row.wire);
  }

  insert(key: string, wire: string): void {
    requireString(key);
    requireString(wire);
    this.transaction(() => {
      this.insertStatement.run(encode(key), encode(wire));
      // The locked post-insert comparison, not a repository pre-read, protects retries.
      if (this.read(key) !== wire) throw new Error("Conflicting immutable record");
    });
  }

  private transaction<T>(body: () => T): T {
    // Outside the owned try: failed/nested BEGIN must never roll back caller work.
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = body();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      try { this.db.exec("ROLLBACK"); } catch { /* Preserve the original failure. */ }
      throw error;
    }
  }
}

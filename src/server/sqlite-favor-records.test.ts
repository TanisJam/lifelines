import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHelpFavorState, grantHelpFavor } from "../domain/effects";
import { createMind } from "../domain/mind";
import type { Person } from "../domain/types";
import { createFavorScheduler, runFavorYear } from "../domain/scheduler";
import { createFavorCapsule, serializeFavorCapsule } from "../domain/favor-capsule";
import { createFavorFork, declareForkChoice, declareForkGrant, forkFavor, runFavorForkYear, semanticResponseTarget } from "../domain/favor-fork";
import { forkOpportunityKey } from "../domain/favor-scheduler";
import { createFavorForkCapsule, serializeFavorForkCapsule } from "../domain/favor-fork-capsule";
import { FavorRepository, type FavorRecords } from "./favor-repository";
import { FavorForkRepository } from "./favor-fork-repository";
import { SqliteFavorRecords } from "./sqlite-favor-records";

vi.mock("./db", () => { throw new Error("Production database imported"); });
vi.mock("./life-store", () => { throw new Error("Legacy storage imported"); });
vi.mock("./decision-engine", () => { throw new Error("Provider imported"); });

// Only databases allocated here are owned/closed here. No environment/default path.
const handles: DatabaseSync[] = [];
const directories: string[] = [];
function open(path = ":memory:", options?: { readOnly: boolean }) {
  const db = new DatabaseSync(path, options ?? {});
  handles.push(db);
  return db;
}
function temporaryFile() {
  const dir = mkdtempSync(join(tmpdir(), "lifelines-favor-records-test-"));
  directories.push(dir);
  return join(dir, "records.db");
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const db of handles.splice(0)) if (db.isOpen) db.close();
  // Removing only directories created by this fixture, after every owned handle closes.
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true });
});
const blob = (value: string) => Buffer.from(value, "utf16le");
const count = (db: DatabaseSync) => db.prepare("SELECT count(*) AS n FROM main.favor_records_v1").get()!.n;
const grant = (key = "g0") => ({ key, year: 1336, creditor: "a", debtor: "b", causes: [], ties: [], appraisals: [] });
function initial() {
  const people: Record<string, Person> = {};
  for (const id of ["b", "a"]) {
    const mind = createMind("c2", id, 1300);
    mind.facets.altruism = 50; mind.facets.anxiety = 50; mind.values.wealth = 0;
    people[id] = { id, name: id, sex: "f", birthYear: 1300, founder: true, job: "none", traits: [], mind };
  }
  return createHelpFavorState(people, [], { a: 2, b: 0 }, { b: 2 }, { a: 2 });
}
function cCapsule() {
  const state = grantHelpFavor(grantHelpFavor(initial(), grant()), grant("g1"));
  return createFavorCapsule(runFavorYear(createFavorScheduler(state, "c2-1", 1336), 1337));
}
function choice(selected: "help" | "refuse" = "refuse") {
  const debt = `${JSON.stringify(["favor-c1", "g0", 0])}/help`;
  const key = forkOpportunityKey({ creditor: "a", debtor: "b", obligation: "ignored", reason: null }, debt, 1337, 0, "request");
  return { target: semanticResponseTarget(key, ["a", "b"], 1337), actors: ["a", "b"] as [string, string], year: 1337, choice: selected };
}
function dCapsule() {
  let fork = createFavorFork(createFavorScheduler(initial(), "c2-1", 1335), "root");
  fork = declareForkGrant(declareForkGrant(fork, grant()), grant("g1"));
  fork = declareForkChoice(runFavorForkYear(fork, 1336), choice());
  return createFavorForkCapsule(runFavorForkYear(runFavorForkYear(fork, 1337), 1340));
}

describe("injected SQLite opaque immutable records", () => {
  it("persists exact opaque strings and rejects immutable conflicts", () => {
    const db = open();
    const records = new SqliteFavorRecords(db);
    expect(records.read("key")).toBeUndefined();
    records.insert("key", "wire");
    records.insert("key", "wire");
    expect(() => records.insert("key", "different")).toThrow("Conflicting");
    expect(records.read("key")).toBe("wire");
    expect(count(db)).toBe(1);
    records.insert("another", "usable after conflict");
  });

  const strings = ["", " \t\n", "'\"; SELECT * --", "\0", "before\0after", "é", "é", "🌱", "\ud800", "\ud801", "\udc00", "x\ud800\0\udc00y", "�"];
  it.each(strings)("roundtrips exact code units for key/wire %j", value => {
    const db = open();
    const records = new SqliteFavorRecords(db);
    records.insert(value, value);
    expect(records.read(value)).toBe(value);
    const row = db.prepare("SELECT key, wire, typeof(key) AS kt, typeof(wire) AS wt FROM favor_records_v1").get()!;
    expect(row.kt).toBe("blob"); expect(row.wt).toBe("blob");
    expect(Buffer.from(row.key as Uint8Array)).toEqual(blob(value));
    expect(Buffer.from(row.wire as Uint8Array)).toEqual(blob(value));
  });
  it("distinguishes UTF-8 collisions and normalization-equivalent keys", () => {
    const records = new SqliteFavorRecords(open());
    expect(Buffer.from("\ud800")).toEqual(Buffer.from("\ud801"));
    strings.forEach((key, i) => records.insert(key, String(i)));
    strings.forEach((key, i) => expect(records.read(key)).toBe(String(i)));
  });

  it("real file close/reopen preserves C2 and D canonical wire and cold continuations together", async () => {
    const file = temporaryFile();
    const db = open(file);
    db.exec("CREATE TABLE sentinel (value TEXT); INSERT INTO sentinel VALUES ('untouched')");
    const records = new SqliteFavorRecords(db);
    const c = cCapsule(), d = dCapsule();
    await new FavorRepository(records).save(c);
    await new FavorForkRepository(records).save(d);
    expect(records.read(c.digest)).toBe(serializeFavorCapsule(c));
    expect(records.read(d.digest)).toBe(serializeFavorForkCapsule(d));
    db.close();

    const reopened = open(file);
    const fresh = new SqliteFavorRecords(reopened);
    const cRepo = new FavorRepository(fresh), dRepo = new FavorForkRepository(fresh);
    const coldC = (await cRepo.load(c.digest))!, coldD = (await dRepo.load(d.digest))!;
    expect(serializeFavorCapsule(coldC)).toBe(serializeFavorCapsule(c));
    expect(serializeFavorForkCapsule(coldD)).toBe(serializeFavorForkCapsule(d));
    expect(Object.keys(coldC.scheduler.state.people)).toEqual(["b", "a"]);
    expect(Object.keys(coldD.fork.people)).toEqual(["b", "a"]);
    expect(runFavorYear(coldC.scheduler, 1344)).toEqual(runFavorYear(c.scheduler, 1344));
    expect(runFavorForkYear(coldD.fork, 1344)).toEqual(runFavorForkYear(d.fork, 1344));
    const child = forkFavor(d.fork, 1337, "child", [choice("help")]);
    expect(forkFavor(coldD.fork, 1337, "child", [choice("help")])).toEqual(child);
    const childCapsule = createFavorForkCapsule(child);
    await dRepo.save(childCapsule);
    reopened.close();
    const finalDb = open(file), finalRecords = new SqliteFavorRecords(finalDb);
    const coldChild = (await new FavorForkRepository(finalRecords).load(childCapsule.digest))!;
    expect(forkFavor(coldChild.fork, 1337, "nested", [choice()])).toEqual(forkFavor(child, 1337, "nested", [choice()]));
    expect(await new FavorRepository(finalRecords).save(coldC)).toBe(c.digest);
    expect(await new FavorForkRepository(finalRecords).save(coldD)).toBe(d.digest);
    expect(count(finalDb)).toBe(3);
    expect(finalDb.prepare("SELECT value FROM sentinel").get()!.value).toBe("untouched");
  });

  it("reinitializes additively and isolates independent files/handles", () => {
    const a = open(temporaryFile()), b = open(temporaryFile());
    a.exec("CREATE TABLE sentinel (n INTEGER); INSERT INTO sentinel VALUES (42)");
    const first = new SqliteFavorRecords(a), second = new SqliteFavorRecords(b);
    first.insert("same", "first"); second.insert("same", "second");
    expect(new SqliteFavorRecords(a).read("same")).toBe("first");
    expect(second.read("same")).toBe("second");
    expect(a.prepare("SELECT n FROM sentinel").get()!.n).toBe(42);
    expect(a.prepare("PRAGMA table_list('favor_records_v1')").get()!.strict).toBe(1);
    expect(() => a.prepare("INSERT INTO favor_records_v1 VALUES (?, ?)").run(null, blob("x"))).toThrow();
    expect(() => a.prepare("INSERT INTO favor_records_v1 VALUES (?, ?)").run(blob("x"), "text")).toThrow();
  });

  it.each(["C2", "D2b"])("%s stale pre-read on two connections converges identically and rejects differing bytes", async kind => {
    const file = temporaryFile();
    const a = new SqliteFavorRecords(open(file)), b = new SqliteFavorRecords(open(file));
    const input = kind === "C2" ? cCapsule() : dCapsule();
    const save = (records: FavorRecords) => kind === "C2" ? new FavorRepository(records).save(input) : new FavorForkRepository(records).save(input);
    const wire = kind === "C2" ? serializeFavorCapsule(input) : serializeFavorForkCapsule(input);
    // Simulate a real missing read followed by another connection committing before insert.
    const stale: FavorRecords = { read(key) { expect(a.read(key)).toBeUndefined(); b.insert(key, wire); return undefined; }, insert: (key, value) => a.insert(key, value) };
    expect(await save(stale)).toBe(input.digest);
    a.insert(input.digest, wire);
    expect(() => b.insert(input.digest, "different")).toThrow("Conflicting");
    expect(a.read(input.digest)).toBe(wire);

    const otherFile = temporaryFile();
    const x = new SqliteFavorRecords(open(otherFile)), y = new SqliteFavorRecords(open(otherFile));
    const conflicting: FavorRecords = { read(key) { expect(x.read(key)).toBeUndefined(); y.insert(key, "raced conflict"); return undefined; }, insert: (key, value) => x.insert(key, value) };
    await expect(save(conflicting)).rejects.toThrow("Conflicting");
    expect(y.read(input.digest)).toBe("raced conflict");
  });

  it("held BEGIN IMMEDIATE causes genuine second-connection lock failure with no publication, then explicit retry", () => {
    const file = temporaryFile(), a = open(file), b = open(file);
    const first = new SqliteFavorRecords(a), second = new SqliteFavorRecords(b);
    a.exec("BEGIN IMMEDIATE");
    expect(() => second.insert("locked", "wire")).toThrow(/locked|busy/i);
    expect(() => new SqliteFavorRecords(b)).toThrow(/locked|busy/i);
    expect(first.read("locked")).toBeUndefined();
    a.exec("ROLLBACK");
    expect(second.read("locked")).toBeUndefined();
    second.insert("locked", "wire");
    expect(first.read("locked")).toBe("wire");
  });

  it.each(["insert", "init"])("nested %s rejects before touching caller's unrelated transaction", operation => {
    const db = open(), records = new SqliteFavorRecords(db);
    db.exec("CREATE TABLE sentinel (n INTEGER); BEGIN; INSERT INTO sentinel VALUES (7)");
    expect(() => operation === "insert" ? records.insert("key", "wire") : new SqliteFavorRecords(db)).toThrow(/transaction/i);
    expect(db.prepare("SELECT n FROM sentinel").get()!.n).toBe(7);
    db.exec("COMMIT");
    expect(db.prepare("SELECT n FROM sentinel").get()!.n).toBe(7);
    expect(records.read("key")).toBeUndefined();
    records.insert("key", "after caller commit");
  });
  it("nested initialization of an absent table creates no provisional schema or caller rollback", () => {
    const db = open();
    db.exec("CREATE TABLE sentinel (n INTEGER); BEGIN; INSERT INTO sentinel VALUES (8)");
    expect(() => new SqliteFavorRecords(db)).toThrow(/transaction/i);
    expect(db.prepare("SELECT name FROM sqlite_schema WHERE name = 'favor_records_v1'").get()).toBeUndefined();
    db.exec("COMMIT");
    expect(db.prepare("SELECT n FROM sentinel").get()!.n).toBe(8);
    new SqliteFavorRecords(db);
  });

  it.each(["FAIL", "ROLLBACK"])("AFTER INSERT RAISE(%s) leaves no row, preserves original error even if rollback fails", action => {
    const db = open(), records = new SqliteFavorRecords(db);
    db.exec(`CREATE TEMP TRIGGER fail_insert AFTER INSERT ON main.favor_records_v1 WHEN NEW.key = X'620061006400' BEGIN SELECT RAISE(${action}, 'original trigger failure'); END`);
    expect(() => records.insert("bad", "attempted")).toThrow("original trigger failure");
    expect(records.read("bad")).toBeUndefined();
    expect(count(db)).toBe(0);
    records.insert("good", "connection still usable");
    expect(records.read("good")).toBe("connection still usable");
  });
  it("post-insert SELECT decode failure rolls back attempted publication", () => {
    const db = open(), records = new SqliteFavorRecords(db);
    db.exec("CREATE TEMP TRIGGER corrupt_insert AFTER INSERT ON main.favor_records_v1 WHEN NEW.key = X'620061006400' BEGIN UPDATE favor_records_v1 SET wire = X'00' WHERE key = NEW.key; END");
    expect(() => records.insert("bad", "wire")).toThrow("UTF-16LE BLOB");
    expect(records.read("bad")).toBeUndefined();
    records.insert("good", "usable");
  });
  it.each(["hex(wire)", "NULL", "123"])("bad actual SQL projection %s cannot coerce a row and cannot partially publish", projection => {
    const db = open(), original = db.prepare.bind(db);
    vi.spyOn(db, "prepare").mockImplementation(sql => original(sql === "SELECT wire FROM main.favor_records_v1 WHERE key = ?" ? `SELECT ${projection} AS wire FROM main.favor_records_v1 WHERE key = ?` : sql));
    const records = new SqliteFavorRecords(db);
    expect(() => records.insert("key", "wire")).toThrow("UTF-16LE BLOB");
    expect(count(db)).toBe(0);
    vi.restoreAllMocks();
    new SqliteFavorRecords(db).insert("key", "usable");
  });
  it("initialization failure after DDL rolls back only its own schema change", () => {
    const db = open(), original = db.prepare.bind(db);
    db.exec("CREATE TABLE sentinel (n INTEGER); INSERT INTO sentinel VALUES (9)");
    vi.spyOn(db, "prepare").mockImplementation(sql => {
      if (sql.includes("tbl_name")) throw new Error("inspection failure after DDL");
      return original(sql);
    });
    expect(() => new SqliteFavorRecords(db)).toThrow("inspection failure after DDL");
    expect(original("SELECT name FROM sqlite_schema WHERE name = 'favor_records_v1'").get()).toBeUndefined();
    expect(original("SELECT n FROM sentinel").get()!.n).toBe(9);
    vi.restoreAllMocks();
    new SqliteFavorRecords(db).insert("key", "usable");
  });

  it.each([
    "CREATE TABLE favor_records_v1 (key TEXT PRIMARY KEY, wire TEXT)",
    "CREATE TABLE favor_records_v1 (key BLOB NOT NULL PRIMARY KEY, wire BLOB NOT NULL)",
    "CREATE TABLE favor_records_v1 (key BLOB NOT NULL PRIMARY KEY, wire BLOB NOT NULL, extra BLOB) STRICT",
    "CREATE TABLE favor_records_v1 (key BLOB NOT NULL PRIMARY KEY, wire BLOB NOT NULL CHECK(length(wire)>0)) STRICT",
    "CREATE VIEW favor_records_v1 AS SELECT X'' AS key, X'' AS wire",
  ])("fails closed for foreign schema without rewriting it: %s", sql => {
    const db = open(); db.exec(sql);
    const before = db.prepare("SELECT type, sql FROM sqlite_schema WHERE name = 'favor_records_v1'").get();
    expect(() => new SqliteFavorRecords(db)).toThrow("Incompatible");
    expect(db.prepare("SELECT type, sql FROM sqlite_schema WHERE name = 'favor_records_v1'").get()).toEqual(before);
    db.exec("CREATE TABLE unrelated (n INTEGER)");
  });
  it.each(["CREATE INDEX foreign_index ON favor_records_v1(wire)", "CREATE TRIGGER foreign_trigger AFTER INSERT ON favor_records_v1 BEGIN SELECT 1; END"])("rejects foreign persistent schema extension: %s", sql => {
    const db = open(); new SqliteFavorRecords(db).insert("key", "unchanged"); db.exec(sql);
    expect(() => new SqliteFavorRecords(db)).toThrow("schema extensions");
    expect(count(db)).toBe(1);
  });
  it("uses main schema even with a caller TEMP table shadow", () => {
    const db = open(), records = new SqliteFavorRecords(db);
    db.exec("CREATE TEMP TABLE favor_records_v1 (key TEXT, wire TEXT); INSERT INTO temp.favor_records_v1 VALUES ('key', 'foreign')");
    records.insert("key", "main");
    expect(new SqliteFavorRecords(db).read("key")).toBe("main");
    expect(db.prepare("SELECT wire FROM temp.favor_records_v1").get()!.wire).toBe("foreign");
  });

  it.each(["C2", "D2b"])("%s repository rejects corrupt opaque bytes on load and retry without replacement", async kind => {
    const db = open(), records = new SqliteFavorRecords(db);
    const input = kind === "C2" ? cCapsule() : dCapsule();
    const corrupt = "not JSON\0\ud800";
    records.insert(input.digest, corrupt);
    expect(records.read(input.digest)).toBe(corrupt);
    const repo = kind === "C2" ? new FavorRepository(records) : new FavorForkRepository(records);
    await expect(repo.load(input.digest)).rejects.toThrow();
    await expect(repo.save(input)).rejects.toThrow();
    expect(records.read(input.digest)).toBe(corrupt);
    expect(count(db)).toBe(1);
  });
  it("odd-byte stored BLOB rejects on read and immutable retry without replacement", () => {
    const db = open(), records = new SqliteFavorRecords(db);
    db.prepare("INSERT INTO favor_records_v1 VALUES (?, ?)").run(blob("bad"), new Uint8Array([0]));
    expect(() => records.read("bad")).toThrow("UTF-16LE BLOB");
    expect(() => records.insert("bad", "replacement")).toThrow("UTF-16LE BLOB");
    expect(db.prepare("SELECT hex(wire) AS wire FROM favor_records_v1").get()!.wire).toBe("00");
    records.insert("good", "usable");
  });

  it("closed handles propagate errors without opening/closing a fallback", () => {
    const db = open(), records = new SqliteFavorRecords(db); db.close();
    expect(() => records.read("key")).toThrow();
    expect(() => records.insert("key", "wire")).toThrow();
    expect(() => new SqliteFavorRecords(db)).toThrow();
    expect(db.isOpen).toBe(false);
    // Guards must win even when any SQL use would fail on this closed connection.
    expect(() => records.read(null as unknown as string)).toThrow("primitive strings");
    expect(() => records.insert("key", null as unknown as string)).toThrow("primitive strings");
  });
  it("read-only file rejects publication and cannot initialize an absent schema", () => {
    const file = temporaryFile(), db = open(file);
    new SqliteFavorRecords(db).insert("key", "original"); db.close();
    const readOnly = open(file, { readOnly: true }), records = new SqliteFavorRecords(readOnly);
    expect(records.read("key")).toBe("original");
    expect(() => records.insert("other", "wire")).toThrow(/readonly|read.only/i);
    expect(records.read("other")).toBeUndefined();
    const emptyFile = temporaryFile(), empty = open(emptyFile); empty.close();
    const emptyReadOnly = open(emptyFile, { readOnly: true });
    expect(() => new SqliteFavorRecords(emptyReadOnly)).toThrow(/readonly|read.only/i);
    expect(emptyReadOnly.prepare("SELECT name FROM sqlite_schema").all()).toEqual([]);
  });
  it.each([undefined, null, 1, {}, Object("boxed"), Symbol("key")])("rejects nonprimitive key/wire %s before SQL without executing hooks", value => {
    const db = open(), records = new SqliteFavorRecords(db);
    const exec = vi.spyOn(db, "exec"), prepare = vi.spyOn(db, "prepare");
    expect(() => records.read(value as string)).toThrow("primitive strings");
    expect(() => records.insert(value as string, "wire")).toThrow("primitive strings");
    expect(() => records.insert("key", value as string)).toThrow("primitive strings");
    expect(exec).not.toHaveBeenCalled(); expect(prepare).not.toHaveBeenCalled();
    expect(count(db)).toBe(0);
  });
  it("does not coerce hostile input hooks and leaves injected handle open", () => {
    const db = open(), records = new SqliteFavorRecords(db);
    let hooks = 0;
    const value = { toString() { hooks++; return "key"; }, valueOf() { hooks++; return "key"; } };
    expect(() => records.insert("key", value as unknown as string)).toThrow("primitive strings");
    expect(hooks).toBe(0); expect(db.isOpen).toBe(true);
  });
  it("imports only types from sqlite/port and no production, legacy, simulation or provider boundary", () => {
    const source = readFileSync(new URL("./sqlite-favor-records.ts", import.meta.url), "utf8");
    const imports = source.match(/^import .*$/gm);
    expect(imports).toEqual([
      'import type { DatabaseSync, StatementSync } from "node:sqlite";',
      'import type { FavorRecords } from "./favor-repository";',
    ]);
    expect(source).not.toMatch(/require\(|import\(|DATA_DIR|lifelines\.db|process\.|new DatabaseSync|PRAGMA|life-store|simulate|provider|remap/);
  });
});

import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { LifecycleProjectionStore, LIFECYCLE_VIEW_TABLE, LIFECYCLE_VIEW_VERSION, LIFECYCLE_PERSON_SHEET_VIEW_VERSION } from "./lifecycle-projection-store";

it("invalidates only the old chronicle view and retains independent localized rows", () => {
  const db = new DatabaseSync(":memory:");
  try {
    const store = new LifecycleProjectionStore(db);
    const key = { lifeId: "life", branchId: "branch", capsuleDigest: "digest" };
    db.prepare(`INSERT INTO ${LIFECYCLE_VIEW_TABLE} VALUES (?, ?, ?, ?, ?, ?, ?)`).run("life", "branch", "lifecycle-chronicle-view-1", "en", "digest", '{"old":true}', 1);
    const read = (locale: "en" | "es") => store.read({ ...key, locale });
    expect(LIFECYCLE_VIEW_VERSION).toBe("lifecycle-chronicle-view-2");
    expect(read("en")).toBeUndefined();
    store.write(key, [{ locale: "en", view: { text: "English" } }, { locale: "es", view: { text: "Español" } }]);
    expect(read("en")).toEqual({ text: "English" });
    expect(read("es")).toEqual({ text: "Español" });
    expect(store.read({ ...key, locale: "en", capsuleDigest: "wrong" })).toBeUndefined();
    expect(store.read({ ...key, locale: "en", lifeId: "wrong" })).toBeUndefined();
    expect(store.read({ ...key, locale: "en", branchId: "wrong" })).toBeUndefined();
    expect(db.prepare(`SELECT view_json, created_at FROM ${LIFECYCLE_VIEW_TABLE} WHERE view_version = ?`).get("lifecycle-chronicle-view-1")).toEqual({ view_json: '{"old":true}', created_at: 1 });
    expect(LIFECYCLE_PERSON_SHEET_VIEW_VERSION).toBe("lifecycle-person-sheet-view-1");
  } finally { db.close(); }
});

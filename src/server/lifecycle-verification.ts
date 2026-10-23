import { LOCALES } from "../domain/locale";
import { getDb } from "./db";
import { projectLifecycleChronicle, projectLifecyclePersonSheet } from "./lifecycle-projection";
import { LifecyclePersonSheetStore, LifecycleProjectionStore } from "./lifecycle-projection-store";
import { LifecycleRepository } from "./lifecycle-repository";

/**
 * Background verification for lifecycle lives (task P5).
 *
 * P3 made reads answer from `lifecycle_projections_v1` without re-proving regeneration, which is what
 * turned a 141.7 s read into milliseconds. The guarantee that removal gave up - "what is served is what
 * the capsule regenerates" - belongs here, off the request path: this replays EVERY stored capsule under
 * current authority and compares each indexed view against a fresh projection of the same output.
 *
 * It never runs in a request and never repairs anything. It reports, and the caller decides. A capsule
 * that refuses to replay (corruption, tampering, or an engine change that altered the run) surfaces as
 * an issue instead of a 500 on somebody's page load.
 */
export type LifecycleVerificationIssueKind =
  | "missing-binding"
  | "missing-capsule"
  | "capsule-refused"
  | "index-unreadable"
  | "view-missing"
  | "view-disagreement"
  | "sheet-index-unreadable"
  | "sheet-view-missing"
  | "sheet-view-disagreement";

export interface LifecycleVerificationIssue {
  readonly lifeId: string;
  readonly kind: LifecycleVerificationIssueKind;
  readonly detail: string;
}

export interface LifecycleVerificationReport {
  readonly lives: number;
  readonly issues: readonly LifecycleVerificationIssue[];
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Record order is not meaning: sort keys so two equal views compare equal regardless of insertion. */
function canonicalView(value: unknown): string {
  const sort = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(sort);
    if (input !== null && typeof input === "object") {
      return Object.fromEntries(Object.keys(input).sort()
        .map((key) => [key, sort((input as Record<string, unknown>)[key])]));
    }
    return input;
  };
  return JSON.stringify(sort(value));
}

/** Replays every lifecycle life and compares each indexed view to a fresh regeneration. */
export async function verifyLifecycleLives(): Promise<LifecycleVerificationReport> {
  const db = getDb();
  const rows = db.prepare("SELECT id, branch_id FROM lifecycle_lives ORDER BY id").all() as
    { readonly id: string; readonly branch_id: string }[];
  const repository = new LifecycleRepository(db);
  const issues: LifecycleVerificationIssue[] = [];
  for (const row of rows) {
    const binding = repository.binding(row.id, row.branch_id);
    if (binding === undefined) {
      issues.push({ lifeId: row.id, kind: "missing-binding", detail: "no binding row for this life and branch" });
      continue;
    }
    // load() cold-admits and FULLY replays, then re-checks digest, schema and genesis agreement.
    let loaded;
    try {
      loaded = await repository.load(row.id, row.branch_id);
    } catch (error) {
      issues.push({ lifeId: row.id, kind: "capsule-refused", detail: messageOf(error) });
      continue;
    }
    if (loaded === undefined) {
      issues.push({ lifeId: row.id, kind: "missing-capsule", detail: "no capsule row for the bound digest" });
      continue;
    }
    const source = { genesis: loaded.capsule.genesis, output: loaded.capsule.output };
    const identity = { lifeId: loaded.binding.lifeId, branchId: loaded.binding.branchId };
    for (const locale of LOCALES) {
      let stored: unknown;
      try {
        stored = new LifecycleProjectionStore(db).read({
          lifeId: identity.lifeId, branchId: identity.branchId,
          capsuleDigest: loaded.binding.capsuleDigest, locale,
        });
      } catch (error) {
        issues.push({ lifeId: row.id, kind: "index-unreadable", detail: `${locale}: ${messageOf(error)}` });
        continue;
      }
      if (stored === undefined) {
        issues.push({ lifeId: row.id, kind: "view-missing", detail: `no indexed view for ${locale}` });
        continue;
      }
      const fresh = await projectLifecycleChronicle({ source, identity, locale });
      if (canonicalView(stored) !== canonicalView(fresh.view)) {
        issues.push({ lifeId: row.id, kind: "view-disagreement",
          detail: `the indexed ${locale} view disagrees with a fresh regeneration of the same capsule` });
      }
    }
    // The person sheets are the other indexed read path, so they get the same treatment: a life that
    // predates the sheet index reports `sheet-view-missing` exactly like a missing chronicle view.
    for (const locale of LOCALES) {
      let stored: Map<string, unknown>;
      let complete: Map<string, unknown> | undefined;
      try {
        const store = new LifecyclePersonSheetStore(db);
        const key = { lifeId: identity.lifeId, branchId: identity.branchId,
          capsuleDigest: loaded.binding.capsuleDigest, locale };
        stored = store.readAll(key);
        complete = store.readComplete(key);
      } catch (error) {
        issues.push({ lifeId: row.id, kind: "sheet-index-unreadable", detail: `${locale}: ${messageOf(error)}` });
        continue;
      }
      if (stored.size === 0) {
        issues.push({ lifeId: row.id, kind: "sheet-view-missing", detail: `no indexed person sheets for ${locale}` });
        continue;
      }
      // Rows without an agreeing completeness marker are a PARTIAL index: the read path treats them
      // as a miss and heals, so reporting them here is the only way to see the condition at all.
      if (complete === undefined) {
        issues.push({ lifeId: row.id, kind: "sheet-view-missing",
          detail: `${locale}: incomplete sheet set (${stored.size} rows, marker absent or disagreeing)` });
        continue;
      }
      for (const personId of Object.keys(loaded.capsule.output.owned.people)) {
        const fresh = (await projectLifecyclePersonSheet({ source, personId, locale })).view;
        const indexed = stored.get(personId);
        if (indexed === undefined) {
          issues.push({ lifeId: row.id, kind: "sheet-view-missing",
            detail: `${locale}: no indexed sheet for ${personId}` });
        } else if (canonicalView(indexed) !== canonicalView(fresh)) {
          issues.push({ lifeId: row.id, kind: "sheet-view-disagreement",
            detail: `${locale}: the indexed sheet for ${personId} disagrees with a fresh regeneration` });
        }
      }
    }
  }
  return { lives: rows.length, issues };
}

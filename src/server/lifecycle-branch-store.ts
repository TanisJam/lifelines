import type { DatabaseSync } from "node:sqlite";
import { deserializeLifecycleForkCapsule } from "../domain/e-lifecycle-fork-capsule";
import { admitLifecycleGenesis } from "../domain/e-lifecycle-genesis";
import { LIFECYCLE_COMPACT_CAPSULE_MANIFEST, LIFECYCLE_COMPACT_CAPSULE_MANIFEST_V2, LIFECYCLE_COMPACT_CAPSULE_MANIFEST_V3 } from "../domain/e-lifecycle-capsule";
import { withTransaction } from "./db";
import { LifecycleRepository, loadStoredLifecycleFork, type LifecycleForkBranchBinding } from "./lifecycle-repository";

const MAX_DECISION_SUMMARY_BYTES = 1_000_000;
const MAX_DECISIONS = 10_000;
const digestPattern = /^[a-f0-9]{64}$/;
const keys = ["branchId", "capsuleDigest", "capsuleSchema", "genesisDigest", "lifeId", "version"];

export interface LifecycleDecisionTarget {
  readonly id: string;
  readonly year: number;
  readonly kind: string;
  readonly personId: string;
  readonly partnerId?: string;
  readonly chosen: string;
  readonly options: readonly { readonly id: string }[];
}

function validTarget(value: unknown): value is LifecycleDecisionTarget {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== "string" || !v.id || !Number.isSafeInteger(v.year) || typeof v.kind !== "string" || !v.kind ||
      typeof v.personId !== "string" || !v.personId || (v.partnerId !== undefined && (typeof v.partnerId !== "string" || !v.partnerId)) ||
      typeof v.chosen !== "string" || !v.chosen || !Array.isArray(v.options) || v.options.length === 0) return false;
  const ids = v.options.map((option: unknown) => option && typeof option === "object" ? (option as { id?: unknown }).id : undefined);
  return ids.every(id => typeof id === "string" && id.length > 0) && new Set(ids).size === ids.length && ids.includes(v.chosen);
}

/** Read-only fork storage. The SQLite file remains a trust boundary; admission replays all ancestry. */
export class LifecycleBranchStore {
  constructor(private readonly db: DatabaseSync) {}

  binding(lifeId: string, branchId: string): LifecycleForkBranchBinding | undefined {
    const row = this.db.prepare("SELECT digest, binding_json FROM lifecycle_forks_v1 WHERE life_id = ? AND branch_id = ?").get(lifeId, branchId);
    if (!row) return undefined;
    const b = JSON.parse(String(row.binding_json)) as LifecycleForkBranchBinding;
    if (!b || typeof b !== "object" || Object.keys(b).sort().join(",") !== keys.join(",") ||
        b.version !== "canonical-lifecycle-fork-binding-v1" || b.capsuleSchema !== "lifecycle-fork-capsule-v1" ||
        b.lifeId !== lifeId || b.branchId !== branchId || b.capsuleDigest !== row.digest ||
        !digestPattern.test(b.capsuleDigest) || !digestPattern.test(b.genesisDigest)) throw new Error("Corrupt fork binding");
    return Object.freeze(b);
  }

  children(lifeId: string, parentDigest: string) {
    return this.db.prepare("SELECT life_id, branch_id, digest, parent_digest, fork_year, decision_id, option_id, publish_order FROM lifecycle_forks_v1 WHERE life_id = ? AND parent_digest = ? ORDER BY publish_order").all(lifeId, parentDigest);
  }

  /** `digest` is a fork capsule digest or, for a root, the genesis digest. */
  async resolve(lifeId: string, digest: string): Promise<{ lifeId: string; capsule: unknown } | undefined> {
    const row = this.db.prepare("SELECT branch_id, wire, parent_digest, fork_year, decision_id, option_id FROM lifecycle_forks_v1 WHERE life_id = ? AND digest = ?").get(lifeId, digest);
    if (row) {
      const binding = this.binding(lifeId, String(row.branch_id));
      if (!binding || !(row.wire instanceof Uint8Array) || row.wire.byteLength % 2) throw new Error("Corrupt fork wire");
      const capsule = await deserializeLifecycleForkCapsule(Buffer.from(row.wire).toString("utf16le"));
      if (capsule.digest !== digest || admitLifecycleGenesis(capsule.genesis).digest !== binding.genesisDigest) throw new Error("Fork binding/capsule disagreement");
      const choice = capsule.lineage.choices.at(-1);
      if (!choice || row.parent_digest !== capsule.recipe.parentDigest || row.fork_year !== choice.year ||
          row.decision_id !== choice.decisionId || row.option_id !== choice.optionId) throw new Error("Fork metadata disagreement");
      return { lifeId, capsule };
    }
    const root = this.db.prepare("SELECT branch_id FROM lifecycle_lives WHERE id = ?").get(lifeId);
    if (!root) return undefined;
    const repo = new LifecycleRepository(this.db);
    const binding = repo.binding(lifeId, String(root.branch_id));
    if (!binding || binding.genesisDigest !== digest) return undefined;
    const loaded = await repo.load(lifeId, String(root.branch_id));
    if (!loaded) throw new Error("Missing lifecycle root");
    return { lifeId, capsule: loaded.capsule };
  }

  private boundDigest(lifeId: string, branchId: string): string | undefined {
    const fork = this.binding(lifeId, branchId);
    if (fork) return fork.capsuleDigest;
    const row = this.db.prepare("SELECT b.binding_json FROM lifecycle_lives l JOIN lifecycle_bindings b ON b.life_id = l.id AND b.branch_id = l.branch_id WHERE l.id = ? AND l.branch_id = ?").get(lifeId, branchId);
    if (!row || typeof row.binding_json !== "string") return undefined;
    const b = JSON.parse(row.binding_json);
    if (!b || typeof b !== "object" || Object.keys(b).sort().join(",") !== keys.join(",") ||
        b.lifeId !== lifeId || b.branchId !== branchId || b.version !== "canonical-lifecycle-cb1-1" ||
        ![LIFECYCLE_COMPACT_CAPSULE_MANIFEST.capsuleSchema, LIFECYCLE_COMPACT_CAPSULE_MANIFEST_V2.capsuleSchema, LIFECYCLE_COMPACT_CAPSULE_MANIFEST_V3.capsuleSchema].includes(b.capsuleSchema) ||
        typeof b.capsuleDigest !== "string" || !digestPattern.test(b.capsuleDigest) || typeof b.genesisDigest !== "string" || !digestPattern.test(b.genesisDigest)) throw new Error("Corrupt lifecycle binding");
    return b.capsuleDigest;
  }

  /** Explicit expensive preparation: caller must hold the lifecycle ticket. Never called by lookup. */
  async prepareDecisions(lifeId: string, branchId: string, digest: string): Promise<void> {
    if (this.boundDigest(lifeId, branchId) !== digest) throw new Error("Decision index binding disagreement");
    const binding = this.binding(lifeId, branchId);
    let decisions: readonly LifecycleDecisionTarget[];
    if (binding) {
      const stored = await this.resolve(lifeId, digest);
      if (!stored) throw new Error("Missing fork capsule");
      const loaded = await loadStoredLifecycleFork(binding, stored.capsule, parent => this.resolve(lifeId, parent));
      decisions = loaded.capsule.output.owned.decisions;
    } else {
      const loaded = await new LifecycleRepository(this.db).load(lifeId, branchId);
      if (!loaded || loaded.binding.capsuleDigest !== digest) throw new Error("Decision index binding disagreement");
      decisions = loaded.capsule.output.owned.decisions;
    }
    const targets = decisions.map(({ id, year, kind, personId, partnerId, chosen, options }) => ({
      id, year, kind, personId, ...(partnerId === undefined ? {} : { partnerId }), chosen, options: options.map(({ id }) => ({ id })),
    }));
    if (!targets.every(validTarget) || new Set(targets.map(d => `${d.id}\u0000${d.year}`)).size !== targets.length) throw new Error("Invalid decision index source");
    const json = JSON.stringify(targets);
    if (targets.length > MAX_DECISIONS || Buffer.byteLength(json, "utf8") > MAX_DECISION_SUMMARY_BYTES) throw new Error("Decision index exceeds bounded size");
    withTransaction(this.db, () => {
      if (this.boundDigest(lifeId, branchId) !== digest) throw new Error("Decision index binding disagreement");
      this.db.prepare("INSERT INTO lifecycle_fork_decision_sets_v1 VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING").run(lifeId, branchId, digest, targets.length, json);
      const row = this.db.prepare("SELECT decision_count, decisions_json FROM lifecycle_fork_decision_sets_v1 WHERE life_id = ? AND branch_id = ? AND capsule_digest = ?").get(lifeId, branchId, digest);
      if (!row || row.decision_count !== targets.length || row.decisions_json !== json) throw new Error("Conflicting decision index");
    });
  }

  /** A miss is not evidence of absence. Preparation must run separately under the replay gate. */
  decision(lifeId: string, branchId: string, digest: string, decisionId: string, year: number): LifecycleDecisionTarget | undefined {
    if (!digestPattern.test(digest) || !Number.isSafeInteger(year) || this.boundDigest(lifeId, branchId) !== digest) return undefined;
    const row = this.db.prepare("SELECT decision_count, decisions_json FROM lifecycle_fork_decision_sets_v1 WHERE life_id = ? AND branch_id = ? AND capsule_digest = ?").get(lifeId, branchId, digest);
    if (!row || typeof row.decisions_json !== "string" || typeof row.decision_count !== "number" || row.decision_count > MAX_DECISIONS || Buffer.byteLength(row.decisions_json, "utf8") > MAX_DECISION_SUMMARY_BYTES) return undefined;
    try {
      const data: unknown = JSON.parse(row.decisions_json);
      if (!Array.isArray(data) || data.length !== row.decision_count || !data.every(validTarget) ||
          new Set(data.map(d => `${d.id}\u0000${d.year}`)).size !== data.length) return undefined;
      return data.find(d => d.id === decisionId && d.year === year);
    } catch { return undefined; }
  }
}

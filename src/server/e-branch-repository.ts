import type { DatabaseSync } from "node:sqlite";
import { ANNUAL_CAPSULE_MANIFEST, admitAnnualRuntimeCapsule, type AnnualRuntimeCapsule } from "../domain/e-capsule";
import { requireFavorData } from "../domain/effects";
import type { LifeSex } from "../contracts/life";
import type { WorldConfig } from "../domain/types";
import { decompressJson, withTransaction } from "./db";
import { AnnualRuntimeRepository } from "./e-repository";
import type { LifeBranchRecord } from "./life-store";
import { SqliteFavorRecords } from "./sqlite-favor-records";

export interface CanonicalForkProvenance {
  readonly parentBranchId: string;
  readonly parentDigest: string;
  readonly frontier: number | null;
  readonly prefixLength: number;
}
export interface CanonicalBranchBinding {
  readonly version: "canonical-branch-rb1";
  readonly lifeId: string;
  readonly branchId: string;
  readonly capsuleDigest: string;
  readonly capsuleVersion: AnnualRuntimeCapsule["manifest"][0];
  readonly runtimeVersion: AnnualRuntimeCapsule["output"]["version"];
  readonly originDigest: string;
  readonly genesisDigest: string;
  readonly provenance: CanonicalForkProvenance | null;
}
export interface CanonicalPublication {
  readonly lifeId: string;
  readonly branchId: string;
  readonly config: WorldConfig;
  readonly protagonistName: string;
  readonly protagonistSex: LifeSex;
  readonly branch: Omit<LifeBranchRecord, "id" | "lifeId" | "createdAt">;
  readonly capsule: unknown;
  readonly provenance?: CanonicalForkProvenance;
  readonly signal?: AbortSignal;
}

/** Record order/prototypes are not meaning; array order, key presence and -0 are. */
function same(left: unknown, right: unknown): boolean {
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return Object.is(left, right);
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every(key => Object.hasOwn(right, key) && same(Reflect.get(left, key), Reflect.get(right, key)));
}
function publicData(value: unknown): unknown {
  // The existing public store is JSON-shaped; the capsule remains lossless UTF-16.
  return JSON.parse(JSON.stringify(value));
}
function key(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw new Error("Invalid binding digest");
}
function sqlText(value: unknown): asserts value is string {
  if (typeof value !== "string" || value.includes("\0") || Buffer.from(value, "utf8").toString("utf8") !== value) {
    throw new Error("Unsupported canonical SQLite TEXT value");
  }
}
function identifier(value: unknown): asserts value is string {
  sqlText(value);
  if (value.length === 0) throw new Error("Invalid branch identifier");
}
function checkProvenance(value: CanonicalForkProvenance) {
  identifier(value.parentBranchId);
  key(value.parentDigest);
  if (!Number.isSafeInteger(value.prefixLength) || value.prefixLength < 0 || Object.is(value.prefixLength, -0)
    || (value.frontier !== null && (!Number.isSafeInteger(value.frontier) || Object.is(value.frontier, -0)))
    || !same(Object.keys(value).sort(), ["frontier", "parentBranchId", "parentDigest", "prefixLength"])) throw new Error("Invalid fork provenance");
}
function frozen<T>(value: T): T {
  if (value && typeof value === "object") { Object.values(value).forEach(frozen); Object.freeze(value); }
  return value;
}
function checkLineage(child: AnnualRuntimeCapsule, parent: AnnualRuntimeCapsule, provenance: CanonicalForkProvenance) {
  const retained = parent.output.journal.slice(0, provenance.prefixLength);
  if (parent.digest !== provenance.parentDigest || child.output.origin.digest !== parent.output.origin.digest
    || !same(child.output.genesis, parent.output.genesis)
    || retained.length !== provenance.prefixLength
    || (retained.at(-1)?.plan.year ?? null) !== provenance.frontier
    || !same(child.output.journal.slice(0, provenance.prefixLength), retained)) throw new Error("Canonical parent/prefix disagreement");
}
function checkCompleted(input: CanonicalPublication, capsule: AnnualRuntimeCapsule) {
  const { output } = capsule;
  sqlText(input.protagonistName); sqlText(input.protagonistSex); sqlText(input.branch.label);
  const protagonist = output.state.people.protagonist;
  const death = output.journal.at(-1);
  if (!protagonist || protagonist.deathYear === undefined || protagonist.deathYear !== output.frontier
    || !death?.entries.some(entry => entry.kind === "death" && entry.outcome === "committed" && entry.actors[0] === "protagonist")
    || !output.state.legacyEvents.some(event => event.kind === "death" && event.year === protagonist.deathYear && event.actors[0] === "protagonist")) {
    throw new Error("Canonical publication requires admitted protagonist death completion");
  }
  const years = output.journal.map(record => record.plan.year);
  if (years.some((year, index) => year !== output.origin.initial.config.startYear + index)) throw new Error("Canonical publication requires complete years");
  if (!same(input.config, output.origin.initial.config) || !same(input.branch.result.config, input.config)
    || input.protagonistName !== protagonist.name || input.protagonistSex !== protagonist.sex
    || !same(publicData(input.branch.result.people), publicData(output.state.people)) || !same(publicData(input.branch.result.events), publicData(output.state.legacyEvents))
    || input.branch.result.decisions.length !== 0) throw new Error("Canonical public representation disagreement");
  // E currently supplies no legacy YearSnapshot/DecisionRecord projection. Never invent it,
  // or certify legacy snapshots as canon. RI1 must add an explicit supported projection.
  if (input.branch.snapshots.size !== 0) throw new Error("Unsupported canonical legacy snapshots");
  if (input.provenance) {
    checkProvenance(input.provenance);
    if (input.branch.parentBranchId !== input.provenance.parentBranchId
      || input.branch.forkYear !== output.journal[input.provenance.prefixLength]?.plan.year) throw new Error("Canonical fork representation disagreement");
  } else if (input.branch.parentBranchId !== undefined || input.branch.forkYear !== undefined || input.branch.override !== undefined) {
    throw new Error("Root cannot have fork metadata");
  }
}

/** Inactive binding boundary. The life store injects its OWN connection. Construct outside
 * BEGIN: SqliteFavorRecords owns its schema/insert transactions. Save is awaited first;
 * failed publication may leave an unreferenced immutable capsule, deliberately without GC.
 * Rules replay establishes integrity, not human-history authority or authenticated authorship.
 */
export class EBranchRepository {
  private readonly capsules: AnnualRuntimeRepository;
  constructor(private readonly db: DatabaseSync, capsules?: AnnualRuntimeRepository) {
    this.capsules = capsules ?? new AnnualRuntimeRepository(new SqliteFavorRecords(db));
  }

  binding(lifeId: string, branchId: string): CanonicalBranchBinding | undefined {
    identifier(lifeId); identifier(branchId);
    const row = this.db.prepare("SELECT binding_json FROM canonical_branch_bindings WHERE life_id = ? AND branch_id = ?").get(lifeId, branchId);
    if (!row) return undefined;
    const binding = JSON.parse(row.binding_json as string) as CanonicalBranchBinding;
    requireFavorData(binding);
    if (!same(Object.keys(binding).sort(), ["branchId", "capsuleDigest", "capsuleVersion", "genesisDigest", "lifeId", "originDigest", "provenance", "runtimeVersion", "version"])
      || binding.version !== "canonical-branch-rb1" || binding.capsuleVersion !== ANNUAL_CAPSULE_MANIFEST[0]
      || binding.runtimeVersion !== ANNUAL_CAPSULE_MANIFEST[2] || binding.lifeId !== lifeId || binding.branchId !== branchId) throw new Error("Corrupt canonical binding");
    key(binding.capsuleDigest); key(binding.originDigest); key(binding.genesisDigest);
    if (binding.provenance !== null) checkProvenance(binding.provenance);
    return frozen(binding);
  }

  async load(lifeId: string, branchId: string, seen = new Set<string>()): Promise<{ binding: CanonicalBranchBinding; capsule: AnnualRuntimeCapsule } | undefined> {
    const binding = this.binding(lifeId, branchId);
    if (!binding) return undefined;
    if (seen.has(branchId)) throw new Error("Cyclic canonical lineage");
    seen.add(branchId);
    // AnnualRuntimeRepository.load performs strict digest admission and semantic replay.
    // Canon is NEVER reconstructed from compatibility snapshots or public DTOs.
    const capsule = await this.capsules.load(binding.capsuleDigest);
    if (!capsule) throw new Error("Missing canonical capsule");
    if (capsule.manifest[0] !== binding.capsuleVersion || capsule.output.version !== binding.runtimeVersion || capsule.output.origin.digest !== binding.originDigest
      || capsule.output.genesis.digest !== binding.genesisDigest) throw new Error("Canonical binding/version disagreement");
    if (binding.provenance) {
      const parent = await this.load(lifeId, binding.provenance.parentBranchId, seen);
      if (!parent) throw new Error("Missing canonical parent binding");
      checkLineage(capsule, parent.capsule, binding.provenance);
    }
    this.checkStoredRepresentation(binding, capsule);
    return Object.freeze({ binding, capsule });
  }

  private checkStoredRepresentation(binding: CanonicalBranchBinding, capsule: AnnualRuntimeCapsule): void {
    const life = this.db.prepare("SELECT * FROM lives WHERE id = ?").get(binding.lifeId);
    const branch = this.db.prepare("SELECT * FROM life_branches WHERE id = ? AND life_id = ?").get(binding.branchId, binding.lifeId);
    if (!life || !branch) throw new Error("Missing canonical public representation");
    const snapshots = decompressJson<Record<string, unknown>>(branch.snapshots_blob as Uint8Array);
    if (Object.keys(snapshots).length !== 0) throw new Error("Canonical snapshot representation disagreement");
    checkCompleted({ lifeId: binding.lifeId, branchId: binding.branchId, capsule,
      config: JSON.parse(life.config_json as string), protagonistName: life.protagonist_name as string,
      protagonistSex: life.protagonist_sex as LifeSex, provenance: binding.provenance ?? undefined,
      branch: { label: branch.label as string, parentBranchId: (branch.parent_branch_id as string | null) ?? undefined,
        forkYear: (branch.fork_year as number | null) ?? undefined,
        override: branch.override_json ? JSON.parse(branch.override_json as string) : undefined,
        result: decompressJson(branch.result_json as Uint8Array), snapshots: new Map() },
    }, capsule);
    if (!binding.provenance && life.original_branch_id !== binding.branchId) throw new Error("Canonical original branch disagreement");
  }

  async publish<T>(request: CanonicalPublication, apply: (input: CanonicalPublication, binding: CanonicalBranchBinding, retry: boolean) => T): Promise<T> {
    identifier(request.lifeId); identifier(request.branchId);
    const signal = request.signal;
    const capsule = admitAnnualRuntimeCapsule(request.capsule);
    // Capture caller-owned data BEFORE the first await. AbortSignal is a capability, not data.
    const data = { lifeId: request.lifeId, branchId: request.branchId, config: request.config,
      protagonistName: request.protagonistName, protagonistSex: request.protagonistSex,
      branch: { label: request.branch.label, parentBranchId: request.branch.parentBranchId,
        forkYear: request.branch.forkYear, override: request.branch.override, result: request.branch.result },
      provenance: request.provenance };
    requireFavorData(data, true);
    if (!(request.branch.snapshots instanceof Map) || request.branch.snapshots.size !== 0) throw new Error("Unsupported canonical legacy snapshots");
    const captured = structuredClone(data);
    const input: CanonicalPublication = { ...captured, branch: { ...captured.branch, snapshots: new Map() }, capsule };
    checkCompleted(input, capsule);
    let parent: Awaited<ReturnType<EBranchRepository["load"]>>;
    if (input.provenance) {
      parent = await this.load(input.lifeId, input.provenance.parentBranchId);
      if (!parent) throw new Error("Missing canonical parent binding; legacy rewrite unsupported");
      checkLineage(capsule, parent.capsule, input.provenance);
    }
    signal?.throwIfAborted();
    if (await this.capsules.save(capsule) !== capsule.digest) throw new Error("Canonical save digest disagreement");
    signal?.throwIfAborted();
    const binding: CanonicalBranchBinding = frozen({ version: "canonical-branch-rb1", lifeId: input.lifeId, branchId: input.branchId,
      capsuleDigest: capsule.digest, capsuleVersion: capsule.manifest[0], runtimeVersion: capsule.output.version, originDigest: capsule.output.origin.digest,
      genesisDigest: capsule.output.genesis.digest, provenance: input.provenance ?? null });
    return withTransaction(this.db, () => {
      // Recheck branch-qualified identity after asynchronous save, under the publication lock.
      if (parent && !same(this.binding(input.lifeId, parent.binding.branchId), parent.binding)) throw new Error("Canonical parent changed during save");
      if (parent) this.checkStoredRepresentation(parent.binding, parent.capsule);
      const existing = this.binding(input.lifeId, input.branchId);
      if (existing && !same(existing, binding)) throw new Error("Conflicting immutable canonical binding");
      const result = apply(input, binding, existing !== undefined);
      this.checkStoredRepresentation(binding, capsule);
      if (!existing) this.db.prepare("INSERT INTO canonical_branch_bindings (life_id, branch_id, binding_json) VALUES (?, ?, ?)").run(input.lifeId, input.branchId, JSON.stringify(binding));
      return result;
    });
  }
}

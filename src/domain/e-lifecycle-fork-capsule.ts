import { createHash } from "node:crypto";
import { deserializeCompactLifecycleDag, serializeCompactLifecycleDag } from "./e-lifecycle-dag";
import { forkLifecycle, LIFECYCLE_FORK_VERSION } from "./e-lifecycle-fork";
import { admitLifecycleGenesis, canonicalLifecycleData, canonicalLifecycleDataEqual, instantiateLifecycleGenesis, lifecycleVersionsMatch, LIFECYCLE_GENESIS_VERSIONS, LIFECYCLE_THREAD_VERSIONS } from "./e-lifecycle-genesis";
import { createLifecycleRuntime, type LifecycleJournalMode } from "./e-lifecycle-runtime";
import { requireFavorData } from "./effects";
import { requireFields } from "./obligations";

type Fork = Awaited<ReturnType<typeof forkLifecycle>>;
const manifests = {
  audit: Object.freeze({ capsuleSchema: "lifecycle-fork-capsule-v1", codec: "canonical-dag-dictionary-cb1-1", profile: "legacy", journal: "audit" }),
  compact: Object.freeze({ capsuleSchema: "lifecycle-fork-capsule-v1", codec: "canonical-dag-dictionary-cb1-1", profile: "legacy", journal: "compact" }),
  thread: Object.freeze({ capsuleSchema: "lifecycle-fork-capsule-v1", codec: "canonical-dag-dictionary-cb1-1", profile: "thread", journal: "compact" }),
} as const;
type Manifest = typeof manifests[keyof typeof manifests];
export interface LifecycleForkCapsule extends Fork {
  readonly manifest: Manifest;
  readonly digest: string;
  readonly recipe: { readonly parentDigest: string; readonly lastYear: number; readonly executor: typeof LIFECYCLE_FORK_VERSION };
  readonly parent: LifecycleForkCapsule | null;
}
function record(value: unknown): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected fork capsule record");
}
function manifestOf(value: unknown): Manifest {
  for (const manifest of Object.values(manifests)) if (canonicalLifecycleDataEqual(value, manifest)) return manifest;
  throw new Error("Unsupported fork capsule manifest");
}
function hash(manifest: Manifest, table: string): string {
  return createHash("sha256").update(JSON.stringify(["lifecycle-fork-capsule-v1", canonicalLifecycleData(manifest), table])).digest("hex");
}
function tableOf(value: Pick<LifecycleForkCapsule, "genesis" | "output" | "lineage" | "recipe" | "parent">): string {
  return serializeCompactLifecycleDag({ genesis: value.genesis, output: value.output, lineage: value.lineage, recipe: value.recipe, parent: value.parent });
}
function freeze<T>(value: T, seen = new Set<object>()): T {
  if (value && typeof value === "object" && !seen.has(value)) {
    seen.add(value);
    for (const entry of Object.values(value)) freeze(entry, seen);
    Object.freeze(value);
  }
  return value;
}
async function regenerate(input: unknown): Promise<LifecycleForkCapsule> {
  requireFavorData(input, true);
  record(input);
  requireFields(input, ["manifest", "genesis", "output", "lineage", "recipe", "parent"]);
  const candidate = structuredClone(input);
  const manifest = manifestOf(candidate.manifest);
  const genesis = admitLifecycleGenesis(candidate.genesis);
  const { config } = instantiateLifecycleGenesis(genesis);
  const thread = lifecycleVersionsMatch(genesis.versions, LIFECYCLE_THREAD_VERSIONS);
  if ((!thread && !lifecycleVersionsMatch(genesis.versions, LIFECYCLE_GENESIS_VERSIONS)) || (manifest.profile === "thread") !== thread) throw new Error("Fork profile disagreement");
  record(candidate.recipe);
  requireFields(candidate.recipe, ["parentDigest", "lastYear", "executor"]);
  // D34: the ceiling is derived from the admitted genesis (plan D12), never a free field. A shorter
  // ceiling is execution-inert after an early death, so replay alone could not authenticate it.
  if (candidate.recipe.executor !== LIFECYCLE_FORK_VERSION || !Number.isSafeInteger(candidate.recipe.lastYear) || candidate.recipe.lastYear !== config.endYear) throw new Error("Invalid fork recipe");
  record(candidate.lineage);
  if (!Array.isArray(candidate.lineage.choices) || candidate.lineage.choices.length === 0) throw new Error("Invalid fork lineage");
  const choice = candidate.lineage.choices.at(-1);
  let parent: Fork | { genesis: typeof genesis; output: ReturnType<ReturnType<typeof createLifecycleRuntime>["snapshot"]> };
  let parentCapsule: LifecycleForkCapsule | null = null;
  if (candidate.parent === null) {
    if (candidate.recipe.parentDigest !== genesis.digest) throw new Error("Missing fork ancestry");
    const runtime = createLifecycleRuntime(genesis, { journal: manifest.journal as LifecycleJournalMode });
    for (let year = config.startYear; year <= config.endYear; year++) if ((await runtime.advance(year)).status === "complete") break;
    parent = { genesis, output: runtime.snapshot() };
  } else {
    parentCapsule = await admitLifecycleForkCapsule(candidate.parent);
    if (candidate.recipe.parentDigest !== parentCapsule.digest || !canonicalLifecycleDataEqual(parentCapsule.genesis, genesis) || !canonicalLifecycleDataEqual(parentCapsule.manifest, manifest)) throw new Error("Fork ancestry disagreement");
    parent = { genesis: parentCapsule.genesis, output: parentCapsule.output, lineage: parentCapsule.lineage };
  }
  const result = await forkLifecycle(parent, choice, { lastYear: candidate.recipe.lastYear as number });
  if (!canonicalLifecycleDataEqual(result.lineage, candidate.lineage) || !canonicalLifecycleDataEqual(result.output, candidate.output)) throw new Error("Fork replay disagreement");
  const body = { genesis: result.genesis, output: result.output, lineage: result.lineage, recipe: candidate.recipe as unknown as LifecycleForkCapsule["recipe"], parent: parentCapsule };
  return freeze({ manifest, digest: hash(manifest, tableOf(body)), ...body });
}
export async function createLifecycleForkCapsule(input: unknown, options: { parent?: LifecycleForkCapsule } = {}): Promise<LifecycleForkCapsule> {
  requireFavorData(input, true);
  record(input);
  requireFields(input, ["genesis", "output", "lineage"]);
  const genesis = admitLifecycleGenesis(input.genesis);
  const { config } = instantiateLifecycleGenesis(genesis);
  record(input.output);
  if (!Array.isArray(input.output.journal) || input.output.journal.length === 0) throw new Error("Invalid fork journal");
  const audit = input.output.journal.every((entry: unknown) => entry !== null && typeof entry === "object" && "physicalSnapshot" in entry);
  const compact = input.output.journal.every((entry: unknown) => entry !== null && typeof entry === "object" && !("physicalSnapshot" in entry));
  const thread = lifecycleVersionsMatch(genesis.versions, LIFECYCLE_THREAD_VERSIONS);
  if ((!audit && !compact) || (thread && audit)) throw new Error("Invalid fork journal mode");
  const manifest = thread ? manifests.thread : audit ? manifests.audit : manifests.compact;
  return regenerate({ manifest, genesis, output: input.output, lineage: input.lineage,
    recipe: { parentDigest: options.parent?.digest ?? genesis.digest, lastYear: config.endYear, executor: LIFECYCLE_FORK_VERSION }, parent: options.parent ?? null });
}
export async function admitLifecycleForkCapsule(input: unknown): Promise<LifecycleForkCapsule> {
  requireFavorData(input, true);
  record(input);
  requireFields(input, ["manifest", "digest", "genesis", "output", "lineage", "recipe", "parent"]);
  const candidate = structuredClone(input) as unknown as LifecycleForkCapsule;
  const manifest = manifestOf(candidate.manifest);
  if (candidate.digest !== hash(manifest, tableOf(candidate))) throw new Error("Fork capsule digest disagreement");
  const { digest: ignored, ...body } = candidate;
  void ignored;
  return regenerate(body);
}
export async function serializeLifecycleForkCapsule(input: unknown): Promise<string> {
  const capsule = await admitLifecycleForkCapsule(input);
  return JSON.stringify({ manifest: capsule.manifest, table: tableOf(capsule), digest: capsule.digest });
}
export async function deserializeLifecycleForkCapsule(input: unknown): Promise<LifecycleForkCapsule> {
  if (typeof input !== "string") throw new Error("Expected fork capsule wire");
  const envelope: unknown = JSON.parse(input);
  requireFavorData(envelope, true);
  record(envelope);
  requireFields(envelope, ["manifest", "table", "digest"]);
  const manifest = manifestOf(envelope.manifest);
  if (typeof envelope.table !== "string" || envelope.digest !== hash(manifest, envelope.table)) throw new Error("Fork capsule digest disagreement");
  if (JSON.stringify({ manifest, table: envelope.table, digest: envelope.digest }) !== input) throw new Error("Noncanonical fork wire");
  const body = deserializeCompactLifecycleDag(envelope.table);
  record(body);
  requireFields(body, ["genesis", "output", "lineage", "recipe", "parent"]);
  return admitLifecycleForkCapsule({ ...body, manifest, digest: envelope.digest });
}

import { createHash } from "node:crypto";
import type { LifecycleCompactCapsule } from "./e-lifecycle-capsule";
import { deserializeCompactLifecycleDag, serializeCompactLifecycleDag } from "./e-lifecycle-dag";
import { admitLifecycleGenesis, canonicalLifecycleData, canonicalLifecycleDataEqual,
  type LifecycleGenesis } from "./e-lifecycle-genesis";
import { replayLifecycleRuntime } from "./e-lifecycle-replay";
import { createLifecycleRuntime } from "./e-lifecycle-runtime";
import { requireFavorData } from "./effects";

/**
 * ADDITIVE chunked FORMAT (CP1-B B1). It never replaces, reinterprets or migrates
 * the certified `lifecycle-capsule-compact-cb1-1` format: a life declares its
 * schema and each loader refuses the other one.
 *
 * AUTHORITY. Every create/admit here performs the SAME current-authority work as
 * the certified compact path - `admitLifecycleGenesis` plus a full
 * `replayLifecycleRuntime` of every native and economic year. A stored manifest,
 * index, digest or chunk table is integrity material only and NEVER short
 * circuits regeneration. A chunk chain whose links all agree with each other but
 * not with regeneration is still refused, so the chain cannot become a second
 * authority.
 *
 * SHAPE. `create` regenerates the life ONCE and slices the regenerated journal
 * into ordered chunks of at most `chunkYears` years (the last chunk may be
 * shorter). A chunk carries exactly `{ from, to, table, digest }`, where `table`
 * is the canonical compact DAG wire of `{ journal: <that slice> }`. A chunk never
 * carries the accumulated world state (`owned`, `favors`, a `YearSnapshot` or the
 * final `output`), because loading regenerates the world from genesis: storing it
 * per chunk would make every chunk grow with the whole life and defeat chunking.
 *
 * GENESIS. The manifest binds the life's genesis by digest only, so the stored
 * capsule is `{ manifest, chunks }` and the caller supplies the genesis it already
 * keeps once per life (repository binding). `regenerated` on the returned value is
 * the authority; the stored chunks only corroborate it.
 */

/** Recognized chunked format. Selected by `capsuleSchema`; never a trust flag. */
export const LIFECYCLE_CHUNKED_CAPSULE_FORMAT = Object.freeze({
  version: "lifecycle-chunked-capsule-cp1-1",
  capsuleSchema: "lifecycle-capsule-chunked-cp1-1",
});
export const LIFECYCLE_CHUNKED_CAPSULE_VERSION = LIFECYCLE_CHUNKED_CAPSULE_FORMAT.version;
export const LIFECYCLE_CHUNKED_CAPSULE_SCHEMA = LIFECYCLE_CHUNKED_CAPSULE_FORMAT.capsuleSchema;
/** Domain separation for one chunk: no compact or legacy capsule bytes can ever be
 * replayed as a chunk digest, or the reverse. */
export const LIFECYCLE_CHUNK_DIGEST_DOMAIN = "lifecycle-chunked-capsule-chunk-cp1-1";
/** Measured 4-year encode envelope from CP1. It is the default AND the ceiling:
 * a caller may lower it, never raise it without a fresh measurement (B4 gate). */
export const LIFECYCLE_CHUNKED_DEFAULT_CHUNK_YEARS = 4;
const MANIFEST_KEYS = ["version", "capsuleSchema", "genesisDigest", "chunkYears", "frontier", "status", "chunks"] as const;
const INDEX_KEYS = ["from", "to", "digest"] as const;
const CHUNK_KEYS = ["from", "to", "table", "digest"] as const;

type Output = LifecycleCompactCapsule["output"];
type Year = { year: number };
/** One chunk's manifest entry: its range and its recomputed digest. */
export interface LifecycleChunkIndex {
  readonly from: number;
  readonly to: number;
  readonly digest: string;
}
/** One stored chunk: its own journal slice as canonical compact wire, plus digest. */
export interface LifecycleChunk {
  readonly from: number;
  readonly to: number;
  readonly table: string;
  readonly digest: string;
}
/** One structurally admitted chunk and the journal slice it decodes to. */
export interface LifecycleChunkContent {
  readonly from: number;
  readonly to: number;
  readonly digest: string;
  readonly journal: readonly unknown[];
}
export interface LifecycleChunkedManifest {
  readonly version: string;
  readonly capsuleSchema: string;
  readonly genesisDigest: string;
  readonly chunkYears: number;
  readonly frontier: number;
  readonly status: "incomplete" | "complete";
  readonly chunks: readonly LifecycleChunkIndex[];
}
export interface LifecycleChunkedRegeneration {
  readonly genesis: LifecycleGenesis;
  readonly output: Output;
}
export interface LifecycleChunkedCapsule {
  readonly manifest: LifecycleChunkedManifest;
  readonly chunks: readonly LifecycleChunk[];
  /** Current-authority regeneration. This is the artifact; `chunks` only corroborate. */
  readonly regenerated: LifecycleChunkedRegeneration;
}

function record(value: unknown): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected lifecycle chunked capsule record");
  }
}
function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const entry of Object.values(value)) freeze(entry);
    Object.freeze(value);
  }
  return value;
}
/** Labelled exact-key-set check. Same invariant as `requireFields`, but every
 * refusal names the part of the chunked capsule that disagreed. Call only after
 * the WHOLE borrowed graph passed `requireFavorData`. */
function exact(value: unknown, fields: readonly string[], label: string): Record<string, unknown> {
  record(value);
  const keys = Object.keys(value);
  if (keys.length !== fields.length || keys.some(key => !fields.includes(key)) ||
    fields.some(key => !Object.hasOwn(value, key))) {
    throw new Error(`${label} keys disagreement`);
  }
  return value;
}
function integer(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && !Object.is(value, -0);
}
function hashEscaped(hash: ReturnType<typeof createHash>, encoded: string): void {
  // Mirrors the certified capsule framing: batch without materializing a second
  // copy of the table string, and never split a paired UTF-16 surrogate.
  for (let start = 0; start < encoded.length;) {
    let end = Math.min(start + 32768, encoded.length);
    if (end < encoded.length) {
      const high = encoded.charCodeAt(end - 1);
      const low = encoded.charCodeAt(end);
      if (high >= 0xd800 && high <= 0xdbff && low >= 0xdc00 && low <= 0xdfff) end--;
    }
    hash.update(JSON.stringify(encoded.slice(start, end)).slice(1, -1), "utf8");
    start = end;
  }
}
/** Integrity for ONE chunk, bound to its own range. Recomputable by anyone, so it
 * is never authority: `create`/`admit` regenerate and compare regardless. */
export function lifecycleChunkDigest(from: number, to: number, table: string): string {
  if (!integer(from) || !integer(to) || from > to) throw new Error("Invalid lifecycle chunked capsule chunk range");
  if (typeof table !== "string") throw new Error("Lifecycle chunked capsule chunk table disagreement");
  const hash = createHash("sha256");
  hash.update(`["${LIFECYCLE_CHUNK_DIGEST_DOMAIN}",${JSON.stringify(canonicalLifecycleData({ from, to }))},"`, "utf8");
  hashEscaped(hash, table);
  hash.update('\"]', "utf8");
  return hash.digest("hex");
}
function chunkTable(journal: readonly unknown[]): string {
  // The SAME compact DAG codec and wire profile as the certified format, applied
  // to one slice: a chunk's encode cost depends only on its own years.
  return serializeCompactLifecycleDag({ journal });
}
function encodeChunk(from: number, to: number, journal: readonly unknown[]): LifecycleChunk {
  const table = chunkTable(journal);
  return Object.freeze({ from, to, table, digest: lifecycleChunkDigest(from, to, table) });
}
function decodeChunk(input: unknown): { chunk: LifecycleChunk; journal: readonly unknown[] } {
  const candidate = exact(input, CHUNK_KEYS, "Lifecycle chunked capsule chunk");
  if (!integer(candidate.from) || !integer(candidate.to) || candidate.from > candidate.to) {
    throw new Error("Invalid lifecycle chunked capsule chunk range");
  }
  if (typeof candidate.table !== "string") throw new Error("Lifecycle chunked capsule chunk table disagreement");
  if (typeof candidate.digest !== "string" || !/^[a-f0-9]{64}$/.test(candidate.digest)) {
    throw new Error("Lifecycle chunked capsule chunk digest disagreement");
  }
  const { from, to, table, digest } = candidate as { from: number; to: number; table: string; digest: string };
  if (digest !== lifecycleChunkDigest(from, to, table)) {
    throw new Error("Lifecycle chunked capsule chunk digest disagreement");
  }
  // Complete closed dictionary decode BEFORE any regeneration work, and reject any
  // payload that is not exactly one journal slice: a chunk has no second shape.
  let decoded: unknown;
  try {
    decoded = deserializeCompactLifecycleDag(table);
  } catch {
    throw new Error("Lifecycle chunked capsule chunk table disagreement");
  }
  const payload = exact(decoded, ["journal"], "Lifecycle chunked capsule chunk payload");
  if (!Array.isArray(payload.journal)) throw new Error("Lifecycle chunked capsule chunk payload disagreement");
  return { chunk: Object.freeze({ from, to, table, digest }), journal: payload.journal };
}
function requireChunkYears(value: unknown): number {
  if (!integer(value) || value < 1) throw new Error("Invalid lifecycle chunked capsule chunk years");
  if (value > LIFECYCLE_CHUNKED_DEFAULT_CHUNK_YEARS) {
    throw new Error("Lifecycle chunked capsule chunk years may not exceed the measured default");
  }
  return value;
}
function chunkYearsOption(value: unknown): number {
  return value === undefined ? LIFECYCLE_CHUNKED_DEFAULT_CHUNK_YEARS : requireChunkYears(value);
}
function partition<T extends Year>(journal: readonly T[], chunkYears: number): { from: number; to: number; journal: readonly T[] }[] {
  const slices: { from: number; to: number; journal: readonly T[] }[] = [];
  for (let start = 0; start < journal.length; start += chunkYears) {
    const end = Math.min(start + chunkYears, journal.length) - 1;
    // A contiguous journal is already enforced by regeneration; year values, not
    // indices, become the wire range.
    slices.push({ from: journal[start].year, to: journal[end].year, journal: journal.slice(start, end + 1) });
  }
  return slices;
}
function assemble(genesis: LifecycleGenesis, output: Output, chunkYears: number): LifecycleChunkedCapsule {
  const chunks = partition(output.journal, chunkYears).map(slice => encodeChunk(slice.from, slice.to, slice.journal));
  const manifest = freeze({
    version: LIFECYCLE_CHUNKED_CAPSULE_VERSION,
    capsuleSchema: LIFECYCLE_CHUNKED_CAPSULE_SCHEMA,
    genesisDigest: genesis.digest,
    chunkYears,
    frontier: output.frontier,
    status: output.status,
    chunks: chunks.map(chunk => ({ from: chunk.from, to: chunk.to, digest: chunk.digest })),
  });
  // `output` is already a detached frozen publication; never re-walk its journal.
  return Object.freeze({ manifest, chunks: Object.freeze(chunks),
    regenerated: Object.freeze({ genesis, output }) });
}
/** Structural admission of the manifest AND every chunk, without genesis or replay.
 * Ordered, contiguous, gap-free, non-overlapping and width-consistent chunks only. */
function requireStructure(manifestInput: unknown, chunksInput: unknown): {
  manifest: LifecycleChunkedManifest;
  chunks: LifecycleChunk[];
  journals: (readonly unknown[])[];
} {
  const manifest = exact(manifestInput, MANIFEST_KEYS, "Lifecycle chunked capsule manifest");
  if (manifest.version !== LIFECYCLE_CHUNKED_CAPSULE_VERSION) {
    throw new Error("Unsupported lifecycle chunked capsule version");
  }
  if (manifest.capsuleSchema !== LIFECYCLE_CHUNKED_CAPSULE_SCHEMA) {
    throw new Error("Unsupported lifecycle chunked capsule schema");
  }
  if (typeof manifest.genesisDigest !== "string" || !/^[a-f0-9]{64}$/.test(manifest.genesisDigest)) {
    throw new Error("Invalid lifecycle chunked capsule genesis digest");
  }
  const chunkYears = requireChunkYears(manifest.chunkYears);
  if (!integer(manifest.frontier)) throw new Error("Invalid lifecycle chunked capsule frontier");
  if (manifest.status !== "incomplete" && manifest.status !== "complete") {
    throw new Error("Invalid lifecycle chunked capsule status");
  }
  if (!Array.isArray(manifest.chunks)) throw new Error("Expected lifecycle chunked capsule chunk index");
  const indexEntries = manifest.chunks as unknown[];
  const indexes: LifecycleChunkIndex[] = [];
  for (let position = 0; position < indexEntries.length; position++) {
    const index = exact(indexEntries[position], INDEX_KEYS, "Lifecycle chunked capsule chunk index");
    if (!integer(index.from) || !integer(index.to) || index.from > index.to) {
      throw new Error("Invalid lifecycle chunked capsule chunk range");
    }
    if (typeof index.digest !== "string" || !/^[a-f0-9]{64}$/.test(index.digest)) {
      throw new Error("Lifecycle chunked capsule chunk digest disagreement");
    }
    const from = index.from;
    const to = index.to;
    const width = to - from + 1;
    if (width > chunkYears || (position !== indexEntries.length - 1 && width !== chunkYears)) {
      throw new Error("Lifecycle chunked capsule chunk width disagreement");
    }
    if (position > 0) {
      const previous = indexes[position - 1];
      if (from <= previous.to) throw new Error("Lifecycle chunked capsule chunks overlap");
      if (from !== previous.to + 1) throw new Error("Lifecycle chunked capsule chunks are not contiguous");
    }
    indexes.push(Object.freeze({ from, to, digest: index.digest }));
  }
  if (!Array.isArray(chunksInput)) throw new Error("Expected lifecycle chunked capsule chunk list");
  if (chunksInput.length !== indexes.length) throw new Error("Lifecycle chunked capsule chunk count disagreement");
  const chunks: LifecycleChunk[] = [];
  const journals: (readonly unknown[])[] = [];
  chunksInput.forEach((entry, position) => {
    const decoded = decodeChunk(entry);
    const index = indexes[position];
    if (decoded.chunk.from !== index.from || decoded.chunk.to !== index.to) {
      throw new Error("Lifecycle chunked capsule chunk range disagreement");
    }
    if (decoded.chunk.digest !== index.digest) {
      throw new Error("Lifecycle chunked capsule chunk digest disagreement");
    }
    chunks.push(decoded.chunk);
    journals.push(decoded.journal);
  });
  return {
    manifest: freeze({ version: LIFECYCLE_CHUNKED_CAPSULE_VERSION, capsuleSchema: LIFECYCLE_CHUNKED_CAPSULE_SCHEMA,
      genesisDigest: manifest.genesisDigest, chunkYears, frontier: manifest.frontier, status: manifest.status,
      chunks: indexes }),
    chunks, journals,
  };
}
async function admitValidated(manifest: LifecycleChunkedManifest, chunks: LifecycleChunk[],
  journals: readonly (readonly unknown[])[], genesisInput: unknown): Promise<LifecycleChunkedCapsule> {
  const genesis = admitLifecycleGenesis(genesisInput);
  if (genesis.digest !== manifest.genesisDigest) {
    throw new Error("Lifecycle chunked capsule genesis digest disagreement");
  }
  // Full current-authority regeneration: the runtime IS the execution authority, so
  // every year is re-derived from genesis and no chunk supplies state.
  const runtime = createLifecycleRuntime(genesis);
  const first = runtime.initial.frontier + 1;
  const frontier = manifest.frontier;
  if (frontier < first - 1) throw new Error("Lifecycle chunked capsule frontier precedes the life");
  if (chunks.length === 0) {
    if (frontier !== first - 1) throw new Error("Lifecycle chunked capsule chunks do not reach the frontier");
  } else {
    if (chunks[0].from !== first) throw new Error("Lifecycle chunked capsule chunks do not start at the life's first year");
    const last = chunks[chunks.length - 1];
    if (last.to !== frontier) throw new Error("Lifecycle chunked capsule chunks do not reach the frontier");
    // Contiguity is already enforced, so the covered span is the stored coverage.
    if (last.to - chunks[0].from + 1 !== frontier - first + 1) {
      throw new Error("Lifecycle chunked capsule chunk coverage disagreement");
    }
  }
  for (let year = first; year <= frontier; year++) {
    try {
      await runtime.advance(year);
    } catch (error) {
      throw new Error(`Lifecycle chunked capsule regeneration refused: ${error instanceof Error ? error.message : "unknown failure"}`);
    }
  }
  const output = runtime.snapshot();
  if (output.status !== manifest.status) throw new Error("Lifecycle chunked capsule status disagreement");
  const expected = partition(output.journal, manifest.chunkYears);
  if (expected.length !== chunks.length) throw new Error("Lifecycle chunked capsule chunk count disagreement");
  for (let position = 0; position < expected.length; position++) {
    const slice = expected[position];
    const chunk = chunks[position];
    if (slice.from !== chunk.from || slice.to !== chunk.to) {
      throw new Error("Lifecycle chunked capsule chunk range disagreement");
    }
    // The decoded slice must equal the regenerated slice for exactly that range.
    // The stored table is canonical (its own decode re-checks byte equality), so
    // table equality follows from this value equality without re-encoding it.
    if (!canonicalLifecycleDataEqual(journals[position], slice.journal)) {
      throw new Error("Lifecycle chunked capsule chunk journal disagreement");
    }
  }
  return Object.freeze({ manifest, chunks: Object.freeze(chunks),
    regenerated: Object.freeze({ genesis, output }) });
}
/** One full regeneration sliced into ordered chunks; nothing is stored as authority. */
export async function createChunkedLifecycleCapsule(input: unknown): Promise<LifecycleChunkedCapsule> {
  requireFavorData(input, true);
  record(input);
  const keys = Object.keys(input);
  if (keys.some(key => !["genesis", "output", "chunkYears"].includes(key)) ||
    !Object.hasOwn(input, "genesis") || !Object.hasOwn(input, "output")) {
    throw new Error("Lifecycle chunked capsule creation keys disagreement");
  }
  const chunkYears = chunkYearsOption(input.chunkYears);
  // Same authority pair as the certified compact capsule: re-admitted genesis and a
  // complete native/economic replay of the candidate output.
  const genesis = admitLifecycleGenesis(input.genesis);
  const output = await replayLifecycleRuntime({ genesis, output: input.output });
  return assemble(genesis, output, chunkYears);
}
/** Cold admission. Requires the caller's genesis (stored once per life) and refuses
 * unless every chunk corroborates the regenerated journal and the manifest itself. */
export async function admitChunkedLifecycleCapsule(input: unknown): Promise<LifecycleChunkedCapsule> {
  requireFavorData(input, true);
  const candidate = exact(input, ["manifest", "chunks", "genesis"], "Lifecycle chunked capsule");
  const { manifest, chunks, journals } = requireStructure(candidate.manifest, candidate.chunks);
  return admitValidated(manifest, chunks, journals, candidate.genesis);
}
function chunkedWire(manifest: LifecycleChunkedManifest, chunks: readonly LifecycleChunk[]): string {
  return JSON.stringify({ manifest, chunks });
}
export async function serializeChunkedLifecycleCapsule(input: unknown): Promise<string> {
  const capsule = await admitChunkedLifecycleCapsule(input);
  return chunkedWire(capsule.manifest, capsule.chunks);
}
/** Strict inverse of `chunkedWire`. The genesis is a separate life input, bound only
 * by `genesisDigest`, so it is required here instead of being duplicated per chunk. */
export async function deserializeChunkedLifecycleCapsule(input: unknown, genesis: unknown): Promise<LifecycleChunkedCapsule> {
  if (typeof input !== "string") throw new Error("Expected lifecycle chunked capsule wire string");
  if (genesis === undefined) throw new Error("Expected lifecycle chunked capsule genesis");
  const envelope: unknown = JSON.parse(input);
  requireFavorData(envelope, true);
  const candidate = exact(envelope, ["manifest", "chunks"], "Lifecycle chunked capsule wire");
  const { manifest, chunks, journals } = requireStructure(candidate.manifest, candidate.chunks);
  // JSON.parse loses duplicates and syntax variants; require the exact canonical
  // bytes BEFORE the expensive regeneration.
  if (chunkedWire(manifest, chunks) !== input) throw new Error("Noncanonical lifecycle chunked capsule wire");
  return admitValidated(manifest, chunks, journals, genesis);
}
function chunkWire(chunk: LifecycleChunk): string {
  return JSON.stringify({ from: chunk.from, to: chunk.to, table: chunk.table, digest: chunk.digest });
}
/** Structural wire for one chunk. It admits the chunk, never a life: corroboration
 * against a regenerated journal happens only in the capsule admission. */
export function serializeLifecycleChunk(input: unknown): string {
  requireFavorData(input, true);
  const { chunk } = decodeChunk(input);
  return chunkWire(chunk);
}
export function deserializeLifecycleChunk(input: unknown): LifecycleChunkContent {
  if (typeof input !== "string") throw new Error("Expected lifecycle chunk wire string");
  const parsed: unknown = JSON.parse(input);
  requireFavorData(parsed, true);
  const { chunk, journal } = decodeChunk(parsed);
  if (chunkWire(chunk) !== input) throw new Error("Noncanonical lifecycle chunk wire");
  return Object.freeze({ from: chunk.from, to: chunk.to, digest: chunk.digest, journal });
}

import { beforeAll, describe, expect, it } from "vitest";
import {
  admitLifecycleCompactCapsule, createLifecycleCompactCapsule, LIFECYCLE_COMPACT_CAPSULE_MANIFEST,
  serializeLifecycleCompactCapsule, type LifecycleCompactCapsule,
} from "./e-lifecycle-capsule";
import { deserializeCompactLifecycleDag, serializeCompactLifecycleDag } from "./e-lifecycle-dag";
import { canonicalLifecycleDataEqual, createLifecycleGenesis, type LifecycleGenesis } from "./e-lifecycle-genesis";
import { createLifecycleRuntime } from "./e-lifecycle-runtime";
import { initializeWorld } from "./world-origin";
import {
  admitChunkedLifecycleCapsule, createChunkedLifecycleCapsule, deserializeChunkedLifecycleCapsule,
  deserializeLifecycleChunk, lifecycleChunkDigest, LIFECYCLE_CHUNKED_CAPSULE_SCHEMA,
  LIFECYCLE_CHUNKED_CAPSULE_VERSION, LIFECYCLE_CHUNKED_DEFAULT_CHUNK_YEARS, serializeChunkedLifecycleCapsule,
  serializeLifecycleChunk, type LifecycleChunkedCapsule,
} from "./e-lifecycle-chunked-capsule";

type Output = LifecycleCompactCapsule["output"];
interface ChunkWire { from: number; to: number; table: string; digest: string }
interface IndexWire { from: number; to: number; digest: string }
interface ManifestWire {
  version: unknown; capsuleSchema: unknown; genesisDigest: unknown; chunkYears: unknown;
  frontier: unknown; status: unknown; chunks: IndexWire[];
}
interface Candidate { manifest: ManifestWire; chunks: ChunkWire[] }

// Short real lives only: the shortest deterministic run that still needs three chunks.
const initialization = { seed: "baseline-1327-1", startYear: 1327, endYear: 1327, founderCount: 6,
  protagonist: { name: "Alice", sex: "random" } };
let genesis: LifecycleGenesis;
let oneYear: Output;
let life: Output;
beforeAll(async () => {
  const { world } = initializeWorld(initialization);
  genesis = createLifecycleGenesis({ initialization, protagonistId: "protagonist",
    resources: Object.fromEntries(Object.keys(world.people).map(id => [id, { grain: 2, effort: 3, need: 1 }])) });
  const runtime = createLifecycleRuntime(genesis);
  await runtime.advance(1327);
  oneYear = runtime.snapshot();
  await runtime.advance(1328);
  await runtime.advance(1329);
  life = runtime.snapshot();
});

function candidateOf(capsule: LifecycleChunkedCapsule): Candidate {
  return {
    manifest: { ...capsule.manifest, chunks: capsule.manifest.chunks.map(index => ({ ...index })) },
    chunks: capsule.chunks.map(chunk => ({ ...chunk })),
  };
}
function submit(candidate: Candidate, life_ = genesis): Promise<LifecycleChunkedCapsule> {
  return admitChunkedLifecycleCapsule({ manifest: candidate.manifest, chunks: candidate.chunks, genesis: life_ });
}

describe("chunked capsule manifest and chunk shape", () => {
  it("exposes the recognized version, chunked schema and exact frozen key set", async () => {
    const capsule = await createChunkedLifecycleCapsule({ genesis, output: oneYear });
    expect(Object.keys(capsule.manifest)).toEqual(["version", "capsuleSchema", "genesisDigest", "chunkYears",
      "frontier", "status", "chunks"]);
    expect(capsule.manifest.version).toBe(LIFECYCLE_CHUNKED_CAPSULE_VERSION);
    expect(capsule.manifest.capsuleSchema).toBe(LIFECYCLE_CHUNKED_CAPSULE_SCHEMA);
    expect(capsule.manifest.genesisDigest).toBe(genesis.digest);
    expect(capsule.manifest.chunkYears).toBe(LIFECYCLE_CHUNKED_DEFAULT_CHUNK_YEARS);
    expect(capsule.manifest.frontier).toBe(1327);
    expect(capsule.manifest.status).toBe("incomplete");
    expect(capsule.manifest.chunks.map(index => [index.from, index.to])).toEqual([[1327, 1327]]);
    expect(Object.keys(capsule.chunks[0])).toEqual(["from", "to", "table", "digest"]);
    for (const value of [capsule.manifest, capsule.manifest.chunks, capsule.manifest.chunks[0],
      capsule.chunks, capsule.chunks[0]]) {
      expect(Object.isFrozen(value)).toBe(true);
    }
  });

  it("lowers the chunk length only", async () => {
    const two = await createChunkedLifecycleCapsule({ genesis, output: life, chunkYears: 2 });
    expect(two.manifest.chunkYears).toBe(2);
    await expect(createChunkedLifecycleCapsule({ genesis, output: oneYear,
      chunkYears: LIFECYCLE_CHUNKED_DEFAULT_CHUNK_YEARS + 1 })).rejects.toThrow(/may not exceed the measured default/);
    await expect(createChunkedLifecycleCapsule({ genesis, output: oneYear, chunkYears: 0 }))
      .rejects.toThrow(/Invalid lifecycle chunked capsule chunk years/);
  });

  it("carries only its own journal slice, never the accumulated world state", async () => {
    const capsule = await createChunkedLifecycleCapsule({ genesis, output: life, chunkYears: 1 });
    const content = deserializeLifecycleChunk(serializeLifecycleChunk(capsule.chunks[0]));
    expect(Object.keys(content)).toEqual(["from", "to", "digest", "journal"]);
    const payload = deserializeCompactLifecycleDag(capsule.chunks[0].table) as Record<string, unknown>;
    expect(Object.keys(payload)).toEqual(["journal"]);
    expect((payload.journal as unknown[]).length).toBe(1);
    // The same year range encodes to the same chunk whatever the life's total length is,
    // so a chunk cannot carry anything the years after it produced.
    const shorter = await createChunkedLifecycleCapsule({ genesis, output: oneYear, chunkYears: 1 });
    expect(shorter.chunks[0].table).toBe(capsule.chunks[0].table);
    const whole = serializeCompactLifecycleDag({ genesis, output: life });
    expect(capsule.chunks[0].table.length).toBeLessThan(whole.length);
  });

  it("partitions the regenerated journal into ordered contiguous chunks", async () => {
    const one = await createChunkedLifecycleCapsule({ genesis, output: life, chunkYears: 1 });
    expect(one.manifest.chunks.map(index => [index.from, index.to])).toEqual([[1327, 1327], [1328, 1328], [1329, 1329]]);
    expect(one.chunks.map(chunk => [chunk.from, chunk.to])).toEqual([[1327, 1327], [1328, 1328], [1329, 1329]]);
    expect(one.manifest.chunks.map(index => index.digest)).toEqual(one.chunks.map(chunk => chunk.digest));
    for (const index of one.manifest.chunks) expect(index.digest).toMatch(/^[a-f0-9]{64}$/);
    const two = await createChunkedLifecycleCapsule({ genesis, output: life, chunkYears: 2 });
    expect(two.manifest.chunks.map(index => [index.from, index.to])).toEqual([[1327, 1328], [1329, 1329]]);
    const short = await createChunkedLifecycleCapsule({ genesis, output: oneYear, chunkYears: 2 });
    expect(short.manifest.chunks.map(index => [index.from, index.to])).toEqual([[1327, 1327]]);
  });
});

describe("chunked capsule admission", () => {
  it("round-trips create then admit and returns the regenerated artifact", async () => {
    const created = await createChunkedLifecycleCapsule({ genesis, output: life, chunkYears: 1 });
    const admitted = await submit(candidateOf(created));
    expect(canonicalLifecycleDataEqual(admitted.manifest, created.manifest)).toBe(true);
    expect(admitted.chunks.map(chunk => chunk.table)).toEqual(created.chunks.map(chunk => chunk.table));
    const fresh = await createLifecycleCompactCapsule({ genesis, output: life });
    expect(admitted.regenerated.genesis.digest).toBe(fresh.genesis.digest);
    expect(canonicalLifecycleDataEqual(admitted.regenerated.output, fresh.output)).toBe(true);
    expect(Object.isFrozen(admitted.regenerated.output)).toBe(true);
  });

  it("serializes and deserializes the whole capsule and single chunks canonically", async () => {
    const created = await createChunkedLifecycleCapsule({ genesis, output: life, chunkYears: 2 });
    const wire = await serializeChunkedLifecycleCapsule({ manifest: created.manifest, chunks: created.chunks, genesis });
    expect(Object.keys(JSON.parse(wire) as object)).toEqual(["manifest", "chunks"]);
    const restored = await deserializeChunkedLifecycleCapsule(wire, genesis);
    expect(restored.manifest.chunks).toEqual(created.manifest.chunks);
    expect(canonicalLifecycleDataEqual(restored.regenerated.output, created.regenerated.output)).toBe(true);
    await expect(deserializeChunkedLifecycleCapsule(`{ ${wire.slice(1)}`, genesis))
      .rejects.toThrow(/Noncanonical lifecycle chunked capsule wire/);
    const chunkWire = serializeLifecycleChunk(created.chunks[0]);
    expect(deserializeLifecycleChunk(chunkWire).from).toBe(1327);
    expect(() => deserializeLifecycleChunk(`${chunkWire} `)).toThrow(/Noncanonical lifecycle chunk wire/);
  });
  it("round-trips a zero-year life with no chunks", async () => {
    const initial = createLifecycleRuntime(genesis).snapshot();
    const created = await createChunkedLifecycleCapsule({ genesis, output: initial });
    expect(created.manifest.chunks).toEqual([]);
    expect(created.manifest.frontier).toBe(initial.frontier);
    const admitted = await submit(candidateOf(created));
    expect(admitted.chunks).toEqual([]);
    expect(canonicalLifecycleDataEqual(admitted.regenerated.output, initial)).toBe(true);
  });
});

describe("chunked capsule refusals", () => {
  let created: LifecycleChunkedCapsule;
  beforeAll(async () => { created = await createChunkedLifecycleCapsule({ genesis, output: life, chunkYears: 1 }); });
  const fresh = (): Candidate => candidateOf(created);

  it("refuses a foreign chunked version", async () => {
    const candidate = fresh();
    candidate.manifest.version = "lifecycle-chunked-capsule-cp1-2";
    await expect(submit(candidate)).rejects.toThrow(/Unsupported lifecycle chunked capsule version/);
  });

  it("refuses a foreign chunked schema", async () => {
    const candidate = fresh();
    candidate.manifest.capsuleSchema = LIFECYCLE_COMPACT_CAPSULE_MANIFEST.capsuleSchema;
    await expect(submit(candidate)).rejects.toThrow(/Unsupported lifecycle chunked capsule schema/);
  });

  it("refuses a chunk whose digest does not cover its own table", async () => {
    const candidate = fresh();
    candidate.chunks[1].digest = "0".repeat(64);
    await expect(submit(candidate)).rejects.toThrow(/chunk digest disagreement/);
  });

  it("binds every chunk digest to its own range", async () => {
    const candidate = fresh();
    candidate.chunks[0].digest = lifecycleChunkDigest(1328, 1328, candidate.chunks[0].table);
    candidate.manifest.chunks[0].digest = candidate.chunks[0].digest;
    await expect(submit(candidate)).rejects.toThrow(/chunk digest disagreement/);
  });

  it("refuses a manifest index digest that disagrees with its chunk", async () => {
    const candidate = fresh();
    candidate.manifest.chunks[1].digest = "1".repeat(64);
    await expect(submit(candidate)).rejects.toThrow(/chunk digest disagreement/);
  });

  it("refuses a tampered table with a stale digest", async () => {
    const candidate = fresh();
    candidate.chunks[1].table += " ";
    await expect(submit(candidate)).rejects.toThrow(/chunk digest disagreement/);
  });

  it("refuses an undecodable table even with a recomputed digest", async () => {
    const candidate = fresh();
    candidate.chunks[1].table = "{}";
    candidate.chunks[1].digest = lifecycleChunkDigest(1328, 1328, "{}");
    candidate.manifest.chunks[1].digest = candidate.chunks[1].digest;
    await expect(submit(candidate)).rejects.toThrow(/chunk table disagreement/);
  });

  it("refuses a chunk payload that smuggles accumulated state", async () => {
    const candidate = fresh();
    const payload = deserializeCompactLifecycleDag(candidate.chunks[0].table) as { journal: unknown[] };
    const table = serializeCompactLifecycleDag({ journal: payload.journal, owned: {} });
    candidate.chunks[0].table = table;
    candidate.chunks[0].digest = lifecycleChunkDigest(1327, 1327, table);
    candidate.manifest.chunks[0].digest = candidate.chunks[0].digest;
    await expect(submit(candidate)).rejects.toThrow(/chunk payload keys disagreement/);
  });

  it("refuses a chunk whose re-digested slice disagrees with regeneration", async () => {
    const candidate = fresh();
    const foreign = candidate.chunks[0].table;
    candidate.chunks[1].table = foreign;
    candidate.chunks[1].digest = lifecycleChunkDigest(1328, 1328, foreign);
    candidate.manifest.chunks[1].digest = candidate.chunks[1].digest;
    await expect(submit(candidate)).rejects.toThrow(/chunk journal disagreement/);
  });

  it("refuses a missing chunk", async () => {
    const candidate = fresh();
    candidate.chunks.pop();
    candidate.manifest.chunks.pop();
    await expect(submit(candidate)).rejects.toThrow(/do not reach the frontier/);
  });

  it("refuses a chunk beyond the frontier", async () => {
    const candidate = fresh();
    const table = candidate.chunks[0].table;
    const digest = lifecycleChunkDigest(1330, 1330, table);
    candidate.manifest.chunks.push({ from: 1330, to: 1330, digest });
    candidate.chunks.push({ from: 1330, to: 1330, table, digest });
    await expect(submit(candidate)).rejects.toThrow(/do not reach the frontier/);
  });

  it("refuses a swapped chunk order", async () => {
    const candidate = fresh();
    [candidate.manifest.chunks[0], candidate.manifest.chunks[1]] =
      [candidate.manifest.chunks[1], candidate.manifest.chunks[0]];
    await expect(submit(candidate)).rejects.toThrow(/chunks overlap/);
  });

  it("refuses a gap and an overlap", async () => {
    const gap = fresh();
    gap.manifest.chunks.splice(1, 1);
    gap.chunks.splice(1, 1);
    await expect(submit(gap)).rejects.toThrow(/chunks are not contiguous/);
    const overlap = fresh();
    overlap.manifest.chunks[1] = { from: 1327, to: 1327, digest: overlap.manifest.chunks[1].digest };
    await expect(submit(overlap)).rejects.toThrow(/chunks overlap/);
  });

  it("refuses an undeclared chunk length and a chunk narrower than declared", async () => {
    const raised = fresh();
    raised.manifest.chunkYears = LIFECYCLE_CHUNKED_DEFAULT_CHUNK_YEARS + 1;
    await expect(submit(raised)).rejects.toThrow(/may not exceed the measured default/);
    const narrowed = fresh();
    narrowed.manifest.chunkYears = 2;
    await expect(submit(narrowed)).rejects.toThrow(/chunk width disagreement/);
  });

  it("refuses a foreign genesis and a wrong status", async () => {
    const foreign = fresh();
    foreign.manifest.genesisDigest = "0".repeat(64);
    await expect(submit(foreign)).rejects.toThrow(/genesis digest disagreement/);
    const status = fresh();
    status.manifest.status = "complete";
    await expect(submit(status)).rejects.toThrow(/status disagreement/);
  });

  it("never accepts the certified compact format", async () => {
    await expect(admitChunkedLifecycleCapsule({ manifest: LIFECYCLE_COMPACT_CAPSULE_MANIFEST, chunks: [],
      genesis })).rejects.toThrow(/manifest keys disagreement/);
    const compactWire = await serializeLifecycleCompactCapsule(await createLifecycleCompactCapsule({ genesis, output: life }));
    await expect(deserializeChunkedLifecycleCapsule(compactWire, genesis)).rejects.toThrow(/wire keys disagreement/);
    await expect(admitLifecycleCompactCapsule({ manifest: created.manifest, digest: "0".repeat(64), genesis,
      output: life })).rejects.toThrow(/Unsupported lifecycle compact capsule manifest/);
  });
});

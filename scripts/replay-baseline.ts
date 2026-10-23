import { performance } from "node:perf_hooks";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";
import { canonicalHash, canonicalJson, createReplayEnvelope, projectResult, replayRules, type ReplayEnvelope } from "../src/domain/replay";
import { generateWorld, type GenerateWorldOptions } from "../src/domain/worldgen";

type ReplayRun = Awaited<ReturnType<typeof replayRules>>;
type Report = ReplayRun["report"];

export const CORPUS = Array.from({ length: 4 }, (_, index): GenerateWorldOptions => ({
  seed: `baseline-1327-${index}`, townName: "Baseline", startYear: 1327, endYear: 1362,
  founderCount: 6, protagonist: { name: "Alice", sex: "f" },
}));

export function assertMatching(first: string, second: string, label: string): void {
  if (first !== second) throw new Error(`${label} mismatch: ${first} != ${second}`);
}

/** Persistence uses an object keyed by year, not JSON.stringify(Map) (which yields {}). */
export function snapshotsObject<T>(snapshots: ReadonlyMap<number, T>): Record<string, T> {
  return Object.fromEntries(snapshots);
}

/** Synchronous elapsed wall time, not CPU time. Compression excludes serialization. */
export function measureJson(value: unknown) {
  const started = performance.now();
  const buffer = Buffer.from(JSON.stringify(value), "utf8");
  const serializationMs = performance.now() - started;
  const gzipStarted = performance.now();
  const gzip = gzipSync(buffer, { level: 6 });
  const gzipMs = performance.now() - gzipStarted;
  const brotliStarted = performance.now();
  const brotli = brotliCompressSync(buffer, {
    params: { [constants.BROTLI_PARAM_QUALITY]: 5 },
  });
  return {
    rawBytes: buffer.byteLength, serializationMs,
    gzip: { level: 6, bytes: gzip.byteLength, compressionMs: gzipMs },
    brotli: { quality: 5, bytes: brotli.byteLength, compressionMs: performance.now() - brotliStarted },
  };
}

export function summarizeRun(envelope: ReplayEnvelope, report: Report) {
  const { input } = envelope;
  const years = [...report.snapshots.keys()].sort((a, b) => a - b);
  const simulatedYears = years.filter((year) => year >= input.config.startYear);
  if (simulatedYears.length === 0) throw new Error("Baseline requires at least one reached simulated year");
  const firstSnapshotYear = years[0]!;
  const lastSnapshotYear = years[years.length - 1]!;
  const inclusiveSimulatedYears = lastSnapshotYear - input.config.startYear + 1;
  const protagonist = input.protagonistId === null ? undefined : report.result.people[input.protagonistId];
  if (!protagonist) throw new Error("Baseline requires an actual protagonist");
  const generatedEvents = report.result.events.length - input.initialEvents.length;
  return {
    years: {
      requestedStartYear: input.config.startYear, requestedEndYear: input.config.endYear,
      firstSnapshotYear, lastSnapshotYear, snapshotCount: years.length,
      firstSimulatedYear: simulatedYears[0]!, reachedYearCount: simulatedYears.length, inclusiveSimulatedYears,
      protagonistAgeAtLastSnapshot: lastSnapshotYear - protagonist.birthYear,
      protagonistDeathYear: protagonist.deathYear ?? null,
      stopReason: protagonist.deathYear !== undefined && protagonist.deathYear <= lastSnapshotYear ? "death" : "cap",
    },
    counts: {
      initialPeople: Object.keys(input.initialPeople).length, finalPeople: Object.keys(report.result.people).length,
      generatedPeople: Object.keys(report.result.people).length - Object.keys(input.initialPeople).length,
      initialEvents: input.initialEvents.length, finalEvents: report.result.events.length, generatedEvents,
      decisions: report.result.decisions.length, decisionCalls: report.decisionCalls,
      hazardFallbacks: { ...report.hazardFallbacks },
      generatedEventsPerInclusiveSimulatedYear: generatedEvents / inclusiveSimulatedYears,
      decisionsPerInclusiveSimulatedYear: report.result.decisions.length / inclusiveSimulatedYears,
    },
  };
}

export function measureReplay(envelope: ReplayEnvelope, run: ReplayRun, replayElapsedMs: number) {
  const inputHashBefore = canonicalHash(envelope);
  const outputHashBefore = canonicalHash(run.canonical);
  assertMatching(outputHashBefore, run.outputHash, "canonical before instrumentation");
  assertMatching(outputHashBefore, canonicalHash(projectResult(run.report.result)), "report projection before instrumentation");
  const summary = summarizeRun(envelope, run.report);
  const sizes = {
    envelopeBytes: Buffer.byteLength(canonicalJson(envelope), "utf8"),
    canonicalBytes: Buffer.byteLength(canonicalJson(run.canonical), "utf8"),
    result: measureJson(run.report.result),
    snapshots: measureJson(snapshotsObject(run.report.snapshots)),
  };
  const outputHashAfter = canonicalHash(run.canonical);
  assertMatching(inputHashBefore, canonicalHash(envelope), "input after instrumentation");
  assertMatching(outputHashBefore, outputHashAfter, "canonical after instrumentation");
  assertMatching(outputHashBefore, canonicalHash(projectResult(run.report.result)), "report projection after instrumentation");
  return {
    inputHash: envelope.manifest.inputHash, envelopeHashBefore: inputHashBefore,
    envelopeHashAfter: canonicalHash(envelope), outputHashBefore, outputHashAfter,
    ...summary, timings: { replayElapsedMs, simulationWallTimeMs: run.report.wallTimeMs }, sizes,
  };
}

function prepare(options: GenerateWorldOptions, roundtrip: boolean) {
  const started = performance.now();
  const world = generateWorld(options);
  const worldgenMs = performance.now() - started;
  const protagonistId = world.people.protagonist?.id;
  if (!protagonistId) throw new Error("Worldgen did not create the baseline protagonist");
  const worldHash = canonicalHash(world);
  const envelopeStarted = performance.now();
  let envelope = createReplayEnvelope({ ...world, protagonistId });
  const envelopeMs = performance.now() - envelopeStarted;
  const roundtripStarted = performance.now();
  if (roundtrip) envelope = JSON.parse(canonicalJson(envelope)) as ReplayEnvelope;
  const roundtripMs = roundtrip ? performance.now() - roundtripStarted : 0;
  assertMatching(worldHash, canonicalHash(world), "world after envelope preparation");
  return { envelope, preparation: { worldgenMs, envelopeMs, roundtripMs } };
}

/** The full report is scoped to one call and is not retained in the corpus summary. */
async function observe(envelope: ReplayEnvelope) {
  const before = canonicalHash(envelope);
  const started = performance.now();
  const run = await replayRules(envelope); // Fresh rules adapter inside replayRules, every call.
  const replayElapsedMs = performance.now() - started; // Includes validation, projection and hash.
  assertMatching(before, canonicalHash(envelope), "input after replay");
  return measureReplay(envelope, run, replayElapsedMs);
}

export async function runSeed(options: GenerateWorldOptions) {
  const first = prepare(options, false);
  const second = prepare(options, true); // Independent world, never a clone of the first.
  assertMatching(first.envelope.manifest.inputHash, second.envelope.manifest.inputHash, "independent input");
  const runs = [];
  for (const prepared of [first, second]) {
    runs.push({ preparation: prepared.preparation, ...await observe(prepared.envelope) });
  }
  assertMatching(runs[0]!.outputHashAfter, runs[1]!.outputHashAfter, "independent output");
  const { input, manifest } = first.envelope;
  return {
    seed: options.seed, generationOptions: options, config: input.config, protagonistId: input.protagonistId,
    versions: manifest.versions, versionsHash: canonicalHash(manifest.versions),
    effectiveOptions: input.options, optionsHash: canonicalHash(input.options),
    configHash: manifest.configHash, runs,
  };
}

async function main() {
  const observations = [];
  for (const options of CORPUS) observations.push(await runSeed(options));
  console.log(JSON.stringify({
    runtime: { node: process.version, v8: process.versions.v8, platform: process.platform, arch: process.arch },
    corpusSize: CORPUS.length, worldGenerationCount: CORPUS.length * 2, replayRunCount: CORPUS.length * 2,
    methodology: {
      execution: "sequential seeds and runs; independent worlds; second envelope canonical JSON roundtrip",
      denominator: "inclusive simulated years: last snapshot year - configured start year + 1, not protagonist age",
      timing: "elapsed wall milliseconds; replay includes admission/projection/hash; serialization includes UTF-8 buffer creation; compression only",
      scope: "standalone rules only; no storage, narration, annual SSE, fork or heap-peak measurement; no coverage or cross-runtime guarantee",
    }, observations,
  }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}

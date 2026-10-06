import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { canonicalLifecycleData, createLifecycleGenesis } from "./e-lifecycle-genesis";
import { createLifecycleRuntime } from "./e-lifecycle-runtime";
import { createLifecycleCapsule, serializeLifecycleCapsule, deserializeLifecycleCapsule } from "./e-lifecycle-capsule";
import { initializeWorld } from "./world-origin";
import type { LifecycleState } from "./e-lifecycle-runtime";

type Output = ReturnType<ReturnType<typeof createLifecycleRuntime>["snapshot"]>;
const childSelected = process.env.LIFECYCLE_MEMORY_CHILD === "1";
const marker = "LP1A_MEMORY ";
const hash = (text: string) => createHash("sha256").update(text).digest("hex");

// Full own-data traversal, not a hash-only certificate or a projected snapshot.
// Diagnostics identify the path without printing the cumulative world/wire.
function fidelity(actual: unknown, expected: unknown, path = "root"): void {
  if (expected === null || typeof expected !== "object") {
    if (!Object.is(actual, expected)) throw new Error(`Leaf disagreement at ${path}`);
    return;
  }
  if (actual === null || typeof actual !== "object" || Array.isArray(actual) !== Array.isArray(expected)) {
    throw new Error(`Container disagreement at ${path}`);
  }
  const a = actual as Record<string, unknown>;
  const e = expected as Record<string, unknown>;
  if (JSON.stringify(Object.keys(a).sort()) !== JSON.stringify(Object.keys(e).sort())) throw new Error(`Own-key disagreement at ${path}`);
  for (const key of Object.keys(e)) fidelity(a[key], e[key], `${path}.${key}`);
}
function frozen(value: unknown, seen = new Set<object>()): void {
  if (value === null || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  if (!Object.isFrozen(value)) throw new Error("Unfrozen published data");
  Object.values(value).forEach(entry => frozen(entry, seen));
}
function traversal(actual: Output, expected: Output): void {
  const states = (value: Output) => [value, ...value.journal.flatMap(record => [record.postNative, record.final])];
  const a = states(actual);
  const e = states(expected);
  for (let i = 0; i < e.length; i++) {
    expect(Object.keys(a[i].owned.people)).toEqual(Object.keys(e[i].owned.people));
  }
  expect(Object.keys(actual.canonicalYearSnapshot.people)).toEqual(Object.keys(expected.canonicalYearSnapshot.people));
  for (let i = 0; i < expected.journal.length; i++) {
    expect(Object.keys(actual.journal[i].physicalSnapshot.people)).toEqual(Object.keys(expected.journal[i].physicalSnapshot.people));
  }
}
function aliases(output: Output): void {
  const states = [output, ...output.journal.flatMap(record => [record.postNative, record.final])];
  for (const state of states) {
    const { owned, favors } = state as unknown as LifecycleState;
    expect(owned.people === favors.people).toBe(true);
    expect(owned.events === favors.legacyEvents).toBe(true);
  }
}

it.skipIf(!childSelected)("memory-child: fixed genuine runtime and full cold capsule", async () => {
  const started = performance.now();
  const phases: { phase: string; rssBytes: number; heapUsedBytes: number; elapsedMs: number }[] = [];
  function sample(phase: string): void {
    const usage = process.memoryUsage();
    phases.push({ phase, rssBytes: usage.rss, heapUsedBytes: usage.heapUsed, elapsedMs: performance.now() - started });
  }
  // Includes the child Vitest engine/imports. Never measure the supervising parent.
  sample("before-genesis");
  const baselineRssBytes = phases[0].rssBytes;
  // Match the predeclared controller fixture exactly: omit defaults from requested
  // origin evidence, not merely reproduce equivalent effective configuration.
  const initialization = { seed: "lifecycle-representative-v1/4", protagonist: { name: "Alice", sex: "f" } };
  const { world } = initializeWorld(initialization);
  expect(Object.keys(world.people)).toHaveLength(85); // E1 default62 founders plus generated family
  const genesis = createLifecycleGenesis({ initialization, protagonistId: "protagonist",
    resources: Object.fromEntries(Object.keys(world.people).map(id => [id, { grain: 2, effort: 3, need: 1 }])) });
  expect(genesis.initial.people.protagonist.birthYear).toBe(1498);
  sample("genesis");
  const runtime = createLifecycleRuntime(genesis);
  let output = runtime.initial;
  // A normal consumer explicitly releases earlier frames, without forced GC.
  let firstFrame: Output | undefined;
  let secondFrame: Output | undefined;
  let steps = 0;
  while (output.status !== "complete" && steps < 128) {
    output = await runtime.advance(output.frontier + 1);
    steps++;
    if (steps === 1) firstFrame = output;
    if (steps === 2) secondFrame = output;
    if (steps === 3) {
      expect(firstFrame!.frontier).toBe(1498);
      expect(secondFrame!.frontier).toBe(1499);
      firstFrame = undefined;
      secondFrame = undefined;
    }
    sample(`annual-${steps}`);
  }
  expect(firstFrame).toBeUndefined();
  expect(secondFrame).toBeUndefined();
  expect(steps).toBe(4); // Predeclared member's observed genuine death, not a cap.
  expect(output.status).toBe("complete");
  expect(output.frontier).toBe(1501);
  expect(output.owned.people.protagonist.deathYear).toBe(output.frontier);
  aliases(output);
  frozen(output);
  sample("full-output-checked");
  const evidence = { genesis, output };
  const capsule = await createLifecycleCapsule(evidence);
  fidelity(capsule.genesis, genesis);
  fidelity(capsule.output, output);
  aliases(capsule.output);
  sample("certified-capsule");
  const wire = await serializeLifecycleCapsule(capsule);
  const wireBytes = Buffer.byteLength(wire);
  sample("serialized");
  const cold = await deserializeLifecycleCapsule(wire);
  sample("cold-admitted");
  fidelity(cold, capsule);
  traversal(cold.output, output);
  expect(Object.keys(cold.genesis.initial.people)).toEqual(genesis.initial.registryOrder);
  aliases(cold.output);
  frozen(cold);
  const canonical = canonicalLifecycleData(evidence);
  expect(canonicalLifecycleData({ genesis: cold.genesis, output: cold.output }) === canonical).toBe(true);
  sample("complete-cold-proof");
  const totalMaxRssBytes = process.resourceUsage().maxRSS * 1024;
  process.stdout.write(`${marker}${JSON.stringify({ node: process.version, seed: initialization.seed, steps,
    frontier: output.frontier, status: output.status, baselineRssBytes, totalMaxRssBytes,
    highWaterMinusBaselineBytes: totalMaxRssBytes - baselineRssBytes,
    provisionalTargetBytes: 1_000_000_000, targetMet: totalMaxRssBytes <= 1_000_000_000,
    elapsedMs: performance.now() - started, wireBytes, canonicalHash: hash(canonical), wireHash: hash(wire),
    fullColdProof: true, phases })}\n`);
}, 600000);

it.skipIf(childSelected)("measures one fresh child, including its Vitest process high-water RSS", async () => {
  const runner = resolve("node_modules/vitest/vitest.mjs");
  const file = resolve("src/domain/e-lifecycle-memory.test.ts");
  const result = await new Promise<string>((accept, reject) => {
    const child = spawn(process.execPath, [runner, "run", file, "--maxWorkers=1", "--pool=threads", "-t", "memory-child"], {
      cwd: process.cwd(), env: { ...process.env, LIFECYCLE_MEMORY_CHILD: "1" }, stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let failure: Error | undefined;
    const timer = setTimeout(() => {
      failure = new Error("Memory child exceeded bounded lifetime");
      child.kill("SIGKILL");
    }, 590000);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
      if (stdout.length > 65536) {
        failure = new Error("Memory child exceeded bounded diagnostics");
        child.kill("SIGKILL");
      }
    });
    child.stderr.on("data", (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-8192); });
    child.on("error", error => { clearTimeout(timer); reject(error); });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (failure || code !== 0) reject(failure ?? new Error(`Memory child failed (${code}/${signal}): ${stderr}\n${stdout.slice(-8192)}`));
      else accept(stdout);
    });
  });
  const lines = result.split("\n").filter(line => line.startsWith(marker));
  expect(lines).toHaveLength(1);
  const metrics = JSON.parse(lines[0].slice(marker.length));
  expect(metrics.fullColdProof).toBe(true);
  expect(metrics.steps).toBe(4);
  expect(metrics.wireBytes).toBe(56561271);
  expect(metrics.canonicalHash).toBe("2f83c72b46391454fbc44e2288be27f09ef161ebf7d5c794a610bc072e881451");
  expect(metrics.wireHash).toBe("1ef4498df18f17cf3b17df4cfee86749450485bfdc29623a0e358ea830e709e8");
  expect(metrics.totalMaxRssBytes).toBeGreaterThan(0);
  // The target is advisory data, never a volatile hard-threshold assertion.
  process.stdout.write(`${lines[0]}\n`);
}, 600000);

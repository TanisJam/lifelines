import { describe, expect, it, vi } from "vitest";
import * as worldgen from "./worldgen";
import * as replay from "./replay";
import {
  assertMatching, measureJson, measureReplay, runSeed, snapshotsObject, summarizeRun,
} from "../../scripts/replay-baseline";

const options = {
  seed: "baseline-test", townName: "Baseline", startYear: 1327, endYear: 1328,
  founderCount: 6, protagonist: { name: "Alice", sex: "f" as const },
};

function envelope() {
  const world = worldgen.generateWorld(options);
  return replay.createReplayEnvelope({ ...world, protagonistId: world.people.protagonist!.id });
}

describe("baseline measurement helpers (import does not run the corpus)", () => {
  it("counts UTF-8 buffer bytes, not characters, with explicit compression settings", () => {
    const value = { text: "é🌾" };
    const measurement = measureJson(value);
    expect(measurement.rawBytes).toBe(Buffer.byteLength(JSON.stringify(value), "utf8"));
    expect(measurement.rawBytes).toBeGreaterThan(JSON.stringify(value).length);
    expect(measurement.gzip.level).toBe(6);
    expect(measurement.brotli.quality).toBe(5);
    expect(value).toEqual({ text: "é🌾" });
  });

  it("converts Map snapshots to a year-keyed object before serialization", () => {
    const snapshots = new Map([[1327, { year: 1327 }], [1328, { year: 1328 }]]);
    expect(snapshotsObject(snapshots)).toEqual({ 1327: { year: 1327 }, 1328: { year: 1328 } });
    expect(measureJson(snapshotsObject(snapshots)).rawBytes).toBeGreaterThan(2);
    expect(snapshots.size).toBe(2);
  });

  it("rejects either independent input or output mismatch", () => {
    expect(() => assertMatching("a", "b", "input")).toThrow(/input.*mismatch/);
    expect(() => assertMatching("a", "b", "output")).toThrow(/output.*mismatch/);
    expect(() => assertMatching("a", "a", "output")).not.toThrow();
  });

  it("measures a real run without changing inputs, canonical output or reports", async () => {
    const input = envelope();
    const before = replay.canonicalJson(input);
    const run = await replay.replayRules(input);
    const reportBefore = JSON.stringify({ result: run.report.result, snapshots: snapshotsObject(run.report.snapshots) });
    const measured = measureReplay(input, run, 1);
    expect(measured.outputHashBefore).toBe(run.outputHash);
    expect(measured.outputHashAfter).toBe(run.outputHash);
    expect(replay.canonicalJson(input)).toBe(before);
    expect(JSON.stringify({ result: run.report.result, snapshots: snapshotsObject(run.report.snapshots) })).toBe(reportBefore);
    expect(measured.sizes.envelopeBytes).toBe(Buffer.byteLength(before));
    expect(measured.sizes.canonicalBytes).toBe(Buffer.byteLength(replay.canonicalJson(run.canonical)));
    expect(measured.sizes.snapshots.rawBytes).toBeGreaterThan(2);
    expect(measured.counts.initialEvents).toBe(input.input.initialEvents.length);
    expect(measured.counts.generatedEvents).toBe(run.report.result.events.length - input.input.initialEvents.length);
    expect(measured.counts.decisions).toBe(run.report.result.decisions.length);
    // The Map also includes the initial checkpoint at startYear - 1.
    expect(measured.years.firstSnapshotYear).toBe(1326);
    expect(measured.years.firstSimulatedYear).toBe(1327);
    expect(measured.years.inclusiveSimulatedYears).toBe(run.report.snapshots.size - 1);
    expect(measured.years.stopReason).toBe("cap");
    expect(measured.years.protagonistAgeAtLastSnapshot).toBe(1);

    const earlyReport = {
      ...run.report, snapshots: new Map([
        [1326, run.report.snapshots.get(1326)!], [1327, run.report.snapshots.get(1327)!],
      ]),
      result: { ...run.report.result, people: {
        ...run.report.result.people, protagonist: { ...run.report.result.people.protagonist!, deathYear: 1327 },
      } },
    };
    const early = summarizeRun(input, earlyReport);
    expect(early.years).toMatchObject({
      firstSnapshotYear: 1326, lastSnapshotYear: 1327, snapshotCount: 2, firstSimulatedYear: 1327,
      inclusiveSimulatedYears: 1, protagonistAgeAtLastSnapshot: 0,
      protagonistDeathYear: 1327, stopReason: "death",
    });
    expect(early.counts.generatedEventsPerInclusiveSimulatedYear).toBe(early.counts.generatedEvents);
    expect(() => measureReplay(input, { ...run, outputHash: "tampered" }, 1)).toThrow(/mismatch/);
  });

  it("runs two independent complete worlds and replays sequentially on a small real fixture", async () => {
    const generation = vi.spyOn(worldgen, "generateWorld");
    const simulation = vi.spyOn(replay, "replayRules");
    try {
      const pair = await runSeed(options);
      expect(generation).toHaveBeenCalledTimes(2);
      expect(simulation).toHaveBeenCalledTimes(2);
      expect(generation.mock.results[0]!.value).not.toBe(generation.mock.results[1]!.value);
      expect(pair.runs).toHaveLength(2);
      expect(pair.runs[0]!.inputHash).toBe(pair.runs[1]!.inputHash);
      expect(pair.runs[0]!.outputHashAfter).toBe(pair.runs[1]!.outputHashAfter);
      expect(pair.runs[0]!.counts.initialPeople).toBeGreaterThanOrEqual(7);
      expect(pair.runs[0]!.counts.initialEvents).toBeGreaterThan(0);
      expect(pair.config).toEqual({ seed: options.seed, startYear: 1327, endYear: 1328, town: { name: "Baseline" } });
      expect(pair.protagonistId).toBe("protagonist");
    } finally {
      vi.restoreAllMocks();
    }
  });
});

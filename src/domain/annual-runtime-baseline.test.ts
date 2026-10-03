import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { CORPUS, ownDataIdentity, assertEquivalent, executeFixture, measureFixture, runBaseline, wireBytes } from "../../scripts/annual-runtime-baseline";
import { createAnnualRuntimeCapsule, deserializeAnnualRuntimeCapsule, serializeAnnualRuntimeCapsule } from "./e-capsule";

it("counts UTF-8 bytes, not code units", () => {
  expect(wireBytes("é🌱")).toBe(6);
});

it("rejects independent mismatches without losing undefined, key presence or signed zero", () => {
  expect(ownDataIdentity({ a: undefined })).not.toBe(ownDataIdentity({}));
  expect(ownDataIdentity([undefined])).not.toBe(ownDataIdentity([]));
  expect(ownDataIdentity(-0)).not.toBe(ownDataIdentity(0));
  expect(() => assertEquivalent({ a: undefined }, {}, "independent")).toThrow(/independent/);
  expect(() => assertEquivalent(-0, 0, "independent")).toThrow(/independent/);
});

it("fails closed on unequal independent canon", () => {
  expect(() => assertEquivalent({ frontier: 1327 }, { frontier: 1333 }, "independent canon")).toThrow(/independent canon/);
});

describe("real bounded E fixtures", () => {
  it.each(CORPUS)("preserves complete canon, inputs and retained checkpoints: $name", fixture => {
    const first = executeFixture(fixture);
    const second = executeFixture(fixture);
    expect(first.input).not.toBe(second.input);
    expect(first.runtime.initial).not.toBe(second.runtime.initial);
    const beforeInput = ownDataIdentity(first.input);
    const beforeRetained = ownDataIdentity(first.checkpoints);
    const measured = measureFixture(first);
    expect(ownDataIdentity(first.input)).toBe(beforeInput);
    expect(ownDataIdentity(first.checkpoints)).toBe(beforeRetained);
    assertEquivalent(first.checkpoints, second.checkpoints, "independent canon");
    const wires = first.checkpoints.slice(1).map(output => serializeAnnualRuntimeCapsule(createAnnualRuntimeCapsule(output)));
    expect(measured.bytes.retainedExecutedCheckpointWireBytesInitialExcluded).toBe(wires.reduce((sum, wire) => sum + Buffer.byteLength(wire, "utf8"), 0));
    expect(measured.bytes.finalWireBytes).toBe(Buffer.byteLength(wires.at(-1)!, "utf8"));
    assertEquivalent(deserializeAnnualRuntimeCapsule(wires.at(-1)!).output, first.runtime.final(), "cold fidelity");
    expect(measured.fork.frontier).toBe(first.input.plans[0].year);
    expect(measured.fork.parity).toBe(true);
  });

  it("separates quiet gapped executed plans from calendar span and rejects a changed second run", () => {
    const fixture = CORPUS[0];
    const measured = measureFixture(executeFixture(fixture));
    expect(measured.counts.executedPlans).toBe(2);
    expect(measured.calendar.inclusiveSpan).toBe(7);
    expect(measured.counts.entriesPerExecutedPlan).toBe(0);
    let calls = 0;
    expect(() => runBaseline(candidate => {
      const run = executeFixture(candidate);
      if (++calls === 2) return { ...run, input: { ...run.input, plans: [] } };
      return run;
    })).toThrow(/independent input/);
  });

  it("rejects a runner with changed retained canon even when inputs match", () => {
    let calls = 0;
    expect(() => runBaseline(fixture => {
      const run = executeFixture(fixture);
      if (++calls === 2) return { ...run, checkpoints: run.checkpoints.slice(0, 1) };
      return run;
    })).toThrow(/independent complete canon/);
  });

  it("exercises own array undefined, signed zero, blocked intentions and allocated newcomer", () => {
    const run = executeFixture(CORPUS[3]);
    const final = run.runtime.final();
    expect(Object.is(final.state.people.newcomer.mind.stress, -0)).toBe(true);
    expect(Object.hasOwn(final.state.people.newcomer, "deathYear")).toBe(false);
    const entry = final.journal[0].entries.find(entry => entry.id === "early")!;
    const grain = (entry.consumed as { grain: unknown[] }).grain;
    expect(Object.hasOwn(grain, 1)).toBe(true);
    expect(grain[1]).toBeUndefined();
    expect(Object.hasOwn(final.state.grain, "newcomer")).toBe(true);
    expect(run.checkpoints[2].state.assistance.newcomer).toBe(1);
    expect(final.state.assistance.newcomer).toBe(0);
    expect(measureFixture(executeFixture(CORPUS[2])).counts.ineligible).toBeGreaterThan(0);
    const delayed = executeFixture(CORPUS[1]).runtime.final();
    expect(delayed.journal[2].entries.some(entry => entry.kind === "help-response")).toBe(true);
    const hasOwnUndefined = (value: unknown): boolean => value !== null && typeof value === "object"
      && Object.keys(value).some(key => Reflect.get(value, key) === undefined || hasOwnUndefined(Reflect.get(value, key)));
    expect(hasOwnUndefined(final)).toBe(true);
  });
});

it("is inactive on functional import and emits one compact JSON report on real CLI", () => {
  const imported = execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", 'await import("./scripts/annual-runtime-baseline.ts"); console.log("import-only")'], { encoding: "utf8", env: { ...process.env, TSX_DISABLE_CACHE: "1" } });
  expect(imported).toBe("import-only\n");
  const stdout = execFileSync(process.execPath, ["--import", "tsx", "scripts/annual-runtime-baseline.ts"], { encoding: "utf8", env: { ...process.env, TSX_DISABLE_CACHE: "1" } });
  expect(stdout.trim().split("\n")).toHaveLength(1);
  const report = JSON.parse(stdout);
  expect(report.corpus.names).toEqual(CORPUS.map(fixture => fixture.name));
  expect(report.corpus.count).toBe(4);
  expect(report.observations).toHaveLength(4);
  expect(report.host.node).toBe(process.version);
}, 60_000);

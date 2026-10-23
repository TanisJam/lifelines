import { describe, expect, it } from "vitest";
import { requireAnnualPolicyView } from "@/domain/e-annual-policy";
import { createLifecycleGenesis } from "@/domain/e-lifecycle-genesis";
import { runLifecycleOutput } from "@/domain/e-lifecycle-run";
import { currentHelpContext, inspectHelpOpportunities, isTrustedFavorState, trustFavorState } from "@/domain/effects";
import { initializeWorld } from "@/domain/world-origin";

/**
 * The deep `ownData` walk is a guard for CALLER-SUPPLIED state: it must still refuse malformed input,
 * and the WeakSet mark must skip it for the exact object the engine marked - never for a copy of it.
 *
 * This pins the L8 optimization. A test that only inspects a PUBLISHED snapshot proves nothing:
 * `run.output.favors` is a frozen clone, so it was never marked, and such a test stays green after the
 * optimization is deleted.
 */
const SEED = "cap-0";

function fixture(seed: string) {
  const initialization = { seed, startYear: 1327, endYear: 1427, protagonist: { name: "Probe", sex: "f" as const } };
  const { world } = initializeWorld(initialization);
  return createLifecycleGenesis({ initialization, protagonistId: "protagonist",
    resources: Object.fromEntries(Object.keys(world.people).map((id) => [id, { grain: 2, effort: 3, need: 1 }])) });
}

async function ledger() {
  const genesis = fixture(SEED);
  const run = await runLifecycleOutput({ kind: "start", genesis }, { maxSteps: 3 }, "compact");
  const favors = run.output.favors as unknown as Record<string, unknown> & {
    grain: Record<string, number>; obligations: { id: string }[] };
  return { favors, year: run.output.frontier, obligationId: favors.obligations[0]!.id, firstGrainId: Object.keys(favors.grain)[0]! };
}

/** A copy of the ledger whose `grain` carries an accessor: refused unless the walk is skipped. */
function withAccessor(favors: Record<string, unknown>, firstGrainId: string) {
  const grain: Record<string, number> = {};
  Object.defineProperty(grain, firstGrainId, { get: () => 2, enumerable: true, configurable: true });
  return { ...favors, grain };
}

describe("favour-state trust boundary (L8)", () => {
  it("still refuses caller-supplied state that no engine path marked", async () => {
    const { favors, year, obligationId, firstGrainId } = await ledger();
    const cases = {
      accessor: () => withAccessor(favors, firstGrainId),
      "own-undefined": () => ({ ...favors, appraisals: undefined }),
      "nonplain-proto": () => Object.assign(Object.create({ marker: 1 }), favors),
      "nan-grain": () => ({ ...favors, grain: { ...favors.grain, [firstGrainId]: Number.NaN } }),
    };
    for (const [name, make] of Object.entries(cases)) {
      const view = make();
      expect(isTrustedFavorState(view), name).toBe(false);
      expect(() => inspectHelpOpportunities(view as never, year), name).toThrow();
    }
    expect(() => requireAnnualPolicyView(withAccessor(favors, firstGrainId))).toThrow("Not own enumerable data");
    expect(() => currentHelpContext(withAccessor(favors, firstGrainId) as never, obligationId, year)).toThrow();
  }, 120_000);

  it("skips the deep walk for the marked object only, and keeps the cheap structural checks", async () => {
    const { favors, year, firstGrainId } = await ledger();
    const malformed = withAccessor(favors, firstGrainId);
    expect(() => inspectHelpOpportunities(malformed as never, year)).toThrow("Not own enumerable data");
    trustFavorState(malformed);
    expect(isTrustedFavorState(malformed)).toBe(true);
    // The skip: the same malformed object is accepted once marked.
    expect(() => inspectHelpOpportunities(malformed as never, year)).not.toThrow();
    // A copy is a different object and is still walked.
    const copy = { ...malformed };
    expect(isTrustedFavorState(copy)).toBe(false);
    expect(() => inspectHelpOpportunities(copy as never, year)).toThrow("Not own enumerable data");
    // Structural checks survive the skip.
    const badTies = { ...favors, ties: {} };
    trustFavorState(badTies);
    expect(() => inspectHelpOpportunities(badTies as never, year)).toThrow("Expected array");
    const missing = { ...favors } as Record<string, unknown>;
    delete missing.appraisals;
    trustFavorState(missing);
    expect(() => requireAnnualPolicyView(missing)).toThrow("Unexpected fields");
    // A non-record must still fail with the legacy text, before any walk.
    expect(() => inspectHelpOpportunities(null as never, year)).toThrow("Expected record");
  }, 120_000);
});

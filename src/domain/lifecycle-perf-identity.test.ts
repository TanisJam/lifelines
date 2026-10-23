import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalLifecycleData, createLifecycleGenesis } from "@/domain/e-lifecycle-genesis";
import { runLifecycleOutput } from "@/domain/e-lifecycle-run";
import { createLifecycleCompactCapsule } from "@/domain/e-lifecycle-capsule";
import { initializeWorld } from "@/domain/world-origin";
import { projectLifecycleChronicle, projectLifecyclePersonSheet } from "@/server/lifecycle-projection";

/**
 * The L8 speedup is a PURE performance change: the trust mark and `auditEvidence` must not alter the
 * life. These are the create-side bytes of two real runs, pinned to what the pre-optimisation engine
 * (b1d70d3) produced. A change here is a behaviour change, not a perf change.
 */
const sha = (value: string) => createHash("sha256").update(value).digest("hex");

function fixture(seed: string) {
  const initialization = { seed, startYear: 1327, endYear: 1427, protagonist: { name: "Probe", sex: "f" as const } };
  const { world } = initializeWorld(initialization);
  return createLifecycleGenesis({ initialization, protagonistId: "protagonist",
    resources: Object.fromEntries(Object.keys(world.people).map((id) => [id, { grain: 2, effort: 3, need: 1 }])) });
}

async function measure(seed: string, steps: number) {
  const genesis = fixture(seed);
  const run = await runLifecycleOutput({ kind: "start", genesis }, { maxSteps: steps }, "compact");
  const output = run.output;
  const capsule = await createLifecycleCompactCapsule({ genesis: run.genesis, output }, "compact");
  const source = { genesis: run.genesis, output };
  const chronicle = (await projectLifecycleChronicle({ source, identity: { lifeId: "probe", branchId: "b" } })).view;
  const sheets: Record<string, string> = {};
  for (const personId of Object.keys(output.owned.people).sort()) {
    sheets[personId] = sha(JSON.stringify((await projectLifecyclePersonSheet({ source, personId })).view));
  }
  return {
    status: output.status, frontier: output.frontier, years: output.journal.length,
    digest: capsule.digest,
    journal: sha(canonicalLifecycleData(output.journal)),
    chronicle: sha(JSON.stringify(chronicle)),
    chronicleEntries: (chronicle as unknown as { entries: unknown[] }).entries.length,
    sheets: sha(JSON.stringify(sheets)), sheetCount: Object.keys(sheets).length,
  };
}

describe("compact create bytes are unchanged by the L8 performance work", () => {
  it("ri1c-lifecycle-1 dies at 1328 with the same bytes", async () => {
    expect(await measure("ri1c-lifecycle-1", 3)).toEqual({
      status: "complete", frontier: 1328, years: 2,
      digest: "c78ef2288074e30983527203406658a1bf195d1a2f61f71643035239e1c9e561",
      journal: "b53f1b702f0dc1e2209426fdb0a70b9282d3817d1ee36ca22537fff989e0a0ed",
      chronicle: "beb6322aee20905b4e21e118eeaac0fd635679ad3c6a07c643be98e1f8a38b26",
      chronicleEntries: 2,
      sheets: "61299d959d117ca1bfbb33d94643a313f04aac136737c8aa7fc2688e9c98be24",
      sheetCount: 85,
    });
  }, 120_000);

  it("cap-0 keeps the same ten-year bytes", async () => {
    expect(await measure("cap-0", 10)).toEqual({
      status: "incomplete", frontier: 1336, years: 10,
      digest: "641be6b9fe8e3dfb2b3739a32761bda16b448479382f6e843ca39b5fdd8dceb3",
      journal: "59bf3a262046f10e8f2ecbdd1ae02513082a7a8f5a527ff15804d9ff2c24cdcd",
      chronicle: "be6dbf1f684ee8e93580ce52925e17799b701e396ad112f96d0702a641ee3a0c",
      chronicleEntries: 10,
      sheets: "2ed2349d8ec5f099f616a2dd61927a4073c2f5ef20903cedfd53ace158eee3e1",
      sheetCount: 111,
    });
  }, 180_000);
});

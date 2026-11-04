import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { canonicalLifecycleData, createLifecycleGenesis } from "./e-lifecycle-genesis";
import { createLifecycleCompactCapsule, serializeLifecycleCompactCapsule } from "./e-lifecycle-capsule";
import { runLifecycleOutput } from "./e-lifecycle-run";
import { LOCALES } from "./locale";
import { initializeWorld } from "./world-origin";
import { openDb } from "@/server/db";
import { LifecycleRepository } from "@/server/lifecycle-repository";
import { projectLifecycleChronicle, projectLifecyclePersonSheet, projectLifecycleTick } from "@/server/lifecycle-projection";

const hash = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const canonicalHash = (value: unknown) => hash(canonicalLifecycleData(value));

it("preserves the fixed-seed ticks, indexed views, capsule bytes and cold loads", async () => {
  const initialization = { seed: "ri1c-lifecycle-1", startYear: 1327, endYear: 1427, protagonist: { name: "Probe", sex: "f" as const } };
  const { world } = initializeWorld(initialization);
  const genesis = createLifecycleGenesis({ initialization, protagonistId: "protagonist", resources: Object.fromEntries(Object.keys(world.people).map(id => [id, { grain: 2, effort: 3, need: 1 }])) });
  const observed: Record<string, unknown> = {};
  for (const mode of ["audit", "compact"] as const) {
    const ticks: unknown[] = [];
    const run = await runLifecycleOutput({ kind: "start", genesis }, { maxSteps: 2, onYear: async output => {
      ticks.push({ type: "tick", ...(await projectLifecycleTick({ source: { genesis, output }, year: output.frontier, locale: "en" })).view });
    } }, mode);
    const identity = { lifeId: `golden-${mode}`, branchId: `branch-${mode}` };
    const projections = [];
    const personSheets = [];
    for (const locale of LOCALES) {
      projections.push({ locale, view: (await projectLifecycleChronicle({ source: run, identity, locale })).view });
      for (const personId of Object.keys(run.output.owned.people)) personSheets.push({ locale, personId, view: (await projectLifecyclePersonSheet({ source: run, personId, locale })).view });
    }
    const capsule = await createLifecycleCompactCapsule({ genesis: run.genesis, output: run.output }, mode);
    const db = openDb(":memory:");
    try {
      const repository = new LifecycleRepository(db);
      const binding = await repository.publish({ ...identity, config: world.config, protagonistName: "Probe", protagonistSex: "f", capsule, projections, personSheets });
      const loaded = await repository.load(identity.lifeId, identity.branchId);
      expect(loaded?.binding).toEqual(binding);
      observed[mode] = { ticks: ticks.map(canonicalHash), projections: canonicalHash(projections), personSheets: canonicalHash(personSheets), capsuleDigest: capsule.digest, canonicalBytes: hash(await serializeLifecycleCompactCapsule(capsule)), coldDigest: loaded?.capsule.digest, coldBytes: hash(await serializeLifecycleCompactCapsule(loaded!.capsule)) };
    } finally { db.close(); }
  }
  const ticks = ["23caf3b05f7cd8021d932210c1c67d909c6d24840b90f225d7125f448edd7acf", "eae1306bb828a09577037edecfc15e192a1fb3459fcbb9c866af909ee399f2e9"];
  const personSheets = "0cc5ea65be514b284bc14ea6dbc1f0ec37c17eec09cd5babadd7ca9683a9d0c9";
  expect(observed).toEqual({
    audit: { ticks, personSheets, projections: "93abdda73c62a40187216707ebbfd68d212c9aba98f84486ece238fecb6d3dcf", capsuleDigest: "9a4f840bfcceddfc2e566ef5a8403403c25067a9e6b08f6ba74e7fd64e42f83c", coldDigest: "9a4f840bfcceddfc2e566ef5a8403403c25067a9e6b08f6ba74e7fd64e42f83c", canonicalBytes: "4f9c4d3e3b6690584e9031f7d9e1d5a1e5d53db8bd4f1fdd78c14e6419c98e6d", coldBytes: "4f9c4d3e3b6690584e9031f7d9e1d5a1e5d53db8bd4f1fdd78c14e6419c98e6d" },
    compact: { ticks, personSheets, projections: "ad082270540b57b111859207813d9cd569d1767224cbbfb8533a0a5a27839f49", capsuleDigest: "c78ef2288074e30983527203406658a1bf195d1a2f61f71643035239e1c9e561", coldDigest: "c78ef2288074e30983527203406658a1bf195d1a2f61f71643035239e1c9e561", canonicalBytes: "976b6710d06113f8b0abb858f68aceb059d4a89798d1235d509318f0f019c834", coldBytes: "976b6710d06113f8b0abb858f68aceb059d4a89798d1235d509318f0f019c834" },
  });
}, 120_000);

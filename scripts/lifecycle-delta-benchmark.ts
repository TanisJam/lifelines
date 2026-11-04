import { serialize } from "node:v8";
import { createLifecycleGenesis } from "../src/domain/e-lifecycle-genesis";
import { createLifecycleRuntime } from "../src/domain/e-lifecycle-runtime";
import { createLifecycleCompactCapsule } from "../src/domain/e-lifecycle-capsule";
import { LOCALES } from "../src/domain/locale";
import { initializeWorld } from "../src/domain/world-origin";
import { openDb } from "../src/server/db";
import { LifecycleRepository } from "../src/server/lifecycle-repository";
import { projectLifecycleChronicle, projectLifecyclePersonSheet, projectLifecycleTick } from "../src/server/lifecycle-projection";

async function main() {
  let heapPeak = process.memoryUsage().heapUsed;
  const times: Record<string, number> = {};
  const sample = () => { heapPeak = Math.max(heapPeak, process.memoryUsage().heapUsed); };
  async function measure<T>(name: string, fn: () => T | Promise<T>): Promise<T> {
    const start = performance.now();
    try { return await fn(); } finally { times[name] = +(performance.now() - start).toFixed(2); sample(); }
  }
  const initialization = { seed: "cap-0", startYear: 1327, endYear: 1427, protagonist: { name: "Probe", sex: "f" as const } };
  const { world, genesis, runtime } = await measure("init", () => {
    const { world } = initializeWorld(initialization);
    const genesis = createLifecycleGenesis({ initialization, protagonistId: "protagonist", resources: Object.fromEntries(Object.keys(world.people).map(id => [id, { grain: 2, effort: 3, need: 1 }])) });
    return { world, genesis, runtime: createLifecycleRuntime(genesis, { journal: "compact" }) };
  });
  const bytes: number[] = [];
  for (let i = 0; i < 3 && runtime.snapshot().status !== "complete"; i++) {
    const output = await measure(`year_${i + 1}`, () => runtime.advance(runtime.snapshot().frontier + 1));
    bytes.push(serialize(output.journal).byteLength);
    await measure(`tick_${i + 1}`, () => projectLifecycleTick({ source: { genesis, output }, year: output.frontier, locale: "en" }));
  }
  const output = runtime.snapshot();
  const source = { genesis, output };
  const projections = await measure("chronicles", async () => Promise.all(LOCALES.map(async locale => ({ locale, view: (await projectLifecycleChronicle({ source, identity: { lifeId: "bench", branchId: "bench" }, locale })).view }))));
  const personSheets = await measure("person_sheets", async () => {
    const sheets = [];
    for (const locale of LOCALES) for (const personId of Object.keys(output.owned.people)) sheets.push({ locale, personId, view: (await projectLifecyclePersonSheet({ source, personId, locale })).view });
    return sheets;
  });
  await measure("persistence", async () => {
    const capsule = await createLifecycleCompactCapsule(source, "compact");
    const db = openDb(":memory:");
    try { await new LifecycleRepository(db).publish({ lifeId: "bench", branchId: "bench", config: world.config, protagonistName: "Probe", protagonistSex: "f", capsule, projections, personSheets }); } finally { db.close(); }
  });
  console.log(JSON.stringify({ times_ms: times, heap_peak_sampled_bytes: heapPeak, max_rss_bytes: process.resourceUsage().maxRSS * 1024, retained_journal_v8_serialized_bytes_by_year: bytes }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });

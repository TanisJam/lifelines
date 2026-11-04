import { createLifecycleGenesis } from "../src/domain/e-lifecycle-genesis";
import { createLifecycleRuntime } from "../src/domain/e-lifecycle-runtime";
import { initializeWorld } from "../src/domain/world-origin";
import { projectLifecycleChronicle } from "../src/server/lifecycle-projection";
import { checkStoryQuality } from "../src/server/story-quality";

async function main() {
  const initialization = { seed: "quality-smoke", startYear: 1327, endYear: 1329, founderCount: 4, protagonist: { name: "Alice", sex: "f" as const } };
  const { world } = initializeWorld(initialization);
  const genesis = createLifecycleGenesis({ initialization, protagonistId: "protagonist", resources: Object.fromEntries(Object.keys(world.people).map(id => [id, { grain: 2, effort: 3, need: 1 }])) });
  const runtime = createLifecycleRuntime(genesis, { journal: "compact" });
  for (let i = 0; i < 3 && runtime.snapshot().status !== "complete"; i++) await runtime.advance(runtime.snapshot().frontier + 1);
  const source = { genesis, output: runtime.snapshot() };
  for (const locale of ["en", "es"] as const) {
    const { view } = await projectLifecycleChronicle({ source, identity: { lifeId: "quality-smoke", branchId: "quality-smoke" }, locale });
    console.log(JSON.stringify(checkStoryQuality(view, { source: "real", locale, protagonistId: source.output.protagonistId })));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

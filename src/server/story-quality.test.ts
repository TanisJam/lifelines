import { describe, expect, it } from "vitest";
import { createLifecycleGenesis } from "@/domain/e-lifecycle-genesis";
import { createLifecycleRuntime } from "@/domain/e-lifecycle-runtime";
import { initializeWorld } from "@/domain/world-origin";
import { projectLifecycleChronicle, type LifecycleProjectionSource } from "./lifecycle-projection";
import { checkStoryQuality } from "./story-quality";

// Recorded, fabricated events, not a 50-year simulation or evidence of a real life.
async function fixture(locale: "en" | "es") {
  const initialization = { seed: "quality-fixture", startYear: 1327, endYear: 1376, founderCount: 4, protagonist: { name: "Alice", sex: "f" as const } };
  const { world } = initializeWorld(initialization);
  const genesis = createLifecycleGenesis({ initialization, protagonistId: "protagonist", resources: Object.fromEntries(Object.keys(world.people).map(id => [id, { grain: 2, effort: 3, need: 1 }])) });
  const initial = createLifecycleRuntime(genesis).snapshot();
  const events = Array.from({ length: 50 }, (_, i) => ({ id: `event-${i}`, year: 1327 + i, kind: i === 0 ? "birth" : "illness", actors: ["protagonist"], payload: {}, causes: i === 1 ? ["event-0"] : [] }));
  const owned = { ...initial.owned, events };
  const journal = events.map((event, i) => ({ year: event.year, versions: initial.versions, final: { owned: { ...owned, events: events.slice(0, i + 1) }, favors: initial.favors } }));
  const output = { ...initial, owned, journal, frontier: 1376 } as unknown as LifecycleProjectionSource["output"];
  return (await projectLifecycleChronicle({ source: { genesis, output }, identity: { lifeId: "synthetic", branchId: "synthetic" }, locale })).view;
}

describe("story quality", () => {
  for (const locale of ["en", "es"] as const) it(`checks synthetic recorded events in ${locale}`, async () => {
    const chronicle = await fixture(locale);
    expect(chronicle.entries.length).toBeGreaterThan(0);
    const report = checkStoryQuality(chronicle, { source: "synthetic", locale, protagonistId: "protagonist" });
    expect(report.source).toBe("synthetic");
    expect(report.crisisCoverage.applicableYears).toEqual([1348, 1349]);
    expect(report.crisisCoverage.pass).toBe(false);
  });
  it("detects repetitions, broken arcs, missing crisis coverage and Spanish leaks independently", async () => {
    const base = await fixture("es");
    const entry = base.entries[0]!;
    const entries = [
      { ...entry, id: "a", year: 1348, kind: "reflection", prose: "Tras marrying. sin él o ella.", who: ["protagonist"] },
      { ...entry, id: "b", year: 1349, kind: "reflection", prose: "Tras marrying. sin él o ella.", who: ["protagonist"], cause: { entryId: "missing", year: 1348, phrase: "earlier" } },
    ];
    const report = checkStoryQuality({ ...base, entries }, { source: "synthetic", locale: "es", protagonistId: "protagonist" });
    expect(report.repetition.pass).toBe(false);
    expect(report.repetition.identicalReflections).toBeGreaterThan(0);
    expect(report.arcs.pass).toBe(false);
    expect(report.crisisCoverage.pass).toBe(false);
    expect(report.localization.pass).toBe(false);
  });
  it("accepts visible earlier links and protagonist-facing crisis entries", async () => {
    const base = await fixture("en");
    const entry = base.entries[0]!;
    const entries = [{ ...entry, id: "a", year: 1348, prose: "The Black Death reached her.", who: ["protagonist"] }, { ...entry, id: "b", year: 1349, prose: "The plague affected her.", who: ["protagonist"], cause: { entryId: "a", year: 1348, phrase: "the plague" } }];
    const report = checkStoryQuality({ ...base, entries }, { source: "synthetic", locale: "en", protagonistId: "protagonist" });
    expect(report.arcs.pass).toBe(true);
    expect(report.crisisCoverage.pass).toBe(true);
  });
});

import { describe, expect, it, vi } from "vitest";
import type { LifeStreamEvent } from "@/contracts/life";
// The per-year pacing delays are irrelevant to the contract being checked.
vi.mock("./stream", async (importOriginal) => ({ ...(await importOriginal<typeof import("./stream")>()), delay: async () => {} }));

import { fixtureChronicle, streamCreateLife, streamRewrite } from "./index";

type Tick = Extract<LifeStreamEvent, { type: "tick" }>;
type Done = Extract<LifeStreamEvent, { type: "done" }>;

async function create(name: string, seed?: string): Promise<{ ticks: Tick[]; done: Done }> {
  const ticks: Tick[] = [];
  let done: Done | undefined;
  await streamCreateLife({ name, sex: "f", seed }, (e) => {
    if (e.type === "tick") ticks.push(e);
    if (e.type === "done") done = e;
  });
  return { ticks, done: done! };
}

describe("fixture parity with the live contract", () => {
  for (const [label, name, seed] of [["Elin", "Elin Marrow", undefined], ["Rosalind", "Rosalind Thorn", "short"]] as const) {
    it(`${label}: one tick per year (quiet years included), scene on every tick, timed entries`, async () => {
      const { ticks, done } = await create(name, seed);
      const { birthYear, deathYear } = done.chronicle.protagonist;
      expect(ticks.map((t) => t.year)).toEqual(Array.from({ length: deathYear - birthYear + 1 }, (_, i) => birthYear + i));
      expect(ticks.some((t) => t.entries.length === 0)).toBe(label === "Elin");
      const finalIds = new Set(done.chronicle.scene.people.map((p) => p.id));
      for (const tick of ticks) {
        const ids = new Set(tick.scene.people.map((p) => p.id));
        for (const id of ids) expect(finalIds.has(id)).toBe(true);
        for (const e of tick.entries) {
          expect(e.at).toBeGreaterThanOrEqual(tick.year);
          expect(e.at).toBeLessThan(tick.year + 1);
          for (const who of e.who) expect(ids.has(who)).toBe(true);
        }
        for (const edge of tick.scene.edges) {
          expect(ids.has(edge.a) && ids.has(edge.b)).toBe(true);
          expect(edge.fromAt === null || edge.fromAt < tick.year + 1).toBe(true);
        }
      }
      for (const p of done.chronicle.scene.people) expect(p.appearsAt).toBeLessThanOrEqual(done.chronicle.scene.span.end ?? Infinity);
    });
  }

  it("rewrite: one tick per year from the fork, each with a scene, and the stored branch keeps its scene", async () => {
    const ticks: Tick[] = [];
    let done: Done | undefined;
    await streamRewrite("life-elin", { branchId: "branch-original", decisionId: "dec-1516-marry", optionId: "stay-unmarried" }, (e) => {
      if (e.type === "tick") ticks.push(e);
      if (e.type === "done") done = e;
    });
    const years = ticks.map((t) => t.year);
    expect(years[0]).toBe(1516);
    expect(years).toEqual(Array.from({ length: years.length }, (_, i) => 1516 + i));
    expect(years[years.length - 1]).toBe(done!.chronicle.protagonist.deathYear);
    expect(ticks.every((t) => t.scene.people.length > 0)).toBe(true);
    expect(fixtureChronicle("life-elin", done!.chronicle.branchId).scene.people.length).toBeGreaterThan(0);
  });
});

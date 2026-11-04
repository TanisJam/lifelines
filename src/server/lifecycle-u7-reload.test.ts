import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import type { LifeStreamEvent } from "@/contracts/life";
import * as annualPolicy from "@/domain/e-annual-policy";
import type { RuntimeOutput } from "@/domain/e-runtime";
import type { LifecycleCompactCapsule } from "@/domain/e-lifecycle-capsule";
import * as database from "./db";
import { streamLifecycleLife } from "./lifecycle-life";
import { projectLifecycleChronicle, projectLifecycleTick } from "./lifecycle-projection";
import { buildLifecycleChronicle } from "./lifecycle-read";
import { LifecycleRepository } from "./lifecycle-repository";

async function checkReopen(injectGrant: boolean) {
  const dir = mkdtempSync(join(tmpdir(), "lifelines-u7-"));
  const path = join(dir, "life.sqlite");
  let db = database.openDb(path);
  let original: LifecycleCompactCapsule | undefined;
  const frames: LifeStreamEvent[] = [];
  const realPlan = annualPolicy.planAnnualFavorDraft;
  const planner = injectGrant ? vi.spyOn(annualPolicy, "planAnnualFavorDraft").mockImplementation((view, seed, year) => {
    const plan = realPlan(view, seed, year);
    const debtor = Object.keys((view as RuntimeOutput["state"]).people).find(id => id !== "protagonist")!;
    return { ...plan, grants: [{ id: "u7-grant", creditor: "protagonist", debtor, causes: [] }] };
  }) : undefined;
  try {
    const repo = new LifecycleRepository(db);
    await streamLifecycleLife({ lifeId: "u7-life", branchId: "u7-branch", name: "Alice", sex: "f", seed: "ri1c-lifecycle-1", locale: "en", maxSteps: 1,
      signal: new AbortController().signal, emit: event => frames.push(event), flushFrame: async () => {},
      repository: { publish: async input => { original = input.capsule as LifecycleCompactCapsule; return repo.publish(input); } } });
    if (!original) throw new Error("Creation did not publish");
    const before: LifecycleCompactCapsule = original;
    db.close();
    db = database.openDb(path);
    const loaded = await new LifecycleRepository(db).load("u7-life", "u7-branch");
    if (!loaded) throw new Error("Reopened life is missing");
    const after = loaded.capsule;
    expect(after.genesis.versions).toEqual(before.genesis.versions);
    expect(after.digest).toBe(before.digest);
    if (injectGrant) {
      expect(before.output.threads?.threads).toHaveLength(1);
      expect(before.output.journal[0]!.threadBeats?.beats).toHaveLength(1);
    }
    expect(after.output.threads).toEqual(before.output.threads);
    expect(after.output.journal.map(record => record.threadBeats)).toEqual(before.output.journal.map(record => record.threadBeats));
    const source = { genesis: after.genesis, output: after.output };
    const spy = vi.spyOn(database, "getDb").mockReturnValue(db);
    try {
      for (const locale of ["en", "es"] as const) {
        const expected = await projectLifecycleChronicle({ source, identity: { lifeId: "u7-life", branchId: "u7-branch" }, locale });
        expect(await buildLifecycleChronicle("u7-life", "u7-branch", locale)).toEqual({ data: expected.view });
        for (const record of after.output.journal) {
          const tick = await projectLifecycleTick({ source, year: record.year, locale });
          const beforeTick = await projectLifecycleTick({ source: { genesis: before.genesis, output: before.output }, year: record.year, locale });
          expect(tick.view).toEqual(beforeTick.view);
          if (locale === "en") expect(frames.find(frame => frame.type === "tick" && frame.year === record.year)).toMatchObject({ type: "tick", ...tick.view });
        }
      }
    } finally { spy.mockRestore(); }
  } finally { planner?.mockRestore(); if (db.isOpen) db.close(); rmSync(dir, { recursive: true, force: true }); }
}

it("reopens genesis-only thread life without mocked authority", () => checkReopen(false), 120_000);
it("reopens a controlled committed grant with identical thread data", () => checkReopen(true), 120_000);

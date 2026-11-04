import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import type { LifeStreamEvent } from "@/contracts/life";
import * as annualPolicy from "@/domain/e-annual-policy";
import type { RuntimeOutput } from "@/domain/e-runtime";
import type { LifecycleCompactCapsule } from "@/domain/e-lifecycle-capsule";
import * as database from "./db";
import { streamLifecycleLife } from "./lifecycle-life";
import { projectLifecycleTick } from "./lifecycle-projection";
import { buildLifecycleChronicle } from "./lifecycle-read";
import { LifecycleRepository } from "./lifecycle-repository";

async function checkReopen(injectGrant: boolean) {
  const dir = mkdtempSync(join(tmpdir(), "lifelines-u7-"));
  const path = join(dir, "life.sqlite");
  const db = database.openDb(path);
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
    if (injectGrant) {
      expect(before.output.threads?.threads).toHaveLength(1);
      expect(before.output.journal[0]!.threadBeats?.beats).toHaveLength(1);
    }
    const spy = vi.spyOn(database, "getDb").mockReturnValue(db);
    const chronicles = [];
    const ticks = [];
    try {
      for (const locale of ["en", "es"] as const) {
        chronicles.push(await buildLifecycleChronicle("u7-life", "u7-branch", locale));
        const views = [];
        for (const record of before.output.journal) {
          const tick = await projectLifecycleTick({ source: { genesis: before.genesis, output: before.output }, year: record.year, locale });
          views.push(tick.view);
          if (locale === "en") expect(frames.find(frame => frame.type === "tick" && frame.year === record.year)).toMatchObject({ type: "tick", ...tick.view });
        }
        ticks.push(views);
      }
    } finally { spy.mockRestore(); }
    db.close();
    const resultPath = join(dir, "child.json");
    await promisify(execFile)("pnpm", ["--config.verify-deps-before-run=ignore", "exec", "vitest", "run", "src/server/lifecycle-u7-child.test.ts", "-t", "child process regeneration"], {
      env: { ...process.env, U7_CHILD_DB: path, U7_CHILD_RESULT: resultPath, U7_CHILD_GRANT: injectGrant ? "1" : "0" }, timeout: 120_000,
    });
    const child = JSON.parse(readFileSync(resultPath, "utf8"));
    expect(child.pid).not.toBe(process.pid);
    expect(child.versions).toEqual(before.genesis.versions);
    expect(child.digest).toBe(before.digest);
    expect(child.threads).toEqual(before.output.threads);
    expect(child.beats).toEqual(before.output.journal.map(record => record.threadBeats));
    expect(child.ticks).toEqual(ticks);
    expect(child.chronicles).toEqual(chronicles);
  } finally { planner?.mockRestore(); if (db.isOpen) db.close(); rmSync(dir, { recursive: true, force: true }); }
}

it("reopens genesis-only thread life without mocked authority", () => checkReopen(false), 120_000);
it("reopens a controlled committed grant with identical thread data", () => checkReopen(true), 120_000);

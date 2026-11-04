import { writeFileSync } from "node:fs";
import { it, vi } from "vitest";
import * as annualPolicy from "@/domain/e-annual-policy";
import type { RuntimeOutput } from "@/domain/e-runtime";
import * as database from "./db";
import { projectLifecycleTick } from "./lifecycle-projection";
import { buildLifecycleChronicle } from "./lifecycle-read";
import { LifecycleRepository } from "./lifecycle-repository";

it.skipIf(!process.env.U7_CHILD_DB)("child process regeneration", async () => {
  const realPlan = annualPolicy.planAnnualFavorDraft;
  if (process.env.U7_CHILD_GRANT === "1") vi.spyOn(annualPolicy, "planAnnualFavorDraft").mockImplementation((view, seed, year) => {
    const plan = realPlan(view, seed, year);
    const debtor = Object.keys((view as RuntimeOutput["state"]).people).find(id => id !== "protagonist")!;
    return { ...plan, grants: [{ id: "u7-grant", creditor: "protagonist", debtor, causes: [] }] };
  });
  const db = database.openDb(process.env.U7_CHILD_DB!);
  vi.spyOn(database, "getDb").mockReturnValue(db);
  try {
    const loaded = await new LifecycleRepository(db).load("u7-life", "u7-branch");
    if (!loaded) throw new Error("Reopened life is missing");
    const capsule = loaded.capsule;
    const source = { genesis: capsule.genesis, output: capsule.output };
    const ticks = [];
    const chronicles = [];
    for (const locale of ["en", "es"] as const) {
      ticks.push(await Promise.all(capsule.output.journal.map(async record => (await projectLifecycleTick({ source, year: record.year, locale })).view)));
      chronicles.push(await buildLifecycleChronicle("u7-life", "u7-branch", locale));
    }
    writeFileSync(process.env.U7_CHILD_RESULT!, JSON.stringify({ pid: process.pid, versions: capsule.genesis.versions, digest: capsule.digest, threads: capsule.output.threads, beats: capsule.output.journal.map(record => record.threadBeats), ticks, chronicles }));
  } finally { vi.restoreAllMocks(); db.close(); }
}, 120_000);

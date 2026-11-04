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

it.skipIf(!process.env.U7_PUBLIC_DB)("child public route reads", async () => {
  const db = database.openDb(process.env.U7_PUBLIC_DB!);
  vi.spyOn(database, "getDb").mockReturnValue(db);
  try {
    const { GET: chronicle } = await import("@/app/api/lives/[lifeId]/route");
    const { GET: person } = await import("@/app/api/lives/[lifeId]/people/[personId]/route");
    const { GET: list } = await import("@/app/api/lives/route");
    const ctx = { params: Promise.resolve({ lifeId: "u7-public" }) };
    const views = [];
    for (const lang of ["en", "es"]) {
      for (const branch of ["root", process.env.U7_PUBLIC_BRANCH!, process.env.U7_PUBLIC_SIBLING!, process.env.U7_PUBLIC_NESTED!, ""]) {
        const query = new URLSearchParams({ lang, ...(branch ? { branchId: branch } : {}) });
        const response = await chronicle(new Request(`http://local/api/lives/u7-public?${query}`), ctx);
        if (!response.ok) throw new Error(`Chronicle failed: ${await response.text()}`);
        views.push(await response.json());
      }
    }
    const savedResponse = await chronicle(new Request(`http://local/api/lives/u7-public?branchId=${process.env.U7_PUBLIC_SAVED}`), ctx);
    if (!savedResponse.ok) throw new Error(`Saved branch failed: ${await savedResponse.text()}`);
    const saved = await savedResponse.json();
    const sheet = await person(new Request(`http://local/api/lives/u7-public/people/protagonist?branchId=${process.env.U7_PUBLIC_BRANCH}`), { params: Promise.resolve({ lifeId: "u7-public", personId: "protagonist" }) });
    const listing = await list(new Request("http://local/api/lives"));
    writeFileSync(process.env.U7_CHILD_RESULT!, JSON.stringify({ pid: process.pid, views, saved, sheetStatus: sheet.status, listing: await listing.json() }));
  } finally { vi.restoreAllMocks(); db.close(); }
}, 120_000);

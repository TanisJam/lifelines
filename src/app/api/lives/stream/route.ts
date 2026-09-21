import type { ChronicleEntry, CreateLifeRequest, LifeSex, LifeStreamEvent } from "@/contracts/life";
import { simulate } from "@/domain/simulate";
import { generateWorld } from "@/domain/worldgen";
import { activeEngineName, getDecisionMaker } from "@/server/decision-engine";
import { buildLifeChronicle } from "@/server/life-chronicle";
import { newLifeBranchId, newLifeId, registerLife } from "@/server/life-store";
import { sseResponse } from "@/server/sse";

export const runtime = "nodejs";

const START_YEAR = 1500;
/** A generous safety cap (see mortality.ts): the sim always stops earlier, at the protagonist's death, but the actuarial curve alone never guarantees that before some fixed year. */
const MAX_LIFESPAN_YEARS = 100;

function randomSeed(): string {
  return Math.random().toString(36).slice(2, 10);
}

function errorResponse(message: string, status = 400): Response {
  return new Response(JSON.stringify({ error: message }), { status, headers: { "Content-Type": "application/json" } });
}

/**
 * Streams the birth-to-death simulation of one protagonist (round 9, decision 034/036).
 * `tick.entries` replays the FINAL chronicle's entries grouped by year, in chronicle order —
 * simpler and more reliable than narrating incrementally mid-simulation (which would need
 * significance scoring and cross-year causal lookups before the life is even finished), while
 * still giving the client one frame per simulated year as the contract asks. See docs/decisions.md
 * 036 for why this is a deliberate scoping choice, not an oversight.
 */
export async function POST(request: Request): Promise<Response> {
  let body: Partial<CreateLifeRequest> = {};
  try {
    body = (await request.json()) as Partial<CreateLifeRequest>;
  } catch {
    // Empty body is invalid (name is required) — caught below.
  }

  const name = body.name?.trim();
  if (!name) return errorResponse('"name" is required.');
  const sex = body.sex;
  if (sex !== "f" && sex !== "m" && sex !== "random") return errorResponse('"sex" must be "f", "m" or "random".');

  const seed = body.seed?.trim() || randomSeed();
  const startYear = START_YEAR;
  const endYear = startYear + MAX_LIFESPAN_YEARS;
  const { config, people, events } = generateWorld({ seed, townName: body.villageName?.trim() || undefined, startYear, endYear, protagonist: { name, sex } });
  const protagonist = people.protagonist;
  if (!protagonist) return errorResponse("Failed to generate the protagonist.", 500);

  const decisionMaker = getDecisionMaker();
  const engineSource = activeEngineName();
  const lifeId = newLifeId();
  const branchId = newLifeBranchId();

  return sseResponse(async (send) => {
    const start: LifeStreamEvent = {
      type: "start",
      lifeId,
      branchId,
      villageName: config.town.name,
      protagonist: { name: protagonist.name, sex: protagonist.sex, birthYear: protagonist.birthYear },
    };
    send("start", start);

    const report = await simulate(config, people, events, { decisionMaker, engineSource, protagonistId: "protagonist" });
    registerLife(lifeId, branchId, config, protagonist.name, protagonist.sex as LifeSex, report.result, report.snapshots);

    const chronicleResult = await buildLifeChronicle(lifeId, branchId);
    if (!chronicleResult.data) {
      send("error", { type: "error", message: chronicleResult.error ?? "Failed to build the chronicle." });
      return;
    }
    const chronicle = chronicleResult.data;

    const byYear = new Map<number, ChronicleEntry[]>();
    for (const entry of chronicle.entries) {
      const bucket = byYear.get(entry.year) ?? [];
      bucket.push(entry);
      byYear.set(entry.year, bucket);
    }
    for (const year of [...byYear.keys()].sort((a, b) => a - b)) {
      send("tick", { type: "tick", year, entries: byYear.get(year)! });
    }

    const adapterStats = decisionMaker.getStats?.();
    const done: LifeStreamEvent = {
      type: "done",
      chronicle,
      stats: { jevCalls: report.decisionCalls, cacheHits: adapterStats?.cacheHits ?? 0, wallTimeMs: report.wallTimeMs },
    };
    send("done", done);
  });
}

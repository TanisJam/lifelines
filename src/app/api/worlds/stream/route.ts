import type { DecisionRecord } from "@/domain/decisions";
import { simulate } from "@/domain/simulate";
import { generateWorld } from "@/domain/worldgen";
import { guardSimulation } from "@/server/abuse-guard";
import { pickRichPerson } from "@/server/rich-person";
import { sseResponse } from "@/server/sse";
import { createWorld } from "@/server/world-store";

export const runtime = "nodejs";

interface CreateWorldBody {
  seed?: string;
  townName?: string;
  turnstileToken?: string;
}

function randomSeed(): string {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * Streams world creation as it happens (decision 010): a `start` frame,
 * then one `tick` frame per simulated year with that year's new events and
 * decisions plus a running population count, then a `done` frame with the
 * created world/branch id and final stats. Falls back cleanly to a normal
 * JSON response's worth of information in the final `done` frame, so a
 * client that only cares about the end state can ignore every `tick`.
 */
export async function POST(request: Request): Promise<Response> {
  let body: CreateWorldBody = {};
  try {
    body = (await request.json()) as CreateWorldBody;
  } catch {
    // Empty body is fine — we'll randomize the seed.
  }

  // Rate limit + (if configured) Turnstile verification, BEFORE any simulation work or the SSE
  // stream starts.
  const guard = await guardSimulation(request, body);
  if (guard instanceof Response) return guard;
  const { decisionMaker, engineSource } = guard.engine;

  const seed = body.seed?.trim() || randomSeed();
  const { config, people, events: seedEvents } = generateWorld({ seed, townName: body.townName });

  return sseResponse(async (send) => {
    send("start", { config, peopleCount: Object.keys(people).length });

    let lastEventCount = 0;
    let lastDecisionCount = 0;

    const report = await simulate(config, people, seedEvents, {
      decisionMaker,
      engineSource,
      onYearComplete: (snapshot) => {
        const newEvents = snapshot.events.slice(lastEventCount);
        const newDecisions: DecisionRecord[] = snapshot.decisions.slice(lastDecisionCount);
        lastEventCount = snapshot.events.length;
        lastDecisionCount = snapshot.decisions.length;
        const population = Object.values(snapshot.people).filter((p) => p.deathYear === undefined).length;
        send("tick", { year: snapshot.year, population, newEvents, newDecisions });
      },
    });

    const world = createWorld(config, report.result, report.snapshots);

    send("done", {
      worldId: world.id,
      branchId: world.originalBranchId,
      config,
      engine: engineSource,
      stats: { decisionCalls: report.decisionCalls, wallTimeMs: report.wallTimeMs, adapterStats: decisionMaker.getStats?.() },
      peopleCount: Object.keys(report.result.people).length,
      eventCount: report.result.events.length,
      decisionCount: report.result.decisions.length,
      // Round 6 (decision 029): the Living Chronicle lands on a rich life, not the Loom.
      richPersonId: pickRichPerson(report.result),
    });
  });
}

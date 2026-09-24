import path from "node:path";
import { JevDecisionMaker } from "@/adapters/decision/jev-decision-maker";
import { RuleDecisionMaker } from "@/adapters/decision/rule-decision-maker";
import type { DecisionMaker, DecisionMakerStats } from "@/domain/decisions";

/**
 * Chooses the DecisionMaker adapter for the whole process. Server-only:
 * imports Node's `fs`/`crypto` transitively through the Jev adapter's
 * cache, and reads `TYPESAFE_API_KEY`, so this module must never be
 * imported from a Client Component.
 */
function buildDecisionMaker(): DecisionMaker {
  const engine = (process.env.DECISION_ENGINE ?? "").toLowerCase();
  const hasKey = Boolean(process.env.TYPESAFE_API_KEY?.trim());

  const useJev = engine === "jev" || (engine !== "rules" && hasKey);

  if (useJev) {
    // Self-hosted Docker deploy: lives under DATA_DIR (a mounted volume) so it survives restarts,
    // same as the SQLite DB (see `db.ts`). Falls back to the pre-existing `.cache/` (gitignored,
    // relative to `process.cwd()`) when DATA_DIR is unset, so local dev is unchanged.
    const cacheDir = process.env.DATA_DIR ? path.join(process.env.DATA_DIR, "cache") : path.join(process.cwd(), ".cache");
    return new JevDecisionMaker({ cacheFilePath: path.join(cacheDir, "jev-decisions.json") });
  }
  return new RuleDecisionMaker();
}

// Attached to `globalThis` (not a plain module-level variable) for the same
// reason as the life store: Next.js can bundle Route Handlers and Server
// Components separately, giving each its own module instance. Without this,
// the Jev adapter's cache and call/latency stats would silently fork into
// two independent copies instead of being shared across the whole process.
const globalInstanceKey = "__lifelinesDecisionMaker__";
const globalWithInstance = globalThis as typeof globalThis & { [globalInstanceKey]?: DecisionMaker };

export function getDecisionMaker(): DecisionMaker {
  globalWithInstance[globalInstanceKey] ??= buildDecisionMaker();
  return globalWithInstance[globalInstanceKey];
}

const backgroundInstanceKey = "__lifelinesBackgroundDecisionMaker__";
const globalWithBackground = globalThis as typeof globalThis & { [backgroundInstanceKey]?: DecisionMaker };

/**
 * Decision 084: when the main engine is Jev, the villagers outside the protagonist's story circle
 * are decided by rules (see `SimulateOptions.backgroundDecisionMaker`), so a life fits in about a
 * minute. Undefined under the rules engine, where everyone already uses rules.
 */
export function getBackgroundDecisionMaker(): DecisionMaker | undefined {
  if (activeEngineName() === "rules") return undefined;
  globalWithBackground[backgroundInstanceKey] ??= new RuleDecisionMaker();
  return globalWithBackground[backgroundInstanceKey];
}

export function activeEngineName(): "jev" | "rules" {
  return getDecisionMaker() instanceof RuleDecisionMaker ? "rules" : "jev";
}

/** $/input-token, per decision 045's `estimatedUsd` field (see `contracts/life.ts`'s `done` event `stats`). */
const USD_PER_INPUT_TOKEN = 0.042 / 1_000_000;

/** Round 12 (decision 045): per-life Jev usage stats. The `getDecisionMaker()` instance is shared across the whole process (see the `globalThis` note above), so its own `getStats()` counters are CUMULATIVE across every life ever simulated in this process — never report them directly. Instead snapshot `getStats()` immediately before and after a single simulation run and report the DELTA, which is what's actually attributable to that one life. */
export interface LifeRunStats {
  readonly cacheHits: number;
  readonly jevRequests?: number;
  readonly jevQuestions?: number;
  readonly inputTokens?: number;
  readonly estimatedUsd?: number;
}

/** Call once immediately before the `simulate()`/fork call whose stats will be reported. */
export function snapshotDecisionMakerStats(decisionMaker: DecisionMaker): DecisionMakerStats | undefined {
  return decisionMaker.getStats?.();
}

/** Call once immediately after the run, with the `before` snapshot from `snapshotDecisionMakerStats` — returns THIS RUN's delta, never the adapter's raw cumulative counters. */
export function decisionMakerRunStats(decisionMaker: DecisionMaker, before: DecisionMakerStats | undefined): LifeRunStats {
  const after = decisionMaker.getStats?.();
  if (!after) return { cacheHits: 0 };
  const cacheHits = after.cacheHits - (before?.cacheHits ?? 0);
  const jevRequests = after.calls - (before?.calls ?? 0);
  const jevQuestions = after.questions !== undefined ? after.questions - (before?.questions ?? 0) : undefined;
  const inputTokens = after.inputTokens !== undefined ? after.inputTokens - (before?.inputTokens ?? 0) : undefined;
  const estimatedUsd = inputTokens !== undefined ? inputTokens * USD_PER_INPUT_TOKEN : undefined;
  return { cacheHits, jevRequests, jevQuestions, inputTokens, estimatedUsd };
}

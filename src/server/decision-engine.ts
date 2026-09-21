import path from "node:path";
import { JevDecisionMaker } from "@/adapters/decision/jev-decision-maker";
import { RuleDecisionMaker } from "@/adapters/decision/rule-decision-maker";
import type { DecisionMaker } from "@/domain/decisions";

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
    return new JevDecisionMaker({ cacheFilePath: path.join(process.cwd(), ".cache", "jev-decisions.json") });
  }
  return new RuleDecisionMaker();
}

// Attached to `globalThis` (not a plain module-level variable) for the same
// reason as the world store: Next.js can bundle Route Handlers and Server
// Components separately, giving each its own module instance. Without this,
// the Jev adapter's cache and call/latency stats would silently fork into
// two independent copies instead of being shared across the whole process.
const globalInstanceKey = "__lifelinesDecisionMaker__";
const globalWithInstance = globalThis as typeof globalThis & { [globalInstanceKey]?: DecisionMaker };

export function getDecisionMaker(): DecisionMaker {
  globalWithInstance[globalInstanceKey] ??= buildDecisionMaker();
  return globalWithInstance[globalInstanceKey];
}

export function activeEngineName(): "jev" | "rules" {
  return getDecisionMaker() instanceof RuleDecisionMaker ? "rules" : "jev";
}

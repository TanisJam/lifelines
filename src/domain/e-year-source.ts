import { RuleDecisionMaker } from "@/adapters/decision/rule-decision-maker";
import { runLegacyYear } from "./legacy-year";
import { createLegacyRunContext, type LegacyOwnedRunState } from "./simulate";
import type { WorldConfig, YearSnapshot } from "./types";

export const RULES_YEAR_SOURCE_VERSION = "native-rules/person-year-batched/v1";

export interface RulesYearSourceDeclaration {
  readonly version: typeof RULES_YEAR_SOURCE_VERSION;
}

export interface RulesYearSource {
  readonly declaration: RulesYearSourceDeclaration;
  execute(year: number): Promise<YearSnapshot>;
}

function admitDeclaration(input: unknown): RulesYearSourceDeclaration {
  if (input === null || typeof input !== "object") throw new Error("Invalid rules-year source declaration");
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) throw new Error("Invalid rules-year source declaration prototype");
  const keys = Reflect.ownKeys(input);
  if (keys.length !== 1 || keys[0] !== "version") throw new Error("Unknown rules-year source declaration fields");
  const version = Object.getOwnPropertyDescriptor(input, "version");
  // Never evaluate declaration getters (including unknown callback/override fields).
  if (!version || !("value" in version) || version.value !== RULES_YEAR_SOURCE_VERSION) {
    throw new Error("Unsupported rules-year source version or accessor");
  }
  return Object.freeze({ version: RULES_YEAR_SOURCE_VERSION });
}

/**
 * Trusted native execution only, over already-owned run references. This is not genesis
 * admission, frontier/replay validation, a capsule authority or an economic-policy runtime.
 * Each source privately owns a fresh native resolver; callers cannot replace annual config,
 * batching, engines, debug collectors, overrides or core choices. Favor ledgers stay separate.
 */
export function createRulesYearSource(
  declaration: unknown,
  origin: WorldConfig,
  owned: LegacyOwnedRunState,
  protagonistId?: string,
  originalOverrideYear: number = origin.startYear,
): RulesYearSource {
  const admitted = admitDeclaration(declaration);
  // WorldConfig is a trusted origin, captured once rather than supplied again at execute.
  const config: WorldConfig = Object.freeze({
    seed: origin.seed, startYear: origin.startYear, endYear: origin.endYear,
    town: Object.freeze({ name: origin.town.name }),
  });
  const context = createLegacyRunContext(config, owned, Object.freeze({
    decisionMaker: new RuleDecisionMaker(), engineSource: "rules" as const,
    protagonistId, fromYear: originalOverrideYear,
    concurrencyLimit: 8, yearBatchConcurrency: 64,
  }));
  return Object.freeze({
    declaration: admitted,
    execute: (year: number) => runLegacyYear(context, year),
  });
}

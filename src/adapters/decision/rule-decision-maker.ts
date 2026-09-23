import type { DecisionMaker, DecisionMakerStats, DecisionQuestion, Distribution, PersonYearBatch, PersonYearResult } from "@/domain/decisions";
import { computeHazardPrior } from "@/domain/hazards";
import { normalizeDistribution } from "@/domain/rng";
import { ruleDistribution } from "@/domain/rule-heuristics";

/**
 * Deterministic heuristic weights. No network calls, no randomness of its
 * own — pure function of the question's state. Used for tests, offline
 * dev, and as the default when no TypeSafe API key is configured. Thin
 * wrapper around `domain/rule-heuristics.ts`'s pure `ruleDistribution` —
 * the domain engine also calls that function directly (not this class) to
 * compute every decision's code-side `prior`, so the heuristic logic lives
 * in the domain layer rather than behind this adapter.
 */
export class RuleDecisionMaker implements DecisionMaker {
  private calls = 0;
  private readonly hazardFallbacks: Record<string, number> = {};

  async decide(question: DecisionQuestion): Promise<Distribution> {
    this.calls += 1;
    return ruleDistribution(question);
  }

  /**
   * Round 11 (decision 044) / round 12 (decisions 045/046), superseded by engine life course PR6
   * (design decisions 1 and 4), refactored in PR7 to share `hazards.ts#computeHazardPrior` with the
   * Jev adapter (spec's "identically for both adapters" requirement — see that function's doc
   * comment): every non-`D1` situation's `selection` entry is now its ABSOLUTE annual hazard, not a
   * flat relative weight — the rules engine reports these hazards UNCHANGED (`t=1`; PR7's clamp only
   * applies to the Jev adapter's own judgment). `computeHazardPrior` already folds them into one
   * exclusive categorical draw per person-year via `resolveCompetingRisks`: `P(k) = h'_k`, with the
   * remainder going to `"nothing"` (NPC) or `"everyday"` (protagonist, when a `D1` vignette rides
   * along). `simulate.ts` still samples the result with Gumbel-max, exactly like the real Jev path.
   */
  async decideYear(batch: PersonYearBatch): Promise<PersonYearResult> {
    this.calls += 1;
    const vignetteSelection: Record<string, number> = {};
    const response: Record<string, Distribution> = {};
    let hasVignette = false;
    for (const [id, situation] of Object.entries(batch.situations)) {
      response[id] = normalizeDistribution(ruleDistribution(situation.question) as Record<string, number>);
      if (situation.kind === "D1") {
        vignetteSelection[id] = 1;
        hasVignette = true;
      }
    }
    const { selection: scaledHazards, residual, hazardFallbacks } = computeHazardPrior(batch.situations, response);
    for (const [key, count] of Object.entries(hazardFallbacks)) this.hazardFallbacks[key] = (this.hazardFallbacks[key] ?? 0) + count;
    const selection: Record<string, number> = { ...scaledHazards };
    if (hasVignette) selection.everyday = residual;
    else if (Object.keys(selection).length > 0) selection.nothing = residual;
    return { selection, vignetteSelection, response };
  }

  getStats(): DecisionMakerStats {
    return { calls: this.calls, cacheHits: 0, wallTimeMs: 0, hazardFallbacks: { ...this.hazardFallbacks } };
  }
}

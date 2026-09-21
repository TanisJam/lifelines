import type { DecisionMaker, DecisionMakerStats, DecisionQuestion, Distribution } from "@/domain/decisions";
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

  async decide(question: DecisionQuestion): Promise<Distribution> {
    this.calls += 1;
    return ruleDistribution(question);
  }

  getStats(): DecisionMakerStats {
    return { calls: this.calls, cacheHits: 0, wallTimeMs: 0 };
  }
}

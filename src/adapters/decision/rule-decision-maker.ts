import type { DecisionMaker, DecisionMakerStats, DecisionQuestion, Distribution, PersonYearBatch, PersonYearResult } from "@/domain/decisions";
import { normalizeDistribution } from "@/domain/rng";
import { ruleDistribution } from "@/domain/rule-heuristics";

/**
 * Deterministic occurrence heuristic for the rules engine's `decideYear` (round 11, decision 044).
 * No AI call, so this can't ask "how likely is this" — instead it treats every eligible candidate
 * as near-certain to occur once code has already gated it into the candidate pool (`gatherCandidatesForYear`'s
 * eligibility checks do the real filtering for the rules engine), except `D1` (the daily-life
 * filler), which gets a lower, tunable base rate so it reads as a genuine fallback candidate rather
 * than something that fires every single year in tests.
 */
function ruleOccurrence(kind: DecisionQuestion["kind"]): number {
  return kind === "D1" ? 0.3 : 0.85;
}

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

  /** Round 11 (decision 044): the batched equivalent of `decide()` — answers every situation in one pass, no network, fully deterministic. */
  async decideYear(batch: PersonYearBatch): Promise<PersonYearResult> {
    this.calls += 1;
    const occurrence: Record<string, number> = {};
    const response: Record<string, Distribution> = {};
    for (const [id, situation] of Object.entries(batch.situations)) {
      response[id] = normalizeDistribution(ruleDistribution(situation.question) as Record<string, number>);
      occurrence[id] = ruleOccurrence(situation.kind);
    }
    return { occurrence, response };
  }

  getStats(): DecisionMakerStats {
    return { calls: this.calls, cacheHits: 0, wallTimeMs: 0 };
  }
}

import type { DecisionMaker, DecisionMakerStats, DecisionQuestion, Distribution, PersonYearBatch, PersonYearResult } from "@/domain/decisions";
import { normalizeDistribution } from "@/domain/rng";
import { ruleDistribution } from "@/domain/rule-heuristics";

/**
 * Deterministic event-selection weight for the rules engine's `decideYear` (round 12, decision 045,
 * superseding round 11's per-candidate occurrence heuristic). No AI call, so this can't judge "which
 * of these is most likely" the way Jev's event-selection Choice does — instead it hands out a flat,
 * tunable relative weight per kind (raw, not normalized: `sampleGumbelMax`/`normalizeDistribution`
 * handle that). `D1` (the daily-life filler) gets a lower weight so it reads as a genuine "nothing
 * else came up" candidate rather than always outscoring every real social situation in tests.
 */
function ruleSelectionWeight(kind: DecisionQuestion["kind"]): number {
  return kind === "D1" ? 0.3 : 0.85;
}

/** Weight for the synthetic `"nothing"` option offered to every non-protagonist person-year (round 12, decision 045) — moderate, so an NPC's quiet years and eventful years are both common, not one or the other. */
const NOTHING_WEIGHT = 0.7;

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

  /**
   * Round 11 (decision 044) / round 12 (decisions 045/046): the batched equivalent of `decide()` —
   * answers every situation in one pass, no network, fully deterministic. `selection` carries raw
   * weights (per `ruleSelectionWeight`/`NOTHING_WEIGHT`); `simulate.ts` samples it with Gumbel-max
   * exactly like the real Jev path, never special-cased here. Round 12 continuation (decision 046):
   * `D1` vignette candidates never get their own `selection` entry — they're aggregated under one
   * flat `"everyday"` weight, with their OWN relative weights (equal, since this heuristic has no
   * basis to prefer one vignette over another) in `vignetteSelection` instead, exactly like the real
   * Jev adapter's nested `pick`/`vignettePick` split.
   */
  async decideYear(batch: PersonYearBatch): Promise<PersonYearResult> {
    this.calls += 1;
    const selection: Record<string, number> = {};
    const vignetteSelection: Record<string, number> = {};
    const response: Record<string, Distribution> = {};
    let hasVignette = false;
    for (const [id, situation] of Object.entries(batch.situations)) {
      response[id] = normalizeDistribution(ruleDistribution(situation.question) as Record<string, number>);
      if (situation.kind === "D1") {
        vignetteSelection[id] = 1;
        hasVignette = true;
      } else {
        selection[id] = ruleSelectionWeight(situation.kind);
      }
    }
    if (hasVignette) selection.everyday = ruleSelectionWeight("D1");
    if (!batch.isProtagonist && Object.keys(selection).length > 0) selection.nothing = NOTHING_WEIGHT;
    return { selection, vignetteSelection, response };
  }

  getStats(): DecisionMakerStats {
    return { calls: this.calls, cacheHits: 0, wallTimeMs: 0 };
  }
}

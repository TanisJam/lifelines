import type { DecisionMaker, DecisionMakerStats, DecisionQuestion, Distribution, PersonYearBatch, PersonYearResult, PersonYearSituation } from "@/domain/decisions";
import { computeHazard, effectiveSelectionHazard, type HazardContext, resolveCompetingRisks } from "@/domain/hazards";
import { FALLBACK_CLASS } from "@/domain/period/classes";
import { normalizeDistribution } from "@/domain/rng";
import { ruleDistribution } from "@/domain/rule-heuristics";
import type { JsonValue, Sex, SocialClass } from "@/domain/types";

function asRecord(value: JsonValue | undefined): Record<string, JsonValue> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, JsonValue>) : undefined;
}

function numberField(record: Record<string, JsonValue> | undefined, key: string): number | undefined {
  const value = record?.[key];
  return typeof value === "number" ? value : undefined;
}

/**
 * Engine life course PR6 (design decision 4: "RuleDecisionMaker returns selection = hazards, t=1"):
 * builds the `HazardContext` `hazards.ts#computeHazard` needs from a `PersonYearSituation`'s own
 * `DecisionQuestion.state` — `self.age/sex/socialClass` (already there for every kind, see
 * `simulate.ts#personSummary`) plus the kind-specific time-in-state extras `simulate.ts` attaches to
 * `situation` (`yearsMarriageable`, `courtshipYears`, `isWidowed`).
 */
function buildHazardContext(situation: PersonYearSituation): HazardContext {
  const self = asRecord(situation.question.state.self);
  const situationState = asRecord(situation.question.state.situation);
  return {
    kind: situation.kind,
    age: numberField(self, "age") ?? 0,
    sex: (self?.sex as Sex | undefined) ?? "f",
    socialClass: (self?.socialClass as SocialClass | undefined) ?? FALLBACK_CLASS,
    year: situation.question.year,
    isWidowed: situationState?.isWidowed === true,
    yearsMarriageable: numberField(situationState, "yearsMarriageable"),
    courtshipYears: numberField(situationState, "courtshipYears"),
  };
}

/**
 * PR6 corrective (engram #6280, "the marriage chain"): the two-stage marriage-track kinds — `Y1`
 * (courtship offer, "encourage") and `A1` (proposal, "propose") — each gate their hazard's effect
 * behind a SECOND, independent outcome roll (`ruleDistribution`'s own branch for that kind). Naming
 * the "positive" option here lets `decideYear` scale the raw hazard by `hazards.ts#
 * effectiveSelectionHazard` so the COMPOUND (selection-wins x this-option-chosen) probability matches
 * the design's own single stated per-year rate, without touching any other kind's semantics.
 */
const OUTCOME_SCALED_KINDS: Readonly<Record<string, string>> = { Y1: "encourage", A1: "propose" };

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
   * (design decisions 1 and 4): every non-`D1` situation's `selection` entry is now its ABSOLUTE
   * annual hazard (`hazards.ts#computeHazard`), not a flat relative weight — the rules engine reports
   * these hazards UNCHANGED (no clamp; that's PR7's Jev adapter). `resolveCompetingRisks` folds them
   * into one exclusive categorical draw per person-year: `P(k) = h'_k`, with the remainder going to
   * `"nothing"` (NPC) or `"everyday"` (protagonist, when a `D1` vignette rides along) — proportionally
   * rescaled so the total never exceeds 1 even in a very busy person-year (design decision 1).
   * `simulate.ts` still samples the result with Gumbel-max, exactly like the real Jev path.
   */
  async decideYear(batch: PersonYearBatch): Promise<PersonYearResult> {
    this.calls += 1;
    const vignetteSelection: Record<string, number> = {};
    const response: Record<string, Distribution> = {};
    const rawHazards: Record<string, number> = {};
    let hasVignette = false;
    for (const [id, situation] of Object.entries(batch.situations)) {
      response[id] = normalizeDistribution(ruleDistribution(situation.question) as Record<string, number>);
      if (situation.kind === "D1") {
        vignetteSelection[id] = 1;
        hasVignette = true;
        continue;
      }
      const hazard = computeHazard(buildHazardContext(situation));
      if (hazard.fallbackKey) this.hazardFallbacks[hazard.fallbackKey] = (this.hazardFallbacks[hazard.fallbackKey] ?? 0) + 1;
      const outcomeOption = OUTCOME_SCALED_KINDS[situation.kind];
      const outcomeProbability = outcomeOption ? response[id]![outcomeOption] : undefined;
      rawHazards[id] = outcomeProbability !== undefined ? effectiveSelectionHazard(hazard.value, outcomeProbability) : hazard.value;
    }
    const { selection: scaledHazards, residual } = resolveCompetingRisks(rawHazards);
    const selection: Record<string, number> = { ...scaledHazards };
    if (hasVignette) selection.everyday = residual;
    else if (Object.keys(selection).length > 0) selection.nothing = residual;
    return { selection, vignetteSelection, response };
  }

  getStats(): DecisionMakerStats {
    return { calls: this.calls, cacheHits: 0, wallTimeMs: 0, hazardFallbacks: { ...this.hazardFallbacks } };
  }
}

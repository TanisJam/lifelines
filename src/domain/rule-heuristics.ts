import type { DecisionQuestion, Distribution } from "./decisions";
import type { JsonValue } from "./types";

/**
 * Deterministic heuristic weights over a `DecisionQuestion`'s state. Pure
 * domain code — no network, no randomness, no adapter dependency — used
 * three ways: as the `RuleDecisionMaker` adapter (tests, offline dev, the
 * default with no API key), as every decision's code-side `prior` when
 * Jev wasn't asked (see `simulate.ts#resolveSocialDecision`), and for
 * reconstructing a decision's shape during override validation without
 * needing to actually call an AI adapter.
 *
 * Round 4: reads the `PersonMind` facets/values compact state (see
 * `mind.ts#compactMindState`) instead of the old flat trait-adjective
 * list, so the rules engine stays a coherent (if simpler) stand-in for
 * the same person Jev would otherwise play.
 */

function clamp01(x: number): number {
  return Math.max(0.02, Math.min(0.98, x));
}

function facets(state: Readonly<Record<string, JsonValue>>, key: string): Record<string, number> {
  const person = state[key];
  if (person && typeof person === "object" && !Array.isArray(person)) {
    const mind = (person as Record<string, JsonValue>).mind;
    if (mind && typeof mind === "object" && !Array.isArray(mind)) {
      const f = (mind as Record<string, JsonValue>).facets;
      if (f && typeof f === "object" && !Array.isArray(f)) return f as unknown as Record<string, number>;
    }
  }
  return {};
}

function values(state: Readonly<Record<string, JsonValue>>, key: string): Record<string, number> {
  const person = state[key];
  if (person && typeof person === "object" && !Array.isArray(person)) {
    const mind = (person as Record<string, JsonValue>).mind;
    if (mind && typeof mind === "object" && !Array.isArray(mind)) {
      const v = (mind as Record<string, JsonValue>).values;
      if (v && typeof v === "object" && !Array.isArray(v)) return v as unknown as Record<string, number>;
    }
  }
  return {};
}

/** Tries several possible state keys (different situations name the other party differently) — "partner", "suitor", "rival". */
function otherFacets(state: Readonly<Record<string, JsonValue>>): Record<string, number> {
  for (const key of ["partner", "suitor", "rival"]) {
    const f = facets(state, key);
    if (Object.keys(f).length > 0) return f;
  }
  return {};
}

function f(rec: Record<string, number>, key: string, fallback = 50): number {
  return rec[key] ?? fallback;
}

export function ruleDistribution(question: DecisionQuestion): Distribution {
  const self = facets(question.state, "self");
  const selfValues = values(question.state, "self");
  const other = otherFacets(question.state);

  switch (question.kind) {
    case "Y1": {
      let encourage = 0.4;
      encourage += (f(self, "lovePropensity") - 50) / 150;
      encourage += (f(self, "gregariousness") - 50) / 250;
      encourage += (f(other, "trust") - 50) / 300;
      encourage = clamp01(encourage);
      const decline = clamp01((1 - encourage) * 0.6);
      const wait = Math.max(0.02, 1 - encourage - decline);
      return { encourage, decline, wait };
    }
    case "A1": {
      let propose = 0.45 + (f(self, "lovePropensity") - 50) / 150 + (f(self, "perseverance") - 50) / 300;
      let endIt = 0.15 + (f(self, "anger") - 50) / 300;
      propose = clamp01(propose);
      endIt = clamp01(endIt);
      const delay = Math.max(0.02, 1 - propose - endIt);
      return { propose, delay, "end-it": endIt };
    }
    case "A3": {
      const options = question.options;
      let seizeWeight = 1 + (f(self, "ambition") - 50) / 40;
      const passWeight = 1 + (f(self, "altruism") - 50) / 60;
      const ignoreWeight = 1 + (50 - f(self, "ambition")) / 60;
      seizeWeight = Math.max(0.2, seizeWeight);
      const weights: Record<string, number> = {};
      for (const option of options) weights[option] = option === "seize" ? seizeWeight : option === "pass" ? passWeight : ignoreWeight;
      const total = Object.values(weights).reduce((sum, w) => sum + w, 0);
      const distribution: Record<string, number> = {};
      for (const option of options) distribution[option] = weights[option]! / total;
      return distribution;
    }
    case "A2": {
      let tryFor = 0.4 + f(selfValues, "family", 0) / 150 + (f(self, "lovePropensity") - 50) / 200;
      tryFor = clamp01(tryFor);
      const refuse = clamp01((1 - tryFor) * 0.3);
      const wait = Math.max(0.02, 1 - tryFor - refuse);
      return { try: tryFor, wait, refuse };
    }
    case "Y4": {
      let confront = 0.35 + (f(self, "anger") - 50) / 150 + (f(self, "greed") - 50) / 250;
      confront = clamp01(confront);
      const forgive = clamp01((1 - confront) * 0.5);
      const nurse = Math.max(0.02, 1 - confront - forgive);
      return { confront, forgive, "nurse-it": nurse };
    }
    case "A6": {
      let reconcile = 0.4 + (f(self, "altruism") - 50) / 150 - (f(self, "anger") - 50) / 250;
      reconcile = clamp01(reconcile);
      const sabotage = clamp01((f(self, "anger") - 50) / 200);
      const feud = Math.max(0.02, 1 - reconcile - sabotage);
      return { reconcile, feud, sabotage };
    }
    case "Y3": {
      let leave = 0.15 + (f(self, "curiosity") - 50) / 150;
      leave = clamp01(leave);
      return { leave, stay: clamp01(1 - leave) };
    }
    case "A8": {
      // Round 7 fix (decision 030): "adjust-it" is only ever offered when the caller included it
      // in `question.options` (a real cause behind the dream check — see simulate.ts) — this must
      // never invent a distribution over an option that isn't actually on the table, or
      // Gumbel-max can sample a "chosen" id absent from `question.options` entirely.
      const hasAdjust = question.options.includes("adjust-it");
      const push = clamp01(0.4 + (f(self, "perseverance") - 50) / 150);
      const abandon = clamp01((100 - f(self, "perseverance") - f(self, "ambition")) / 250);
      if (!hasAdjust) {
        const stay = Math.max(0.02, 1 - abandon);
        return { "push-harder": stay, "abandon-it": abandon };
      }
      const adjust = Math.max(0.02, 1 - push - abandon);
      return { "push-harder": push, "adjust-it": adjust, "abandon-it": abandon };
    }
    case "A11": {
      const master = clamp01(0.3 + (f(self, "perseverance") - 50) / 150 - (f(self, "stressVulnerability") - 50) / 200);
      return { "master-it": master, "give-in": clamp01(1 - master) };
    }
    default:
      return question.options.reduce<Record<string, number>>((acc, option) => ({ ...acc, [option]: 1 }), {});
  }
}

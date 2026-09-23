import type { DecisionQuestion, Distribution } from "./decisions";
import { OUTCOME_PROBABILITY_FLOOR } from "./hazards";
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
      // PR6 corrective (engram #6280, "the marriage chain"): floored at `OUTCOME_PROBABILITY_FLOOR`
      // (0.15), not `clamp01`'s own 0.02 — a facet-worst-case person's raw formula can reach the 0.02
      // floor, which combined with `hazards.ts#effectiveSelectionHazard`'s SELECTION-side scaling
      // (which can inflate the win rate but never the ACTUAL "encourage" draw itself) produced a
      // measured ~50-year expected wait for that person specifically, regardless of how favorable
      // their circumstances otherwise were (validator trace: 18+ consecutive years offered at a
      // ~85-94% selection win rate, "encourage" pinned at 0.02 the entire time). A shy or
      // low-trust person should still be SLOWER than average — not effectively locked out for
      // decades — matching `effectiveSelectionHazard`'s own floor so the two halves of the chain
      // share one consistent "how reluctant can a real person plausibly be" floor.
      encourage = Math.max(OUTCOME_PROBABILITY_FLOOR, clamp01(encourage));
      const decline = clamp01((1 - encourage) * 0.6);
      const wait = Math.max(0.02, 1 - encourage - decline);
      return { encourage, decline, wait };
    }
    case "A1": {
      let propose = 0.45 + (f(self, "lovePropensity") - 50) / 150 + (f(self, "perseverance") - 50) / 300;
      let endIt = 0.15 + (f(self, "anger") - 50) / 300;
      // PR6 corrective: same floor as Y1's "encourage" above, for the same reason.
      propose = Math.max(OUTCOME_PROBABILITY_FLOOR, clamp01(propose));
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
    case "C1": {
      const compete = clamp01(0.3 + (f(self, "anger") - 50) / 150 + (f(self, "greed") - 50) / 250);
      const withdraw = clamp01((f(self, "anxiety") - 50) / 200);
      const bond = Math.max(0.02, 1 - compete - withdraw);
      return { compete, bond, withdraw };
    }
    case "C4": {
      const fightBack = clamp01(0.3 + (f(self, "anger") - 50) / 150 + (f(self, "bravery") - 50) / 200);
      const tellElder = clamp01(0.25 + (f(self, "trust") - 50) / 200);
      const endure = Math.max(0.02, 1 - fightBack - tellElder);
      return { "fight-back": fightBack, endure, "tell-an-elder": tellElder };
    }
    case "Y2": {
      const pursue = clamp01(0.35 + (f(self, "ambition") - 50) / 150 + (f(selfValues, "craft", 0)) / 150);
      return { "pursue-the-dream": pursue, "stay-practical": clamp01(1 - pursue) };
    }
    case "Y5": {
      const openUp = clamp01(0.4 + (f(self, "gregariousness") - 50) / 150 + (f(self, "trust") - 50) / 200);
      return { "open-up": openUp, "keep-distance": clamp01(1 - openUp) };
    }
    case "A4": {
      const revenge = clamp01(0.15 + (f(self, "anger") - 50) / 150);
      const leave = clamp01(0.2 + (50 - f(self, "trust")) / 150);
      const forgive = clamp01(0.2 + (f(self, "altruism") - 50) / 150);
      const confront = Math.max(0.02, 1 - revenge - leave - forgive);
      return { confront, forgive, leave, revenge };
    }
    case "A7": {
      const doubleDown = clamp01(0.35 + (f(selfValues, "faith", 0)) / 100 + (f(self, "perseverance") - 50) / 200);
      const loseFaith = clamp01((50 - f(selfValues, "faith", 0) - 50) / -150);
      const seekOther = Math.max(0.02, 1 - doubleDown - loseFaith);
      return { "double-down": doubleDown, "lose-faith": clamp01(loseFaith), "seek-another-path": seekOther };
    }
    case "A9": {
      const pursue = clamp01(0.15 + (f(self, "lovePropensity") - 50) / 150 - (f(selfValues, "law", 0)) / 150 - (f(selfValues, "tradition", 0)) / 200);
      return { resist: clamp01(1 - pursue), pursue };
    }
    case "A10": {
      const takeApprentice = clamp01(0.4 + (f(self, "altruism") - 50) / 150 + (f(selfValues, "craft", 0)) / 150);
      return { "take-an-apprentice": takeApprentice, decline: clamp01(1 - takeApprentice) };
    }
    case "O1": {
      const eldest = clamp01(0.3 + (f(selfValues, "tradition", 0)) / 150);
      const town = clamp01(0.15 + (f(self, "altruism") - 50) / 200);
      const split = clamp01(0.25 + (f(selfValues, "family", 0)) / 200);
      const favorite = Math.max(0.02, 1 - eldest - town - split);
      return { eldest, favorite, split, town };
    }
    case "O3": {
      const lastAttempt = clamp01(0.25 + (f(self, "perseverance") - 50) / 150);
      const passOn = clamp01(0.35 + (f(selfValues, "family", 0)) / 150);
      const makePeace = Math.max(0.02, 1 - lastAttempt - passOn);
      return { "last-attempt": lastAttempt, "pass-it-on": passOn, "make-peace-with-it": makePeace };
    }
    case "AP1": {
      const ownTrade = clamp01(0.4 + (f(selfValues, "tradition", 0)) / 150);
      const sendAway = clamp01(0.25 + (f(self, "ambition") - 50) / 200);
      const keepHome = Math.max(0.02, 1 - ownTrade - sendAway);
      return { "apprentice-own-trade": ownTrade, "send-away": sendAway, "keep-home": keepHome };
    }
    case "PIL1": {
      const go = clamp01(0.3 + (f(selfValues, "faith", 0)) / 120 + (f(self, "curiosity") - 50) / 200);
      return { go, stay: clamp01(1 - go) };
    }
    case "SEX1": {
      // The rules engine has no opinion on a name's gendering — a real coin flip either way.
      return { f: 0.5, m: 0.5 };
    }
    case "D1": {
      // Generic everyday-life situation: a uniform-ish spread over whatever 2-3 options this
      // vignette offers, with a very slight lean toward the situation's own "options[0]" (usually
      // the more active/generous choice) via self.altruism, matching the mild self-consistency the
      // other rule branches show without inventing a fake per-vignette model.
      const options = question.options;
      const lean = clamp01(0.4 + (f(self, "altruism") - 50) / 250);
      if (options.length === 0) return {};
      const rest = Math.max(0.02, 1 - lean) / Math.max(1, options.length - 1);
      const distribution: Record<string, number> = {};
      options.forEach((option, index) => {
        distribution[option] = index === 0 ? lean : rest;
      });
      return distribution;
    }
    default:
      return question.options.reduce<Record<string, number>>((acc, option) => ({ ...acc, [option]: 1 }), {});
  }
}

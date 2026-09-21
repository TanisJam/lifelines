/**
 * Pure view-logic for the Living Chronicle (round 8, decision 033) — split out of
 * `src/components/chronicle.tsx` (a client component) so it's directly unit-testable with vitest,
 * with no React/Next.js runtime involved. Framework-free by design: only plain objects in, plain
 * values out.
 */

export interface ChronicleDecisionLike {
  readonly chosen: string;
  readonly fragility: number;
  readonly surprise: boolean;
  readonly source: string;
  readonly final: Readonly<Record<string, number>>;
}

/** Whether a decision was Jev/the rules engine actually deciding something, vs. a biological chance roll (illness/death) — "chose" language only belongs to the former. */
export function isChoiceDecision(d: ChronicleDecisionLike): boolean {
  return d.source === "jev" || d.source === "rules";
}

/**
 * Whether this decision is a real TURN — the ONLY thing that earns the "◆ CHOSEN" label and the
 * "change what happened" link at all (round 8, decision 033, "three event levels are not
 * respected" — round 7 showed these on EVERY decision, including a 99%-certain death roll and an
 * uncontested birth). A Jev/rules decision is a turn only when the alternatives were actually
 * live — the chosen option's own probability was under 90%, the call was fragile, or the outcome
 * was a surprise. A chance event (illness, death) is a turn only when the runner-up was genuinely
 * plausible (≥10%) or the outcome was a surprise.
 */
export function isRealTurn(d: ChronicleDecisionLike): boolean {
  const chosenProb = d.final[d.chosen] ?? 0;
  if (isChoiceDecision(d)) return chosenProb < 0.9 || d.fragility < 1 || d.surprise;
  const runnerUp = [...Object.values(d.final)].sort((a, b) => b - a)[1] ?? 0;
  return d.surprise || runnerUp >= 0.1;
}

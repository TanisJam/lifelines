/**
 * Scratch measurement tool for the backlog item "Rewrite ghost annotations come back empty"
 * (decision 039, followed up by decision 082). NOT part of `pnpm test`'s coverage (same convention
 * as every other `scripts/*.ts` one-off, see decision 061's `find-seeds.ts` note) — a dev tool for
 * measuring `decision-id.ts#buildGhostAnnotations`'s match rate before/after a change, offline,
 * under the deterministic `RuleDecisionMaker` (no Jev calls, no server/life-store layer).
 *
 * What it measures: across many seeds, simulate a full protagonist life, then fork it at a handful
 * of the protagonist's own real turns (forcing a DIFFERENT option than what actually happened),
 * exactly like the rewrite route does (see `protagonist.test.ts`'s own fork pattern). For every
 * post-fork decision that concerns the protagonist and is a real turn, an INDEPENDENT oracle (never
 * imported from `decision-id.ts`, so this can't be tautological) decides whether a "plausible
 * counterpart" exists in the base branch: same `kind`, same `personId`, same `partnerId` (or both
 * absent), within `ORACLE_WINDOW_YEARS` of each other. Restricted further to cases where that
 * nearest counterpart's `chosen` actually DIFFERS (a genuine divergence — the only case a ghost
 * annotation should ever fire for), the script reports what fraction of those get annotated by
 * `buildGhostAnnotations` vs. come back empty.
 *
 * Usage: npx tsx scripts/ghost-match-rate.ts [seedCount]
 */
import { RuleDecisionMaker } from "../src/adapters/decision/rule-decision-maker";
import { isRealTurn } from "../src/domain/chronicle-view";
import { buildGhostAnnotations } from "../src/domain/decision-id";
import { forkWorld } from "../src/domain/fork";
import { simulate, type SimulateReport } from "../src/domain/simulate";
import type { DecisionRecord } from "../src/domain/decisions";
import type { Override, WorldConfig } from "../src/domain/types";
import { generateWorld } from "../src/domain/worldgen";

const PROTAGONIST_ID = "protagonist";
/** Generous on purpose (wider than whatever `buildGhostAnnotations` itself uses) — an independent, permissive "these two decisions plausibly describe the same life moment" bar, not the algorithm under test. */
const ORACLE_WINDOW_YEARS = 8;

interface DivergenceCase {
  readonly seed: string;
  readonly forkYear: number;
  readonly kind: string;
  readonly oldYear: number;
  readonly newYear: number;
  readonly yearGap: number;
  readonly entryId: string;
  readonly annotated: boolean;
}

function protagonistWorld(seed: string) {
  return generateWorld({ seed, startYear: 1327, endYear: 1427, founderCount: 20, protagonist: { name: "Testa", sex: "random" } });
}

async function runBaseLife(seed: string): Promise<{ config: WorldConfig; report: SimulateReport }> {
  const { config, people, events } = protagonistWorld(seed);
  const report = await simulate(config, people, events, { decisionMaker: new RuleDecisionMaker(), engineSource: "rules", protagonistId: PROTAGONIST_ID });
  return { config, report };
}

function concernsProtagonist(d: DecisionRecord): boolean {
  return d.personId === PROTAGONIST_ID || d.partnerId === PROTAGONIST_ID;
}

/** Picks a handful of the protagonist's own real turns, spread across the life, each with >= 2 options and an alternative to force. */
function pickForkPoints(decisions: readonly DecisionRecord[]): DecisionRecord[] {
  const candidates = decisions
    .filter((d) => concernsProtagonist(d) && isRealTurn(d) && d.options.length >= 2 && d.options.some((o) => o.id !== d.chosen))
    .sort((a, b) => a.year - b.year);
  if (candidates.length === 0) return [];
  const picks: DecisionRecord[] = [];
  const quartiles = [0.15, 0.4, 0.65];
  for (const q of quartiles) {
    const idx = Math.min(candidates.length - 1, Math.floor(candidates.length * q));
    const pick = candidates[idx]!;
    if (!picks.some((p) => p.id === pick.id)) picks.push(pick);
  }
  return picks;
}

/**
 * Independent oracle: exclusive (one-to-one) nearest-year matching, same (kind, personId,
 * partnerId) group, within `ORACLE_WINDOW_YEARS` — coded separately from
 * `decision-id.ts#buildGhostAnnotations` (never imported from it), deliberately with a WIDER window
 * than production uses, and EXCLUSIVE (each old decision counts as a counterpart for at most one new
 * one) so a relationship that simply ran one occurrence longer in the fork (e.g. an extra "propose"
 * year before "end-it") isn't double-counted as if its already-claimed neighbor were its own
 * counterpart too — that longer-running extra occurrence genuinely has none, in either the oracle or
 * production's view, and both should agree it stays empty.
 */
function oracleMatch(newDecisions: readonly DecisionRecord[], baseFromFork: readonly DecisionRecord[]): Map<string, DecisionRecord> {
  interface Candidate {
    readonly nd: DecisionRecord;
    readonly bd: DecisionRecord;
    readonly gap: number;
  }
  const candidates: Candidate[] = [];
  for (const nd of newDecisions) {
    for (const bd of baseFromFork) {
      if (bd.kind !== nd.kind || bd.personId !== nd.personId) continue;
      if ((bd.partnerId ?? null) !== (nd.partnerId ?? null)) continue;
      const gap = Math.abs(bd.year - nd.year);
      if (gap <= ORACLE_WINDOW_YEARS) candidates.push({ nd, bd, gap });
    }
  }
  candidates.sort((a, b) => a.gap - b.gap);

  const matched = new Map<string, DecisionRecord>();
  const usedOld = new Set<DecisionRecord>();
  for (const c of candidates) {
    if (matched.has(c.nd.id) || usedOld.has(c.bd)) continue;
    matched.set(c.nd.id, c.bd);
    usedOld.add(c.bd);
  }
  return matched;
}

async function measureSeed(seed: string, cases: DivergenceCase[]): Promise<void> {
  const { config, report: base } = await runBaseLife(seed);
  const forkPoints = pickForkPoints(base.result.decisions);

  for (const target of forkPoints) {
    const altOption = target.options.find((o) => o.id !== target.chosen)!;
    const override: Override = { id: `ghost-rate-${seed}-${target.id}`, decisionId: target.id, optionId: altOption.id };

    let forked: SimulateReport;
    try {
      forked = await forkWorld(base.snapshots, override, target.year, new RuleDecisionMaker(), "rules", config, undefined, PROTAGONIST_ID);
    } catch {
      continue; // no snapshot for that year (shouldn't happen for a decision drawn from this same report), skip defensively
    }

    const baseFromFork = base.result.decisions.filter((d) => d.year >= target.year);
    const newTurns = forked.result.decisions.filter((d) => concernsProtagonist(d) && isRealTurn(d) && d.resultingEventIds.length > 0);

    // Build minimal chronicle-entry stand-ins the same shape `buildGhostAnnotations` expects,
    // without going through narration/Jev at all (see module doc comment).
    const newEntries = newTurns.map((d) => ({ id: d.resultingEventIds[0]!, turn: { decisionId: d.id, chosen: { optionId: d.chosen } } }));
    const ghosts = buildGhostAnnotations(base.result.decisions, forked.result.decisions, newEntries, target.year);
    // Matched over the FULL decision set on both sides (exactly what `buildGhostAnnotations` itself
    // sees, per its real call site in the rewrite route) — not just the `newTurns` subset — so an
    // exact-year, non-divergent, non-turn sibling decision correctly "claims" its own base
    // counterpart first, the same way it does in production; only the RESULT is then narrowed to
    // the turns this measurement cares about.
    const oracle = oracleMatch(forked.result.decisions, baseFromFork);

    for (const nd of newTurns) {
      const counterpart = oracle.get(nd.id);
      if (!counterpart || counterpart.chosen === nd.chosen) continue; // no plausible counterpart, or no real divergence — not this measurement's concern
      const entryId = nd.resultingEventIds[0]!;
      cases.push({
        seed,
        forkYear: target.year,
        kind: nd.kind,
        oldYear: counterpart.year,
        newYear: nd.year,
        yearGap: Math.abs(counterpart.year - nd.year),
        entryId,
        annotated: ghosts[entryId] !== undefined,
      });
    }
  }
}

async function main(): Promise<void> {
  const seedCount = Number(process.argv[2] ?? 20);
  const cases: DivergenceCase[] = [];

  for (let i = 1; i <= seedCount; i++) {
    await measureSeed(`ghost-rate-${i}`, cases);
  }

  const total = cases.length;
  const annotated = cases.filter((c) => c.annotated).length;
  const empty = total - annotated;

  console.log(`Seeds: ${seedCount}`);
  console.log(`Genuine post-fork divergences with a plausible counterpart (oracle window ${ORACLE_WINDOW_YEARS}y): ${total}`);
  console.log(`  Annotated (ghost present): ${annotated} (${total > 0 ? ((annotated / total) * 100).toFixed(1) : "0.0"}%)`);
  console.log(`  Empty (ghost missing):     ${empty} (${total > 0 ? ((empty / total) * 100).toFixed(1) : "0.0"}%)`);

  const byGap = new Map<number, { annotated: number; total: number }>();
  for (const c of cases) {
    const entry = byGap.get(c.yearGap) ?? { annotated: 0, total: 0 };
    entry.total += 1;
    if (c.annotated) entry.annotated += 1;
    byGap.set(c.yearGap, entry);
  }
  console.log("\nBy year gap between the shifted event and its base-branch counterpart:");
  for (const gap of [...byGap.keys()].sort((a, b) => a - b)) {
    const { annotated: a, total: t } = byGap.get(gap)!;
    console.log(`  gap=${gap}y: ${a}/${t} annotated`);
  }

  const emptyExamples = cases.filter((c) => !c.annotated).slice(0, 5);
  if (emptyExamples.length > 0) {
    console.log("\nSample cases that came back empty:");
    for (const c of emptyExamples) {
      console.log(`  seed=${c.seed} kind=${c.kind} forkYear=${c.forkYear} oldYear=${c.oldYear} newYear=${c.newYear} gap=${c.yearGap}`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

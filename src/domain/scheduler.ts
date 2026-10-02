import { createHelpFavorState, helpOpportunities, replayHelpFavorEvents, requestHelp, respondHelp, requireFavorData, type HelpFavorState, type HelpOpportunity, type HelpSkipReason } from "./effects";
import { requireFields, requireId, requireInteger } from "./obligations";
import { keyedDraw } from "./rng";

export const SCHEDULER_VERSION = "favor-scheduler-c2";
export const SCHEDULER_RNG_VERSION = "keyed-mulberry32-c2";
interface SkippedDebt { obligation: string; reason: HelpSkipReason }
interface DrawEvidence { key: string; value: number }
interface AttemptContext { seed: string; year: number; creditor: string; slot: 0 | 1; skipped: SkippedDebt[] }
export type FavorAttempt =
  | (AttemptContext & { kind: "quiet"; reason: "no-eligible-debt" })
  | (AttemptContext & { kind: "inactive"; obligation: string; actors: string[]; activation: DrawEvidence })
  | (AttemptContext & { kind: "response"; obligation: string; actors: string[]; activation: DrawEvidence; response: DrawEvidence; outcome: "help" | "refuse"; requestId: string; responseId: string });
export interface FavorYear { year: number; attempts: FavorAttempt[] }
export interface FavorScheduler {
  version: typeof SCHEDULER_VERSION;
  rngVersion: typeof SCHEDULER_RNG_VERSION;
  seed: string;
  initialPreviousYear: number;
  completedYear: number;
  initialPrefixLength: number;
  years: FavorYear[];
  state: HelpFavorState;
}

/** UTF-8 byte order; raw string fallback distinguishes lone-surrogate replacement collisions. */
function byteOrder(a: string, b: string): number {
  const encoder = new TextEncoder();
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    if (left[i] !== right[i]) return left[i]! - right[i]!;
  }
  return left.length - right.length || (a < b ? -1 : a > b ? 1 : 0);
}
// Inputs are descriptor-checked before comparison. Records may have null prototypes/key order changes.
function dataEncoding(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(dataEncoding).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${dataEncoding((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
function semanticKey(target: HelpOpportunity, year: number, slot: number, purpose: string): string {
  return JSON.stringify([SCHEDULER_VERSION, SCHEDULER_RNG_VERSION, "help-opportunity", [target.creditor, target.debtor], year, slot, target.obligation, purpose]);
}
function draw(seed: string, key: string): DrawEvidence {
  // Put ALL variable transport into one canonical string; the delimiter-based legacy adapter
  // only receives fixed remaining arguments. This does not promise collision-free RNG hashing.
  return { key, value: keyedDraw(JSON.stringify([seed, key]), "favor-c2", 0, "uniform") };
}

/** Fresh envelope owns one C world and a prefix index, never an initial/final Person mirror. */
export function createFavorScheduler(input: HelpFavorState, seed: string, initialPreviousYear: number): FavorScheduler {
  requireId(seed); // Primitive validation precedes encoding or RNG transport.
  requireInteger(initialPreviousYear, Number.MIN_SAFE_INTEGER);
  const state = replayHelpFavorEvents(input, []);
  if (state.events.some((event) => event.year > initialPreviousYear)) throw new Error("Initial events exceed previous-year frontier");
  return { version: SCHEDULER_VERSION, rngVersion: SCHEDULER_RNG_VERSION, seed, initialPreviousYear, completedYear: initialPreviousYear, initialPrefixLength: state.events.length, years: [], state };
}

/** Internal deterministic annual transaction; caller has already admitted the envelope. */
function executeYear(envelope: FavorScheduler, year: number): FavorScheduler {
  requireInteger(year, Number.MIN_SAFE_INTEGER);
  if (year <= envelope.completedYear || envelope.state.events.some((event) => event.year > year)) throw new Error("Repeated or backward annual frontier");
  const preflight = helpOpportunities(envelope.state, year);
  let state = preflight.state;
  const creditors = [...new Set(preflight.candidates.map((candidate) => candidate.creditor))].sort(byteOrder);
  const attempts: FavorAttempt[] = [];
  for (const creditor of creditors) {
    for (const slot of [0, 1] as const) {
      // Reinspect after each immediate response; no cached eligibility or global RNG sequence.
      const current = helpOpportunities(state, year);
      state = current.state;
      const candidates = current.candidates.filter((candidate) => candidate.creditor === creditor).sort((a, b) => byteOrder(a.obligation, b.obligation));
      const skipped = candidates.filter((candidate) => candidate.reason !== null).map((candidate) => ({ obligation: candidate.obligation, reason: candidate.reason! }));
      const context: AttemptContext = { seed: envelope.seed, year, creditor, slot, skipped };
      const target = candidates.find((candidate) => candidate.reason === null);
      if (!target) {
        attempts.push({ ...context, kind: "quiet", reason: "no-eligible-debt" });
        continue;
      }
      const actors = [target.creditor, target.debtor];
      const activation = draw(envelope.seed, semanticKey(target, year, slot, "activation"));
      if (activation.value >= 0.25) {
        attempts.push({ ...context, kind: "inactive", obligation: target.obligation, actors, activation });
        continue;
      }
      const response = draw(envelope.seed, semanticKey(target, year, slot, "response"));
      state = requestHelp(state, { key: semanticKey(target, year, slot, "request"), year, obligation: target.obligation });
      const requestId = state.events.at(-1)!.id;
      state = respondHelp(state, { request: requestId, year, noise: response.value, appraisals: [] });
      const event = state.events.at(-1)!;
      attempts.push({ ...context, kind: "response", obligation: target.obligation, actors, activation, response, outcome: event.evidence!.selected!, requestId, responseId: event.id });
    }
  }
  return { ...envelope, completedYear: year, state, years: [...envelope.years, { year, attempts }] };
}

/** Reconstruct initial prefix transiently, then reproduce every annual record and C effect.
 * Deterministic consistency only: neither the prefix boundary nor seed authenticates its author. */
export function admitFavorScheduler(input: FavorScheduler): FavorScheduler {
  requireFavorData(input, true);
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Expected scheduler envelope");
  requireFields(input, ["version", "rngVersion", "seed", "initialPreviousYear", "completedYear", "initialPrefixLength", "years", "state"]);
  requireFavorData({ version: input.version, rngVersion: input.rngVersion, seed: input.seed, initialPreviousYear: input.initialPreviousYear, completedYear: input.completedYear, initialPrefixLength: input.initialPrefixLength, years: input.years });
  if (input.version !== SCHEDULER_VERSION || input.rngVersion !== SCHEDULER_RNG_VERSION) throw new Error("Unsupported scheduler versions");
  requireId(input.seed);
  requireInteger(input.initialPreviousYear, Number.MIN_SAFE_INTEGER);
  requireInteger(input.completedYear, input.initialPreviousYear);
  if (!Array.isArray(input.years)) throw new Error("Expected annual records");
  const admitted = replayHelpFavorEvents(input.state, []); // Entire C checkpoint, before draws.
  requireInteger(input.initialPrefixLength, 0, admitted.events.length);
  const empty = createHelpFavorState(admitted.people, admitted.legacyEvents, admitted.allocations, admitted.initialAssistance, admitted.initialNeed);
  const initial = replayHelpFavorEvents(empty, admitted.events.slice(0, input.initialPrefixLength));
  let rebuilt = createFavorScheduler(initial, input.seed, input.initialPreviousYear);
  for (const record of input.years) {
    if (!record || typeof record !== "object" || Array.isArray(record)) throw new Error("Expected annual record");
    requireFields(record, ["year", "attempts"]);
    rebuilt = executeYear(rebuilt, record.year);
    if (dataEncoding(rebuilt.years.at(-1)) !== dataEncoding(record)) throw new Error("Forged or stale annual evidence");
  }
  if (rebuilt.completedYear !== input.completedYear || dataEncoding(rebuilt.state) !== dataEncoding(admitted)) throw new Error("Scheduler frontier/log disagreement");
  return rebuilt;
}

/** Gaps are allowed explicitly; absent years are not simulated or counted as quiet attempts. */
export function runFavorYear(input: FavorScheduler, year: number): FavorScheduler {
  requireInteger(year, Number.MIN_SAFE_INTEGER);
  return executeYear(admitFavorScheduler(input), year);
}

import { canonicalLifecycleData } from "./e-lifecycle-genesis";
import { createLifecycleRuntime } from "./e-lifecycle-runtime";
import { requireFavorData } from "./effects";
import { requireFields } from "./obligations";

function record(value: unknown): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected lifecycle replay record");
}

/** Cold full-state replay, not checkpoint hydration, hash authority or a wire codec.
 * Only admitted genesis and contiguous years are execution inputs. Candidate
 * plans, effects, native choices and snapshots are evidence to compare, NEVER
 * instructions to execute. Return the regenerated owner's frozen graph so its
 * people/log aliases and genesis registry traversal survive canonical sorting.
 */
export async function replayLifecycleRuntime(input: unknown) {
  // Check the WHOLE borrowed envelope before any read, clone, hash or await.
  requireFavorData(input, true);
  record(input);
  requireFields(input, ["genesis", "output"]);
  // Capture everything before the first asynchronous native step. Later caller
  // mutations cannot change the admitted root or the evidence being certified.
  const candidate = structuredClone(input);
  record(candidate.output);
  if (!Array.isArray(candidate.output.journal)) throw new Error("Expected lifecycle journal");
  const runtime = createLifecycleRuntime(candidate.genesis); // complete LR1a semantic regeneration
  let nextYear = runtime.initial.frontier + 1;
  for (const entry of candidate.output.journal) {
    record(entry);
    if (!Number.isSafeInteger(entry.year) || Object.is(entry.year, -0) || entry.year !== nextYear) {
      throw new Error("Lifecycle replay years must be contiguous safe integers");
    }
    nextYear++;
  }
  for (const entry of candidate.output.journal) {
    // advance rejects after genuine death and has no origin.endYear ceiling.
    const regenerated = await runtime.advance(entry.year as number);
    if (canonicalLifecycleData(entry) !== canonicalLifecycleData(regenerated.journal.at(-1))) {
      throw new Error("Lifecycle annual record disagreement");
    }
  }
  const regenerated = runtime.snapshot();
  // Includes versions, digest, frontier/status, every final native/economic
  // ledger and canonical snapshot; no duplicate Person/Mind schema or projection.
  // Human-authority evidence cannot equal the authority-free regenerated output.
  if (canonicalLifecycleData(candidate.output) !== canonicalLifecycleData(regenerated)) {
    throw new Error("Lifecycle final output disagreement");
  }
  return regenerated;
}

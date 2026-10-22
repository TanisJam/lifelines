import { admitLifecycleGenesis, canonicalLifecycleData } from "./e-lifecycle-genesis";
import { admitLifecycleCapsule, createLifecycleCapsule, type LifecycleCapsule } from "./e-lifecycle-capsule";
import { createLifecycleRuntime, type LifecycleJournalMode } from "./e-lifecycle-runtime";
import { requireFavorData } from "./effects";
import { requireFields } from "./obligations";

export interface LifecycleRunOptions {
  /** New committed years only; admission and reconstruction do not consume budget. */
  readonly maxSteps: number;
  readonly signal?: AbortSignal;
  /**
   * Observes each committed year INSIDE the run loop, with that frontier's published output, before
   * the next year executes. A streaming caller emits its frame here, so a viewer watches the life
   * unfold instead of waiting for the whole run and receiving every year in one burst. Like `signal`,
   * this is a capability, never serializable authority: it observes the run and cannot alter it.
   */
  readonly onYear?: (output: LifecycleCapsule["output"]) => Promise<void> | void;
}
export type LifecycleRunResult =
  | { readonly status: "complete"; readonly capsule: LifecycleCapsule }
  | { readonly status: "incomplete"; readonly reason: "budget"; readonly capsule: LifecycleCapsule }
  | { readonly status: "aborted"; readonly capsule: LifecycleCapsule };

function record(value: unknown): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected lifecycle run record");
}
function capture(input: unknown): Record<string, unknown> {
  // Check WHOLE authority graph before the discriminator, cloning or any await.
  requireFavorData(input, true);
  record(input);
  if (input.kind === "start") requireFields(input, ["kind", "genesis"]);
  else if (input.kind === "resume") requireFields(input, ["kind", "capsule"]);
  else throw new Error("Unknown lifecycle run kind");
  return structuredClone(input);
}
const nativeAborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, "aborted")!.get!;
function optionsFor(input: unknown): { maxSteps: number; aborted: () => boolean; onYear: LifecycleRunOptions["onYear"] } {
  // The signal is a native capability, not serializable execution authority.
  // Inspect only root descriptors; never traverse a signal or call caller getters.
  record(input);
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== null && prototype !== Object.prototype) throw new Error("Expected plain lifecycle run options");
  for (const key of Reflect.ownKeys(input)) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key)!;
    if ((key !== "maxSteps" && key !== "signal" && key !== "onYear")
      || !descriptor.enumerable || !("value" in descriptor)) {
      throw new Error("Invalid lifecycle run option descriptor");
    }
  }
  if (!Object.hasOwn(input, "maxSteps")) throw new Error("Missing lifecycle step budget");
  const maxSteps = input.maxSteps;
  if (typeof maxSteps !== "number" || !Number.isSafeInteger(maxSteps) || maxSteps < 0 || Object.is(maxSteps, -0)) {
    throw new Error("Invalid lifecycle step budget");
  }
  const signal = input.signal;
  const aborted = signal === undefined ? () => false : () => nativeAborted.call(signal) as boolean;
  aborted(); // Native brand check before asynchronous work, including zero budget.
  const onYear = input.onYear;
  if (onYear !== undefined && typeof onYear !== "function") throw new Error("Invalid lifecycle year observer");
  return { maxSteps, aborted, onYear: onYear as LifecycleRunOptions["onYear"] };
}
function result(capsule: LifecycleCapsule, aborted: boolean): LifecycleRunResult {
  // Producer cancellation wins even if the last committed runtime year was death.
  if (aborted) return Object.freeze({ status: "aborted", capsule });
  if (capsule.output.status === "complete") return Object.freeze({ status: "complete", capsule });
  return Object.freeze({ status: "incomplete", reason: "budget", capsule });
}

/** Certified start/resume owner. No checkpoint hydration, callbacks or authority port.
 * Cancellation observes closed boundaries only, never interrupts native/replay work.
 * Errors propagate unchanged; no failed execution is converted into cancellation.
 */
/**
 * Re-executes a stored genesis for its recorded number of years and returns the output, WITHOUT building
 * the legacy capsule. This is the cold-reconstruction primitive: the genesis is the stored authority, and
 * every year is regenerated from it under the current engine. No stored output, digest or record is used
 * as an input - there is none to use.
 */
export async function regenerateLifecycleOutput(
  genesis: unknown,
  maxSteps: unknown,
  journal: LifecycleJournalMode = "audit",
): Promise<LifecycleCapsule["output"]> {
  const admitted = admitLifecycleGenesis(genesis);
  if (typeof maxSteps !== "number" || !Number.isSafeInteger(maxSteps) || maxSteps < 0 || Object.is(maxSteps, -0)) {
    throw new Error("Invalid lifecycle reconstruction step budget");
  }
  const owner = createLifecycleRuntime(admitted, { journal });
  for (let step = 0; step < maxSteps; step++) {
    // Same stop rule as runLifecycle: a death inside the budget ends the run early, never overshoots.
    if (owner.snapshot().status === "complete") break;
    await owner.advance(owner.snapshot().frontier + 1);
  }
  return owner.snapshot();
}

export interface LifecycleRunOutput {
  readonly genesis: ReturnType<typeof admitLifecycleGenesis>;
  readonly output: LifecycleCapsule["output"];
  readonly aborted: boolean;
}

/**
 * The run WITHOUT the legacy capsule. `createLifecycleCapsule` builds `canonicalLifecycleData`, a
 * string about 15x the payload that throws `Invalid string length` past ~17 years; a caller that only
 * needs `{ genesis, output }` (the compact create path, the cold loader) must not pay it.
 */
export async function runLifecycleOutput(
  input: unknown,
  options: LifecycleRunOptions,
  journal: LifecycleJournalMode = "audit",
): Promise<LifecycleRunOutput> {
  const candidate = capture(input);
  const { maxSteps, aborted, onYear } = optionsFor(options);
  // Resume reads a LEGACY capsule, whose bytes embed the audit journal: audit is the only mode that
  // can reproduce it, and a compact request against it is a refusal rather than a silent mismatch.
  if (candidate.kind === "resume" && journal !== "audit") {
    throw new Error("A resumed legacy capsule can only be replayed in audit mode");
  }
  const admitted = candidate.kind === "resume" ? await admitLifecycleCapsule(candidate.capsule) : undefined;
  const genesis = admitted?.genesis ?? admitLifecycleGenesis(candidate.genesis);
  // Full cold admission already certified a complete capsule; never advance it.
  if (admitted?.output.status === "complete") {
    return { genesis, output: admitted.output, aborted: aborted() };
  }
  const owner = createLifecycleRuntime(genesis, { journal });
  if (admitted !== undefined) {
    for (const entry of admitted.output.journal) await owner.advance(entry.year);
    if (canonicalLifecycleData(owner.snapshot()) !== canonicalLifecycleData(admitted.output)) {
      throw new Error("Lifecycle resume reconstruction disagreement");
    }
  }
  let observedAbort = aborted();
  for (let steps = 0; steps < maxSteps && owner.snapshot().status !== "complete" && !observedAbort; steps++) {
    observedAbort = aborted();
    if (observedAbort) break;
    await owner.advance(owner.snapshot().frontier + 1);
    observedAbort = aborted();
    if (observedAbort) break;
    // Per-year observation happens after this year is committed and before the next one starts, so a
    // streaming caller's frame reflects real progress rather than a finished run.
    if (onYear !== undefined) await onYear(owner.snapshot());
    observedAbort = aborted();
    if (observedAbort) break;
    // A real timer turn lets disconnect/abort timers run despite native microtasks.
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    observedAbort = aborted();
  }
  return { genesis, output: owner.snapshot(), aborted: observedAbort || aborted() };
}

/** The certified legacy path: the same run, plus the legacy capsule the legacy format requires. */
export async function runLifecycle(input: unknown, options: LifecycleRunOptions): Promise<LifecycleRunResult> {
  const run = await runLifecycleOutput(input, options, "audit");
  const capsule = await createLifecycleCapsule({ genesis: run.genesis, output: run.output });
  return result(capsule, run.aborted);
}

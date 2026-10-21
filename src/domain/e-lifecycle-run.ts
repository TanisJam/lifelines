import { admitLifecycleGenesis, canonicalLifecycleData } from "./e-lifecycle-genesis";
import { admitLifecycleCapsule, createLifecycleCapsule, type LifecycleCapsule } from "./e-lifecycle-capsule";
import { createLifecycleRuntime } from "./e-lifecycle-runtime";
import { requireFavorData } from "./effects";
import { requireFields } from "./obligations";

export interface LifecycleRunOptions {
  /** New committed years only; admission and reconstruction do not consume budget. */
  readonly maxSteps: number;
  readonly signal?: AbortSignal;
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
function optionsFor(input: unknown): { maxSteps: number; aborted: () => boolean } {
  // The signal is a native capability, not serializable execution authority.
  // Inspect only root descriptors; never traverse a signal or call caller getters.
  record(input);
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== null && prototype !== Object.prototype) throw new Error("Expected plain lifecycle run options");
  for (const key of Reflect.ownKeys(input)) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key)!;
    if ((key !== "maxSteps" && key !== "signal") || !descriptor.enumerable || !("value" in descriptor)) {
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
  return { maxSteps, aborted };
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
export async function runLifecycle(input: unknown, options: LifecycleRunOptions): Promise<LifecycleRunResult> {
  const candidate = capture(input);
  const { maxSteps, aborted } = optionsFor(options);
  const admitted = candidate.kind === "resume" ? await admitLifecycleCapsule(candidate.capsule) : undefined;
  const genesis = admitted?.genesis ?? admitLifecycleGenesis(candidate.genesis);
  // Full cold admission already certified a complete capsule; never advance it.
  if (admitted?.output.status === "complete") return result(admitted, aborted());
  const owner = createLifecycleRuntime(genesis);
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
    // A real timer turn lets disconnect/abort timers run despite native microtasks.
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    observedAbort = aborted();
  }
  const capsule = await createLifecycleCapsule({ genesis, output: owner.snapshot() });
  return result(capsule, observedAbort || aborted());
}

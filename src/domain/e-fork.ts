import { admitAnnualRuntimeCapsule, createAnnualRuntimeCapsule } from "./e-capsule";
import { createAnnualRuntime, type AnnualPlan } from "./e-runtime";
import { requireFavorData } from "./effects";

type DeepReadonly<T> = T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;
type Checkpoint = ReturnType<ReturnType<typeof createAnnualRuntime>["final"]>;
export interface AnnualRuntimeFork {
  readonly version: "annual-runtime-fork-e3-1";
  readonly parentDigest: string;
  readonly frontier: number | null;
  readonly prefixLength: number;
  readonly initial: Checkpoint;
  readonly prefix: Checkpoint;
  readonly suffix: readonly Checkpoint[];
  readonly finalCapsule: ReturnType<typeof createAnnualRuntimeCapsule>;
}

/** Only guarded acyclic own data: record order/prototypes are not canonical meaning.
 * Key presence, array order and Object.is leaves (including -0) remain significant. */
function sameData(left: unknown, right: unknown): boolean {
  if (left === null || right === null || typeof left !== "object" || typeof right !== "object") return Object.is(left, right);
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  if (Array.isArray(left) && Array.isArray(right) && left.length !== right.length) return false;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every(key => Object.hasOwn(right, key)
    && sameData(Reflect.get(left, key), Reflect.get(right, key)));
}

/** Freeze only the owned capsule clone, including its detached compatibility tuple. */
function freezeCapsule<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(freezeCapsule);
    Object.freeze(value);
  }
  return value;
}

/** Fresh local rules reconstruction, not durable lineage or a reusable transaction. */
export function forkAnnualRuntime(parent: unknown, frontier: number | null, suffix: readonly DeepReadonly<AnnualPlan>[]): AnnualRuntimeFork {
  const admitted = admitAnnualRuntimeCapsule(parent); // Whole future too, before any slicing or suffix access.
  requireFavorData(suffix);
  if (!Array.isArray(suffix)) throw new Error("Expected required annual suffix array");
  let prefixLength = 0;
  if (frontier !== null) {
    if (!Number.isSafeInteger(frontier) || Object.is(frontier, -0)) throw new Error("Invalid fork frontier");
    const index = admitted.output.journal.findIndex(record => record.plan.year === frontier);
    if (index < 0) throw new Error("Fork frontier was not executed");
    prefixLength = index + 1;
  }
  const runtime = createAnnualRuntime(admitted.output.origin.requested, admitted.output.genesis.resources);
  const retained = admitted.output.journal.slice(0, prefixLength);
  for (const record of retained) runtime.advance(record.plan);
  const prefix = runtime.final();
  if (!sameData(prefix.journal, retained)) throw new Error("Fork retained journal disagreement");
  const outputs = suffix.map(plan => runtime.advance(plan));
  return Object.freeze({
    version: "annual-runtime-fork-e3-1", parentDigest: admitted.digest, frontier, prefixLength,
    initial: runtime.initial, prefix, suffix: Object.freeze(outputs),
    finalCapsule: freezeCapsule(structuredClone(createAnnualRuntimeCapsule(runtime.final()))),
  });
}

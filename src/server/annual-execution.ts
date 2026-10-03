import { createAnnualRuntime, type AnnualPlan, type ResponseAuthority } from "../domain/e-runtime";
import { yieldToEventLoop } from "./sse";

export type AnnualExecutionOutput = ReturnType<ReturnType<typeof createAnnualRuntime>["final"]>;
export interface AnnualExecutionOptions {
  authority?: ResponseAuthority;
  onYear?: (output: AnnualExecutionOutput) => void | Promise<void>;
  signal?: AbortSignal;
}

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Annual execution aborted", "AbortError");
}

/** Explicit plans only. Cancellation cannot undo a committed year or callback effects. */
export async function executeAnnual(
  initialization: unknown,
  resources: unknown,
  plans: readonly AnnualPlan[],
  options: AnnualExecutionOptions = {},
): Promise<AnnualExecutionOutput> {
  checkAbort(options.signal);
  if (!Array.isArray(plans)) throw new TypeError("Annual plans must be an array");
  const runtime = createAnnualRuntime(initialization, resources, options.authority);
  for (const plan of plans) {
    checkAbort(options.signal);
    const output = runtime.advance(plan);
    checkAbort(options.signal);
    await options.onYear?.(output);
    checkAbort(options.signal);
    await yieldToEventLoop();
    checkAbort(options.signal);
  }
  return runtime.final();
}

import type { Chronicle, LifeStreamEvent } from "@/contracts/life";
import type { RewriteAction } from "./rewrite";

export interface RewriteRun {
  readonly signal: AbortSignal;
  /** Resolves after the hold (or at once when the signal aborts). The A and B holds go through it. */
  readonly sleep: (phase: "A" | "B") => Promise<void>;
  readonly dispatch: (action: RewriteAction) => void;
  readonly from: Chronicle;
  /** Runs the stream and feeds it every event; resolves when the stream ends. */
  readonly stream: (onEvent: (event: LifeStreamEvent) => void) => Promise<void>;
  /** The new life was saved: the caller moves the address bar. */
  readonly onDone: (chronicle: Chronicle) => void;
  readonly messages: { readonly incomplete: string; readonly failed: (err: unknown) => string };
}

/**
 * The decisions of a rewrite, free of React: hold in A, hold in B, stream in C, and how it ends. An error event is
 * only recorded while the stream runs and acted on once it has resolved, so the server's own message (a Turnstile or
 * guard rejection) reaches the user whatever the transport does after it, and a throw inside the callback never
 * leaves a half-read response behind. An aborted run dispatches nothing more.
 */
export async function runRewrite(run: RewriteRun): Promise<void> {
  const { signal, dispatch } = run;
  await run.sleep("A");
  if (signal.aborted) return;
  dispatch({ type: "hold" });
  await run.sleep("B");
  if (signal.aborted) return;
  dispatch({ type: "stream", from: run.from });

  let finished = false;
  let serverError: string | null = null;
  let thrown: unknown;
  try {
    await run.stream((event) => {
      if (serverError !== null) return;
      if (event.type === "tick") dispatch(event);
      else if (event.type === "done") {
        finished = true;
        dispatch({ type: "done", chronicle: event.chronicle, ghosts: event.ghosts ?? {} });
        run.onDone(event.chronicle);
      } else if (event.type === "error") serverError = event.message;
    });
  } catch (err) {
    thrown = err;
  }
  if (signal.aborted) return;
  // The old life was never touched: dropping the stream restores it, and the message says why.
  if (serverError !== null) dispatch({ type: "fail", message: serverError });
  else if (thrown !== undefined) dispatch({ type: "fail", message: run.messages.failed(thrown) });
  else if (!finished) dispatch({ type: "fail", message: run.messages.incomplete });
}

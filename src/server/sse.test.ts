import { describe, expect, it } from "vitest";
import { sseResponse } from "./sse";

async function readAllFrames(res: Response): Promise<string> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  return text;
}

describe("sseResponse", () => {
  it("writes one 'event: <name>\\ndata: <json>\\n\\n' frame per send() call, in order", async () => {
    const res = sseResponse(async (send) => {
      send("start", { a: 1 });
      send("done", { b: 2 });
    });

    const text = await readAllFrames(res);
    expect(text).toBe('event: start\ndata: {"a":1}\n\nevent: done\ndata: {"b":2}\n\n');
  });

  it("incremental-simulation capability: cancelling the stream aborts the signal passed to the handler", async () => {
    let observedSignal: AbortSignal | undefined;
    let sawAbortBeforeHandlerReturned = false;

    const res = sseResponse(async (send, signal) => {
      observedSignal = signal;
      send("start", {});
      // Give the reader a turn to cancel before this handler checks the signal again.
      await new Promise((resolve) => setTimeout(resolve, 10));
      sawAbortBeforeHandlerReturned = signal.aborted;
    });

    expect(observedSignal?.aborted).toBe(false);
    await res.body!.cancel();
    // The cancel() lifecycle callback runs synchronously on cancel(); give the handler's pending
    // timer a moment to observe it too.
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(observedSignal?.aborted).toBe(true);
    expect(sawAbortBeforeHandlerReturned).toBe(true);
  });
});

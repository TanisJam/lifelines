/**
 * A minimal `text/event-stream` Route Handler helper (decision 010). Each
 * `send(event, data)` call inside `handler` writes one SSE frame; the
 * stream closes when `handler` resolves, or after emitting an `error`
 * frame if it throws.
 *
 * Incremental-simulation capability: `handler` also receives an `AbortSignal` that fires when the
 * underlying `ReadableStream` is cancelled — the standard Web Streams signal for "the client
 * disconnected" — so a live-draining caller (`drainSimulation`) can stop simulating and skip
 * persisting a branch nobody will read.
 */
export function sseResponse(handler: (send: (event: string, data: unknown) => void, signal: AbortSignal) => Promise<void>): Response {
  const encoder = new TextEncoder();
  let closed = false;
  const abortController = new AbortController();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown): void => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          // Controller already closed (client disconnected mid-stream) — nothing to do.
        }
      };
      try {
        await handler(send, abortController.signal);
      } catch (error) {
        if (!abortController.signal.aborted) send("error", { message: error instanceof Error ? error.message : String(error) });
      } finally {
        closed = true;
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      }
    },
    cancel() {
      // The client disconnected before `handler` finished.
      abortController.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

/**
 * Decision 081: resolves after one real event-loop turn (`setImmediate`), not a microtask. A
 * CPU-bound handler whose awaits never reach real I/O (the rules engine, or Jev answering from its
 * cache) only ever yields microtasks, so Node never gets to write the enqueued frames to the socket
 * or to notice a disconnect until the whole run ends, and every tick arrives in one burst. Await
 * this after each streamed frame that should reach the client right away.
 */
export function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

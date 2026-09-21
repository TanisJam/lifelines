/**
 * A minimal `text/event-stream` Route Handler helper (decision 010). Each
 * `send(event, data)` call inside `handler` writes one SSE frame; the
 * stream closes when `handler` resolves, or after emitting an `error`
 * frame if it throws.
 */
export function sseResponse(handler: (send: (event: string, data: unknown) => void) => Promise<void>): Response {
  const encoder = new TextEncoder();
  let closed = false;

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
        await handler(send);
      } catch (error) {
        send("error", { message: error instanceof Error ? error.message : String(error) });
      } finally {
        closed = true;
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      }
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

/**
 * Consumes a POST `text/event-stream` response. Browsers' built-in
 * `EventSource` only supports GET, so a POST-driven stream (world creation
 * and forks both send a JSON body) has to be read manually from `fetch`'s
 * response body.
 */
export async function streamSSE(url: string, body: unknown, onEvent: (event: string, data: unknown) => void, signal?: AbortSignal): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Request failed (${res.status})`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";

    for (const frame of frames) {
      let event = "message";
      let dataText = "";
      for (const line of frame.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) dataText += line.slice(5).trim();
      }
      if (!dataText) continue;
      try {
        onEvent(event, JSON.parse(dataText));
      } catch {
        // Malformed frame; skip it rather than aborting the whole stream.
      }
    }
  }
}

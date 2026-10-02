import { describe, expect, it } from "vitest";
import type { Chronicle, LifeStreamEvent } from "@/contracts/life";
import { deleteLife } from "@/server/life-store";
import { POST } from "./route";

interface SseFrame {
  readonly event: string;
  readonly data: LifeStreamEvent;
}

/** Same POST-body SSE frame parsing `src/lib/sse.ts#streamSSE` uses client-side. */
async function collectFrames(res: Response): Promise<SseFrame[]> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const frames: SseFrame[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      let event = "message";
      let dataText = "";
      for (const line of part.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) dataText += line.slice(5).trim();
      }
      if (dataText) frames.push({ event, data: JSON.parse(dataText) as LifeStreamEvent });
    }
  }
  return frames;
}

function freshIp(): string {
  return `test-${Math.random().toString(36).slice(2)}`;
}

describe("POST /api/lives/stream — incremental-simulation capability: live SSE ticks", () => {
  it("sends a 'tick' frame for every simulated year of the protagonist's life, all before 'done'", async () => {
    const request = new Request("http://localhost/api/lives/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json", "cf-connecting-ip": freshIp() },
      body: JSON.stringify({ name: "Testa", sex: "f", seed: "route-tick-test" }),
    });

    const res = await POST(request);
    expect(res.status).toBe(200);
    const frames = await collectFrames(res);

    const doneIndex = frames.findIndex((f) => f.event === "done");
    expect(doneIndex).toBeGreaterThan(-1);
    const doneData = frames[doneIndex]!.data as Extract<LifeStreamEvent, { type: "done" }>;
    const chronicle: Chronicle = doneData.chronicle;

    const tickFrames = frames.filter((f) => f.event === "tick") as { event: string; data: Extract<LifeStreamEvent, { type: "tick" }> }[];
    expect(tickFrames.length).toBeGreaterThan(0);
    // Every tick arrives strictly before 'done'.
    expect(tickFrames.every((f) => frames.indexOf(f) < doneIndex)).toBe(true);
    // One tick per year of the protagonist's life, in order (design decision 9 + spec's
    // "Tick precedes completion" scenario), not a batch replay of only years with entries.
    const expectedYears = Array.from({ length: chronicle.protagonist.deathYear - chronicle.protagonist.birthYear + 1 }, (_, i) => chronicle.protagonist.birthYear + i);
    expect(tickFrames.map((f) => f.data.year)).toEqual(expectedYears);

    // Every tick carries the scene so far; done's scene is a superset of the last tick's.
    for (const f of tickFrames) expect(f.data.scene.people.some((p) => p.id === "protagonist")).toBe(true);
    const lastScene = tickFrames[tickFrames.length - 1]!.data.scene;
    const doneIds = new Set(chronicle.scene.people.map((p) => p.id));
    for (const p of lastScene.people) expect(doneIds.has(p.id)).toBe(true);
    // Entries carry fractional times and scene-resolvable people, equal ids in tick and done.
    const doneEntries = new Map(chronicle.entries.map((e) => [e.id, e]));
    for (const f of tickFrames) {
      const sceneIds = new Set(f.data.scene.people.map((p) => p.id));
      for (const e of f.data.entries) {
        expect(e.at).toBeGreaterThanOrEqual(f.data.year);
        expect(e.at).toBeLessThan(f.data.year + 1);
        for (const id of e.who) expect(sceneIds.has(id)).toBe(true);
        if (doneEntries.has(e.id)) expect(doneEntries.get(e.id)!.at).toBe(e.at);
      }
    }

    deleteLife(chronicle.lifeId);
  });
});

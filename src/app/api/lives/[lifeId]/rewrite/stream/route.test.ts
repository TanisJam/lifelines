import { describe, expect, it } from "vitest";
import { RuleDecisionMaker } from "@/adapters/decision/rule-decision-maker";
import type { LifeStreamEvent } from "@/contracts/life";
import { simulate } from "@/domain/simulate";
import { generateWorld } from "@/domain/worldgen";
import { deleteLife, newLifeBranchId, newLifeId, registerLife } from "@/server/life-store";
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

describe("POST /api/lives/:lifeId/rewrite/stream — incremental-simulation capability: live SSE ticks", () => {
  it("resumes simulateYears from the fork year: every tick is >= forkYear, all before 'done', with ghosts present", async () => {
    const { config, people, events } = generateWorld({ seed: "rewrite-tick-test", startYear: 1327, endYear: 1427, founderCount: 10, protagonist: { name: "Testa", sex: "f" } });
    const report = await simulate(config, people, events, { decisionMaker: new RuleDecisionMaker(), engineSource: "rules", protagonistId: "protagonist" });
    const protagonist = report.result.people.protagonist!;

    const lifeId = newLifeId();
    const branchId = newLifeBranchId();
    registerLife(lifeId, branchId, config, protagonist.name, protagonist.sex, report.result, report.snapshots);

    const decision = report.result.decisions.find((d) => d.options.some((o) => o.id !== d.chosen));
    expect(decision).toBeDefined();
    const alternative = decision!.options.find((o) => o.id !== decision!.chosen)!;
    const forkYear = decision!.year;

    const request = new Request(`http://localhost/api/lives/${lifeId}/rewrite/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "cf-connecting-ip": freshIp() },
      body: JSON.stringify({ branchId, decisionId: decision!.id, optionId: alternative.id }),
    });

    const res = await POST(request, { params: Promise.resolve({ lifeId }) });
    expect(res.status).toBe(200);
    const frames = await collectFrames(res);

    const doneIndex = frames.findIndex((f) => f.event === "done");
    expect(doneIndex).toBeGreaterThan(-1);
    const doneData = frames[doneIndex]!.data as Extract<LifeStreamEvent, { type: "done" }>;
    expect(doneData.ghosts).toBeDefined();

    const tickFrames = frames.filter((f) => f.event === "tick") as { event: string; data: Extract<LifeStreamEvent, { type: "tick" }> }[];
    expect(tickFrames.length).toBeGreaterThan(0);
    expect(tickFrames.every((f) => frames.indexOf(f) < doneIndex)).toBe(true);
    // Resuming from the restored snapshot never re-simulates (or re-ticks) a year before the fork.
    expect(tickFrames.every((f) => f.data.year >= forkYear)).toBe(true);
    expect(tickFrames[0]!.data.year).toBe(forkYear);

    deleteLife(lifeId);
  });
});

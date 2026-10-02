import { describe, expect, it, vi } from "vitest";
import type { LifeStreamEvent } from "@/contracts/life";
import { deleteLife } from "@/server/life-store";

// A year with no narrated entries must still advance the sky's clock: force every year to be quiet.
vi.mock("@/server/life-chronicle", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/life-chronicle")>()),
  buildProvisionalTickEntries: vi.fn(async () => []),
}));

const { POST } = await import("./route");

describe("POST /api/lives/stream — quiet years", () => {
  it("emits a tick with empty entries and the current scene for every year", async () => {
    const res = await POST(
      new Request("http://localhost/api/lives/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json", "cf-connecting-ip": `test-${Math.random().toString(36).slice(2)}` },
        body: JSON.stringify({ name: "Testa", sex: "f", seed: "route-quiet-test" }),
      }),
    );
    const text = await res.text();
    const frames = text
      .split("\n\n")
      .filter(Boolean)
      .map((part) => ({ event: /event: (.*)/.exec(part)![1]!, data: JSON.parse(/data: (.*)/.exec(part)![1]!) as LifeStreamEvent }));
    const ticks = frames.filter((f) => f.event === "tick").map((f) => f.data as Extract<LifeStreamEvent, { type: "tick" }>);
    const done = frames.find((f) => f.event === "done")!.data as Extract<LifeStreamEvent, { type: "done" }>;
    const { birthYear, deathYear } = done.chronicle.protagonist;
    expect(ticks.map((t) => t.year)).toEqual(Array.from({ length: deathYear - birthYear + 1 }, (_, i) => birthYear + i));
    expect(ticks.every((t) => t.entries.length === 0 && t.scene.people.length > 0)).toBe(true);
    deleteLife(done.chronicle.lifeId);
  });
});

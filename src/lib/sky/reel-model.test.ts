import { describe, expect, it } from "vitest";
import type { ChronicleEntry } from "@/contracts/life";
import { fixtureChronicle } from "@/lib/fixtures";
import { reelEntries } from "./reel-model";

const entry = (over: Partial<ChronicleEntry>): ChronicleEntry => ({ id: "e", year: 1500, level: 1, kind: "family", title: "T", prose: "P", links: [], at: 1500.5, who: [], ...over });

describe("reelEntries", () => {
  it("leaves period summaries out of the reel", () => {
    const rows = reelEntries([entry({ id: "a" }), entry({ id: "p", kind: "period", at: 1500.6 })]);
    expect(rows.map((r) => r.id)).toEqual(["a"]);
  });

  it("orders by moment, then id, whatever order they arrive in", () => {
    const rows = reelEntries([entry({ id: "c", at: 1502 }), entry({ id: "b", at: 1501 }), entry({ id: "a", at: 1501 })]);
    expect(rows.map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("marks turns and carries the typewriter parts and the people the entry names", () => {
    const [row] = reelEntries([entry({ id: "t", level: 3, who: ["x"], turn: { decidedBy: "Her choice" } as never })]);
    expect(row).toMatchObject({ id: "t", at: 1500.5, year: 1500, turn: true, who: ["x"] });
    expect(row!.parts.map((p) => p.text)).toEqual(["T", "Her choice", "P"]);
  });

  it("builds a full reel from a fixture life, one row per non-summary entry", () => {
    const chronicle = fixtureChronicle("life-elin");
    expect(reelEntries(chronicle.entries)).toHaveLength(chronicle.entries.filter((e) => e.kind !== "period").length);
  });
});

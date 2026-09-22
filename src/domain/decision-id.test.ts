import { describe, expect, it } from "vitest";
import { EMPTY_SLOTS, advanceSlot } from "./life-state";
import { buildGhostAnnotations, causalPositions, decisionSubject, mintDecisionId } from "./decision-id";

describe("mintDecisionId", () => {
  it("mints an id shaped `<kind>:<subject>#<ordinal>.<attempt>`, with no year anywhere in it", () => {
    const minted = mintDecisionId("Y1", "protagonist", 1345, EMPTY_SLOTS);
    expect(minted.id).toBe("Y1:protagonist#1.1");
    expect(minted.id).not.toContain("1345");
  });

  it("the ordinal is occurred+1 from the subject's slot", () => {
    const slots = advanceSlot(advanceSlot(EMPTY_SLOTS, "Y1:protagonist", true), "Y1:protagonist", true); // occurred twice already
    const minted = mintDecisionId("Y1", "protagonist", 1350, slots);
    expect(minted.id).toBe("Y1:protagonist#3.1");
  });

  it("the attempt is attempts+1 from the subject's slot", () => {
    const slots = advanceSlot(advanceSlot(EMPTY_SLOTS, "Y1:protagonist", false), "Y1:protagonist", false); // offered twice, never occurred
    const minted = mintDecisionId("Y1", "protagonist", 1350, slots);
    expect(minted.id).toBe("Y1:protagonist#1.3");
  });

  it("a `world` subject uses the year itself as the ordinal, unaffected by slots", () => {
    const minted = mintDecisionId("immigration", "world", 1348, EMPTY_SLOTS);
    expect(minted.id).toBe("immigration:world#1348.1");
  });

  it("two different subjects mint independent, non-colliding ordinals", () => {
    const a = mintDecisionId("death", "p001", 1400, EMPTY_SLOTS);
    const b = mintDecisionId("death", "p002", 1400, EMPTY_SLOTS);
    expect(a.id).toBe("death:p001#1.1");
    expect(b.id).toBe("death:p002#1.1");
  });
});

describe("decisionSubject", () => {
  it("parses kind and subject from a new-format ordinal id", () => {
    expect(decisionSubject("Y1:protagonist#3.1")).toEqual({ kind: "Y1", subject: "protagonist" });
  });

  it("parses kind and subject from a legacy year-embedded id, dropping the year", () => {
    expect(decisionSubject("death:p001:1345")).toEqual({ kind: "death", subject: "p001" });
  });

  it("parses a legacy world-immigration id (subject itself is the literal string \"world\")", () => {
    expect(decisionSubject("immigration:world:1348")).toEqual({ kind: "immigration", subject: "world" });
  });
});

describe("causalPositions", () => {
  it("assigns the Nth occurrence of a (kind, personId) pair, in year order, regardless of id format", () => {
    const decisions = [
      { id: "Y1:protagonist:1345", year: 1345, kind: "Y1", personId: "protagonist" },
      { id: "Y1:protagonist:1346", year: 1346, kind: "Y1", personId: "protagonist" },
    ];
    const positions = causalPositions(decisions);
    expect(positions.get("Y1:protagonist:1345")).toBe("Y1:protagonist#1");
    expect(positions.get("Y1:protagonist:1346")).toBe("Y1:protagonist#2");
  });

  it("keeps different (kind, personId) pairs on independent counters", () => {
    const decisions = [
      { id: "Y1:protagonist:1345", year: 1345, kind: "Y1", personId: "protagonist" },
      { id: "death:protagonist:1345", year: 1345, kind: "death", personId: "protagonist" },
    ];
    const positions = causalPositions(decisions);
    expect(positions.get("Y1:protagonist:1345")).toBe("Y1:protagonist#1");
    expect(positions.get("death:protagonist:1345")).toBe("death:protagonist#1");
  });
});

describe("buildGhostAnnotations", () => {
  const option = (id: string) => ({ id, label: id });

  it("finds a ghost across a shifted rewrite (1345 -> 1346) via causal position, not the literal id string", () => {
    const baseDecisions = [{ id: "Y1:protagonist:1345", year: 1345, kind: "Y1", personId: "protagonist", chosen: "decline", options: [option("encourage"), option("decline")] }];
    // New branch: same causal slot (1st Y1 for protagonist), but shifted to 1346 AND a different id format.
    const newDecisions = [{ id: "Y1:protagonist#1.1", year: 1346, kind: "Y1", personId: "protagonist", chosen: "encourage", options: [option("encourage"), option("decline")] }];
    const newEntries = [{ id: "entry-1", turn: { decisionId: "Y1:protagonist#1.1", chosen: { optionId: "encourage" } } }];

    const ghosts = buildGhostAnnotations(baseDecisions, newDecisions, newEntries);
    expect(ghosts["entry-1"]).toBeDefined();
    expect(ghosts["entry-1"]).toMatch(/decline/i);
  });

  it("does NOT annotate a ghost when the new outcome matches the old one (nothing actually changed)", () => {
    const baseDecisions = [{ id: "Y1:protagonist:1345", year: 1345, kind: "Y1", personId: "protagonist", chosen: "encourage", options: [option("encourage"), option("decline")] }];
    const newDecisions = [{ id: "Y1:protagonist#1.1", year: 1345, kind: "Y1", personId: "protagonist", chosen: "encourage", options: [option("encourage"), option("decline")] }];
    const newEntries = [{ id: "entry-1", turn: { decisionId: "Y1:protagonist#1.1", chosen: { optionId: "encourage" } } }];

    const ghosts = buildGhostAnnotations(baseDecisions, newDecisions, newEntries);
    expect(ghosts["entry-1"]).toBeUndefined();
  });

  it("skips entries with no turn at all", () => {
    const ghosts = buildGhostAnnotations([], [], [{ id: "entry-1" }]);
    expect(ghosts).toEqual({});
  });

  it("aligns causal positions to forkYear, not the base branch's whole life, so a recurring kind doesn't pair against a pre-fork decision (R3-002)", () => {
    // The rewrite's OWN `simulate()` run starts fresh AT forkYear (decision-identity capability:
    // `report.result.decisions` never carries pre-fork history) — this is occurrence #1 in the NEW
    // branch's numbering, even though it's occurrence #3 in the base branch's whole-life numbering.
    const baseDecisions = [
      { id: "illness:protagonist:1330", year: 1330, kind: "illness", personId: "protagonist", chosen: "healthy", options: [option("illness"), option("healthy")] },
      { id: "illness:protagonist:1331", year: 1331, kind: "illness", personId: "protagonist", chosen: "healthy", options: [option("illness"), option("healthy")] },
      { id: "illness:protagonist:1332", year: 1332, kind: "illness", personId: "protagonist", chosen: "illness", options: [option("illness"), option("healthy")] },
    ];
    const newDecisions = [{ id: "illness:protagonist#1.1", year: 1332, kind: "illness", personId: "protagonist", chosen: "healthy", options: [option("illness"), option("healthy")] }];
    const newEntries = [{ id: "entry-1", turn: { decisionId: "illness:protagonist#1.1", chosen: { optionId: "healthy" } } }];

    const ghosts = buildGhostAnnotations(baseDecisions, newDecisions, newEntries, 1332);
    expect(ghosts["entry-1"]).toBeDefined();
    expect(ghosts["entry-1"]).toMatch(/illness/i);
  });

  it("does NOT invent a spurious ghost against a pre-fork occurrence when the correctly-aligned post-fork outcome actually matches (R3-002)", () => {
    const baseDecisions = [
      { id: "illness:protagonist:1330", year: 1330, kind: "illness", personId: "protagonist", chosen: "illness", options: [option("illness"), option("healthy")] },
      { id: "illness:protagonist:1332", year: 1332, kind: "illness", personId: "protagonist", chosen: "healthy", options: [option("illness"), option("healthy")] },
    ];
    const newDecisions = [{ id: "illness:protagonist#1.1", year: 1332, kind: "illness", personId: "protagonist", chosen: "healthy", options: [option("illness"), option("healthy")] }];
    const newEntries = [{ id: "entry-1", turn: { decisionId: "illness:protagonist#1.1", chosen: { optionId: "healthy" } } }];

    const ghosts = buildGhostAnnotations(baseDecisions, newDecisions, newEntries, 1332);
    expect(ghosts["entry-1"]).toBeUndefined();
  });
});

import { describe, expect, it } from "vitest";
import type { RuntimeOutput } from "../domain/e-runtime";
import { journalPlacements } from "./historical-journal-placement";

const record = (year: number, ...ids: string[]) => ({
  plan: { year }, entries: ids.map((id) => ({ id })),
});

// Compile-time compatibility with the complete runtime journal, without projection.
const placeRuntimeJournal: (journal: RuntimeOutput["journal"]) => Readonly<Record<string, number>> = journalPlacements;

describe("journalPlacements", () => {
  it("uses every complete-year slot, not visibility, eligibility or cumulative position", () => {
    const journal = [{ plan: { year: 1327 }, entries: [
      { id: "hidden", visible: false, outcome: "committed", position: 90 },
      { id: "shown", visible: true, outcome: "committed", position: 91 },
      { id: "ineligible", visible: false, outcome: "ineligible", position: 92 },
    ] }];
    const placements = journalPlacements(journal);
    expect(placements.hidden).toBe(1327.25);
    expect(placements.shown).toBe(1327.5);
    expect(placements.ineligible).toBe(1327.75);
    const visibleIds = journal[0].entries.filter((entry) => entry.visible).map((entry) => entry.id);
    expect(visibleIds.map((id) => placements[id])).toEqual([1327.5]);
    expect(journalPlacements(journal)).toEqual(placements);
    journal[0].entries[1].visible = false;
    journal[0].entries[1].position = 500;
    expect(journalPlacements(journal)).toEqual(placements);
  });

  it("needs no prose or people and preserves earlier placements across quiet years and gaps", () => {
    const earlier = [record(1300, "a", "b"), record(1302, "c")];
    const initial = journalPlacements(earlier);
    const later = journalPlacements([...earlier, record(1303), record(1400, "d")]);
    for (const id of ["a", "b", "c"]) expect(later[id]).toBe(initial[id]);
    expect(initial.a).toBe(1300 + 1 / 3);
    expect(initial.b).toBe(1300 + 2 / 3);
    expect(initial.c).toBe(1302.5);
    expect(later.d).toBe(1400.5);
    expect(Object.keys(initial)).toEqual(["a", "b", "c"]);
  });

  it("accepts empty journals and empty ordered years, including extreme quiet years", () => {
    for (const journal of [[], [record(-2), record(0), record(Number.MAX_SAFE_INTEGER)]]) {
      const placements = journalPlacements(journal);
      expect(Object.keys(placements)).toEqual([]);
      expect(Object.getPrototypeOf(placements)).toBeNull();
      expect(Object.isFrozen(placements)).toBe(true);
    }
    expect(placeRuntimeJournal([])).toEqual(journalPlacements([]));
  });

  it("accepts negative and ordinary zero years with strict interior, ordered positions", () => {
    const placements = journalPlacements([record(-2, "a", "b"), record(0, "c", "d")]);
    expect(placements.a).toBe(-2 + 1 / 3);
    expect(placements.b).toBe(-2 + 2 / 3);
    expect(placements.c).toBe(1 / 3);
    expect(placements.d).toBe(2 / 3);
    expect(-2 < placements.a && placements.a < placements.b && placements.b < -1).toBe(true);
    expect(0 < placements.c && placements.c < placements.d && placements.d < 1).toBe(true);
  });

  it.each([NaN, Infinity, -Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1,
    Number.MIN_SAFE_INTEGER - 1, -0])("rejects invalid year %s even when empty", (year) => {
    expect(() => journalPlacements([record(year)])).toThrow(/year/i);
  });

  it.each([{ years: [1, 1] }, { years: [2, 1] }, { years: [-1, -2] }])(
    "rejects duplicate or descending empty years $years", ({ years }) => {
      expect(() => journalPlacements(years.map((year) => record(year)))).toThrow(/year/i);
    },
  );

  it("rejects empty IDs and duplicates within or across years", () => {
    expect(() => journalPlacements([record(1, "")])).toThrow(/id/i);
    expect(() => journalPlacements([record(1, "a", "a")])).toThrow(/duplicate/i);
    expect(() => journalPlacements([record(1, "a"), record(3, "a")])).toThrow(/duplicate/i);
    expect(() => journalPlacements([record(1, "__proto__"), record(2, "__proto__")])).toThrow(/duplicate/i);
    // Typed callers normally prevent this; required scalar fields still get basic validation.
    const malformed = record(1, 42 as unknown as string);
    expect(() => journalPlacements([malformed])).toThrow(/id/i);
  });

  it("preserves arbitrary nonempty JavaScript IDs exactly as own keys", () => {
    const ids = ["__proto__", "constructor", "toString", "hasOwnProperty", "{actor}",
      "\0", "line\rbreak", "é", "e\u0301", "😀", "\ud800", "\udc00", " a ", "a", " "];
    const placements = journalPlacements([record(0, ...ids)]);
    expect(Object.getPrototypeOf(placements)).toBeNull();
    expect(Object.keys(placements)).toEqual(ids);
    ids.forEach((id, index) => {
      expect(Object.hasOwn(placements, id)).toBe(true);
      expect(placements[id]).toBe((index + 1) / (ids.length + 1));
    });
    expect(Object.hasOwn(placements, "missing")).toBe(false);
    expect(placements.missing).toBeUndefined();
  });

  it("returns detached frozen primitive data without mutating or retaining input", () => {
    const source = [record(0, "a", "b")];
    const before = structuredClone(source);
    const placements = journalPlacements(source);
    expect(source).toEqual(before);
    expect(Object.isFrozen(source)).toBe(false);
    expect(Object.isFrozen(placements)).toBe(true);
    expect(Object.values(placements).every((value) => typeof value === "number")).toBe(true);
    expect(Reflect.set(placements, "a", 99)).toBe(false);
    expect(Reflect.set(placements, "new", 99)).toBe(false);
    expect(Reflect.deleteProperty(placements, "a")).toBe(false);
    expect(() => Object.defineProperty(placements, "a", { value: 99 })).toThrow(TypeError);
    expect(() => Object.setPrototypeOf(placements, {})).toThrow(TypeError);
    source[0].plan.year = 4;
    source[0].entries[0].id = "changed";
    source[0].entries.push({ id: "later" });
    expect(placements.a).toBe(1 / 3);
    expect(placements.b).toBe(2 / 3);
    expect(Object.keys(placements)).toEqual(["a", "b"]);
    expect(journalPlacements(source)).not.toEqual(placements);
    expect(journalPlacements(before)).not.toBe(placements);
    const frozen = Object.freeze([Object.freeze({
      plan: Object.freeze({ year: 0 }), entries: Object.freeze([Object.freeze({ id: "f" })]),
    })]);
    expect(journalPlacements(frozen).f).toBe(0.5);
  });

  it.each([2 ** 52, Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER])(
    "rejects reachable floating-point collapse at year %s", (year) => {
      expect(() => journalPlacements([record(year, "a", "b")])).toThrow(/precision/i);
    },
  );

  it("checks precision in every slot, including an unselected hidden final entry", () => {
    // First placement is interior; the hidden second collapses onto the first.
    const year = 2 ** 51;
    expect(year + 1 / 3).toBeGreaterThan(year);
    const journal = [{ plan: { year }, entries: [
      { id: "selected", visible: true }, { id: "hidden", visible: false },
    ] }];
    expect(() => journalPlacements(journal)).toThrow(/precision/i);
  });
});

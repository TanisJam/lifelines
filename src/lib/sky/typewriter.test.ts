import { describe, expect, it } from "vitest";
import { entryText, TYPE_FAST, TYPE_TITLE, typed, typedKey, typeParts } from "./typewriter";

const parts = [
  { text: "Title", rate: 0.01 },
  { text: "By", rate: 0.01 },
  { text: "Prose here", rate: 0.01 },
];

describe("typed", () => {
  it("types nothing before the entry's moment", () => {
    expect(typed(parts, -1)).toEqual({ counts: [0, 0, 0], done: false, caret: 0 });
  });

  it("types parts in order, one character per rate, with the caret on the part being typed", () => {
    expect(typed(parts, 0.03)).toMatchObject({ counts: [3, 0, 0], done: false, caret: 0 });
    expect(typed(parts, 0.07)).toMatchObject({ counts: [5, 2, 0], caret: 2 });
    expect(typed(parts, 0.07).caret).toBe(2);
  });

  it("is done, with no caret, once every character is down", () => {
    expect(typed(parts, 10)).toEqual({ counts: [5, 2, 10], done: true, caret: -1 });
  });

  it("is a pure function of elapsed sim time: same input, same state", () => {
    expect(typed(parts, 0.0432)).toEqual(typed(parts, 0.0432));
    expect(typedKey(typed(parts, 0.03))).not.toBe(typedKey(typed(parts, 0.04)));
  });

  it("handles an empty text part without stalling", () => {
    expect(typed([{ text: "", rate: 0.01 }, { text: "ab", rate: 0.01 }], 0.01).counts).toEqual([0, 1]);
  });
});

describe("entryText", () => {
  const entry = { title: "Born", prose: "Child of {{a}} and {{b}}.", links: [{ personId: "a", name: "Ann" }, { personId: "b", name: "Bo" }] };

  it("resolves prose markers to names and records where each link sits", () => {
    const text = entryText(entry);
    expect(text.prose).toBe("Child of Ann and Bo.");
    expect(text.links).toEqual([
      { start: 9, end: 12, personId: "a" },
      { start: 17, end: 19, personId: "b" },
    ]);
  });

  it("keeps literal name code units and computes ranges without reparsing marker-like names", () => {
    const name = '<b>\r\0\ud800😀{{b}}</b>';
    const text = entryText({ ...entry, prose: "{{a}}!{{missing}}{{b}}", links: [{ personId: "a", name }, { personId: "b", name: "\udfff" }] });
    expect(text.prose).toBe(`${name}!\udfff`);
    expect(text.links).toEqual([
      { start: 0, end: name.length, personId: "a" },
      { start: name.length + 1, end: name.length + 2, personId: "b" },
    ]);
  });

  it("types the title slowly, then the decider, then the prose fast; turns carry a decider", () => {
    const turn = { decidedBy: "Her choice" } as never;
    expect(typeParts(entryText({ ...entry, turn }))).toEqual([
      { text: "Born", rate: TYPE_TITLE },
      { text: "Her choice", rate: TYPE_FAST },
      { text: "Child of Ann and Bo.", rate: TYPE_FAST },
    ]);
    expect(typeParts(entryText(entry))).toHaveLength(2);
  });
});

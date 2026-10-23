import { describe, expect, it } from "vitest";
import { domCoordinate } from "./dom-coordinate";

describe("DOM coordinates (not canonical IDs)", () => {
  it("encodes every UTF-16 code unit injectively, including NUL and lone surrogates", () => {
    const seen = new Set<string>();
    for (let unit = 0; unit <= 0xffff; unit++) {
      const id = String.fromCharCode(unit);
      const coordinate = domCoordinate(id);
      expect(coordinate).toBe(`sky-${unit.toString(16).padStart(4, "0")}`);
      expect(domCoordinate(id)).toBe(coordinate);
      seen.add(coordinate);
    }
    expect(seen.size).toBe(65536);
  });

  it("preserves code-unit sequences without UTF-8 replacement, normalization or variable-width ambiguity", () => {
    const ids = ["", "\0", "\ufffd", "\ud800", "\ud801", "\udfff", "\ud83d\ude00", "é", "e\u0301", "a\"\\b", "sky-0000", "__proto__", "constructor"];
    expect(new Set(ids.map(domCoordinate)).size).toBe(ids.length);
    expect(domCoordinate("\ud83d\ude00")).toBe("sky-d83dde00");
    expect(domCoordinate("\u0001\u0023")).not.toBe(domCoordinate("\u0012\u0003"));
    for (let unit = 0; unit <= 0xffff; unit++) {
      const a = String.fromCharCode(unit);
      const b = String.fromCharCode(0xffff - unit);
      expect(domCoordinate(a + b)).toBe(domCoordinate(a) + domCoordinate(b).slice(4));
      if (a !== b) expect(domCoordinate(a + b)).not.toBe(domCoordinate(b + a));
    }
  });
});

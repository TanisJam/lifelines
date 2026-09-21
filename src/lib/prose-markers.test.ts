import { describe, expect, it } from "vitest";
import { parseProseMarkers } from "./prose-markers";

describe("parseProseMarkers", () => {
  it("returns the whole string as one text part when there are no markers", () => {
    expect(parseProseMarkers("She grew up in Hallowmere.", [])).toEqual([{ kind: "text", text: "She grew up in Hallowmere." }]);
  });

  it("resolves a single marker to its linked name", () => {
    const parts = parseProseMarkers("Elin marries {{tomas}} at midsummer.", [{ personId: "tomas", name: "Tomas Vell" }]);
    expect(parts).toEqual([
      { kind: "text", text: "Elin marries " },
      { kind: "link", personId: "tomas", name: "Tomas Vell" },
      { kind: "text", text: " at midsummer." },
    ]);
  });

  it("resolves multiple distinct markers in order", () => {
    const parts = parseProseMarkers("{{petra}} and {{joren}} welcome a daughter.", [
      { personId: "petra", name: "Petra Marrow" },
      { personId: "joren", name: "Joren Marrow" },
    ]);
    expect(parts).toEqual([
      { kind: "link", personId: "petra", name: "Petra Marrow" },
      { kind: "text", text: " and " },
      { kind: "link", personId: "joren", name: "Joren Marrow" },
      { kind: "text", text: " welcome a daughter." },
    ]);
  });

  it("falls back to the raw id when a marker has no matching link", () => {
    expect(parseProseMarkers("She meets {{ghost}}.", [])).toEqual([
      { kind: "text", text: "She meets " },
      { kind: "link", personId: "ghost", name: "ghost" },
      { kind: "text", text: "." },
    ]);
  });

  it("handles a marker at the very start and end of the prose", () => {
    const parts = parseProseMarkers("{{a}}{{b}}", [
      { personId: "a", name: "A" },
      { personId: "b", name: "B" },
    ]);
    expect(parts).toEqual([
      { kind: "link", personId: "a", name: "A" },
      { kind: "link", personId: "b", name: "B" },
    ]);
  });

  it("returns an empty array for an empty string", () => {
    expect(parseProseMarkers("", [])).toEqual([]);
  });
});

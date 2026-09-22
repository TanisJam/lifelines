import { describe, expect, it } from "vitest";
import { stripLocale } from "./pathname";

describe("decision 059: stripLocale", () => {
  it("strips a leading /en or /es segment", () => {
    expect(stripLocale("/en/lives")).toBe("/lives");
    expect(stripLocale("/es/life/l1")).toBe("/life/l1");
    expect(stripLocale("/en")).toBe("/");
    expect(stripLocale("/es")).toBe("/");
  });

  it("leaves an already-bare or unrecognized-prefix pathname unchanged", () => {
    expect(stripLocale("/lives")).toBe("/lives");
    expect(stripLocale("/")).toBe("/");
    expect(stripLocale(null)).toBe("/");
  });

  it("never strips a segment that only starts with a locale code as a substring (e.g. /english-town)", () => {
    expect(stripLocale("/english-town")).toBe("/english-town");
  });
});

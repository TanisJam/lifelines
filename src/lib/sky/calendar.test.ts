import { describe, expect, it } from "vitest";
import { festivalAt, monthIndex, MONTHS } from "./calendar";

describe("monthIndex", () => {
  it("maps the fraction of the year to 0..11 and never overflows at the year's last instant", () => {
    expect(monthIndex(1350)).toBe(0);
    expect(monthIndex(1350.5)).toBe(6);
    expect(monthIndex(1350.9999999)).toBe(11);
    expect(monthIndex(1350 + 11 / 12)).toBe(11);
  });
});

describe("festivalAt", () => {
  it("names the festival of the month in each language", () => {
    expect(festivalAt(1350.05, "en")).toBe("Epiphany");
    expect(festivalAt(1350.45, "en")).toBe("Midsummer");
    expect(festivalAt(1350.45, "es")).toBe("San Juan");
    expect(festivalAt(1350.97, "es")).toBe("Navidad");
  });

  it("has twelve of everything, in both languages", () => {
    for (const lang of ["en", "es"] as const) expect(MONTHS[lang]).toHaveLength(12);
    expect(festivalAt(1350.0, "en")).not.toBe(festivalAt(1350.5, "en"));
  });
});

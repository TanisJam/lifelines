import { describe, expect, it } from "vitest";
import { villagePos } from "./village";

describe("villagePos", () => {
  it("is a pure function of the key", () => {
    expect(villagePos("v-ansel")).toEqual(villagePos("v-ansel"));
    expect(villagePos("v-ansel")).not.toEqual(villagePos("v-brida"));
  });

  it("stays inside the village disc", () => {
    for (let i = 0; i < 200; i++) {
      const p = villagePos(`soul-${i}`);
      expect(Math.hypot(p.x, p.y)).toBeLessThanOrEqual(302.0001);
      expect(p.size).toBeGreaterThanOrEqual(0.6);
    }
  });
});

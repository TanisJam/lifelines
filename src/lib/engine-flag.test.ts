import { describe, expect, it } from "vitest";
import { requestedEngine } from "./engine-flag";

/**
 * RA1 (spec S1): the hidden opt-in is the only way to request the new engine, and every value it
 * does not recognize leaves the request body untouched.
 */
describe("requestedEngine", () => {
  it("requests the lifecycle engine only for the exact flag", () => {
    expect(requestedEngine("?engine=lifecycle")).toBe("lifecycle");
    expect(requestedEngine("?lang=en&engine=lifecycle")).toBe("lifecycle");
  });

  it("leaves the request unchanged for every other value", () => {
    expect(requestedEngine("")).toBeUndefined();
    expect(requestedEngine("?lang=en")).toBeUndefined();
    expect(requestedEngine("?engine=legacy")).toBeUndefined();
    expect(requestedEngine("?engine=")).toBeUndefined();
    expect(requestedEngine("?engine=LIFECYCLE")).toBeUndefined();
    expect(requestedEngine("?engine=Lifecycle")).toBeUndefined();
    expect(requestedEngine("?engine=lifecycle2")).toBeUndefined();
    expect(requestedEngine("?enginex=lifecycle")).toBeUndefined();
  });

  it("never coerces one representation into the other", () => {
    // A caller that asks for legacy explicitly must not be upgraded, and there is no third value.
    expect(requestedEngine("?engine=legacy")).not.toBe("lifecycle");
    expect(requestedEngine("?engine=annuaL")).toBeUndefined();
  });
});

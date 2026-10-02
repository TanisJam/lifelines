import { describe, expect, it } from "vitest";
import { firstSentence } from "./epitaph";

const links = [{ personId: "a", name: "Ann Reeve" }];

describe("firstSentence", () => {
  it("resolves markers and stops after the first sentence", () => {
    expect(firstSentence("She raised {{a}} alone. Then she left.", links)).toBe("She raised Ann Reeve alone.");
  });

  it("keeps a summary that has no sentence end, and an empty one", () => {
    expect(firstSentence("No full stop here", links)).toBe("No full stop here");
    expect(firstSentence("", links)).toBe("");
  });

  it("does not stop at a decimal or an abbreviation-free inner dot", () => {
    expect(firstSentence("Lived 4.5 decades, mostly well. Died old.", links)).toBe("Lived 4.5 decades, mostly well.");
  });
});

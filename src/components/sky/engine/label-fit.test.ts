import { describe, expect, it } from "vitest";
import { keptLabels } from "./label-fit";

describe("keptLabels", () => {
  it("drops a name that would be drawn over one already placed, keeping the story circle ahead of the village", () => {
    const kept = keptLabels([
      // Parents close together in the same sector: their names would overprint each other.
      { id: "father", x: 0, y: -150, name: "Thomas Smith", rank: 1 },
      { id: "mother", x: 36, y: -145, name: "Margery Smith", rank: 1 },
      // Far below, a name that clears both.
      { id: "sibling", x: 0, y: 150, name: "Hugh Smith", rank: 1 },
      // The protagonist keeps its own name wherever it sits.
      { id: "self", x: 0, y: 0, name: "Ada Smith", rank: 0 },
      // Beyond the circle, over a name already kept: it loses even though it was listed first.
      { id: "outer", x: 0, y: -150, name: "Village Smith", rank: 2 },
    ]);
    expect([...kept]).toEqual(["self", "father", "sibling"]);
  });
});

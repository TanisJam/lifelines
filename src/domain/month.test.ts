import { beforeAll, describe, expect, it } from "vitest";
import { RuleDecisionMaker } from "@/adapters/decision/rule-decision-maker";
import { at, eventTimes, monthFor, resolveMonths } from "./month";
import { simulate } from "./simulate";
import { seasonFor } from "./town";
import type { Event, SimulationResult } from "./types";
import { generateWorld } from "./worldgen";

function event(id: string, kind: Event["kind"], year: number, actors: string[], extra: Partial<Event> = {}): Event {
  return { id, year, kind, actors, payload: {}, causes: [], ...extra };
}

const SEASON_MONTHS: Record<string, number[]> = {
  "the depths of winter": [12, 1, 2],
  "the first days of spring": [3, 4, 5],
  "high summer": [6, 7, 8],
  "the golden days of autumn": [9, 10, 11],
};

describe("monthFor", () => {
  it("is deterministic for the same seed and event", () => {
    const e = event("b1", "birth", 1340, ["kid", "mum", "dad"]);
    expect(monthFor("seed", e, "p")).toBe(monthFor("seed", e, "p"));
  });

  it("lands births in the season their prose names", () => {
    for (let year = 1330; year < 1360; year++) {
      const e = event(`b${year}`, "birth", year, ["kid", "mum", "dad"]);
      const season = seasonFor("seed", "kid-mum-dad", year, "birth");
      expect(SEASON_MONTHS[season]).toContain(monthFor("seed", e, "p"));
    }
  });

  it("lands romances and vignettes in their own salted season", () => {
    const romance = event("r", "romance", 1341, ["a", "b"]);
    expect(SEASON_MONTHS[seasonFor("seed", "a-b", 1341, "romance")]).toContain(monthFor("seed", romance, "p"));
    const vignette = event("v", "vignette", 1342, ["p"]);
    expect(SEASON_MONTHS[seasonFor("seed", "p", 1342, "D1")]).toContain(monthFor("seed", vignette, "p"));
  });

  it("keeps 1348 black-death deaths between June and December", () => {
    for (let i = 0; i < 40; i++) {
      const e = event(`d${i}`, "death", 1348, [`x${i}`], { payload: { cause: "black-death" } });
      expect(monthFor("seed", e, "p")).toBeGreaterThanOrEqual(6);
    }
  });
});

describe("resolveMonths", () => {
  it("keeps an unlocked effect at or after its cause and a cause before its locked effect", () => {
    for (let year = 1330; year < 1380; year++) {
      const marriage = event(`m${year}`, "marriage", year, ["a", "b"]);
      const birth = event(`b${year}`, "birth", year, ["kid", "a", "b"], { causes: [marriage.id] });
      const move = event(`mv${year}`, "move", year, ["a"], { causes: [marriage.id] });
      const months = resolveMonths("seed", [marriage, birth, move], "p");
      expect(months.get(birth.id)!).toBeGreaterThanOrEqual(months.get(marriage.id)!);
      expect(months.get(move.id)!).toBeGreaterThanOrEqual(months.get(marriage.id)!);
      expect(SEASON_MONTHS[seasonFor("seed", "kid-a-b", year, "birth")]).toContain(months.get(birth.id));
    }
  });

  it("is stable for a year whether or not later years are present", () => {
    const early = [event("m1", "marriage", 1340, ["a", "b"]), event("b1", "birth", 1340, ["k", "a", "b"], { causes: ["m1"] })];
    const later = [...early, event("d2", "death", 1345, ["a"])];
    const a = resolveMonths("seed", early, "p");
    const b = resolveMonths("seed", later, "p");
    expect(b.get("b1")).toBe(a.get("b1"));
    expect(b.get("m1")).toBe(a.get("m1"));
  });
});

describe("at / eventTimes", () => {
  it("stays inside the month, spreading same-month events in order", () => {
    expect(at(1350, 3, 0, 1)).toBeGreaterThanOrEqual(1350 + 2 / 12);
    expect(at(1350, 3, 0, 2)).toBeLessThan(at(1350, 3, 1, 2));
    expect(at(1350, 12, 0, 1)).toBeLessThan(1351);
  });

  it("gives each event a time inside its year", () => {
    const events = [event("a", "job", 1350, ["x"]), event("b", "job", 1350, ["y"]), event("c", "death", 1350, ["x"])];
    for (const t of eventTimes("seed", events, "p").values()) {
      expect(t).toBeGreaterThanOrEqual(1350);
      expect(t).toBeLessThan(1351);
    }
  });
});

describe("over a simulated life", () => {
  let result: SimulationResult;
  beforeAll(async () => {
    const { config, people, events } = generateWorld({ seed: "month-life", startYear: 1327, endYear: 1400, founderCount: 10, protagonist: { name: "Testa", sex: "random" } });
    result = (await simulate(config, people, events, { decisionMaker: new RuleDecisionMaker(), engineSource: "rules", protagonistId: "protagonist" })).result;
  });

  it("agrees with the narrated season for every birth and romance, and respects causes within a year", () => {
    const months = resolveMonths("month-life", result.events, "protagonist");
    const byId = new Map(result.events.map((e) => [e.id, e]));
    for (const e of result.events) {
      const key = e.actors.join("-") || e.id;
      if (e.kind === "birth") expect(SEASON_MONTHS[seasonFor("month-life", key, e.year, "birth")]).toContain(months.get(e.id));
      if (e.kind === "romance") expect(SEASON_MONTHS[seasonFor("month-life", key, e.year, "romance")]).toContain(months.get(e.id));
      for (const causeId of e.causes) {
        const cause = byId.get(causeId);
        if (cause && cause.year === e.year) expect(months.get(e.id)!).toBeGreaterThanOrEqual(months.get(causeId)!);
      }
    }
  });
});

import { describe, expect, it } from "vitest";
import { createMind } from "./mind";
import { dreamGoalSatisfiedBy, feudPairHistory, gatherCandidatesForYear } from "./simulate";
import type { Event, Person } from "./types";

function makePerson(id: string, overrides: Partial<Person> = {}): Person {
  const birthYear = overrides.birthYear ?? 1470;
  const mind = createMind("test-seed", id, birthYear);
  return {
    id,
    name: `Person ${id}`,
    sex: "f",
    birthYear,
    traits: [],
    job: "farmer",
    founder: true,
    mind,
    ...overrides,
  };
}

describe("situation triggers (gatherCandidatesForYear)", () => {
  it("A11 (breakdown) triggers when stress is at or above the threshold", () => {
    const stressed = makePerson("p001", { birthYear: 1470 });
    stressed.mind.stress = 80;
    const calm = makePerson("p002", { birthYear: 1470 });
    calm.mind.stress = 10;

    const people = { p001: stressed, p002: calm };
    const candidates = gatherCandidatesForYear(1500, people, [], "test-seed");

    expect(candidates.some((c) => c.kind === "A11" && c.personId === "p001")).toBe(true);
    expect(candidates.some((c) => c.kind === "A11" && c.personId === "p002")).toBe(false);
  });

  it("A11's breakdown kind is picked by code from the dominant propensity, not randomly", () => {
    const rager = makePerson("p003", { birthYear: 1470 });
    rager.mind.stress = 90;
    rager.mind.facets.anger = 95;
    rager.mind.facets.anxiety = 10;
    rager.mind.facets.perseverance = 50;

    const candidates = gatherCandidatesForYear(1500, { p003: rager }, [], "test-seed");
    const a11 = candidates.find((c) => c.kind === "A11" && c.personId === "p003");
    expect(a11).toBeDefined();
    expect(a11!.breakdownKind).toBe("rage");
  });

  it("A8 (dream check) triggers for an adult with an unrealized dream at a 5-year mark, not other years", () => {
    const dreamer = makePerson("p004", { birthYear: 1470 }); // age 30 in 1500 -> divisible by 5
    dreamer.mind.dream.status = "pursuing";

    const atFive = gatherCandidatesForYear(1500, { p004: dreamer }, [], "test-seed");
    expect(atFive.some((c) => c.kind === "A8" && c.personId === "p004")).toBe(true);

    const offYear = gatherCandidatesForYear(1501, { p004: dreamer }, [], "test-seed");
    expect(offYear.some((c) => c.kind === "A8" && c.personId === "p004")).toBe(false);
  });

  it("A8 does not trigger once the dream is realized or abandoned", () => {
    const realized = makePerson("p005", { birthYear: 1470 });
    realized.mind.dream.status = "realized";
    const candidates = gatherCandidatesForYear(1500, { p005: realized }, [], "test-seed");
    expect(candidates.some((c) => c.kind === "A8")).toBe(false);
  });

  it("A2 (have a child) only comes up for a married woman within the fertility window, via the mother", () => {
    const mother = makePerson("p006", { birthYear: 1475, sex: "f", spouseId: "p007" });
    const father = makePerson("p007", { birthYear: 1473, sex: "m", spouseId: "p006" });
    const people = { p006: mother, p007: father };

    // Eligibility is deterministic (round 12, decision 045) — a married woman in her fertile window
    // is eligible every year, so this should already be true from year one.
    let sawA2 = false;
    for (let year = 1500; year < 1520; year++) {
      const candidates = gatherCandidatesForYear(year, people, [], "test-seed");
      if (candidates.some((c) => c.kind === "A2" && c.personId === "p006")) sawA2 = true;
    }
    expect(sawA2).toBe(true);

    // An unmarried woman of the same age never gets A2.
    const single = makePerson("p008", { birthYear: 1475, sex: "f" });
    let sawA2Single = false;
    for (let year = 1500; year < 1520; year++) {
      const candidates = gatherCandidatesForYear(year, { p008: single }, [], "test-seed");
      if (candidates.some((c) => c.kind === "A2")) sawA2Single = true;
    }
    expect(sawA2Single).toBe(false);
  });

  it("every generated candidate's decisionId is stable and content-derived (same inputs -> same id)", () => {
    const person = makePerson("p009", { birthYear: 1470 });
    person.mind.stress = 80;
    const a = gatherCandidatesForYear(1500, { p009: person }, [], "test-seed");
    const b = gatherCandidatesForYear(1500, { p009: person }, [], "test-seed");
    expect(a.map((c) => c.decisionId)).toEqual(b.map((c) => c.decisionId));
  });
});

describe("round 5 fix: a dead person can never be offered as a decision's partner (decision 022)", () => {
  it("A6 stops being offered once the feud partner has died, even though the feud is still 'active' in the event log", () => {
    const p1 = makePerson("p010", { birthYear: 1460 });
    const p2 = makePerson("p011", { birthYear: 1460, deathYear: 1520 });
    const feudEvent: Event = { id: "ev-1", year: 1510, kind: "feud", actors: ["p010", "p011"], payload: {}, causes: [] };
    const people = { p010: p1, p011: p2 };

    // Before the death, A6 can legitimately be offered for this pair.
    const beforeDeath = gatherCandidatesForYear(1513, people, [feudEvent], "test-seed");
    const beforeHasA6 = beforeDeath.some((c) => c.kind === "A6" && (c.personId === "p011" || c.partnerId === "p011"));
    expect(beforeHasA6).toBe(true);

    // After p011's death, no candidate of ANY kind should ever name them as personId or partnerId —
    // this is the exact bug the coordinator caught: "Fira ... made peace" a year after Orla died.
    for (const year of [1521, 1522, 1525, 1530]) {
      const candidates = gatherCandidatesForYear(year, people, [feudEvent], "test-seed");
      const referencesDead = candidates.some((c) => c.personId === "p011" || c.partnerId === "p011");
      expect(referencesDead).toBe(false);
    }
  });

  it("A1 (proposal) stops being offered once the romance partner has died", () => {
    const p1 = makePerson("p012", { birthYear: 1470, sex: "f" });
    const p2 = makePerson("p013", { birthYear: 1470, sex: "m", deathYear: 1509 });
    const romanceEvent: Event = { id: "ev-2", year: 1508, kind: "romance", actors: ["p012", "p013"], payload: {}, causes: [] };
    const people = { p012: p1, p013: p2 };

    for (const year of [1510, 1512, 1515]) {
      const candidates = gatherCandidatesForYear(year, people, [romanceEvent], "test-seed");
      expect(candidates.some((c) => c.kind === "A1")).toBe(false);
    }
  });
});

describe("round 5 fix: a feud needs a fresh trigger, not a repeat with the same person (decision 022)", () => {
  it("feudPairHistory records both directions of a resolved feud", () => {
    const events: Event[] = [
      { id: "ev-1", year: 1510, kind: "feud", actors: ["p020", "p021"], payload: {}, causes: [] },
      { id: "ev-2", year: 1513, kind: "reconciliation", actors: ["p020", "p021"], payload: {}, causes: [] },
    ];
    expect(feudPairHistory(events, "p020")).toEqual(new Set(["p021"]));
    expect(feudPairHistory(events, "p021")).toEqual(new Set(["p020"]));
    expect(feudPairHistory(events, "p099")).toEqual(new Set());
  });

  it("Y4 never re-offers a NEW grudge against someone this person has already feuded with, even years after reconciliation and even though the anger facet still qualifies", () => {
    const angry = makePerson("p022", { birthYear: 1460 });
    angry.mind.facets.anger = 90; // well above the Y4 trigger threshold
    const pastRival = makePerson("p023", { birthYear: 1460, job: angry.job });
    const events: Event[] = [
      { id: "ev-1", year: 1490, kind: "feud", actors: ["p022", "p023"], payload: {}, causes: [] },
      { id: "ev-2", year: 1493, kind: "reconciliation", actors: ["p022", "p023"], payload: {}, causes: [] },
    ];
    const people = { p022: angry, p023: pastRival };

    let everOffered = false;
    for (let year = 1494; year <= 1560; year++) {
      const candidates = gatherCandidatesForYear(year, people, events, "test-seed");
      if (candidates.some((c) => c.kind === "Y4" && c.personId === "p022" && c.partnerId === "p023")) everOffered = true;
    }
    expect(everOffered).toBe(false);
  });

  it("A6 stops re-asking about the same feud once it has escalated FEUD_EPISODE_CAP times, even though the pair is still technically unreconciled", () => {
    const p1 = makePerson("p024", { birthYear: 1450 });
    const p2 = makePerson("p025", { birthYear: 1450 });
    const events: Event[] = [
      { id: "ev-1", year: 1500, kind: "feud", actors: ["p024", "p025"], payload: {}, causes: [] },
      { id: "ev-2", year: 1503, kind: "feud", actors: ["p024", "p025"], payload: { escalated: true }, causes: [] },
      { id: "ev-3", year: 1506, kind: "feud", actors: ["p024", "p025"], payload: { escalated: true }, causes: [] },
    ];
    const people = { p024: p1, p025: p2 };

    // Three feud-kind events already on record for this pair (the episode cap) — A6 should no
    // longer be offered for them at any later year, even one that would otherwise be "on schedule".
    for (const year of [1509, 1512, 1520]) {
      const candidates = gatherCandidatesForYear(year, people, events, "test-seed");
      expect(candidates.some((c) => c.kind === "A6" && c.personId === "p024" && c.partnerId === "p025")).toBe(false);
    }
  });
});

describe("round 5 fix: a dream can only be realized once the matching real event has happened (decision 023)", () => {
  it("'leave for the city' is only satisfied by an actual move-away event for that exact person", () => {
    const events: Event[] = [{ id: "ev-1", year: 1520, kind: "move", actors: ["p030"], payload: { away: true }, causes: [] }];
    expect(dreamGoalSatisfiedBy("leave for the city", events, "p030")).toBe(true);
    expect(dreamGoalSatisfiedBy("leave for the city", events, "p031")).toBe(false);
    expect(dreamGoalSatisfiedBy("leave for the city", [], "p030")).toBe(false);
    // Arriving (an immigrant) is NOT "leaving" — payload.away must be true, not just any move event.
    const arrival: Event[] = [{ id: "ev-2", year: 1520, kind: "move", actors: ["p030"], payload: { arrived: true }, causes: [] }];
    expect(dreamGoalSatisfiedBy("leave for the city", arrival, "p030")).toBe(false);
  });

  it("'start a family' requires an actual birth event naming this person as a parent", () => {
    const events: Event[] = [{ id: "ev-1", year: 1520, kind: "birth", actors: ["child-1", "p032", "p033"], payload: {}, causes: [] }];
    expect(dreamGoalSatisfiedBy("start a family", events, "p032")).toBe(true);
    expect(dreamGoalSatisfiedBy("start a family", events, "child-1")).toBe(false); // the child isn't the parent
    expect(dreamGoalSatisfiedBy("start a family", events, "p099")).toBe(false);
  });

  it("'master a craft' requires a real (non-forced) job change, not just having a job from birth", () => {
    const realChange: Event[] = [{ id: "ev-1", year: 1520, kind: "job", actors: ["p034"], payload: { job: "smith" }, causes: [] }];
    expect(dreamGoalSatisfiedBy("master a craft", realChange, "p034")).toBe(true);
    const forcedChange: Event[] = [{ id: "ev-2", year: 1520, kind: "job", actors: ["p034"], payload: { job: "smith", forced: true }, causes: [] }];
    expect(dreamGoalSatisfiedBy("master a craft", forcedChange, "p034")).toBe(false);
  });
});

describe("round 7 fix: dream stickiness (decision 030 — 'dream churn is noise')", () => {
  it("A8 never offers 'adjust-it' on a bare life-stage milestone with no setback or related event", () => {
    // Age 40 for someone born 1470 is a milestone year (age % 10 === 0), with a calm mood and no
    // recent event tied to their dream — a "real cause" free year.
    const calm = makePerson("p040", { birthYear: 1470 });
    calm.mind.dream = { goal: "master a craft", status: "pursuing", since: 1470 };
    const candidates = gatherCandidatesForYear(1510, { p040: calm }, [], "test-seed");
    const a8 = candidates.find((c) => c.kind === "A8" && c.personId === "p040");
    expect(a8).toBeDefined();
    expect(a8!.options).not.toContain("adjust-it");
    expect(a8!.options).toEqual(["push-harder", "abandon-it"]);
  });

  it("A8 DOES offer 'adjust-it' when there's a real cause — a recent event tied to the dream", () => {
    const person = makePerson("p041", { birthYear: 1470 });
    person.mind.dream = { goal: "master a craft", status: "pursuing", since: 1470 };
    // A "job" event in the last 2 years is thematically tied to "master a craft" (see DREAM_RELATED_EVENT_KINDS).
    const events: Event[] = [{ id: "ev-1", year: 1509, kind: "job", actors: ["p041"], payload: { job: "smith" }, causes: [] }];
    const candidates = gatherCandidatesForYear(1511, { p041: person }, events, "test-seed");
    const a8 = candidates.find((c) => c.kind === "A8" && c.personId === "p041");
    expect(a8).toBeDefined();
    expect(a8!.options).toContain("adjust-it");
  });

  it("A8 DOES offer 'adjust-it' after a setback (low mood), even off the 10-year milestone", () => {
    const sad = makePerson("p042", { birthYear: 1470 });
    sad.mind.dream = { goal: "leave for the city", status: "pursuing", since: 1470 };
    // A stack of strong negative thoughts drives mood well below the -25 setback threshold.
    sad.mind.thoughts = [
      { emotion: "despair", cause: "a recent loss", intensity: 90, yearsLeft: 3, year: 1510 },
      { emotion: "grief", cause: "another loss", intensity: 90, yearsLeft: 3, year: 1510 },
    ];
    const candidates = gatherCandidatesForYear(1511, { p042: sad }, [], "test-seed"); // 1511: age 41, not a milestone year
    const a8 = candidates.find((c) => c.kind === "A8" && c.personId === "p042");
    expect(a8).toBeDefined();
    expect(a8!.options).toContain("adjust-it");
  });

  it("C3 (early calling) fires exactly once, at age 12, only for someone with a real birth in this world's log", () => {
    const bornInSim = makePerson("child-p001-1500", { birthYear: 1500, founder: false });
    const atTwelve = gatherCandidatesForYear(1512, { "child-p001-1500": bornInSim }, [], "test-seed");
    expect(atTwelve.some((c) => c.kind === "C3" && c.personId === "child-p001-1500")).toBe(true);
    const offYear = gatherCandidatesForYear(1513, { "child-p001-1500": bornInSim }, [], "test-seed");
    expect(offYear.some((c) => c.kind === "C3")).toBe(false);

    const founder = makePerson("p001", { birthYear: 1500, founder: true });
    const forFounder = gatherCandidatesForYear(1512, { p001: founder }, [], "test-seed");
    expect(forFounder.some((c) => c.kind === "C3")).toBe(false);
  });
});

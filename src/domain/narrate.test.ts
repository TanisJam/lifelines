import { describe, expect, it } from "vitest";
import { createMind, DREAM_GOALS, dreamGerund, pushThought } from "./mind";
import { article, lifeSummary, narrateEvent, narrateEventForViewer, narrateMemory, narrateThought } from "./narrate";
import type { Event, Person } from "./types";

function makePerson(id: string, overrides: Partial<Person> = {}): Person {
  const birthYear = overrides.birthYear ?? 1470;
  const mind = createMind("seed-1", id, birthYear);
  return { id, name: `Person ${id}`, sex: "f", birthYear, traits: [], job: "farmer", founder: true, mind, ...overrides };
}

/**
 * Round 5 grammar fix (decision 023): `pushThought`'s `cause` strings must be gerund/noun
 * phrases, not past-tense sentence fragments — "felt relieved upon made peace with Briala" is
 * exactly the bug the coordinator flagged. These substrings would only appear if a `cause` had
 * slipped back to a raw past-tense verb ("began", "was", "made", "left", "clashed", ...).
 */
const BROKEN_UPON_PATTERNS = [/upon began /, /upon was /, /upon is /, /upon made /, /upon left /, /upon clashed /, /upon married /, /upon became /, /upon sabotaged /, /upon abandoned /, /upon overcame /, /upon gave /, /upon chose /, /upon turned /, /upon helped /, /upon welcomed /, /upon silently resented /] as const;

describe("round 5 grammar fixes (decision 023)", () => {
  it("narrateThought never produces a broken 'upon <past-tense verb>' form", () => {
    const mind = createMind("seed-1", "p001", 1470);
    const causes = [
      "courting Merric",
      "marrying Merric",
      "the courtship with Merric ending",
      "clashing with Petra",
      "making peace with Briala",
      "sabotaging Fira",
      "being sabotaged by Fira",
      "abandoning their dream of leaving for the city",
      "overcoming a breaking point",
      "giving in to it (rage)",
      "leaving home for a distant town",
      "being left behind by Merric",
    ];
    for (const cause of causes) {
      pushThought(mind, "joy", cause, 50, 5, 1500);
      const rendered = narrateThought("Orla", mind.thoughts[mind.thoughts.length - 1]!, mind);
      for (const pattern of BROKEN_UPON_PATTERNS) expect(rendered).not.toMatch(pattern);
      expect(rendered).toContain(`upon ${cause}`);
    }
  });

  it("dream narration uses the gerund form, never the raw imperative-ish DreamGoal string", () => {
    for (const goal of DREAM_GOALS) {
      const gerund = dreamGerund(goal);
      const realized: Event = { id: "e1", year: 1520, kind: "dream", actors: ["p001"], payload: { goal, outcome: "realized" }, causes: [] };
      const abandoned: Event = { id: "e2", year: 1520, kind: "dream", actors: ["p001"], payload: { goal, outcome: "abandoned" }, causes: [] };
      const pursuing: Event = { id: "e3", year: 1520, kind: "dream", actors: ["p001"], payload: { goal, outcome: "adjusted" }, causes: [] };
      const people = { p001: makePerson("p001") };

      for (const event of [realized, abandoned, pursuing]) {
        const prose = narrateEvent(event, people, "seed-1");
        expect(prose).toContain(gerund);
        // The raw form only differs from the gerund by its ending, so check the exact broken
        // phrase the coordinator quoted doesn't appear: "dreamed of <raw goal>".
        expect(prose).not.toContain(`dreamed of ${goal},`);
      }
    }
  });

  it("narrateMemory never restates the year a second time (memory.text already embeds it)", () => {
    const memory = { year: 1507, text: "clashed with Petra Mossgate in 1507", emotion: "anger", core: false };
    const rendered = narrateMemory("Orla", memory);
    // The exact bug: "still remembers, from 1507: clashed with Petra Mossgate in 1507".
    expect(rendered).not.toMatch(/from 1507.*1507/);
    expect(rendered).toBe("Orla still remembers: clashed with Petra Mossgate in 1507");
  });
});

describe("round 5 pivot: narrateEventForViewer / lifeSummary (decision 026)", () => {
  it("returns a relation term for a family member's death instead of just their name", () => {
    const wife = makePerson("p001", { sex: "f", spouseId: "p002" });
    const husband = makePerson("p002", { sex: "m", spouseId: "p001", deathYear: 1550 });
    const people = { p001: wife, p002: husband };
    const deathEvent: Event = { id: "e1", year: 1550, kind: "death", actors: ["p002"], payload: { age: 74 }, causes: [] };

    const fromWife = narrateEventForViewer(deathEvent, "p001", people, "seed-1");
    expect(fromWife.prose).toContain("husband");
    expect(fromWife.prose).toContain(husband.name);

    // From the deceased's OWN page, no relation-term rewrite (it's just their own death).
    const fromHusband = narrateEventForViewer(deathEvent, "p002", people, "seed-1");
    expect(fromHusband.title).toBe("Dies");
  });

  it("every RenderedEvent has a non-empty title distinct from an empty prose", () => {
    const people = { p001: makePerson("p001"), p002: makePerson("p002", { sex: "m" }) };
    const marriage: Event = { id: "e1", year: 1520, kind: "marriage", actors: ["p001", "p002"], payload: {}, causes: [] };
    const { title, prose } = narrateEventForViewer(marriage, "p001", people, "seed-1");
    expect(title.length).toBeGreaterThan(0);
    expect(prose.length).toBeGreaterThan(0);
  });

  it("lifeSummary mentions how and where a person died, deterministically, from real fields only", () => {
    const deceased = makePerson("p001", { birthYear: 1490, deathYear: 1550, job: "healer" });
    deceased.mind.dream.status = "realized";
    const summary = lifeSummary(deceased, { p001: deceased }, [], "Ravenford");
    expect(summary).toContain("died at 60");
    expect(summary).toContain("Ravenford");
    expect(summary).toContain("healer");
    // Deterministic: calling it again with identical inputs produces the exact same string.
    expect(lifeSummary(deceased, { p001: deceased }, [], "Ravenford")).toBe(summary);
  });

  it("lifeSummary mentions living children when there are any", () => {
    const mother = makePerson("p001", { birthYear: 1490, deathYear: 1560 });
    const child = makePerson("child-p001-1520", { birthYear: 1520, motherId: "p001" });
    const summary = lifeSummary(mother, { p001: mother, "child-p001-1520": child }, [], "Ravenford");
    expect(summary).toContain("surrounded by");
  });
});

describe("round 7 fixes (decision 030)", () => {
  it("a family death clause uses the OBJECT pronoun ('her'/'him'), never the subject pronoun, after 'stayed with'", () => {
    // Regression test for the exact bug found live while screenshotting round 7: "the loss stayed
    // with she for years" — grammatically wrong (subject pronoun where an object pronoun belongs).
    const wife = makePerson("p001", { sex: "f", spouseId: "p002" });
    const husband = makePerson("p002", { sex: "m", spouseId: "p001", deathYear: 1550 });
    // Try several seeds so both of `pick()`'s phrasing variants get exercised — only one of the
    // two actually contains "stayed with", so a single seed could pass by chance alone.
    for (const seed of ["seed-1", "seed-2", "seed-3", "seed-4", "seed-5"]) {
      const husbandAway: Event = { id: "e1", year: 1550, kind: "death", actors: ["p002"], payload: { age: 74, awayFromTown: true }, causes: [] };
      const rendered = narrateEventForViewer(husbandAway, "p001", { p001: wife, p002: husband }, seed);
      expect(rendered.prose).not.toMatch(/stayed with (she|he)\b/);
    }

    const husbandDied: Person = { ...husband };
    // A memory-year match triggers `innerLifeClause`'s own "this would stay with ___" clause.
    husbandDied.mind.memories.push({ year: 1534, text: "let go of a dream in 1534", emotion: "despair", core: true });
    const dreamEvent: Event = { id: "e2", year: 1534, kind: "dream", actors: ["p002"], payload: { goal: "master a craft", outcome: "abandoned" }, causes: [] };
    const dreamProse = narrateEventForViewer(dreamEvent, "p002", { p001: wife, p002: husbandDied }, "seed-1").prose;
    expect(dreamProse).not.toMatch(/stay with (she|he)\b/);
  });

  it("dream narration uses the person's real pronoun ('her'/'his'), not singular 'their', when setting a new dream", () => {
    const woman = makePerson("p001", { sex: "f" });
    const man = makePerson("p002", { sex: "m" });
    const event = (actorId: string): Event => ({ id: `e-${actorId}`, year: 1520, kind: "dream", actors: [actorId], payload: { goal: "leave for the city", outcome: "set" }, causes: [] });
    const womanProse = narrateEvent(event("p001"), { p001: woman, p002: man }, "seed-1");
    const manProse = narrateEvent(event("p002"), { p001: woman, p002: man }, "seed-1");
    expect(womanProse).toContain("her sights");
    expect(manProse).toContain("his sights");
    expect(womanProse).not.toContain("their sights");
    expect(manProse).not.toContain("their sights");
  });

  it("a dream change with a cause names it in the prose ('After marrying, ...'), and never announces a new dream unmotivated", () => {
    const person = makePerson("p001", { sex: "f" });
    const causedEvent: Event = { id: "e1", year: 1520, kind: "dream", actors: ["p001"], payload: { goal: "start a family", outcome: "adjusted", cause: "marrying" }, causes: [] };
    const prose = narrateEvent(causedEvent, { p001: person }, "seed-1");
    expect(prose).toMatch(/^After marrying,/);
  });
});

describe("round 8 grammar fixes (decision 033)", () => {
  it("article(noun) picks 'an' for a vowel-leading noun and 'a' otherwise, for every job in the pool", () => {
    // Regression test for "Becomes a innkeeper" / "as a innkeeper" — `innkeeper` is the only
    // vowel-leading job in JOB_POOL, but the helper must be correct for the whole set, not just
    // that one case.
    const expected: Record<string, "a" | "an"> = {
      farmer: "a",
      blacksmith: "a",
      healer: "a",
      merchant: "a",
      scholar: "a",
      guard: "a",
      fisher: "a",
      innkeeper: "an",
      weaver: "a",
    };
    for (const [job, want] of Object.entries(expected)) {
      const withArticleText = article(job);
      expect(withArticleText).toBe(want);
    }
  });

  it("a job-change event never reads 'a innkeeper' — renders 'an innkeeper' with the correct article both for a first job and a real career change", () => {
    const person = makePerson("p001");
    // `forced: true` selects a single deterministic template (no `pick()` variant), so this
    // exercises the article logic without depending on which of the two phrasings gets picked.
    const firstJob: Event = { id: "e1", year: 1520, kind: "job", actors: ["p001"], payload: { job: "innkeeper", forced: true }, causes: [] };
    expect(narrateEvent(firstJob, { p001: person }, "seed-1")).toMatch(/\ban innkeeper\b/);

    const priorJob: Event = { id: "e1", year: 1510, kind: "job", actors: ["p001"], payload: { job: "farmer" }, causes: [] };
    const careerChange: Event = { id: "e2", year: 1530, kind: "job", actors: ["p001"], payload: { job: "innkeeper" }, causes: [] };
    const prose = narrateEvent(careerChange, { p001: person }, "seed-1", "town", [priorJob, careerChange]);
    expect(prose).toMatch(/\ban innkeeper\b/);
    expect(prose).not.toMatch(/\ba innkeeper\b/);
  });

  it("lifeSummary's job clause never reads 'as a innkeeper' for a vowel-leading job", () => {
    const person = makePerson("p001", { deathYear: 1550, job: "innkeeper" });
    const summary = lifeSummary(person, { p001: person }, [], "Ravenford");
    expect(summary).toMatch(/\bas an innkeeper\b/);
  });

  it("A8's option labels use the person's real pronoun, for both sexes — never singular 'their'", () => {
    for (const sex of ["f", "m"] as const) {
      const goalPronoun = sex === "f" ? "her" : "his";
      const event = (goal: string): Event => ({ id: `e-${sex}`, year: 1520, kind: "dream", actors: ["p001"], payload: { goal, outcome: "set" }, causes: [] });
      const person = makePerson("p001", { sex });
      const prose = narrateEvent(event("leave for the city"), { p001: person }, "seed-1");
      expect(prose).toContain(`${goalPronoun} sights`);
      expect(prose).not.toContain("their sights");
    }
  });
});

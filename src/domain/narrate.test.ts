import { describe, expect, it } from "vitest";
import { createMind, DREAM_GOALS, dreamGerund, pushThought } from "./mind";
import { article, lifeSummary, narrateEvent, narrateEventForViewer, narrateMemory, narrateThought, TOWN_EVENT_NARRATION, TOWN_EVENT_NARRATION_ES } from "./narrate";
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
      labourer: "a",
      shepherd: "a",
      farmer: "a",
      blacksmith: "a",
      carpenter: "a",
      weaver: "a",
      miller: "a",
      baker: "a",
      tanner: "a",
      healer: "a",
      merchant: "a",
      innkeeper: "an",
      priest: "a",
      landholder: "a",
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

describe("decision 054: widowhood narration", () => {
  it("narrateEvent renders a 'widowed' event with the survivor as the subject, distinguishing widow/widower by sex, and names the kept trade when flagged", () => {
    const widow = makePerson("p001", { sex: "f" });
    const husband = makePerson("p002", { sex: "m" });
    const people = { p001: widow, p002: husband };
    const plain: Event = { id: "e1", year: 1540, kind: "widowed", actors: ["p001", "p002"], payload: {}, causes: [] };
    const plainProse = narrateEvent(plain, people, "seed-1");
    expect(plainProse).toContain(widow.name);
    expect(plainProse).toContain(husband.name);
    expect(plainProse).not.toContain("kept the workshop");

    const keptTrade: Event = { id: "e2", year: 1540, kind: "widowed", actors: ["p001", "p002"], payload: { keptTrade: true }, causes: [] };
    expect(narrateEvent(keptTrade, people, "seed-1")).toContain("kept the workshop going alone");

    // A widower (survivor is male) reads "widower", not "widow" — exercised across several seeds
    // since only one of `pick`'s two phrasing variants actually contains the noun.
    const widower = makePerson("p003", { sex: "m" });
    const wife = makePerson("p004", { sex: "f" });
    const widowerEvent: Event = { id: "e3", year: 1540, kind: "widowed", actors: ["p003", "p004"], payload: {}, causes: [] };
    let sawWidower = false;
    for (const seed of ["seed-1", "seed-2", "seed-3", "seed-4"]) {
      const prose = narrateEvent(widowerEvent, { p003: widower, p004: wife }, seed);
      expect(prose).not.toContain("a widow when");
      if (prose.includes("widower")) sawWidower = true;
    }
    expect(sawWidower).toBe(true);
  });

  it("a death's title/prose still credits the surviving spouse's relation ('Husband X dies') once `spouseId` has already been cleared by the death itself — decision 054's own fix, since the widowhood bug fix would otherwise silently break this", () => {
    const wife = makePerson("p001", { sex: "f" }); // spouseId already cleared, as `simulate.ts` now does
    const husband = makePerson("p002", { sex: "m", deathYear: 1550 });
    const people = { p001: wife, p002: husband };
    const deathEvent: Event = { id: "e1", year: 1550, kind: "death", actors: ["p002"], payload: { age: 74 }, causes: [] };
    const widowedEvent: Event = { id: "e2", year: 1550, kind: "widowed", actors: ["p001", "p002"], payload: {}, causes: [deathEvent.id] };
    const allEvents = [deathEvent, widowedEvent];

    const rendered = narrateEventForViewer(deathEvent, "p001", people, "seed-1", "town", allEvents);
    expect(rendered.title).toBe("Husband Person p002 dies");
    expect(rendered.prose).toContain("husband");
    expect(rendered.prose).toContain(husband.name);
  });
});

describe("decision 059: Spanish narration", () => {
  it("renders Spanish prose for a marriage, deterministically, distinct from the English prose", () => {
    const bride = makePerson("p001", { sex: "f" });
    const groom = makePerson("p002", { sex: "m" });
    const people = { p001: bride, p002: groom };
    const event: Event = { id: "e1", year: 1520, kind: "marriage", actors: ["p001", "p002"], payload: {}, causes: [] };

    const es = narrateEvent(event, people, "seed-1", "town", [], "es");
    const en = narrateEvent(event, people, "seed-1", "town", [], "en");
    expect(es).not.toBe(en);
    expect(es).toMatch(/se casó con|contrajeron matrimonio/);
    expect(es).toContain(bride.name);
    expect(es).toContain(groom.name);
    // Determinism: the same (seed, event) always renders the exact same Spanish string.
    expect(narrateEvent(event, people, "seed-1", "town", [], "es")).toBe(es);
  });

  it("renders Spanish prose for a birth", () => {
    const mother = makePerson("p001", { sex: "f" });
    const father = makePerson("p002", { sex: "m" });
    const child = makePerson("p003");
    const people = { p001: mother, p002: father, p003: child };
    const event: Event = { id: "e1", year: 1520, kind: "birth", actors: ["p003", "p001", "p002"], payload: {}, causes: [] };
    const es = narrateEvent(event, people, "seed-1", "town", [], "es");
    expect(es).toMatch(/nació|recibieron/);
    expect(es).toContain(child.name);
  });

  it("renders Spanish prose for a death, translating the cause of death", () => {
    const person = makePerson("p001", { sex: "m" });
    const event: Event = { id: "e1", year: 1550, kind: "death", actors: ["p001"], payload: { age: 60, cause: "old-age" }, causes: [] };
    const es = narrateEvent(event, { p001: person }, "seed-1", "town", [], "es");
    expect(es).toMatch(/murió|fue llevado/);
    expect(es).toContain("vejez");
    expect(es).toContain("60");
  });

  it("renders a Spanish job title, gender-agreed with the person's sex", () => {
    const woman = makePerson("p001", { sex: "f" });
    const man = makePerson("p002", { sex: "m" });
    const eventFor = (id: string): Event => ({ id: `e-${id}`, year: 1520, kind: "job", actors: [id], payload: { job: "baker", forced: true }, causes: [] });
    const esWoman = narrateEvent(eventFor("p001"), { p001: woman }, "seed-1", "town", [], "es");
    const esMan = narrateEvent(eventFor("p002"), { p002: man }, "seed-1", "town", [], "es");
    expect(esWoman).toContain("panadera");
    expect(esMan).toContain("panadero");
  });

  it("renders Spanish prose for a town event", () => {
    const event: Event = { id: "e1", year: 1536, kind: "town", actors: [], payload: { eventType: "plague" }, causes: [] };
    const es = narrateEvent(event, {}, "seed-1", "Ravenford", [], "es");
    expect(es).toBe("Una peste asoló el pueblo.");
  });

  it("titleFor (via narrateEventForViewer) renders a Spanish title", () => {
    const woman = makePerson("p001", { sex: "f" });
    const event: Event = { id: "e1", year: 1520, kind: "birth", actors: ["p001"], payload: {}, causes: [] };
    const { title } = narrateEventForViewer(event, "p001", { p001: woman }, "seed-1", "town", [], "es");
    expect(title).toBe("Nace");
  });

  it("lifeSummary renders in Spanish", () => {
    const deceased = makePerson("p001", { birthYear: 1490, deathYear: 1550, job: "healer", sex: "f" });
    const summary = lifeSummary(deceased, { p001: deceased }, [], "Ravenford", "es");
    expect(summary).toContain("murió a los 60");
    expect(summary).toContain("Ravenford");
    expect(summary).toContain("curandera");
  });
});

describe("bugfix: return-home narration (payload.returned) reads as a return, not another departure", () => {
  it("English: a returned move is narrated as coming/returning home, with a 'Returns to' title", () => {
    const person = makePerson("p001", { sex: "f" });
    const people = { p001: person };
    const event: Event = { id: "e1", year: 1520, kind: "move", actors: ["p001"], payload: { away: false, returned: true, destination: "Ravenford" }, causes: [] };

    const prose = narrateEvent(event, people, "seed-1", "Ravenford", [], "en");
    expect(prose).toMatch(/^Person p001 (came home to|returned to) Ravenford\.$/);
    expect(prose).not.toMatch(/moved away|left for|packed up/);

    const { title } = narrateEventForViewer(event, "p001", people, "seed-1", "Ravenford", [], "en");
    expect(title).toBe("Returns to Ravenford");
    expect(title).not.toMatch(/^Leaves for/);
  });

  it("Spanish: a returned move is narrated as volvió/regresó home, with a 'Vuelve a' title", () => {
    const person = makePerson("p001", { sex: "f" });
    const people = { p001: person };
    const event: Event = { id: "e1", year: 1520, kind: "move", actors: ["p001"], payload: { away: false, returned: true, destination: "Ravenford" }, causes: [] };

    const prose = narrateEvent(event, people, "seed-1", "Ravenford", [], "es");
    expect(prose).toMatch(/^Person p001 (volvió a|regresó a su hogar en) Ravenford\.$/);
    expect(prose).not.toMatch(/se mudó|partió hacia|recogió sus cosas/);

    const { title } = narrateEventForViewer(event, "p001", people, "seed-1", "Ravenford", [], "es");
    expect(title).toBe("Vuelve a Ravenford");
  });

  it("a plain departure (no payload.returned) still narrates as leaving/moving away, unchanged", () => {
    const person = makePerson("p001", { sex: "f" });
    const people = { p001: person };
    const event: Event = { id: "e1", year: 1520, kind: "move", actors: ["p001"], payload: { away: true, destination: "Millbrook" }, causes: [] };

    const prose = narrateEvent(event, people, "seed-1", "town", [], "en");
    expect(prose).toMatch(/^Person p001 (moved away to|packed up and left for) Millbrook\.$/);

    const { title } = narrateEventForViewer(event, "p001", people, "seed-1", "town", [], "en");
    expect(title).toBe("Leaves for Millbrook");
  });
});

describe("PR5: dated period-event copy, en/es key parity", () => {
  it("en and es cover exactly the same set of town-event keys", () => {
    expect(Object.keys(TOWN_EVENT_NARRATION).sort()).toEqual(Object.keys(TOWN_EVENT_NARRATION_ES).sort());
  });

  it("every dated PR5 shock/national-event key has non-empty copy in both locales", () => {
    for (const key of ["black-death", "second-pestilence", "hundred-years-war-begins", "ordinance-of-labourers", "statute-of-labourers"]) {
      expect(TOWN_EVENT_NARRATION[key]?.length).toBeGreaterThan(0);
      expect(TOWN_EVENT_NARRATION_ES[key]?.length).toBeGreaterThan(0);
    }
  });
});

describe("PR5: manorial-fine and period-marker narration (restrained copy, both locales)", () => {
  const person = makePerson("p001", { sex: "f" });
  const people = { p001: person };

  it.each(["merchet", "heriot", "chevage", "leyrwite"] as const)("renders restrained en/es prose and a title for %s, never throwing on an unknown event kind", (fine) => {
    const event: Event = { id: "e1", year: 1340, kind: "manorial-fine", actors: ["p001"], payload: { fine, payerId: "p001", payee: "lord" }, causes: [] };
    const en = narrateEvent(event, people, "seed-1", "town", [], "en");
    const es = narrateEvent(event, people, "seed-1", "town", [], "es");
    expect(en.length).toBeGreaterThan(0);
    expect(es.length).toBeGreaterThan(0);
    // "the lord" is named as payee only, never dramatized as a character with their own actions.
    expect(en.toLowerCase()).not.toMatch(/lord (killed|attacked|raped|tortured)/);
    const { title } = narrateEventForViewer(event, "p001", people, "seed-1", "town", [], "en");
    expect(title.length).toBeGreaterThan(0);
  });

  it.each(["great-famine", "cattle-murrain"] as const)("renders en/es backstory prose and a title for the %s period-marker", (marker) => {
    const event: Event = { id: "e1", year: 1315, kind: "period-marker", actors: ["p001"], payload: { marker }, causes: [] };
    const en = narrateEvent(event, people, "seed-1", "town", [], "en");
    const es = narrateEvent(event, people, "seed-1", "town", [], "es");
    expect(en.length).toBeGreaterThan(0);
    expect(es.length).toBeGreaterThan(0);
    const { title } = narrateEventForViewer(event, "p001", people, "seed-1", "town", [], "en");
    expect(title.length).toBeGreaterThan(0);
  });
});

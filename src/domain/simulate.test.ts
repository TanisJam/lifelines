import { describe, expect, it } from "vitest";
import { RuleDecisionMaker } from "@/adapters/decision/rule-decision-maker";
import { classMortalityMultiplier } from "./actuarial";
import { indexEventsById, walkCauses } from "./causality";
import { forkWorld } from "./fork";
import { createMind } from "./mind";
import { canMarry, eligibleForAnotherChild, gatherCandidatesForYear, simulate, townEventMortalityMultiplier } from "./simulate";
import type { Event, Override, Person, SocialClass } from "./types";
import { generateWorld } from "./worldgen";

// A small, fast world for tests: fewer founders, fewer years than the MVP default.
function testWorld(seed: string) {
  return generateWorld({ seed, startYear: 1500, endYear: 1530, founderCount: 10 });
}

function makeClergyPerson(overrides: Partial<Person> = {}): Person {
  return {
    id: "priest1",
    name: "Father Test",
    sex: "m",
    birthYear: 1480,
    traits: [],
    job: "priest",
    founder: true,
    socialClass: "clergy",
    mind: undefined as unknown as Person["mind"],
    ...overrides,
  };
}

function run(seed: string) {
  const { config, people } = testWorld(seed);
  return simulate(config, people, [], { decisionMaker: new RuleDecisionMaker(), engineSource: "rules" });
}

describe("determinism", () => {
  it("produces an identical event log and decision log for the same seed", async () => {
    const reportA = await run("acorn");
    const reportB = await run("acorn");

    expect(reportA.result.events).toEqual(reportB.result.events);
    expect(reportA.result.people).toEqual(reportB.result.people);
    expect(reportA.result.decisions).toEqual(reportB.result.decisions);
  });

  it("produces a different event log for a different seed", async () => {
    const reportA = await run("acorn");
    const reportB = await run("birch");

    expect(reportA.result.events.length === reportB.result.events.length && JSON.stringify(reportA.result.people) === JSON.stringify(reportB.result.people)).toBe(false);
  });
});

describe("forking with the generic override", () => {
  it("re-choosing the SAME option a decision already landed on leaves the future identical (a true no-op)", async () => {
    const base = await run("cedar");

    const deathDecision = base.result.decisions.find((d) => d.kind === "death" && d.chosen === "survive");
    expect(deathDecision).toBeDefined();

    const override: Override = { id: "ov-noop", decisionId: deathDecision!.id, optionId: "survive" };
    const forked = await forkWorld(base.snapshots, override, new RuleDecisionMaker(), "rules", base.result.config);

    expect(forked.result.events).toEqual(base.result.events);
  });

  it("forcing a different option at a real decision leaves the timeline before it unchanged and diverges after", async () => {
    // Decision 053 reseeded this from "dogwood": raising the marriage-eligibility floor from a flat
    // 16 to a class-specific ~20-28 (research.md's synthesis table) meant this small 10-founder,
    // 30-year test world no longer produced a declined Y1 courtship at all. "dogwood-1" does.
    const base = await run("dogwood-1");

    // Find a "Y1" (courtship offer) decision that was declined, and force it to "encourage" instead.
    const declined = base.result.decisions.find((d) => d.kind === "Y1" && d.chosen === "decline");
    expect(declined).toBeDefined();
    const forkYear = declined!.year;

    const override: Override = { id: "ov-accept", decisionId: declined!.id, optionId: "encourage" };
    const forked = await forkWorld(base.snapshots, override, new RuleDecisionMaker(), "rules", base.result.config);

    const beforeBase = base.result.events.filter((e) => e.year < forkYear);
    const beforeForked = forked.result.events.filter((e) => e.year < forkYear);
    expect(beforeForked).toEqual(beforeBase);

    // The forced romance itself must appear at the fork year.
    const forcedRomance = forked.result.events.find((e) => e.kind === "romance" && e.year === forkYear && e.actors.includes(declined!.personId));
    expect(forcedRomance).toBeDefined();

    const afterBase = JSON.stringify(base.result.events.filter((e) => e.year >= forkYear));
    const afterForked = JSON.stringify(forked.result.events.filter((e) => e.year >= forkYear));
    expect(afterBase).not.toEqual(afterForked);
  });

  it("forcing 'survive' at a death decision that would otherwise have killed someone changes their fate (prevent-death via the generic override)", async () => {
    const base = await run("elm");

    const fatalDeath = base.result.decisions.find((d) => d.kind === "death" && d.chosen === "die");
    if (!fatalDeath) return; // small deterministic worlds occasionally have nobody die; that's fine, skip.

    const override: Override = { id: "ov-survive", decisionId: fatalDeath.id, optionId: "survive" };
    const forked = await forkWorld(base.snapshots, override, new RuleDecisionMaker(), "rules", base.result.config);

    const person = forked.result.people[fatalDeath.personId];
    expect(person).toBeDefined();
    expect(person!.deathYear === undefined || person!.deathYear > fatalDeath.year).toBe(true);
  });

  it("leaves at least some unrelated people unaffected when there is no causal path to them", async () => {
    const base = await run("fir2");

    const declined = base.result.decisions.find((d) => d.kind === "Y1" && d.chosen === "decline");
    expect(declined).toBeDefined();

    const override: Override = { id: "ov-accept-2", decisionId: declined!.id, optionId: "encourage" };
    const forked = await forkWorld(base.snapshots, override, new RuleDecisionMaker(), "rules", base.result.config);

    const unaffectedCount = Object.keys(base.result.people).filter((id) => {
      if (id === declined!.personId) return false;
      const before = base.result.people[id];
      const after = forked.result.people[id];
      if (!after) return false;
      return before!.job === after.job && before!.deathYear === after.deathYear && before!.spouseId === after.spouseId;
    }).length;

    expect(unaffectedCount).toBeGreaterThan(0);
  });
});

describe("population", () => {
  it("produces births across multiple generations over a full-length run under the rules engine", async () => {
    const { config, people } = generateWorld({ seed: "generations-check" });
    const startCount = Object.keys(people).length;
    const report = await simulate(config, people, [], { decisionMaker: new RuleDecisionMaker(), engineSource: "rules" });

    const births = report.result.events.filter((e) => e.kind === "birth");
    expect(births.length).toBeGreaterThan(0);

    const birthDecades = new Set(births.map((e) => Math.floor(e.year / 10) * 10));
    expect(birthDecades.size).toBeGreaterThan(1);

    const endCount = Object.keys(report.result.people).length;
    expect(endCount).toBeGreaterThan(startCount);
    const aliveAtEnd = Object.values(report.result.people).filter((p) => p.deathYear === undefined).length;
    expect(aliveAtEnd).toBeGreaterThan(0);
  });
});

describe("decision records", () => {
  it("records a DecisionRecord for every event that has a resulting decision, with a valid fragility/surprise and chosen option", async () => {
    const report = await run("holly");
    expect(report.result.decisions.length).toBeGreaterThan(0);

    for (const decision of report.result.decisions) {
      expect(decision.options.some((o) => o.id === decision.chosen)).toBe(true);
      expect(decision.fragility).toBeGreaterThanOrEqual(0);
      expect(typeof decision.surprise).toBe("boolean");
      expect(Object.keys(decision.final).length).toBeGreaterThan(0);
    }
  });

  it("does not record a biology decision when it was a near-certainty and nothing happened (recording threshold)", async () => {
    const report = await run("ivy");
    // A healthy adult's illness decision has p well under 5%; if it didn't fire, it shouldn't be recorded.
    const trivialSurvivedIllness = report.result.decisions.find((d) => d.kind === "illness" && d.chosen === "healthy" && d.final.illness! < 0.05);
    expect(trivialSurvivedIllness).toBeUndefined();
  });
});

describe("decision 056: canMarry / class inheritance", () => {
  it("canMarry returns false for clergy and true for every other class", () => {
    expect(canMarry(makeClergyPerson(), 1520)).toBe(false);
    for (const socialClass of ["labourer", "husbandman", "yeoman", "artisan", "merchant", "gentry"] as const) {
      expect(canMarry(makeClergyPerson({ socialClass, job: "farmer" }), 1520)).toBe(true);
    }
  });

  it("no clergy founder is ever a marriage actor across a full run, for several seeds", async () => {
    for (const seed of ["clergy-check-1", "clergy-check-2", "clergy-check-3"]) {
      const { config, people, events: initialEvents } = generateWorld({ seed, startYear: 1498, endYear: 1558, founderCount: 24 });
      const clergyIds = new Set(Object.values(people).filter((p) => p.socialClass === "clergy").map((p) => p.id));
      expect(clergyIds.size).toBe(1);
      const report = await simulate(config, people, initialEvents, { decisionMaker: new RuleDecisionMaker(), engineSource: "rules" });
      const marriageEvents = report.result.events.filter((e) => e.kind === "marriage");
      for (const marriage of marriageEvents) {
        for (const actorId of marriage.actors) expect(clergyIds.has(actorId)).toBe(false);
      }
    }
  });

  it("a child born during the simulation inherits its class from its father", async () => {
    const { config, people } = generateWorld({ seed: "birth-class-check", startYear: 1498, endYear: 1540, founderCount: 20 });
    const report = await simulate(config, people, [], { decisionMaker: new RuleDecisionMaker(), engineSource: "rules" });
    const births = report.result.events.filter((e) => e.kind === "birth");
    expect(births.length).toBeGreaterThan(0);
    for (const birth of births) {
      const [childId, , fatherId] = birth.actors;
      const child = report.result.people[childId!];
      const father = fatherId ? report.result.people[fatherId] : undefined;
      if (child && father) expect(child.socialClass).toBe(father.socialClass);
    }
  });
});

describe("decision 057: no universal school event", () => {
  it("not everyone who reaches age 7 gets a 'school' event, but the literate minority does", async () => {
    const { config, people } = generateWorld({ seed: "school-check", startYear: 1498, endYear: 1540, founderCount: 24 });
    const report = await simulate(config, people, [], { decisionMaker: new RuleDecisionMaker(), engineSource: "rules" });

    const schoolEventPersonIds = new Set(report.result.events.filter((e) => e.kind === "school").map((e) => e.actors[0]));
    const ageReached = (p: Person) => (p.deathYear ?? config.endYear) - p.birthYear;
    const everyoneWhoReachedSeven = Object.values(report.result.people).filter((p) => ageReached(p) >= 7);
    expect(everyoneWhoReachedSeven.length).toBeGreaterThan(0);

    const literateCount = everyoneWhoReachedSeven.filter((p) => p.literate).length;
    const illiterateCount = everyoneWhoReachedSeven.length - literateCount;
    // Only the literate get a school event; with the sourced literacy rates, most villagers don't.
    expect(illiterateCount).toBeGreaterThan(0);
    for (const person of everyoneWhoReachedSeven) {
      if (!person.literate) expect(schoolEventPersonIds.has(person.id)).toBe(false);
    }
  });
});

describe("decision 050: recalibrated mortality and class multiplier", () => {
  it("orders the class multipliers per the documented direction: labourer worst, common classes at baseline, merchant better, clergy/gentry best", () => {
    const labourer = classMortalityMultiplier("labourer");
    const baseline = classMortalityMultiplier("husbandman");
    const merchant = classMortalityMultiplier("merchant");
    const clergy = classMortalityMultiplier("clergy");
    expect(classMortalityMultiplier("yeoman")).toBe(baseline);
    expect(classMortalityMultiplier("artisan")).toBe(baseline);
    expect(labourer).toBeGreaterThan(baseline);
    expect(baseline).toBeGreaterThan(merchant);
    expect(merchant).toBeGreaterThan(clergy);
    expect(classMortalityMultiplier("gentry")).toBe(clergy);
  });

  it("the class multiplier actually moves simulated mortality: across several seeds, labourers die younger on average than gentry/clergy", async () => {
    const labourerAges: number[] = [];
    const wellOffAges: number[] = [];
    for (const seed of ["class-mortality-1", "class-mortality-2", "class-mortality-3", "class-mortality-4", "class-mortality-5"]) {
      const { config, people } = generateWorld({ seed, startYear: 1498, endYear: 1558, founderCount: 30 });
      const report = await simulate(config, people, [], { decisionMaker: new RuleDecisionMaker(), engineSource: "rules" });
      for (const person of Object.values(report.result.people)) {
        if (person.deathYear === undefined) continue;
        const ageAtDeath = person.deathYear - person.birthYear;
        const socialClass: SocialClass = person.socialClass ?? "labourer";
        if (socialClass === "labourer") labourerAges.push(ageAtDeath);
        if (socialClass === "gentry" || socialClass === "clergy") wellOffAges.push(ageAtDeath);
      }
    }
    expect(labourerAges.length).toBeGreaterThan(0);
    expect(wellOffAges.length).toBeGreaterThan(0);
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(avg(labourerAges)).toBeLessThan(avg(wellOffAges));
  });
});

describe("decision 052: dated epidemics and dearths", () => {
  it("a dated shock (sweating sickness, dearth, influenza) only ever kills in its documented historical year(s), never a random one", async () => {
    const { config, people } = generateWorld({ seed: "epi-check-9", startYear: 1498, endYear: 1558, founderCount: 30 });
    const report = await simulate(config, people, [], { decisionMaker: new RuleDecisionMaker(), engineSource: "rules" });
    const datedDeaths = report.result.events.filter((e) => e.kind === "death" && ["sweating-sickness", "dearth", "influenza"].includes(e.payload.cause as string));
    expect(datedDeaths.length).toBeGreaterThan(0);

    const yearsByCause: Record<string, readonly number[]> = {
      "sweating-sickness": [1508, 1517, 1528, 1551],
      dearth: [1527, 1528, 1529, 1555, 1556],
      influenza: [1557, 1558, 1559],
    };
    for (const death of datedDeaths) {
      const cause = death.payload.cause as string;
      expect(yearsByCause[cause]).toContain(death.year);
    }
    // The curated seed above is known to hit all three dated shock kinds within 1498-1558.
    const causesSeen = new Set(datedDeaths.map((d) => d.payload.cause));
    expect(causesSeen.has("sweating-sickness")).toBe(true);
    expect(causesSeen.has("dearth")).toBe(true);
    expect(causesSeen.has("influenza")).toBe(true);
  });

  // Fixed after review (R3-003): the old version of this test only checked that a
  // "sweating-sickness" death cause appeared, but `determineDeathCause` labels EVERY death in a
  // sweating-sickness year that way (it's keyed off `ctx.townEventType`, not who the multiplier
  // actually favored) — so the test could pass even if the skew below were broken or removed. This
  // asserts directly on `townEventMortalityMultiplier` (mortality.ts's documented skew, now
  // test-exported from simulate.ts) instead.
  it("sweating sickness raises mortality most for prime-adult men, more than for a child or a woman of the same class", () => {
    const noEvent = townEventMortalityMultiplier(undefined, 30, "m", "labourer");
    expect(noEvent).toBe(1);

    // Same (labourer, not "better-off") class throughout, so only age/sex vary.
    const primeAdultMan = townEventMortalityMultiplier("sweating-sickness", 30, "m", "labourer");
    const child = townEventMortalityMultiplier("sweating-sickness", 8, "m", "labourer");
    const woman = townEventMortalityMultiplier("sweating-sickness", 30, "f", "labourer");
    expect(primeAdultMan).toBeGreaterThan(1);
    expect(primeAdultMan).toBeGreaterThan(child);
    expect(primeAdultMan).toBeGreaterThan(woman);

    // A prime-adult man who is ALSO better-off (research.md: "particularly the clergy") is hit
    // hardest of all — the documented x5 vs. x2.5-for-either-alone tiering.
    const primeAdultBetterOffMan = townEventMortalityMultiplier("sweating-sickness", 30, "m", "merchant");
    expect(primeAdultBetterOffMan).toBeGreaterThan(primeAdultMan);
  });
});

describe("decision 051: maternal mortality at childbirth", () => {
  it("a mother can die of childbirth complications the same year as the birth, with the death causally linked to it", async () => {
    const { config, people } = generateWorld({ seed: "maternal-check-37", startYear: 1498, endYear: 1558, founderCount: 24 });
    const report = await simulate(config, people, [], { decisionMaker: new RuleDecisionMaker(), engineSource: "rules" });

    const maternalDeaths = report.result.events.filter((e) => e.kind === "death" && e.payload.cause === "childbirth");
    expect(maternalDeaths.length).toBeGreaterThan(0);

    for (const death of maternalDeaths) {
      const motherId = death.actors[0]!;
      const birthSameYear = report.result.events.find((e) => e.kind === "birth" && e.year === death.year && e.actors.includes(motherId));
      expect(birthSameYear).toBeDefined();
      expect(death.causes).toContain(birthSameYear!.id);
      // The mother must actually be dead in the final state, not just carry a stray event.
      expect(report.result.people[motherId]!.deathYear).toBe(death.year);
    }
  });

  // Fixed after review (R3-001): the maternal-death path used to skip decision 054's widowhood
  // handling entirely — a husband whose wife died in childbirth kept `spouseId` set forever (no
  // `widowed` event, remarriage impossible). Now both death paths share `resolveWidowhood`.
  it("a husband whose wife dies in childbirth ends up widowed: spouseId cleared on both sides and a `widowed` event recorded", async () => {
    let widowedHusbands = 0;
    for (const seed of ["maternal-check-37", "maternal-check-38", "maternal-check-39", "maternal-check-40", "maternal-check-41", "maternal-check-42", "maternal-check-43"]) {
      const { config, people } = generateWorld({ seed, startYear: 1498, endYear: 1558, founderCount: 30 });
      const report = await simulate(config, people, [], { decisionMaker: new RuleDecisionMaker(), engineSource: "rules" });

      const maternalDeaths = report.result.events.filter((e) => e.kind === "death" && e.payload.cause === "childbirth");
      for (const death of maternalDeaths) {
        const motherId = death.actors[0]!;
        // `resolveWidowhood` pushes `widowed` as [survivor.id, deceased.id]; only mothers who still
        // had a living spouse at the moment of death get one.
        const widowedEvent = report.result.events.find((e) => e.kind === "widowed" && e.year === death.year && e.actors[1] === motherId);
        if (!widowedEvent) continue;
        widowedHusbands++;
        const husbandId = widowedEvent.actors[0]!;
        expect(widowedEvent.causes).toContain(death.id);
        expect(report.result.people[husbandId]!.spouseId).toBeUndefined();
        expect(report.result.people[motherId]!.spouseId).toBeUndefined();
      }
    }
    expect(widowedHusbands).toBeGreaterThan(0);
  });

  // The remarriage-after-mourning half of decision 054, checked cheaply and deterministically:
  // directly against `gatherCandidatesForYear` (already test-exported) rather than by hoping a full
  // probabilistic `simulate()` run both widows someone AND then remarries them within the window.
  it("a widower from a maternal death becomes eligible for a new Y1 courtship offer once decision 054's mourning interval has passed, not before", () => {
    const husband: Person = {
      id: "husband1",
      name: "Test Husband",
      sex: "m",
      birthYear: 1480,
      traits: [],
      job: "labourer",
      founder: true,
      socialClass: "labourer",
      mind: createMind("seed", "husband1", 1480),
    };
    const candidate: Person = {
      id: "candidate1",
      name: "Test Candidate",
      sex: "f",
      birthYear: 1485,
      traits: [],
      job: "none",
      founder: true,
      socialClass: "labourer",
      mind: createMind("seed", "candidate1", 1485),
    };
    const people = { [husband.id]: husband, [candidate.id]: candidate };
    // As `resolveWidowhood` would push it for a maternal death: [survivor (husband), deceased (wife)].
    const widowedEvent: Event = { id: "ev-widowed", year: 1529, kind: "widowed", actors: [husband.id, "deceased-wife"], payload: {}, causes: ["ev-death"] };

    const stillMourning = gatherCandidatesForYear(1529, people, [widowedEvent], "seed");
    expect(stillMourning.some((c) => c.kind === "Y1" && c.personId === husband.id)).toBe(false);

    const mourningOverYear = gatherCandidatesForYear(1529 + 1, people, [widowedEvent], "seed"); // MOURNING_YEARS.m === 1
    expect(mourningOverYear.some((c) => c.kind === "Y1" && (c.personId === husband.id || c.partnerId === husband.id))).toBe(true);
  });
});

describe("decision 055: birth spacing", () => {
  it("consecutive births to the same mother are never closer than her class's minimum spacing, unless the previous child died in infancy", async () => {
    let checkedPairs = 0;
    let infantDeathResetPairs = 0;
    for (const seed of ["spacing-check-1", "spacing-check-2", "spacing-check-3", "spacing-check-4"]) {
      const { config, people } = generateWorld({ seed, startYear: 1498, endYear: 1558, founderCount: 24 });
      const report = await simulate(config, people, [], { decisionMaker: new RuleDecisionMaker(), engineSource: "rules" });

      // `eligibleForAnotherChild` (decision 055) only ever gates an IN-SIM conception — a "birth"
      // event's child. Founder children (`worldgen.ts#makeChild`) are given independent random ages at
      // world creation with no spacing rule at all, so two founder siblings can legitimately land a
      // year apart; only a PAIR ending in an in-sim birth is a real spacing-rule check.
      const bornDuringSim = new Set(report.result.events.filter((e) => e.kind === "birth").map((e) => e.actors[0]));
      const mothersWithChildren = new Set(Object.values(report.result.people).map((p) => p.motherId).filter((id): id is string => id !== undefined));
      for (const motherId of mothersWithChildren) {
        const mother = report.result.people[motherId];
        if (!mother) continue;
        const children = Object.values(report.result.people)
          .filter((p) => p.motherId === motherId)
          .sort((a, b) => a.birthYear - b.birthYear);
        if (children.length < 2) continue;
        const minSpacing = (mother.socialClass ?? "labourer") === "gentry" ? 1 : 2;
        for (let i = 1; i < children.length; i++) {
          const previous = children[i - 1]!;
          const current = children[i]!;
          if (!bornDuringSim.has(current.id)) continue; // current wasn't gated by eligibleForAnotherChild at all
          checkedPairs++;
          const gap = current.birthYear - previous.birthYear;
          // Fixed after review (R3-002): `eligibleForAnotherChild` itself now resets on `<= 1`
          // (matching the engine's actual first-death-evaluation timing), not the never-true `< 1`
          // this predicate used to mirror — kept in sync so this test still means what it says.
          const previousDiedInInfancy = previous.deathYear !== undefined && previous.deathYear - previous.birthYear <= 1;
          if (!previousDiedInInfancy) {
            expect(gap).toBeGreaterThanOrEqual(minSpacing);
          } else if (gap < minSpacing) {
            infantDeathResetPairs++;
          }
        }
      }
    }
    expect(checkedPairs).toBeGreaterThan(0);
    // Proves the reset branch actually FIRED somewhere across these runs — before the R3-002 fix,
    // `< 1` was unreachable in practice, so this count would always have been 0.
    expect(infantDeathResetPairs).toBeGreaterThan(0);
  });

  it("eligibleForAnotherChild resets the spacing floor when the last child died at its very first death-evaluation (age 1), but not when it died later", () => {
    const mother: Person = {
      id: "mother1",
      name: "Test Mother",
      sex: "f",
      birthYear: 1480,
      traits: [],
      job: "none",
      founder: true,
      socialClass: "labourer",
      mind: undefined as unknown as Person["mind"],
    };
    const infantDiedAtFirstEvaluation: Person = {
      id: "child1",
      name: "Test Child",
      sex: "f",
      birthYear: 1500,
      deathYear: 1501, // the earliest a child born in-sim can ever be evaluated for death
      traits: [],
      job: "none",
      motherId: mother.id,
      founder: false,
      mind: undefined as unknown as Person["mind"],
    };
    const peopleWithInfantDeath = { [mother.id]: mother, [infantDiedAtFirstEvaluation.id]: infantDiedAtFirstEvaluation };
    // Evaluated one year after the birth — the earliest an in-sim child is ever death-evaluated,
    // and still well inside the normal 2-year labourer spacing floor were the reset not applied.
    expect(eligibleForAnotherChild(mother, peopleWithInfantDeath, 1501)).toBe(true);

    // Same timing, but the child is still alive at its first evaluation (no infant death at all):
    // the reset must NOT apply, so the normal 2-year floor still blocks eligibility one year in.
    const stillAlive: Person = { ...infantDiedAtFirstEvaluation, deathYear: undefined };
    const peopleStillAlive = { [mother.id]: mother, [stillAlive.id]: stillAlive };
    expect(eligibleForAnotherChild(mother, peopleStillAlive, 1501)).toBe(false);
  });
});

describe("decision 053: marriage by class and canon law", () => {
  it("canMarry allows clergy to marry only during the 1549-1553 Clergy Marriage Act window", () => {
    const priest = makeClergyPerson();
    expect(canMarry(priest, 1548)).toBe(false);
    expect(canMarry(priest, 1549)).toBe(true);
    expect(canMarry(priest, 1551)).toBe(true);
    expect(canMarry(priest, 1553)).toBe(true);
    expect(canMarry(priest, 1554)).toBe(false);
  });

  it("no in-sim marriage happens below the canon-law absolute minimum (12 women / 14 men), and every actor clears the lowest class floor in the table (17 women / 22 men, gentry) — well above the old flat 16", async () => {
    let checkedMarriages = 0;
    for (const seed of ["age-check-1", "age-check-2", "age-check-3", "age-check-4"]) {
      const { config, people } = generateWorld({ seed, startYear: 1498, endYear: 1558, founderCount: 24 });
      const report = await simulate(config, people, [], { decisionMaker: new RuleDecisionMaker(), engineSource: "rules" });
      for (const marriage of report.result.events.filter((e) => e.kind === "marriage" && !e.payload.backfilled)) {
        for (const actorId of marriage.actors) {
          const actor = report.result.people[actorId];
          if (!actor) continue;
          checkedMarriages++;
          const age = marriage.year - actor.birthYear;
          expect(age).toBeGreaterThanOrEqual(actor.sex === "f" ? 12 : 14);
          expect(age).toBeGreaterThanOrEqual(actor.sex === "f" ? 17 : 22);
        }
      }
    }
    expect(checkedMarriages).toBeGreaterThan(0);
  });

  function mkPerson(overrides: Partial<Person> & Pick<Person, "id" | "sex">): Person {
    const birthYear = overrides.birthYear ?? 1500;
    return {
      name: overrides.id,
      birthYear,
      traits: [],
      job: "none",
      founder: false,
      socialClass: "husbandman",
      mind: createMind("cousin-seed", overrides.id, birthYear),
      ...overrides,
    };
  }

  it("first cousins are never matched by Y1, but an otherwise-identical unrelated pair is", () => {
    const seed = "cousin-check";
    const year = 1530;
    const grandmotherId = "grandmother";
    // Two "brothers" (dead, not otherwise relevant), sharing a mother — cousin1 and cousin2 are
    // their respective children, so they share a grandparent without sharing a parent (not caught
    // by the plain sibling/parent-child `isRelated` check, only by the new cousin extension).
    const fatherA: Person = { id: "fatherA", name: "fatherA", sex: "m", birthYear: 1470, traits: [], job: "none", founder: true, deathYear: 1520, motherId: grandmotherId, mind: undefined as unknown as Person["mind"] };
    const fatherB: Person = { id: "fatherB", name: "fatherB", sex: "m", birthYear: 1470, traits: [], job: "none", founder: true, deathYear: 1520, motherId: grandmotherId, mind: undefined as unknown as Person["mind"] };
    const unrelatedFather: Person = { id: "unrelatedFather", name: "unrelatedFather", sex: "m", birthYear: 1470, traits: [], job: "none", founder: true, deathYear: 1520, mind: undefined as unknown as Person["mind"] };

    const cousin1 = mkPerson({ id: "cousin1", sex: "f", fatherId: fatherA.id, birthYear: 1500 }); // age 30
    const cousin2 = mkPerson({ id: "cousin2", sex: "m", fatherId: fatherB.id, birthYear: 1500 }); // age 30
    const unrelated2 = mkPerson({ id: "unrelated2", sex: "m", fatherId: unrelatedFather.id, birthYear: 1500 }); // age 30

    const cousinsWorld = { fatherA, fatherB, cousin1, cousin2 };
    const cousinCandidates = gatherCandidatesForYear(year, cousinsWorld, [], seed, undefined);
    const cousinY1 = cousinCandidates.filter((c) => c.kind === "Y1");
    expect(cousinY1.some((c) => (c.personId === cousin1.id && c.partnerId === cousin2.id) || (c.personId === cousin2.id && c.partnerId === cousin1.id))).toBe(false);

    const unrelatedWorld = { fatherA, unrelatedFather, cousin1, unrelated2 };
    const unrelatedCandidates = gatherCandidatesForYear(year, unrelatedWorld, [], seed, undefined);
    const unrelatedY1 = unrelatedCandidates.filter((c) => c.kind === "Y1");
    expect(unrelatedY1.some((c) => (c.personId === cousin1.id && c.partnerId === unrelated2.id) || (c.personId === unrelated2.id && c.partnerId === cousin1.id))).toBe(true);
  });

  it("prefers a same-class partner over an equally age-appropriate cross-class one (status endogamy, a soft preference)", () => {
    const seed = "endogamy-check";
    const year = 1530;
    // Ids chosen so the cross-class candidate sorts FIRST alphabetically (`aliveNonMoved` is sorted
    // by id) — if the same-class preference weren't real, plain `.find()` would return the
    // cross-class candidate simply because it comes first in iteration order.
    const person = mkPerson({ id: "z_person", sex: "f", socialClass: "husbandman", birthYear: 1500 }); // age 30
    const sameClass = mkPerson({ id: "y_same", sex: "m", socialClass: "husbandman", birthYear: 1502 }); // age 28
    const crossClass = mkPerson({ id: "a_cross", sex: "m", socialClass: "merchant", birthYear: 1501 }); // age 29

    const people = { person, sameClass, crossClass };
    const candidates = gatherCandidatesForYear(year, people, [], seed, undefined);
    const y1 = candidates.find((c) => c.kind === "Y1" && c.personId === person.id);
    expect(y1?.partnerId).toBe(sameClass.id);
  });
});

describe("decision 054: widowhood and remarriage", () => {
  it("a spouse's death clears spouseId on both sides and records a causally-linked widowed event — the exact bug decision 054 fixes, checked across every widowed event in several full-length village runs", async () => {
    let widowedEventsChecked = 0;
    for (const seed of ["widow-general-1", "widow-general-2", "widow-general-3", "widow-general-4"]) {
      const { config, people } = generateWorld({ seed, startYear: 1498, endYear: 1558, founderCount: 24 });
      const report = await simulate(config, people, [], { decisionMaker: new RuleDecisionMaker(), engineSource: "rules" });
      for (const widowed of report.result.events.filter((e) => e.kind === "widowed")) {
        widowedEventsChecked++;
        const [survivorId, deceasedId] = widowed.actors;
        const deathEvent = report.result.events.find((e) => e.kind === "death" && e.actors[0] === deceasedId && e.year === widowed.year);
        expect(deathEvent).toBeDefined();
        expect(widowed.causes).toContain(deathEvent!.id);
        const survivor = report.result.people[survivorId!];
        // Cleared, not left pointing at the now-dead spouse (the bug): may end up undefined (never
        // remarried) or point at a DIFFERENT, later spouse (remarried), but never the deceased.
        expect(survivor!.spouseId).not.toBe(deceasedId);
      }
    }
    expect(widowedEventsChecked).toBeGreaterThan(0);
  });

  it("a widow or widower can remarry, after their class's mourning interval since being widowed", async () => {
    const { config, people } = generateWorld({ seed: "widow-check-11", startYear: 1498, endYear: 1558, founderCount: 30 });
    const report = await simulate(config, people, [], { decisionMaker: new RuleDecisionMaker(), engineSource: "rules" });

    const marriagesByPerson = new Map<string, number[]>();
    for (const marriage of report.result.events.filter((e) => e.kind === "marriage")) {
      for (const actorId of marriage.actors) marriagesByPerson.set(actorId, [...(marriagesByPerson.get(actorId) ?? []), marriage.year]);
    }
    const remarried = [...marriagesByPerson.entries()].find(([, years]) => years.length >= 2);
    expect(remarried).toBeDefined();
    const [personId, years] = remarried!;
    const sortedYears = [...years].sort((a, b) => a - b);

    const firstWidowed = report.result.events.find((e) => e.kind === "widowed" && e.actors[0] === personId && e.year >= sortedYears[0]! && e.year < sortedYears[1]!);
    expect(firstWidowed).toBeDefined();
    const mourningYears = report.result.people[personId]!.sex === "m" ? 1 : 3;
    expect(sortedYears[1]!).toBeGreaterThanOrEqual(firstWidowed!.year + mourningYears);
  });

  it("an artisan's widow keeps the trade: her job and class match her late husband's when she had none of her own", async () => {
    const { config, people } = generateWorld({ seed: "widow-trade-39", startYear: 1498, endYear: 1558, founderCount: 30 });
    const report = await simulate(config, people, [], { decisionMaker: new RuleDecisionMaker(), engineSource: "rules" });

    const keptTrade = report.result.events.find((e) => e.kind === "widowed" && e.payload.keptTrade === true);
    expect(keptTrade).toBeDefined();
    const [survivorId, deceasedId] = keptTrade!.actors;
    const survivor = report.result.people[survivorId!]!;
    const deceased = report.result.people[deceasedId!]!;
    expect(survivor.sex).toBe("f");
    expect(deceased.job).not.toBe("none");
    expect(survivor.job).toBe(deceased.job);
    expect(survivor.socialClass).toBe("artisan");
  });
});

describe("decision 058: scheduled period events", () => {
  it("the ten dated period events fire at exactly their historical years, every full-length run, regardless of seed — never rolled, never missing", async () => {
    const expected: readonly [number, string][] = [
      [1524, "lay-subsidy"],
      [1525, "amicable-grant"],
      [1530, "vagrancy-act-1530"],
      [1536, "dissolution-begins"],
      [1536, "vagrancy-act-1536"],
      [1544, "great-debasement"],
      [1547, "chantries-act"],
      [1547, "vagrancy-act-1547"],
      [1549, "prayer-book"],
      [1553, "marian-restoration"],
    ];
    for (const seed of ["period-check-1", "period-check-2"]) {
      const { config, people } = generateWorld({ seed, startYear: 1498, endYear: 1558, founderCount: 12 });
      const report = await simulate(config, people, [], { decisionMaker: new RuleDecisionMaker(), engineSource: "rules" });
      const periodEvents = report.result.events.filter((e) => e.kind === "town" && e.payload.period === true).map((e) => [e.year, e.payload.eventType] as const);
      expect(periodEvents.length).toBe(expected.length);
      for (const pair of expected) expect(periodEvents).toContainEqual(pair);
    }
  });

  it(
    "the protagonist's lord's-levy odds are class-weighted: well-off (gentry/clergy) protagonists face a lower aggregate levy rate than labourer/husbandman ones, across many seeds",
    async () => {
      let wellOffLevies = 0;
      let wellOffYears = 0;
      let commonLevies = 0;
      let commonYears = 0;
      for (let i = 1; i <= 60; i++) {
        const seed = `levy-check-${i}`;
        const { config, people } = generateWorld({ seed, startYear: 1498, endYear: 1558, founderCount: 20, protagonist: { name: "Test", sex: "f" } });
        const report = await simulate(config, people, [], { decisionMaker: new RuleDecisionMaker(), engineSource: "rules", protagonistId: "protagonist" });
        const protagonist = report.result.people["protagonist"]!;
        const socialClass = protagonist.socialClass;
        const lastYear = protagonist.deathYear ?? config.endYear;
        const eligibleYears = Math.max(0, lastYear - Math.max(config.startYear, protagonist.birthYear + 16) + 1);
        const levyCount = report.result.events.filter((e) => e.kind === "levy").length;
        if (socialClass === "gentry" || socialClass === "clergy") {
          wellOffLevies += levyCount;
          wellOffYears += eligibleYears;
        } else if (socialClass === "labourer" || socialClass === "husbandman") {
          commonLevies += levyCount;
          commonYears += eligibleYears;
        }
      }
      expect(wellOffYears).toBeGreaterThan(0);
      expect(commonYears).toBeGreaterThan(0);
      expect(wellOffLevies / wellOffYears).toBeLessThan(commonLevies / commonYears);
    },
    20000,
  );

  it("the lord's levy actually fires (regression: `biologyDistribution` used to fall through to the immigration `arrive`/`no-arrival` labels for 'levy', so `chosen` could never equal 'impose' and no levy event ever fired), and can land in the 1524-25 Lay Subsidy/Amicable Grant years", async () => {
    const { config, people } = generateWorld({ seed: "levy-check-6", startYear: 1498, endYear: 1558, founderCount: 20, protagonist: { name: "Test", sex: "f" } });
    const report = await simulate(config, people, [], { decisionMaker: new RuleDecisionMaker(), engineSource: "rules", protagonistId: "protagonist" });
    const levies = report.result.events.filter((e) => e.kind === "levy");
    expect(levies.length).toBeGreaterThan(0);
    expect(levies.some((e) => e.year === 1524 || e.year === 1525)).toBe(true);
  });
});

describe("causality", () => {
  it("the causes chain is walkable back to root events", async () => {
    const base = await run("juniper");

    const marriage = base.result.events.find((e) => e.kind === "marriage" && e.causes.length > 0);
    if (!marriage) return;

    const eventsById = indexEventsById(base.result.events);
    const node = walkCauses(marriage.id, eventsById);
    expect(node).toBeDefined();
    expect(node!.event.id).toBe(marriage.id);
    expect(node!.causes.length).toBeGreaterThan(0);
    for (const cause of node!.causes) {
      expect(eventsById.has(cause.event.id)).toBe(true);
    }
  });
});

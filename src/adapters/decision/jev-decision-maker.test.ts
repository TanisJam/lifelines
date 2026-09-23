import { describe, expect, it } from "vitest";
import type { PersonYearBatch } from "@/domain/decisions";
import { computeHazardPrior, HAZARD_CLAMP_K_MAX } from "@/domain/hazards";
import { JevDecisionMaker } from "./jev-decision-maker";

const BASE_STATE = { name: "Mira", age: 30, job: "healer" };

function makeBatch(id: string, personId = "p1", year = 1524, isProtagonist = false): PersonYearBatch {
  return {
    personId,
    year,
    self: BASE_STATE,
    isProtagonist,
    situations: {
      [id]: { kind: "Y1", question: { id, kind: "Y1", personId, year, state: { self: BASE_STATE, situation: { code: "Y1", question: "Do I encourage it?" }, town: "Oakhaven", year }, options: ["encourage", "decline", "wait"] } },
    },
  };
}

const D1_ID = "D1:p1:1524:feast-day";

/** A batch with one real life situation (Y1) AND one `D1` daily-life vignette candidate — the shape `pickCriteria`/`vignetteCriteria` (decision 046) need to split. */
function makeBatchWithVignette(personId = "p1", year = 1524, isProtagonist = true): PersonYearBatch {
  return {
    personId,
    year,
    self: BASE_STATE,
    isProtagonist,
    situations: {
      "Y1:p001::p002:1524": {
        kind: "Y1",
        question: { id: "Y1:p001::p002:1524", kind: "Y1", personId, year, state: { self: BASE_STATE, situation: { code: "Y1", question: "Do I encourage it?" }, town: "Oakhaven", year }, options: ["encourage", "decline", "wait"] },
      },
      [D1_ID]: {
        kind: "D1",
        question: { id: D1_ID, kind: "D1", personId, year, state: { self: BASE_STATE, situation: { code: "D1", question: "It's a feast day. Do I join in?" }, town: "Oakhaven", year }, options: ["join-in", "keep-to-self"] },
      },
    },
  };
}

/** Fake systemOne answers: one for every question name the request actually asked. */
function fakeAnswers(questionNames: readonly string[]): Record<string, unknown> {
  const answers: Record<string, unknown> = {};
  for (const name of questionNames) {
    if (name === "pick") answers[name] = { type: "choice", choice: "Y1:p001::p002:1524", confidence: 0.8, probabilities: { "Y1:p001::p002:1524": 0.4, everyday: 0.6, nothing: 0 } };
    else if (name === "vignettePick") answers[name] = { type: "choice", choice: D1_ID, confidence: 0.8, probabilities: { [D1_ID]: 1 } };
    else if (name.startsWith("resp:")) answers[name] = { type: "choice", choice: "encourage", confidence: 0.8, probabilities: { encourage: 0.5, decline: 0.2, wait: 0.3 } };
  }
  return answers;
}

function fakeFetch(opts: { statuses?: number[] } = {}): { fetch: typeof fetch; calls: { body: unknown }[] } {
  const calls: { body: unknown }[] = [];
  let call = 0;
  const statuses = opts.statuses ?? [];
  const fetchImpl = (async (_input: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(init.body as string) : {};
    calls.push({ body });
    const status = statuses[call] ?? 200;
    call += 1;
    if (status !== 200) {
      return new Response(JSON.stringify({ error: "rate limited" }), { status, headers: { "content-type": "application/json" } });
    }
    const questionNames = Object.keys((body as { questions: Record<string, unknown> }).questions);
    return new Response(JSON.stringify({ model: (body as { model: string }).model, answers: fakeAnswers(questionNames), usage: { input_tokens: 100, output_tokens: 10 } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { fetch: fetchImpl, calls };
}

describe("JevDecisionMaker.decideYear", () => {
  it("answers every situation in a batch with a single HTTP request", async () => {
    const { fetch, calls } = fakeFetch();
    const maker = new JevDecisionMaker({ apiKey: "test", fetch });
    const batch = makeBatch("Y1:p001::p002:1524");
    const result = await maker.decideYear(batch);
    expect(calls.length).toBe(1);
    expect(result.selection["Y1:p001::p002:1524"]).toBeCloseTo(0.4);
    expect(result.response["Y1:p001::p002:1524"]).toEqual({ encourage: 0.5, decline: 0.2, wait: 0.3 });
  });

  it("caches an identical person-year batch, so a re-run (e.g. a fork re-simulating unchanged years) makes no second request", async () => {
    const { fetch, calls } = fakeFetch();
    const maker = new JevDecisionMaker({ apiKey: "test", fetch });
    const batch = makeBatch("Y1:p001::p002:1524");
    await maker.decideYear(batch);
    await maker.decideYear(batch);
    expect(calls.length).toBe(1);
    expect(maker.getStats().cacheHits).toBe(1);
  });

  it("retries on 429 and succeeds once the retry goes through", async () => {
    const { fetch, calls } = fakeFetch({ statuses: [429, 200] });
    const maker = new JevDecisionMaker({ apiKey: "test", fetch, maxRetries: 3 });
    const batch = makeBatch("Y1:p001::p002:1524");
    const result = await maker.decideYear(batch);
    expect(calls.length).toBe(2);
    expect(result.response["Y1:p001::p002:1524"]).toBeDefined();
  });

  it("splits a batch across multiple requests when a situation's estimated size alone would blow the per-request token budget", async () => {
    const { fetch, calls } = fakeFetch();
    const maker = new JevDecisionMaker({ apiKey: "test", fetch });
    const hugeText = "x".repeat(300_000); // ~75k estimated tokens for this one situation alone
    const batch: PersonYearBatch = {
      personId: "p1",
      year: 1524,
      self: BASE_STATE,
      isProtagonist: false,
      situations: {
        small: { kind: "Y1", question: { id: "small", kind: "Y1", personId: "p1", year: 1524, state: { self: BASE_STATE, situation: { code: "Y1" }, town: "Oakhaven", year: 1524 }, options: ["encourage", "decline"] } },
        huge: { kind: "Y1", question: { id: "huge", kind: "Y1", personId: "p1", year: 1524, state: { self: BASE_STATE, situation: { code: "Y1", note: hugeText }, town: "Oakhaven", year: 1524 }, options: ["encourage", "decline"] } },
      },
    };
    const result = await maker.decideYear(batch);
    expect(calls.length).toBe(2);
    expect(Object.keys(result.response).sort()).toEqual(["huge", "small"]);
  });

  it("hierarchical event selection (decision 046): the top-level `pick` gets ONE aggregate 'everyday' option for every D1 vignette candidate, not one option per vignette, plus a separate `vignettePick` Choice", async () => {
    const { fetch, calls } = fakeFetch();
    const maker = new JevDecisionMaker({ apiKey: "test", fetch });
    const batch = makeBatchWithVignette();
    const result = await maker.decideYear(batch);

    expect(calls.length).toBe(1);
    const questions = (calls[0]!.body as { questions: Record<string, { criteria?: Record<string, unknown> }> }).questions;
    // The D1 candidate's raw decision id never appears as its own `pick` option...
    expect(Object.keys(questions.pick!.criteria!)).not.toContain(D1_ID);
    // ...exactly one aggregate "everyday" option stands in for it instead.
    expect(Object.keys(questions.pick!.criteria!)).toContain("everyday");
    expect(Object.keys(questions.pick!.criteria!).filter((k) => k === "everyday")).toHaveLength(1);
    // The vignette itself is only judged in the separate, nested `vignettePick` Choice.
    expect(Object.keys(questions.vignettePick!.criteria!)).toEqual([D1_ID]);

    expect(result.selection.everyday).toBeCloseTo(0.6);
    expect(result.selection[D1_ID]).toBeUndefined();
    expect(result.vignetteSelection![D1_ID]).toBeCloseTo(1);
  });

  it("asks no `vignettePick` Choice when a batch has no D1 candidates", async () => {
    const { fetch, calls } = fakeFetch();
    const maker = new JevDecisionMaker({ apiKey: "test", fetch });
    const result = await maker.decideYear(makeBatch("Y1:p001::p002:1524"));
    const questions = (calls[0]!.body as { questions: Record<string, unknown> }).questions;
    expect(questions.vignettePick).toBeUndefined();
    expect(result.vignetteSelection).toEqual({});
  });
});

describe("PR7: hybrid Jev clamp (spec's 'Hybrid clamp on judged probability' requirement)", () => {
  /** A fetch double this describe block controls directly, so `pick`'s judged probability can be set per test (the shared `fakeAnswers` helper above hardcodes one fixed answer for every batch shape). */
  function extremeFetch(pickProbabilities: Record<string, number>): { fetch: typeof fetch; calls: { body: unknown }[] } {
    const calls: { body: unknown }[] = [];
    const fetchImpl = (async (_input: string, init?: RequestInit) => {
      const body = JSON.parse(init!.body as string) as { model: string; questions: Record<string, unknown> };
      calls.push({ body });
      const answers: Record<string, unknown> = {};
      for (const name of Object.keys(body.questions)) {
        if (name === "pick") answers[name] = { type: "choice", choice: Object.keys(pickProbabilities)[0], confidence: 0.9, probabilities: pickProbabilities };
        else if (name.startsWith("resp:")) answers[name] = { type: "choice", choice: "encourage", confidence: 0.8, probabilities: { encourage: 0.5, decline: 0.2, wait: 0.3 } };
      }
      return new Response(JSON.stringify({ model: body.model, answers, usage: { input_tokens: 100, output_tokens: 10 } }), { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;
    return { fetch: fetchImpl, calls };
  }

  it("never lets an extreme Jev judgment through unclamped — the engine's own hazard baseline still bounds the selection", async () => {
    const situationId = "Y1:p001::p002:1524";
    const { fetch } = extremeFetch({ [situationId]: 0.99, nothing: 0.01 });
    const maker = new JevDecisionMaker({ apiKey: "test", fetch });
    const batch = makeBatch(situationId);

    const result = await maker.decideYear(batch);

    const baseline = computeHazardPrior({ [situationId]: batch.situations[situationId]! }, result.response).selection[situationId]!;
    expect(result.selection[situationId]!).toBeLessThanOrEqual(baseline * HAZARD_CLAMP_K_MAX + 1e-9);
    expect(result.selection[situationId]!).not.toBeCloseTo(0.99, 2);
  });

  it("passes through a judgment that already sits within the clamp bounds", async () => {
    const situationId = "Y1:p001::p002:1524";
    // "encourage": 0.5 keeps this comparable to the "answers every situation" test's own baseline math.
    const { fetch } = extremeFetch({ [situationId]: 0.4, nothing: 0.6 });
    const maker = new JevDecisionMaker({ apiKey: "test", fetch });
    const result = await maker.decideYear(makeBatch(situationId));
    expect(result.selection[situationId]).toBeCloseTo(0.4, 5);
  });

  it("reports hazard-lookup fallbacks via getStats(), same as the rule adapter (spec: identically for both adapters)", async () => {
    const situationId = "Y1:p001::p002:1524";
    const { fetch } = extremeFetch({ [situationId]: 0.5, nothing: 0.5 });
    const maker = new JevDecisionMaker({ apiKey: "test", fetch });
    const batch = makeBatch(situationId, "p1", 1524, false);
    // An unrecognized socialClass on `self` forces the marriage-floor lookup to fall back.
    (batch.self as Record<string, unknown>).socialClass = "not-a-real-class";
    await maker.decideYear(batch);
    const stats = maker.getStats();
    expect(stats.hazardFallbacks).toBeDefined();
    expect(Object.keys(stats.hazardFallbacks!).length).toBeGreaterThan(0);
  });
});

describe("PR7: Jev's prompt never sees raw time-in-state numbers (design decision 3)", () => {
  it("replaces yearsMarriageable with a qualitative timeInState fact and a rare/uncommon/common baseRate label", async () => {
    const { fetch, calls } = fakeFetch();
    const maker = new JevDecisionMaker({ apiKey: "test", fetch });
    const situationId = "Y1:p001::p002:1524";
    const batch: PersonYearBatch = {
      personId: "p1",
      year: 1524,
      self: BASE_STATE,
      isProtagonist: false,
      situations: {
        [situationId]: {
          kind: "Y1",
          question: {
            id: situationId,
            kind: "Y1",
            personId: "p1",
            year: 1524,
            state: { self: BASE_STATE, situation: { code: "Y1", question: "Do I encourage it?", yearsMarriageable: 6 }, town: "Oakhaven", year: 1524 },
            options: ["encourage", "decline", "wait"],
          },
        },
      },
    };

    await maker.decideYear(batch);

    const body = calls[0]!.body as { state: { situations: Record<string, { situation: Record<string, unknown> }> } };
    const sentSituation = body.state.situations[situationId]!.situation;
    expect(sentSituation.yearsMarriageable).toBeUndefined();
    expect(typeof sentSituation.timeInState).toBe("string");
    expect(sentSituation.timeInState).toBe("long-standing");
    expect(["rare", "uncommon", "common"]).toContain(sentSituation.baseRate);
  });

  it("leaves a situation with no time-in-state field untouched (nothing to strip or annotate)", async () => {
    const { fetch, calls } = fakeFetch();
    const maker = new JevDecisionMaker({ apiKey: "test", fetch });
    await maker.decideYear(makeBatch("Y1:p001::p002:1524"));
    const body = calls[0]!.body as { state: { situations: Record<string, { situation: Record<string, unknown> }> } };
    const sentSituation = body.state.situations["Y1:p001::p002:1524"]!.situation;
    expect(sentSituation.timeInState).toBeUndefined();
    expect(sentSituation.baseRate).toBeUndefined();
  });
});

import { describe, expect, it } from "vitest";
import type { PersonYearBatch } from "@/domain/decisions";
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

/** Fake systemOne answers: one for every question name the request actually asked. */
function fakeAnswers(questionNames: readonly string[]): Record<string, unknown> {
  const answers: Record<string, unknown> = {};
  for (const name of questionNames) {
    if (name === "pick") answers[name] = { type: "choice", choice: "Y1:p001::p002:1524", confidence: 0.8, probabilities: { "Y1:p001::p002:1524": 0.6, nothing: 0.4 } };
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
    expect(result.selection["Y1:p001::p002:1524"]).toBeCloseTo(0.6);
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
});

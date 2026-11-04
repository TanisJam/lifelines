import { describe, expect, it } from "vitest";
import { initializeWorld } from "./world-initialization";
import { createFavorExecutor } from "./e-favor-executor";
import { planThreadHelpSlot } from "./e-thread-policy";
import { evolveThreadLedger } from "./e-thread-ledger";
import type { RuntimeEntry, RuntimeOutput } from "./e-runtime";

function fixture() {
  const { world } = initializeWorld({ seed: "verify-1", startYear: 1327, endYear: 1335, founderCount: 6 });
  const actors = Object.values(world.people).filter(p => p.birthYear < 1327 && p.deathYear === undefined && !p.away).map(p => p.id);
  const [creditor, debtor] = actors;
  const state: RuntimeOutput["state"] = { people: world.people, legacyEvents: world.events, events: [], grain: Object.fromEntries(actors.map(id => [id, 2])), assistance: Object.fromEntries(actors.map(id => [id, 1])), need: Object.fromEntries(actors.map(id => [id, 1])), obligations: [], ties: [], appraisals: [] };
  const entries: RuntimeEntry[] = [];
  createFavorExecutor(state, 1327, entries).executeGrant({ id: "grant", creditor, debtor, causes: [] }, 0);
  const threads = evolveThreadLedger([], entries, creditor, 1327, {}).threads;
  return { state, entries, threads, creditor, debtor };
}
function active(f: ReturnType<typeof fixture>, year: number) {
  for (let i = 0; i < 100; i++) {
    const request = planThreadHelpSlot(f.state, f.threads, `seed-${i}`, year, f.creditor, 0);
    if (request) return request;
  }
  return null;
}
describe("thread HELP maturity", () => {
  it.each([[1327, false], [1328, false], [1329, false], [1330, true], [1331, true]])("year %i permits response: %s", (year, allowed) => {
    const f = fixture(); expect(Boolean(active(f, year))).toBe(allowed);
  });
  it.each([[1328, false], [1329, false], [1330, true]])("thread-less grant at year %i permits response: %s", (year, allowed) => {
    const f = fixture();
    expect(Array.from({ length: 100 }, (_, i) => planThreadHelpSlot(f.state, [], `seed-${i}`, year, f.creditor, 0)).some(Boolean)).toBe(allowed);
  });
  it("does not force activation, or require protagonist thread membership", () => {
    const f = fixture();
    expect(Array.from({ length: 100 }, (_, i) => planThreadHelpSlot(f.state, [], `seed-${i}`, 1330, f.creditor, 0)).some(Boolean)).toBe(true);
    expect(Array.from({ length: 100 }, (_, i) => planThreadHelpSlot(f.state, f.threads, `seed-${i}`, 1330, f.creditor, 0)).some(x => x === null)).toBe(true);
  });
  it.each(["dead creditor", "dead debtor", "same-year death", "unborn", "absent", "closed thread", "no need", "no assistance", "already requested"])("skips %s without changing resources or payoff counts", reason => {
    const f = fixture();
    if (reason === "dead creditor") f.state.people[f.creditor].deathYear = 1329;
    if (reason === "dead debtor") f.state.people[f.debtor].deathYear = 1329;
    if (reason === "same-year death") f.state.people[f.debtor].deathYear = 1330;
    if (reason === "unborn") f.state.people[f.debtor] = { ...f.state.people[f.debtor], birthYear: 1331 };
    if (reason === "absent") f.state.people[f.debtor] = { ...f.state.people[f.debtor], away: true };
    if (reason === "closed thread") f.threads[0].status = "dead";
    if (reason === "no need") f.state.need = { ...f.state.need, [f.creditor]: 0 };
    if (reason === "no assistance") f.state.assistance = { ...f.state.assistance, [f.debtor]: 0 };
    if (reason === "already requested") {
      createFavorExecutor(f.state, 1328, f.entries).executeRequest({ id: "earlier", obligation: "grant/help", noise: 0.999 }, 0);
      f.state.obligations = f.state.obligations.map(item => ({ ...item, status: "open" as const }));
    }
    const before = structuredClone({ need: f.state.need, assistance: f.state.assistance, entries: f.entries });
    expect(active(f, 1330)).toBeNull();
    expect({ need: f.state.need, assistance: f.state.assistance, entries: f.entries }).toEqual(before);
  });
  it("records selected refusal as broken", () => {
    const f = fixture(); const request = active(f, 1330)!; expect(request).not.toBeNull();
    createFavorExecutor(f.state, 1330, f.entries, () => ({ source: "human", selected: "refuse" })).executeRequest(request, 0);
    expect(evolveThreadLedger(f.threads, f.entries.slice(1), f.creditor, 1330, {}).threads[0].status).toBe("broken");
  });
});

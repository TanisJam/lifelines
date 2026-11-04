import { describe, expect, it } from "vitest";
import { evolveThreadLedger } from "./e-thread-ledger";
import type { RuntimeEntry } from "./e-runtime";

const entry = (value: Partial<RuntimeEntry>): RuntimeEntry => ({ id: "grant", year: 1, position: 0, phase: "grants", declarationIndex: 0, kind: "grain-grant", actors: ["p", "q"], causes: [], effects: [{ kind: "grain", from: "p", to: "q", amount: 1 }, { kind: "obligation", id: "grant/help", creditor: "p", debtor: "q", origin: "grant", status: "open" }], consumed: undefined, outcome: "committed", ...value });
const grant = entry({});
const response = entry({ id: "request/response", year: 4, kind: "help-response", phase: "help", causes: ["grant", "request"], effects: [{ kind: "settlement", id: "grant/help", origin: "grant", creditor: "p", debtor: "q", status: "fulfilled" }, { kind: "assistance", from: "q", to: "p", amount: 1 }], authority: { source: "rules", selected: "help", baseline: "help", noise: 0 } });

describe("thread ledger", () => {
  it("opens only committed protagonist grants and retains exact facts", () => {
    const { threads, beats } = evolveThreadLedger([], [grant, entry({ id: "other", actors: ["x", "y"], effects: [{ kind: "grain", from: "x", to: "y", amount: 1 }, { kind: "obligation", id: "other/help", creditor: "x", debtor: "y", origin: "other", status: "open" }] }), entry({ id: "invalid", kind: "grant-ineligible", outcome: "ineligible" })], "p", 1, {});
    expect(threads).toHaveLength(1);
    expect(threads[0]).toMatchObject({ obligation: "grant/help", actors: ["p", "q"], setup: "grant", openedYear: 1, eligibleYear: 4, status: "open" });
    expect(beats[0]).toMatchObject({ kind: "setup", source: "grant", effects: grant.effects });
  });
  it("records only the matching committed response once, including refusal", () => {
    const opened = evolveThreadLedger([], [grant], "p", 1, {}).threads;
    const result = evolveThreadLedger(opened, [response, response], "p", 4, {});
    expect(result.threads[0]).toMatchObject({ status: "fulfilled", terminal: "request/response" });
    expect(result.beats).toHaveLength(1);
    expect(result.beats[0]).toMatchObject({ kind: "payoff", effects: response.effects, selected: "help" });
    const refused = entry({ ...response, effects: [{ kind: "settlement", id: "grant/help", origin: "grant", creditor: "p", debtor: "q", status: "broken" }], authority: { source: "rules", selected: "refuse", baseline: "refuse", noise: 0 } });
    const broken = evolveThreadLedger(opened, [refused, refused], "p", 4, {});
    expect(broken.threads[0].status).toBe("broken");
    expect(broken.beats).toHaveLength(1);
    expect(broken.beats[0].kind).toBe("payoff");
    expect(broken.beats[0].effects).toEqual(refused.effects);
    expect(broken.beats[0].selected).toBe("refuse");
    expect(evolveThreadLedger(opened, [], "p", 4, {}).threads[0].status).toBe("open");
  });
  it("closes on death, including the setup year, without payoff effects", () => {
    const result = evolveThreadLedger([], [grant], "p", 1, { q: { year: 1, id: "death-q" } });
    expect(result.threads[0].status).toBe("dead");
    expect(result.beats.map(beat => beat.kind)).toEqual(["setup", "death"]);
    expect(result.beats[1]).not.toHaveProperty("effects");
    expect(result.beats[1].source).toBe("death-q");
    const opened = evolveThreadLedger([], [grant], "p", 1, {}).threads;
    const sameYear = evolveThreadLedger(opened, [response], "p", 4, { q: { year: 4, id: "death-q" } });
    expect(sameYear.threads[0].status).toBe("dead");
    expect(sameYear.beats.map(beat => beat.kind)).toEqual(["death"]);
    expect(sameYear.beats[0]).not.toHaveProperty("effects");
  });
});

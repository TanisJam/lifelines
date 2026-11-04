import { describe, expect, it } from "vitest";
import { renderThreadFavorBeat } from "./e-favor-templates";
import type { ThreadBeat } from "./e-thread-ledger";

const names = [{ id: "p", name: "Álvaro de León" }, { id: "q", name: "李 小明" }];
const setup: ThreadBeat = { kind: "setup", thread: "help/g/help", source: "g", year: 1, actors: ["p", "q"], causes: [], effects: [
  { kind: "grain", from: "p", to: "q", amount: 1 },
  { kind: "obligation", id: "g/help", origin: "g", creditor: "p", debtor: "q", status: "open" },
] };
const payoff = (selected: "help" | "refuse"): ThreadBeat => ({ kind: "payoff", thread: "help/g/help", source: "r/response", year: 4, actors: ["p", "q"], causes: ["g", "r"], selected, effects: [
  { kind: "settlement", id: "g/help", origin: "g", creditor: "p", debtor: "q", status: selected === "help" ? "fulfilled" : "broken" },
  ...(selected === "help" ? [{ kind: "assistance" as const, from: "q", to: "p", amount: 1 as const }] : []),
] });

describe("thread favor text", () => {
  it.each(["en", "es"] as const)("renders exact setup and actual outcomes in %s with names and direction", locale => {
    const grant = renderThreadFavorBeat(setup, names, locale);
    const help = renderThreadFavorBeat(payoff("help"), names, locale);
    const refusal = renderThreadFavorBeat(payoff("refuse"), names, locale);
    expect(grant).toContain("Álvaro de León [p]");
    expect(grant).toContain("李 小明 [q]");
    expect(help).toContain("李 小明 [q] → Álvaro de León [p]");
    expect(refusal).toContain("李 小明 [q] → Álvaro de León [p]");
    expect(help).toContain(locale === "en" ? "fulfilled" : "cumplida");
    expect(refusal).toContain(locale === "en" ? "broken" : "incumplida");
    expect(help).toContain(locale === "en" ? "obligation from the earlier grain grant" : "obligación de la entrega anterior de grano");
    expect(refusal).toContain(locale === "en" ? "obligation from the earlier grain grant" : "obligación de la entrega anterior de grano");
    expect(help + refusal).not.toMatch(/repay|repaid|hatred|devolver|odio/i);
  });
  it("rejects unsupported, missing and contradictory facts", () => {
    for (const beat of [ { ...setup, kind: "death" }, { ...setup, effects: [] }, { ...payoff("help"), selected: "refuse" }, { ...payoff("help"), causes: ["other"] }, { ...setup, thread: "wrong" }, { ...setup, actors: ["p", "p"] } ]) {
      expect(() => renderThreadFavorBeat(beat as ThreadBeat, names, "en")).toThrow();
    }
    expect(() => renderThreadFavorBeat(setup, names.slice(0, 1), "en")).toThrow();
    expect(() => renderThreadFavorBeat(setup, names, "fr" as "en")).toThrow();
  });
});

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
  it.each([
    ["en", "Álvaro de León [p] transferred 1 unit of grain to 李 小明 [q]. An open help obligation was recorded.", "李 小明 [q] → Álvaro de León [p]. Recorded help response: help. The help obligation was recorded as fulfilled; 1 unit of assistance was recorded. This response concerned the obligation from the earlier grain grant.", "李 小明 [q] → Álvaro de León [p]. Recorded help response: refuse. The help obligation was recorded as broken. This response concerned the obligation from the earlier grain grant."],
    ["es", "Álvaro de León [p] transfirió 1 unidad de grano a 李 小明 [q]. Se registró una obligación de ayuda abierta.", "李 小明 [q] → Álvaro de León [p]. Respuesta de ayuda registrada: ayuda. La obligación de ayuda quedó registrada como cumplida; se registró 1 unidad de asistencia. Esta respuesta correspondió a la obligación de la entrega anterior de grano.", "李 小明 [q] → Álvaro de León [p]. Respuesta de ayuda registrada: rechazo. La obligación de ayuda quedó registrada como incumplida. Esta respuesta correspondió a la obligación de la entrega anterior de grano."],
  ] as const)("renders full recorded strings in %s", (locale, grant, help, refusal) => {
    expect(renderThreadFavorBeat(setup, names, locale)).toBe(grant);
    expect(renderThreadFavorBeat(payoff("help"), names, locale)).toBe(help);
    expect(renderThreadFavorBeat(payoff("refuse"), names, locale)).toBe(refusal);
  });

  it("rejects a death beat even with valid payoff facts", () => {
    expect(() => renderThreadFavorBeat({ ...payoff("help"), kind: "death" } as ThreadBeat, names, "en")).toThrow();
  });

  it.each([
    ["reversed grain", { ...setup, effects: [{ kind: "grain", from: "q", to: "p", amount: 1 }, setup.effects![1]] }],
    ["wrong grain amount", { ...setup, effects: [{ kind: "grain", from: "p", to: "q", amount: 2 }, setup.effects![1]] }],
    ["wrong obligation status", { ...setup, effects: [setup.effects![0], { ...setup.effects![1], status: "fulfilled" }] }],
    ["reversed obligation", { ...setup, effects: [setup.effects![0], { ...setup.effects![1], creditor: "q", debtor: "p" }] }],
    ["extra grant fact", { ...setup, effects: [...setup.effects!, setup.effects![0]] }],
    ["setup carrying a response", { ...setup, selected: "help" }],
    ["wrong settlement status", { ...payoff("help"), effects: [{ ...payoff("help").effects![0], status: "broken" }, payoff("help").effects![1]] }],
    ["swapped settlement parties", { ...payoff("help"), effects: [{ ...payoff("help").effects![0], creditor: "q", debtor: "p" }, payoff("help").effects![1]] }],
    ["reversed assistance", { ...payoff("help"), effects: [payoff("help").effects![0], { kind: "assistance", from: "p", to: "q", amount: 1 }] }],
    ["refusal carrying assistance", { ...payoff("refuse"), effects: [...payoff("refuse").effects!, { kind: "assistance", from: "q", to: "p", amount: 1 }] }],
  ])("rejects %s", (_description, beat) => {
    expect(() => renderThreadFavorBeat(beat as ThreadBeat, names, "en")).toThrow();
  });

  it("rejects an empty name", () => {
    expect(() => renderThreadFavorBeat(setup, [{ id: "p", name: "" }, names[1]], "en")).toThrow();
  });

  it("rejects duplicate identity ids", () => {
    expect(() => renderThreadFavorBeat(setup, [...names, names[0]], "en")).toThrow();
  });
  it("rejects unsupported, missing and contradictory facts", () => {
    for (const beat of [ { ...setup, kind: "death" }, { ...setup, effects: [] }, { ...payoff("help"), selected: "refuse" }, { ...payoff("help"), causes: ["other"] }, { ...setup, thread: "wrong" }, { ...setup, actors: ["p", "p"] } ]) {
      expect(() => renderThreadFavorBeat(beat as ThreadBeat, names, "en")).toThrow();
    }
    expect(() => renderThreadFavorBeat(setup, names.slice(0, 1), "en")).toThrow();
    expect(() => renderThreadFavorBeat(setup, names, "fr" as "en")).toThrow();
  });
});

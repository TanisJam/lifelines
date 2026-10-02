import { describe, expect, it } from "vitest";
import { createHelpObligation } from "./obligations";

describe("objective help obligation", () => {
  it("records parties and origin without promising grain repayment", () => {
    expect(createHelpObligation("o", "debtor", "creditor", "event")).toEqual({
      id: "o", kind: "HELP", debtor: "debtor", creditor: "creditor", origin: "event", status: "open",
    });
  });
  it.each([["", "d", "c", "e"], ["o", "d", "d", "e"], ["o", "d", "c", ""]])("rejects invalid identities %j", (...args) => {
    expect(() => createHelpObligation(...args as [string, string, string, string])).toThrow();
  });
});

import { describe, expect, it, vi } from "vitest";
import { admitLifecycleChoice, LIFECYCLE_CHOICE_VERSION } from "./e-lifecycle-choice";

const input = { version: LIFECYCLE_CHOICE_VERSION, decisionId: "Y1:alice#1.1", optionId: "accept", year: 1500 };
const target = { id: "Y1:alice#1.1", kind: "Y1", personId: "alice", year: 1500, chosen: "decline", options: [{ id: "accept" }, { id: "decline" }] };

class Declaration {
  version = LIFECYCLE_CHOICE_VERSION;
  decisionId = input.decisionId;
  optionId = input.optionId;
  year = input.year;
}
const MISMATCH = "Lifecycle choice does not match target";
const VALUES = "Invalid lifecycle choice declaration values";
const FIELDS = "Unknown lifecycle choice declaration fields";

describe("lifecycle choice admission", () => {
  it("returns a closed immutable copy bound to the exact target", () => {
    const declaration = { ...input };
    const admitted = admitLifecycleChoice(declaration, target);
    declaration.optionId = "decline";
    expect(admitted).toEqual(input);
    expect(Object.isFrozen(admitted)).toBe(true);
  });
  it.each([
    ["wrong ID", { ...input, decisionId: "Y1:alice#1.2" }, target, MISMATCH],
    ["wrong subject", input, { ...target, personId: "bob" }, MISMATCH],
    ["wrong kind", input, { ...target, kind: "A1" }, MISMATCH],
    ["same choice", { ...input, optionId: "decline" }, target, MISMATCH],
    ["wrong option", { ...input, optionId: "missing" }, target, MISMATCH],
    ["wrong year", { ...input, year: 1501 }, target, MISMATCH],
    ["invalid year", { ...input, year: 1.5 }, { ...target, year: 1.5 }, VALUES],
    ["empty ID", { ...input, decisionId: "" }, { ...target, id: "" }, VALUES],
    ["empty option", { ...input, optionId: "" }, { ...target, options: [{ id: "" }] }, VALUES],
    ["unknown field", { ...input, override: true }, target, FIELDS],
    ["missing field", { version: input.version, decisionId: input.decisionId, optionId: input.optionId }, target, FIELDS],
    ["unknown version", { ...input, version: "v2" }, target, VALUES],
    ["null declaration", null, target, "Invalid lifecycle choice declaration"],
    ["inherited fields", Object.create(input), target, "Invalid lifecycle choice declaration prototype"],
    ["class instance", new Declaration(), target, "Invalid lifecycle choice declaration prototype"],
  ])("refuses %s", (_name, declaration, record, message) => {
    expect(() => admitLifecycleChoice(declaration, record)).toThrow(message);
  });
  it("refuses accessors without evaluating them", () => {
    const getter = vi.fn(() => input.decisionId);
    const declaration = Object.defineProperty({ ...input }, "decisionId", { get: getter });
    expect(() => admitLifecycleChoice(declaration, target)).toThrow();
    expect(getter).not.toHaveBeenCalled();
  });
});

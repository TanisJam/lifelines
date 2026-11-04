import { candidateMatchesSubject, decisionSubject } from "./decision-id";
import type { DecisionRecord } from "./decisions";

/** A fork choice is distinct from the authority-free rules source declaration. */
export const LIFECYCLE_CHOICE_VERSION = "lifecycle-native-choice/v1";

export interface LifecycleChoiceDeclaration {
  readonly version: typeof LIFECYCLE_CHOICE_VERSION;
  readonly decisionId: string;
  readonly optionId: string;
  readonly year: number;
}

/** Evidence to be produced by the execution adapter, not by declaration admission. */
export interface LifecycleChoiceAppliedEvidence {
  readonly decisionId: string;
  readonly optionId: string;
  readonly year: number;
  readonly appliedCount: 1;
}

type Target = Pick<DecisionRecord, "id" | "kind" | "personId" | "partnerId" | "year" | "chosen"> & {
  readonly options: readonly { readonly id: string }[];
};

/** Admit data against an exposed native decision; the caller owns the trusted target. */
export function admitLifecycleChoice(input: unknown, target: Target): LifecycleChoiceDeclaration {
  if (input === null || typeof input !== "object") throw new Error("Invalid lifecycle choice declaration");
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) throw new Error("Invalid lifecycle choice declaration prototype");
  const keys = Reflect.ownKeys(input);
  const expected = ["version", "decisionId", "optionId", "year"];
  if (keys.length !== expected.length || keys.some((key) => typeof key !== "string" || !expected.includes(key))) {
    throw new Error("Unknown lifecycle choice declaration fields");
  }
  const fields = expected.map((key) => Object.getOwnPropertyDescriptor(input, key));
  if (fields.some((field) => !field || !("value" in field))) throw new Error("Lifecycle choice accessors are not allowed");
  const [version, decisionId, optionId, year] = fields.map((field) => field!.value);
  if (version !== LIFECYCLE_CHOICE_VERSION || typeof decisionId !== "string" || !decisionId ||
      typeof optionId !== "string" || !optionId || !Number.isSafeInteger(year)) {
    throw new Error("Invalid lifecycle choice declaration values");
  }
  const subject = decisionSubject(decisionId);
  if (decisionId !== target.id || year !== target.year || subject.kind !== target.kind || !subject.subject ||
      !candidateMatchesSubject(subject.subject, target.personId, target.partnerId) ||
      (target.chosen === optionId) || !target.options.some((option) => option.id === optionId)) {
    throw new Error("Lifecycle choice does not match target");
  }
  return Object.freeze({ version: LIFECYCLE_CHOICE_VERSION, decisionId, optionId, year });
}

/** B-only objective commitment; no repayment asset, scheduling or inferred motive. */
export interface HelpObligation {
  id: string;
  kind: "HELP";
  debtor: string;
  creditor: string;
  origin: string;
  status: "open";
}

export function requireId(value: unknown): asserts value is string {
  if (typeof value !== "string" || value.length === 0) throw new Error("Expected nonempty identity");
}

export function requireInteger(value: unknown, min: number, max = Number.MAX_SAFE_INTEGER): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) throw new Error("Integer out of range");
}

/** Call only after checking own-data descriptors, so field reads cannot invoke code. */
export function requireFields(value: object, fields: readonly string[]): void {
  const keys = Object.keys(value);
  if (keys.length !== fields.length || keys.some((key) => !fields.includes(key))) throw new Error("Unexpected fields");
  if (fields.some((key) => !Object.hasOwn(value, key))) throw new Error("Missing field");
}

export function createHelpObligation(id: string, debtor: string, creditor: string, origin: string): HelpObligation {
  for (const value of [id, debtor, creditor, origin]) requireId(value);
  if (debtor === creditor) throw new Error("Self obligation");
  return { id, kind: "HELP", debtor, creditor, origin, status: "open" };
}

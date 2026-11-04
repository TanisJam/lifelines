import { canonicalLifecycleDataEqual } from "./e-lifecycle-genesis";
import type { LifecycleState } from "./e-lifecycle-runtime";

type Value = unknown;
type Patch = { kind: "replace"; value: Value } | { kind: "object"; keys: string[]; changes: Record<string, Patch> } | { kind: "array"; length: number; keys: string[]; changes: Record<string, Patch> };
type StateInput = { readonly owned: unknown; readonly favors: unknown };
interface EncodedState { owned: Record<string, unknown>; favors: Record<string, unknown> }
interface Delta { patch: Patch | null; life: unknown[]; decisions: unknown[]; economic: unknown[] }
export interface LifecycleDeltaJournal {
  readonly version: "lifecycle-delta-1";
  readonly base: EncodedState;
  readonly baseLife: unknown[];
  readonly baseDecisions: unknown[];
  readonly baseEconomic: unknown[];
  readonly years: readonly Delta[];
}

function freeze<T>(value: T, seen = new Set<object>()): T {
  if (value !== null && typeof value === "object" && !seen.has(value)) {
    seen.add(value);
    for (const child of Object.values(value)) freeze(child, seen);
    Object.freeze(value);
  }
  return value;
}
function split(input: StateInput) {
  const state = input as LifecycleState;
  if (state.favors.people !== state.owned.people || state.favors.legacyEvents !== state.owned.events) throw new Error("Lifecycle state alias disagreement");
  const { events: life, decisions, ...owned } = state.owned;
  const { people: _people, legacyEvents: _legacyEvents, events: economic, ...favors } = state.favors;
  return { state: { owned, favors }, life, decisions, economic };
}
function difference(before: Value, after: Value): Patch | null {
  if (Object.is(before, after)) return null;
  if (before === null || after === null || typeof before !== "object" || typeof after !== "object" || Array.isArray(before) !== Array.isArray(after)) return { kind: "replace", value: structuredClone(after) };
  const old = before as Record<string, unknown>, next = after as Record<string, unknown>;
  const oldKeys = Object.keys(old), keys = Object.keys(next);
  const changes: Record<string, Patch> = Object.create(null);
  for (const key of keys) {
    const patch = Object.hasOwn(old, key) ? difference(old[key], next[key]) : { kind: "replace" as const, value: structuredClone(next[key]) };
    if (patch) Object.defineProperty(changes, key, { value: patch, enumerable: true });
  }
  const orderChanged = oldKeys.length !== keys.length || oldKeys.some((key, i) => key !== keys[i]);
  if (Object.keys(changes).length === 0 && !orderChanged && (!Array.isArray(after) || after.length === (before as unknown[]).length)) return null;
  return Array.isArray(after) ? { kind: "array", length: after.length, keys, changes } : { kind: "object", keys, changes };
}
function apply(before: Value, patch: Patch | null): Value {
  if (!patch) return before;
  if (patch.kind === "replace") return structuredClone(patch.value);
  const old = before as Record<string, unknown>;
  if (patch.kind === "array") {
    const result = new Array(patch.length);
    for (const key of patch.keys) Object.defineProperty(result, key, { value: apply(old[key], patch.changes[key] ?? null), enumerable: true, writable: true, configurable: true });
    return result;
  }
  const result: Record<string, unknown> = {};
  for (const key of patch.keys) Object.defineProperty(result, key, { value: apply(old[key], patch.changes[key] ?? null), enumerable: true, writable: true, configurable: true });
  return result;
}
function suffix(before: readonly unknown[], after: readonly unknown[]): unknown[] {
  if (after.length < before.length || before.some((value, index) => !canonicalLifecycleDataEqual(value, after[index]))) throw new Error("Lifecycle append-only history changed");
  return structuredClone(after.slice(before.length));
}
export function createLifecycleDeltaJournal(initial: StateInput): LifecycleDeltaJournal {
  const initialParts = split(initial);
  return freeze({ version: "lifecycle-delta-1" as const, base: structuredClone(initialParts.state), baseLife: structuredClone(initialParts.life), baseDecisions: structuredClone(initialParts.decisions), baseEconomic: structuredClone(initialParts.economic), years: [] });
}
export function appendLifecycleDelta(journal: LifecycleDeltaJournal, before: StateInput, after: StateInput): LifecycleDeltaJournal {
  const left = split(before), right = split(after);
  const delta = { patch: difference(left.state, right.state), life: suffix(left.life, right.life), decisions: suffix(left.decisions, right.decisions), economic: suffix(left.economic, right.economic) };
  return freeze({ ...journal, years: [...journal.years, delta] });
}
export function reconstructLifecycleDelta(journal: LifecycleDeltaJournal, yearIndex: number): LifecycleState {
  if (!Number.isSafeInteger(yearIndex) || yearIndex < 0 || yearIndex >= journal.years.length) throw new Error("Invalid lifecycle delta year");
  let state: EncodedState = structuredClone(journal.base);
  const life = structuredClone(journal.baseLife), decisions = structuredClone(journal.baseDecisions), economic = structuredClone(journal.baseEconomic);
  for (const delta of journal.years.slice(0, yearIndex + 1)) {
    state = apply(state, delta.patch) as EncodedState;
    life.push(...structuredClone(delta.life)); decisions.push(...structuredClone(delta.decisions)); economic.push(...structuredClone(delta.economic));
  }
  const owned: Record<string, unknown> = { ...state.owned, events: life, decisions };
  const favors = { people: owned.people, legacyEvents: life, events: economic, ...state.favors };
  return freeze({ owned, favors }) as unknown as LifecycleState;
}

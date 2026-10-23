import { describe, expect, it } from "vitest";
import { createMind } from "@/domain/mind";
import type { SimulationResult, YearSnapshot } from "@/domain/types";
import { assertCompletedLife } from "./completed-life";

function completed() {
  const result: { -readonly [K in keyof SimulationResult]: SimulationResult[K] } = {
    config: { seed: "completed", startYear: 1327, endYear: 1427, town: { name: "Testford" } },
    people: { protagonist: { id: "protagonist", name: "Testa", sex: "f", birthYear: 1327, deathYear: 1328, traits: [], job: "none", founder: false, mind: createMind("completed", "protagonist", 1327) } },
    events: [{ id: "death", kind: "death", year: 1328, actors: ["protagonist"], causes: [], payload: {} }],
    decisions: [],
  };
  const snapshot: YearSnapshot = { year: 1328, people: result.people, events: result.events, decisions: [] };
  return { result, snapshots: new Map([[1328, snapshot]]) };
}

describe("completed-life admission", () => {
  it("admits recorded death, including a quiet final year", () => {
    const { result, snapshots } = completed();
    expect(() => assertCompletedLife(result, snapshots)).not.toThrow();
  });

  it.each([undefined, NaN, Infinity, 1328.5, Number.MAX_SAFE_INTEGER + 1, 1326, 1428])("rejects an absent or unsafe death year %s", (deathYear) => {
    const { result, snapshots } = completed();
    result.people.protagonist!.deathYear = deathYear;
    expect(() => assertCompletedLife(result, snapshots)).toThrow();
  });

  it.each(["missing", "different-year", "other-person", "duplicate"])("rejects %s canonical death", (kind) => {
    const { result, snapshots } = completed();
    if (kind === "missing") result.events = [];
    if (kind === "different-year") result.events = [{ ...result.events[0]!, year: 1327 }];
    if (kind === "other-person") result.events = [{ ...result.events[0]!, actors: ["npc", "protagonist"] }];
    if (kind === "duplicate") result.events = [...result.events, { ...result.events[0]!, id: "second-death" }];
    expect(() => assertCompletedLife(result, snapshots)).toThrow();
  });

  it.each(["missing-final", "later-tick", "wrong-key", "alive-final", "missing-final-death", "later-event", "unsafe-event", "unsafe-birth", "later-final-event", "later-decision", "future-snapshot-event", "premature-death"])("rejects %s frontier inconsistency", (kind) => {
    const { result, snapshots } = completed();
    const final = snapshots.get(1328)!;
    if (kind === "missing-final") snapshots.clear();
    if (kind === "later-tick") snapshots.set(1329, { ...final, year: 1329 });
    if (kind === "wrong-key") snapshots.set(1327, final);
    if (kind === "alive-final") snapshots.set(1328, { ...final, people: { protagonist: { ...result.people.protagonist!, deathYear: undefined } } });
    if (kind === "missing-final-death") snapshots.set(1328, { ...final, events: [] });
    if (kind === "later-event") result.events = [...result.events, { ...result.events[0]!, id: "late", kind: "vignette", year: 1329 }];
    if (kind === "unsafe-event") result.events = [...result.events, { ...result.events[0]!, id: "invalid", kind: "vignette", year: NaN }];
    if (kind === "unsafe-birth") result.people = { protagonist: { ...result.people.protagonist!, birthYear: NaN } };
    if (kind === "later-final-event") snapshots.set(1328, { ...final, events: [...final.events, { ...result.events[0]!, id: "late", kind: "vignette", year: 1329 }] });
    if (kind === "later-decision") result.decisions = [{ year: 1329 } as SimulationResult["decisions"][number]];
    if (kind === "future-snapshot-event") snapshots.set(1327, { ...final, year: 1327, people: { protagonist: { ...result.people.protagonist!, deathYear: undefined } } });
    if (kind === "premature-death") snapshots.set(1327, { ...final, year: 1327, events: [] });
    expect(() => assertCompletedLife(result, snapshots)).toThrow();
  });
});

import { describe, expect, it, vi } from "vitest";
import { createAnnualRuntime, type AnnualPlan, type Newcomer, type RuntimeOutput } from "./e-runtime";
import { selectHistoricalEvidence } from "./e-selection";
import { initializeWorld } from "./world-initialization";

const initialization = { seed: "verify-1", startYear: 1327, endYear: 1335, founderCount: 6 };
function quiet(year: number): AnnualPlan { return { year, physical: [], resources: [], grants: [], requests: [] }; }
function fixture() {
  const { world } = initializeWorld(initialization);
  const actors = Object.values(world.people).filter(p => p.birthYear < 1327 && p.deathYear === undefined && !p.away);
  const [creditor, debtor] = actors.map(p => p.id);
  const resources = Object.fromEntries(Object.keys(world.people).map(id => [id, { grain: 2, effort: 1, need: 1 }]));
  const runtime = createAnnualRuntime(initialization, resources);
  const history = [runtime.initial, runtime.advance({ ...quiet(1327), grants: [{ id: "grant", creditor, debtor, causes: [] }] })];
  return { runtime, history, creditor, debtor };
}

describe("internal historical E evidence", () => {
  it("selects the exact retained frontier, not a final state", () => {
    const { history, creditor } = fixture();
    const output = selectHistoricalEvidence({ history, subjectActorID: creditor, asOfYear: 1327 });
    expect(output.beats.map(b => b.id)).toEqual(["grant"]);
    expect(output.subject.id).toBe(creditor);
  });

  it("is byte-identical after valid future death, residence and actor introductions", () => {
    const { runtime, history, creditor, debtor } = fixture();
    const input = { history, subjectActorID: creditor, asOfYear: 1327 };
    const before = selectHistoricalEvidence(input);
    const p = runtime.initial.state.people[debtor];
    const person: Newcomer = { id: "future", name: "FUTURE NAME", sex: p.sex, birthYear: 1329,
      traits: [...p.traits], job: p.job, mind: structuredClone(p.mind) as Newcomer["mind"] };
    history.push(runtime.advance({ ...quiet(1329), physical: [
      { id: "death", kind: "death", actor: creditor, causes: [] },
      { id: "away", kind: "residence", actor: debtor, status: "away", causes: [] },
      { id: "future-create", kind: "create", person, causes: [] },
    ] }));
    expect(selectHistoricalEvidence(input)).toEqual(before);
    expect(JSON.stringify(selectHistoricalEvidence(input))).toBe(JSON.stringify(before));
    expect(JSON.stringify(before)).not.toMatch(/FUTURE NAME|mind|consumed|facets|thoughts/);
    expect(() => selectHistoricalEvidence({ history, subjectActorID: "future", asOfYear: 1327 })).toThrow();
  });

  it.each([0, 0.999])("records settlement and transfers, with hidden transitive causes (noise %s)", noise => {
    const { runtime, history, creditor } = fixture();
    history.push(runtime.advance({ ...quiet(1328), requests: [{ id: "request", obligation: "grant/help", noise }] }));
    const output = selectHistoricalEvidence({ history, subjectActorID: creditor, asOfYear: 1328 });
    expect(output.beats.map(b => b.id)).toEqual(["grant", "request/response"]);
    expect(output.evidence.map(e => e.id)).toEqual(["grant", "request", "request/response"]);
    const response = output.beats[1];
    expect(response.response).toBe(noise === 0 ? "help" : "refuse");
    expect(response.facts).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "settlement", status: noise === 0 ? "fulfilled" : "broken" })]));
    expect(response.facts.some(f => f.kind === "assistance")).toBe(noise === 0);
    expect(output.beats[0].facts).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "grain", amount: 1 })]));
  });

  it.each(["constructor", "toString", "hasOwnProperty", "__proto__"])("keeps historical introductions and physical/origin causes for %s", id => {
    const { runtime, history, creditor, debtor } = fixture();
    const p = runtime.initial.state.people[debtor];
    const origin = runtime.initial.origin.initial.events.find(e => e.year <= 1327)!;
    const person: Newcomer = { id, name: runtime.initial.state.people[creditor].name, sex: p.sex,
      birthYear: 1327, traits: [...p.traits], job: p.job, mind: structuredClone(p.mind) as Newcomer["mind"] };
    const first = runtime.advance({ ...quiet(1328), physical: [{ id: "create", kind: "create", person, causes: [origin.id] }],
      resources: [{ id: "allocate", kind: "allocate", actor: id, causes: ["create"], allocation: { grain: 0, effort: 1, need: 1 } }],
      grants: [{ id: "new-grant", creditor, debtor: id, causes: ["allocate", "create"] }] });
    history.push(first);
    const output = selectHistoricalEvidence({ history, subjectActorID: id, asOfYear: 1328 });
    expect(output.subject).toEqual({ id, name: person.name });
    expect(output.evidence.map(e => e.id)).toEqual(expect.arrayContaining([origin.id, "create", "allocate", "new-grant"]));
    expect(output.evidence.filter(e => e.id === "create")).toHaveLength(1);
    expect(output.evidence.find(e => e.id === "create")!.facts).toEqual([{ kind: "creation", actor: id, birthYear: 1327 }]);
  });

  it("returns empty beats for quiet/unrelated subjects and permits executed year gaps", () => {
    const { runtime, history, creditor, debtor } = fixture();
    history.push(runtime.advance(quiet(1330)));
    const other = Object.keys(runtime.initial.state.people).find(id => id !== creditor && id !== debtor)!;
    expect(selectHistoricalEvidence({ history, subjectActorID: other, asOfYear: 1330 }).beats).toEqual([]);
    for (const asOfYear of [1326, 1328, 1329, 1331, 1327.5, -0, NaN, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => selectHistoricalEvidence({ history, subjectActorID: creditor, asOfYear })).toThrow();
    }
    expect(selectHistoricalEvidence({ history, subjectActorID: creditor, asOfYear: 1330 }).beats).toHaveLength(1);
    const quietRuntime = createAnnualRuntime(initialization, runtime.initial.genesis.resources);
    expect(selectHistoricalEvidence({ history: [quietRuntime.initial, quietRuntime.advance(quiet(1327))],
      subjectActorID: creditor, asOfYear: 1327 }).evidence).toEqual([]);
  });

  it("never relabels ineligibility as a refusal", () => {
    const { runtime, history, creditor, debtor } = fixture();
    history.push(runtime.advance({ ...quiet(1328), physical: [{ id: "away", kind: "residence", actor: debtor, status: "away", causes: [] }],
      grants: [{ id: "unavailable-grant", creditor, debtor, causes: ["away"] }],
      requests: [{ id: "unavailable-request", obligation: "grant/help", noise: 0 }] }));
    const output = selectHistoricalEvidence({ history, subjectActorID: creditor, asOfYear: 1328 });
    expect(output.beats.map(b => b.id)).toEqual(["grant"]);
    expect(output.evidence.map(e => e.id)).toEqual(["grant"]);
    expect(output.beats.some(b => b.response === "refuse")).toBe(false);
  });

  it("rejects missing roots, checkpoint omission, duplication and reordering", () => {
    const { runtime, history, creditor } = fixture();
    history.push(runtime.advance(quiet(1329)), runtime.advance(quiet(1330)));
    for (const candidate of [history.slice(1), [history[0], history[2]], [history[0], history[1], history[3]],
      [history[0], history[2], history[1]], [history[0], history[1], history[1]]]) {
      expect(() => selectHistoricalEvidence({ history: candidate, subjectActorID: creditor, asOfYear: 1327 })).toThrow();
    }
    expect(() => selectHistoricalEvidence({ history, subjectActorID: "missing", asOfYear: 1327 })).toThrow();
  });

  it("rejects semantically valid but disagreeing initial resources, origins and accumulated prefixes", () => {
    const { runtime, history, creditor, debtor } = fixture();
    const different = createAnnualRuntime(initialization, Object.fromEntries(Object.keys(runtime.initial.state.people)
      .map(id => [id, { grain: 3, effort: 1, need: 1 }])));
    expect(() => selectHistoricalEvidence({ history: [different.initial, history[1]], subjectActorID: creditor, asOfYear: 1327 })).toThrow();
    const otherInitialization = { ...initialization, seed: "other-origin" };
    const otherWorld = initializeWorld(otherInitialization).world;
    const otherOrigin = createAnnualRuntime(otherInitialization, Object.fromEntries(Object.keys(otherWorld.people)
      .map(id => [id, { grain: 2, effort: 1, need: 1 }])));
    expect(() => selectHistoricalEvidence({ history: [otherOrigin.initial, history[1]], subjectActorID: creditor, asOfYear: 1327 })).toThrow();
    const alternate = createAnnualRuntime(initialization, runtime.initial.genesis.resources);
    alternate.advance({ ...quiet(1327), grants: [{ id: "different-grant", creditor, debtor, causes: [] }] });
    expect(() => selectHistoricalEvidence({ history: [...history, alternate.advance(quiet(1328))], subjectActorID: creditor, asOfYear: 1327 })).toThrow();
  });

  it.each(["version", "state", "missing", "forward", "cycle", "effects", "shape"])("rejects tampered %s evidence", mode => {
    const { history, creditor } = fixture();
    const candidate = structuredClone(history as unknown) as RuntimeOutput[];
    const entry = candidate[1].journal[0].entries[0];
    if (mode === "version") Reflect.set(candidate[1], "version", "unsupported");
    if (mode === "state") Reflect.set(candidate[1].state.people[creditor], "name", "forged");
    if (mode === "missing") entry.causes = ["missing"];
    if (mode === "forward" || mode === "cycle") entry.causes = [entry.id];
    if (mode === "effects") entry.effects = [];
    if (mode === "shape") Reflect.set(entry, "unknown", true);
    expect(() => selectHistoricalEvidence({ history: candidate, subjectActorID: creditor, asOfYear: 1327 })).toThrow();
  });

  it("explicitly rejects human histories, even when selecting an older rules checkpoint", () => {
    const { runtime, history, creditor } = fixture();
    const human = createAnnualRuntime(initialization, runtime.initial.genesis.resources, () => ({ source: "human", selected: "help" }));
    human.advance(history[1].journal[0].plan);
    const future = human.advance({ ...quiet(1328), requests: [{ id: "request", obligation: "grant/help", noise: 0 }] });
    expect(() => selectHistoricalEvidence({ history: [...history, future], subjectActorID: creditor, asOfYear: 1327 })).toThrow(/Human authority/);
  });

  it("guards descriptors before hooks and rejects open/executable containers", () => {
    const { history, creditor } = fixture();
    const hook = vi.fn(() => history);
    const getter = { subjectActorID: creditor, asOfYear: 1327 };
    Object.defineProperty(getter, "history", { get: hook, enumerable: true });
    expect(() => selectHistoricalEvidence(getter)).toThrow();
    const nested = structuredClone(history);
    Object.defineProperty(nested[1].state.people[creditor], "name", { get: hook, enumerable: true });
    expect(() => selectHistoricalEvidence({ history: nested, subjectActorID: creditor, asOfYear: 1327 })).toThrow();
    expect(hook).not.toHaveBeenCalled();
    for (const extra of [() => 1, new Date(), undefined]) {
      expect(() => selectHistoricalEvidence({ history, subjectActorID: creditor, asOfYear: 1327, extra })).toThrow();
    }
  });

  it("is detached, deeply frozen and preserves source generated negative zero without exporting Mind", () => {
    const { history, creditor } = fixture();
    const borrowed = structuredClone(history);
    const before = structuredClone(borrowed);
    const output = selectHistoricalEvidence({ history: borrowed, subjectActorID: creditor, asOfYear: 1327 });
    function frozen(value: unknown): void {
      if (value !== null && typeof value === "object") {
        expect(Object.isFrozen(value)).toBe(true);
        Object.values(value).forEach(frozen);
      }
    }
    frozen(output);
    expect(borrowed).toEqual(before);
    expect(output.subject).not.toBe(borrowed[1].state.people[creditor]);
    Reflect.set(borrowed[1].state.people[creditor], "name", "changed later");
    expect(output.subject.name).toBe(before[0].state.people[creditor].name);
    expect(() => Reflect.set(output.subject, "name", "change")).not.toThrow();
    expect(output.subject.name).toBe(before[0].state.people[creditor].name);
    function negativeZeros(value: unknown): number {
      if (typeof value === "number") return Object.is(value, -0) ? 1 : 0;
      return value !== null && typeof value === "object" ? Object.values(value).reduce<number>((n, v) => n + negativeZeros(v), 0) : 0;
    }
    expect(negativeZeros(before)).toBeGreaterThan(0);
  });
});

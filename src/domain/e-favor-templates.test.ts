import { describe, expect, it, vi } from "vitest";
import { createAnnualRuntime, type AnnualPlan, type Newcomer, type RuntimeOutput } from "./e-runtime";
import { selectHistoricalEvidence } from "./e-selection";
import { renderHistoricalFavorTemplates, FAVOR_TEMPLATE_VERSION } from "./e-favor-templates";
import type { Locale } from "./locale";
import { initializeWorld } from "./world-initialization";

const initialization = { seed: "verify-1", startYear: 1327, endYear: 1335, founderCount: 6 };
function quiet(year: number): AnnualPlan { return { year, physical: [], resources: [], grants: [], requests: [] }; }
function fixture() {
  const { world } = initializeWorld(initialization);
  const [creditor, debtor] = Object.values(world.people)
    .filter(p => p.birthYear < 1327 && p.deathYear === undefined && !p.away).map(p => p.id);
  const resources = Object.fromEntries(Object.keys(world.people).map(id => [id, { grain: 2, effort: 1, need: 1 }]));
  const runtime = createAnnualRuntime(initialization, resources);
  const history = [runtime.initial, runtime.advance({ ...quiet(1327), grants: [{ id: "grant", creditor, debtor, causes: [] }] })];
  return { runtime, history, creditor, debtor };
}

describe("internal historical favor templates", () => {
  it("renders the admitted grant in English", () => {
    const { history, creditor, debtor } = fixture();
    const output = renderHistoricalFavorTemplates({ history, subjectActorID: creditor, asOfYear: 1327 }, "en");
    const label = (id: string) => `${history[0].state.people[id].name} [${id}]`;
    expect(output.version).toBe(FAVOR_TEMPLATE_VERSION);
    expect(output.entries[0].text).toBe(`${label(creditor)} transferred 1 unit of grain to ${label(debtor)}. An open help obligation was recorded.`);
  });

  it.each([0, 0.999])("locks both locales and preserves complete metadata (noise %s)", noise => {
    const { runtime, history, creditor, debtor } = fixture();
    history.push(runtime.advance({ ...quiet(1328), requests: [{ id: "request", obligation: "grant/help", noise }] }));
    const input = { history, subjectActorID: creditor, asOfYear: 1328 };
    const selected = selectHistoricalEvidence(input);
    const en = renderHistoricalFavorTemplates(input, "en"), es = renderHistoricalFavorTemplates(input, "es");
    const label = (id: string) => `${history[0].state.people[id].name} [${id}]`;
    expect(en.entries.map(e => e.text)).toEqual([
      `${label(creditor)} transferred 1 unit of grain to ${label(debtor)}. An open help obligation was recorded.`,
      `${label(debtor)} → ${label(creditor)}. ${noise === 0
        ? "Recorded help response: help. The help obligation was recorded as fulfilled; 1 unit of assistance was recorded."
        : "Recorded help response: refuse. The help obligation was recorded as broken."}`,
    ]);
    expect(es.entries.map(e => e.text)).toEqual([
      `${label(creditor)} transfirió 1 unidad de grano a ${label(debtor)}. Se registró una obligación de ayuda abierta.`,
      `${label(debtor)} → ${label(creditor)}. ${noise === 0
        ? "Respuesta de ayuda registrada: ayuda. La obligación de ayuda quedó registrada como cumplida; se registró 1 unidad de asistencia."
        : "Respuesta de ayuda registrada: rechazo. La obligación de ayuda quedó registrada como incumplida."}`,
    ]);
    for (const output of [en, es]) {
      expect(output.historicalVersion).toBe(selected.version);
      expect(output.asOfYear).toBe(1328);
      expect(output.subject).toEqual(selected.subject);
      expect(output.evidence).toEqual(selected.evidence);
      expect(output.evidence.map(e => e.id)).toEqual(["grant", "request", "request/response"]);
      expect(output.entries.map(({ sourceEvidenceID, text, ...beat }) => {
        expect(sourceEvidenceID).toBe(beat.id);
        expect(typeof text).toBe("string");
        return beat;
      })).toEqual(selected.beats);
      expect(output.entries[0].facts.find(f => f.kind === "obligation")?.status).toBe("open");
      expect(output.entries[1].facts).toEqual(noise === 0 ? [
        expect.objectContaining({ kind: "settlement", creditor, debtor, status: "fulfilled" }),
        { kind: "assistance", from: debtor, to: creditor, amount: 1 },
      ] : [expect.objectContaining({ kind: "settlement", creditor, debtor, status: "broken" })]);
    }
  });

  it("keeps quiet/unrelated selection empty and ineligibility distinct from refusal", () => {
    const { runtime, history, creditor, debtor } = fixture();
    const quietRuntime = createAnnualRuntime(initialization, runtime.initial.genesis.resources);
    const quietInput = { history: [quietRuntime.initial, quietRuntime.advance(quiet(1327))], subjectActorID: creditor, asOfYear: 1327 };
    for (const locale of ["en", "es"] as const) {
      expect(renderHistoricalFavorTemplates(quietInput, locale).entries).toEqual([]);
      expect(renderHistoricalFavorTemplates(quietInput, locale).evidence).toEqual(selectHistoricalEvidence(quietInput).evidence);
    }
    history.push(runtime.advance({ ...quiet(1328), physical: [{ id: "away", kind: "residence", actor: debtor, status: "away", causes: [] }],
      grants: [{ id: "unavailable-grant", creditor, debtor, causes: ["away"] }],
      requests: [{ id: "unavailable-request", obligation: "grant/help", noise: 0 }] }));
    const input = { history, subjectActorID: creditor, asOfYear: 1328 };
    expect(renderHistoricalFavorTemplates(input, "en").entries.map(e => e.id)).toEqual(["grant"]);
    const other = Object.keys(runtime.initial.state.people).find(id => id !== creditor && id !== debtor)!;
    expect(renderHistoricalFavorTemplates({ ...input, subjectActorID: other }, "es").entries).toEqual([]);
  });

  it.each(["constructor", "toString"])("labels duplicate names by ID and retains hidden closure for %s", id => {
    const { runtime, history, creditor, debtor } = fixture();
    const p = runtime.initial.state.people[debtor];
    const person: Newcomer = { id, name: runtime.initial.state.people[creditor].name, sex: p.sex,
      birthYear: 1327, traits: [...p.traits], job: p.job, mind: structuredClone(p.mind) as Newcomer["mind"] };
    const origin = runtime.initial.origin.initial.events.find(e => e.year <= 1327)!;
    history.push(runtime.advance({ ...quiet(1328), physical: [{ id: "create", kind: "create", person, causes: [origin.id] }],
      resources: [{ id: "allocate", kind: "allocate", actor: id, causes: ["create"], allocation: { grain: 0, effort: 1, need: 1 } }],
      grants: [{ id: "new-grant", creditor, debtor: id, causes: ["allocate", "create"] }] }));
    history.push(runtime.advance({ ...quiet(1329), requests: [{ id: "new-request", obligation: "new-grant/help", noise: 0 }] }));
    const input = { history, subjectActorID: id, asOfYear: 1329 };
    const selected = selectHistoricalEvidence(input);
    for (const locale of ["en", "es"] as const) {
      const output = renderHistoricalFavorTemplates(input, locale);
      expect(output.evidence).toEqual(selected.evidence);
      expect(output.evidence.map(e => e.id)).toEqual([origin.id, "create", "allocate", "new-grant", "new-request", "new-request/response"]);
      expect(output.entries.map(e => e.id)).toEqual(["new-grant", "new-request/response"]);
      expect(output.entries[0].text).toContain(`${person.name} [${creditor}]`);
      expect(output.entries[0].text).toContain(`${person.name} [${id}]`);
      expect(output.entries[1].text).toContain(`${person.name} [${id}] → ${person.name} [${creditor}]`);
    }
  });

  it("preserves markup names literally as plain strings", () => {
    const { runtime, history, creditor, debtor } = fixture();
    const p = runtime.initial.state.people[debtor];
    const name = '<img src=x onerror="alert(1)"> &amp; <script>throw 1</script>';
    const person: Newcomer = { id: "markup", name, sex: p.sex, birthYear: 1327,
      traits: [...p.traits], job: p.job, mind: structuredClone(p.mind) as Newcomer["mind"] };
    history.push(runtime.advance({ ...quiet(1328), physical: [{ id: "create", kind: "create", person, causes: [] }],
      resources: [{ id: "allocate", kind: "allocate", actor: person.id, causes: ["create"], allocation: { grain: 0, effort: 1, need: 1 } }],
      grants: [{ id: "markup-grant", creditor, debtor: person.id, causes: ["allocate"] }] }));
    for (const locale of ["en", "es"] as const) {
      const output = renderHistoricalFavorTemplates({ history, subjectActorID: person.id, asOfYear: 1328 }, locale);
      expect(output.entries[0].text).toContain(`${name} [markup]`);
      expect(output.subject.name).toBe(name);
    }
  });

  it("is byte invariant at the historical boundary after future death/residence/creation", () => {
    const { runtime, history, creditor, debtor } = fixture();
    const input = { history, subjectActorID: creditor, asOfYear: 1327 };
    const before = (["en", "es"] as const).map(locale => JSON.stringify(renderHistoricalFavorTemplates(input, locale)));
    const p = runtime.initial.state.people[debtor];
    const person: Newcomer = { id: "future", name: "FUTURE NAME", sex: p.sex, birthYear: 1329,
      traits: [...p.traits], job: p.job, mind: structuredClone(p.mind) as Newcomer["mind"] };
    history.push(runtime.advance({ ...quiet(1329), physical: [
      { id: "death", kind: "death", actor: creditor, causes: [] },
      { id: "away", kind: "residence", actor: debtor, status: "away", causes: [] },
      { id: "future-create", kind: "create", person, causes: [] },
    ] }));
    expect((["en", "es"] as const).map(locale => JSON.stringify(renderHistoricalFavorTemplates(input, locale)))).toEqual(before);
    expect(() => renderHistoricalFavorTemplates({ ...input, subjectActorID: "future" }, "en")).toThrow();
  });

  it.each([undefined, null, "fr", "EN", "", {}, 1])("rejects invalid runtime locale %s", locale => {
    const { history, creditor } = fixture();
    expect(() => renderHistoricalFavorTemplates({ history, subjectActorID: creditor, asOfYear: 1327 }, locale as Locale)).toThrow(/locale/);
  });

  it("requires locale at runtime and in TypeScript", () => {
    const { history, creditor } = fixture();
    // @ts-expect-error Explicit locale has no default.
    expect(() => renderHistoricalFavorTemplates({ history, subjectActorID: creditor, asOfYear: 1327 })).toThrow(/locale/);
  });

  it("delegates tampered history and descriptor rejection without invoking hooks", () => {
    const { history, creditor } = fixture();
    const hook = vi.fn(() => history);
    const input = { subjectActorID: creditor, asOfYear: 1327 };
    Object.defineProperty(input, "history", { get: hook, enumerable: true });
    expect(() => renderHistoricalFavorTemplates(input, "en")).toThrow();
    const nested = structuredClone(history);
    Object.defineProperty(nested[1].state.people[creditor], "name", { get: hook, enumerable: true });
    expect(() => renderHistoricalFavorTemplates({ history: nested, subjectActorID: creditor, asOfYear: 1327 }, "en")).toThrow();
    expect(hook).not.toHaveBeenCalled();
    for (const mode of ["version", "effects", "name"]) {
      const candidate = structuredClone(history as unknown) as RuntimeOutput[];
      if (mode === "version") Reflect.set(candidate[1], "version", "unsupported");
      if (mode === "effects") candidate[1].journal[0].entries[0].effects = [];
      if (mode === "name") Reflect.set(candidate[1].state.people[creditor], "name", "forged");
      expect(() => renderHistoricalFavorTemplates({ history: candidate, subjectActorID: creditor, asOfYear: 1327 }, "es")).toThrow();
    }
    expect(() => renderHistoricalFavorTemplates(selectHistoricalEvidence({ history, subjectActorID: creditor, asOfYear: 1327 }), "en")).toThrow();
  });

  it("accepts mutable borrowed data without mutation and returns detached deep readonly data", () => {
    const { history, creditor } = fixture();
    const borrowed = structuredClone(history);
    const before = structuredClone(borrowed);
    const output = renderHistoricalFavorTemplates({ history: borrowed, subjectActorID: creditor, asOfYear: 1327 }, "en");
    function frozen(value: unknown): void {
      if (value !== null && typeof value === "object") {
        expect(Object.isFrozen(value)).toBe(true);
        Object.values(value).forEach(frozen);
      }
    }
    frozen(output);
    expect(borrowed).toEqual(before);
    expect(Object.isFrozen(borrowed)).toBe(false);
    expect(output.subject).not.toBe(borrowed[0].state.people[creditor]);
    Reflect.set(borrowed[0].state.people[creditor], "name", "changed");
    expect(output.subject.name).toBe(before[0].state.people[creditor].name);
    expect(Reflect.set(output.entries[0].actors[0], "name", "changed")).toBe(false);
    expect(Reflect.set(output.evidence[0].facts[0], "amount", 99)).toBe(false);
    // Compile-only assertions: all nested metadata, not merely the envelope, is readonly.
    if (false) {
      // @ts-expect-error Nested actor identity is readonly.
      output.entries[0].actors[0].name = "changed";
      // @ts-expect-error Cause arrays are readonly.
      output.entries[0].causes.push("new");
      // @ts-expect-error Evidence facts are readonly.
      output.evidence[0].facts[0].kind = "origin";
      // @ts-expect-error Subject is readonly.
      output.subject.id = "other";
    }
  });
});

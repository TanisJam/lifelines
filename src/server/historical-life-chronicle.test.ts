import { describe, expect, it, vi } from "vitest";
import { createAnnualRuntime, type AnnualPlan, type Newcomer } from "../domain/e-runtime";
import { renderHistoricalFavorTemplates } from "../domain/e-favor-templates";
import type { Locale } from "../domain/locale";
import { initializeWorld } from "../domain/world-initialization";
import type { GenerateWorldOptions } from "../domain/worldgen";
import { resolveEntryProse } from "../lib/prose-markers";
import { scenePresence } from "../lib/sky/presence";
import { deriveHistoricalScene } from "./historical-scene";
import { buildHistoricalLifeChronicle, type HistoricalPartialChronicle } from "./historical-life-chronicle";

const initialization = { seed: "verify-1", startYear: 1327, endYear: 1335, founderCount: 6 };
const quiet = (year: number): AnnualPlan => ({ year, physical: [], resources: [], grants: [], requests: [] });
function fixture(options: GenerateWorldOptions = initialization) {
  const { world } = initializeWorld(options);
  const resources = Object.fromEntries(Object.keys(world.people).map(id => [id, { grain: 2, effort: 1, need: 1 }]));
  const runtime = createAnnualRuntime(options, resources);
  const [creditor, debtor, other] = Object.values(runtime.initial.state.people)
    .filter(p => p.birthYear < (options.startYear ?? 1327) && p.deathYear === undefined && !p.away).map(p => p.id);
  const history = [runtime.initial];
  function newcomer(id: string, name: string, birthYear = 1300): Newcomer {
    const p = runtime.initial.state.people[debtor];
    return { id, name, sex: p.sex, birthYear, traits: [...p.traits], job: p.job,
      mind: structuredClone(p.mind) as Newcomer["mind"] };
  }
  return { runtime, history, creditor, debtor, other, newcomer };
}
function assertProjection(output: HistoricalPartialChronicle, input: Parameters<typeof buildHistoricalLifeChronicle>[0], locale: Locale) {
  const templates = renderHistoricalFavorTemplates(input, locale);
  expect(output.asOfYear).toBe(input.asOfYear);
  expect(output.evidence).toEqual(templates.evidence);
  expect(output.scene).toEqual(deriveHistoricalScene(input));
  expect(output.entries.map(({ at, who, prose, links, proseTokens, ...template }) => {
    expect(at).toBeGreaterThan(template.year);
    expect(at).toBeLessThan(template.year + 1);
    expect(who).toEqual(template.actors.map(a => a.id));
    expect(prose).toBe(template.text);
    expect(proseTokens).toHaveLength(4);
    expect(links).toEqual(template.actors.map(a => ({ personId: a.id, name: a.name })));
    return template;
  })).toEqual(templates.entries);
  for (const entry of output.entries) {
    const parts = resolveEntryProse(entry);
    expect(parts.map(p => p.kind === "text" ? p.text : p.name).join("")).toBe(entry.text);
    const roles = entry.actors.map(a => a.id);
    expect(parts.filter(p => p.kind === "link").map(p => p.personId))
      .toEqual(entry.kind === "grain-grant" ? roles : roles.reverse());
    for (const id of entry.who) expect(output.scene.people.some(p => p.id === id)).toBe(true);
  }
  for (const evidence of output.evidence) {
    expect(evidence.year).toBeLessThanOrEqual(input.asOfYear);
    for (const actor of evidence.actors) expect(output.scene.people.find(p => p.id === actor.id)?.name).toBe(actor.name);
  }
  expect(Object.keys(output).sort()).toEqual(["asOfYear", "entries", "evidence", "scene", "version"]);
}
function frozen(value: unknown): void {
  if (value !== null && typeof value === "object") {
    expect(value).not.toBeInstanceOf(Map);
    expect(Object.isFrozen(value)).toBe(true);
    Object.values(value).forEach(frozen);
  }
}

describe("inactive historical partial chronicle", () => {
  it.each([0, 0.999])("preserves actual grant and help/refuse text, metadata and recorded roles (noise %s)", noise => {
    const { runtime, history, creditor, debtor } = fixture();
    history.push(runtime.advance({ ...quiet(1327), grants: [{ id: "grant", creditor, debtor, causes: [] }] }));
    history.push(runtime.advance({ ...quiet(1328), requests: [{ id: "request", obligation: "grant/help", noise }] }));
    const input = { history, subjectActorID: creditor, asOfYear: 1328 };
    for (const locale of ["en", "es"] as const) {
      const output = buildHistoricalLifeChronicle(input, locale);
      assertProjection(output, input, locale);
      expect(output.entries.map(e => e.at)).toEqual([1327.5, 1328 + 2 / 3]);
      expect(output.entries[1].response).toBe(noise === 0 ? "help" : "refuse");
      expect(output.version).toBe("historical-rules-e4-partial-chronicle-1");
      frozen(output);
    }
  });

  it.each([
    ["__proto__", 0], ["constructor", 0], ["{雪}\u0000{{p}}", 0],
    ["__proto__", 0.999], ["constructor", 0.999], ["{雪}\u0000{{p}}", 0.999],
  ] as const)("uses exact own-key IDs and hostile same-name links: %s, noise %s", (id, noise) => {
    const { runtime, history, creditor, debtor, newcomer } = fixture();
    const second = `${id}/second`;
    const name = '{{constructor}} {{__proto__}} {雪}\u0000 <script>& [ID]';
    history.push(runtime.advance({ ...quiet(1327), physical: [
      { id: "create-a", kind: "create", person: newcomer(id, name), causes: [] },
      { id: "create-b", kind: "create", person: newcomer(second, name), causes: [] },
      { id: "away", kind: "residence", actor: debtor, status: "away", causes: [] },
    ], resources: [
      { id: "allocate-a", kind: "allocate", actor: id, causes: ["create-a"], allocation: { grain: 2, effort: 1, need: 1 } },
      { id: "allocate-b", kind: "allocate", actor: second, causes: ["create-b"], allocation: { grain: 0, effort: 1, need: 1 } },
    ], grants: [
      { id: "hidden-ineligible", creditor, debtor, causes: ["away"] },
      { id: "__proto__", creditor: id, debtor: second, causes: ["allocate-a", "allocate-b"] },
    ] }));
    history.push(runtime.advance({ ...quiet(1328), requests: [{ id: "constructor", obligation: "__proto__/help", noise }] }));
    const input = { history, subjectActorID: id, asOfYear: 1328 };
    expect(history[1].journal[0].entries).toHaveLength(7);
    expect(history[1].journal[0].entries[5].outcome).toBe("ineligible");
    for (const locale of ["en", "es"] as const) {
      const output = buildHistoricalLifeChronicle(input, locale);
      assertProjection(output, input, locale);
      expect(output.entries[0].at).toBe(1327 + 7 / 8);
      expect(output.entries[0].position).toBe(6);
      expect(output.entries[1].at).toBe(1328 + 2 / 3);
      expect(output.entries[0].proseTokens[1]).toMatchObject({ kind: "text", text: expect.stringContaining(` [${id}]`) });
      expect(output.entries[0].links.map(l => l.name)).toEqual([name, name]);
      expect(output.scene.people[0]).toMatchObject({ id, born: 1300, appearsAt: 1327 + 1 / 8 });
      expect(output.entries[1].response).toBe(noise === 0 ? "help" : "refuse");
    }
  });

  it("is byte invariant across retained future death/creation but rejects malformed future truth and prefixes", () => {
    const { runtime, history, creditor, debtor, newcomer } = fixture();
    history.push(runtime.advance({ ...quiet(1327), grants: [{ id: "grant", creditor, debtor, causes: [] }] }));
    const input = { history, subjectActorID: creditor, asOfYear: 1327 };
    const before = (["en", "es"] as const).map(l => JSON.stringify(buildHistoricalLifeChronicle(input, l)));
    history.push(runtime.advance({ ...quiet(1329), physical: [
      { id: "future-death", kind: "death", actor: creditor, causes: [] },
      { id: "future-create", kind: "create", person: newcomer("future", "FUTURE", 1329), causes: [] },
    ] }));
    expect((["en", "es"] as const).map(l => JSON.stringify(buildHistoricalLifeChronicle(input, l)))).toEqual(before);
    const bad = structuredClone(history);
    Reflect.set(bad[2].state.people[creditor], "name", "forged");
    expect(() => buildHistoricalLifeChronicle({ ...input, history: bad }, "en")).toThrow();
    expect(() => buildHistoricalLifeChronicle({ ...input, history: [history[0], history[2]] }, "es")).toThrow();
    for (const asOfYear of [1328, NaN, -0]) expect(() => buildHistoricalLifeChronicle({ ...input, asOfYear }, "en")).toThrow();
    expect(() => buildHistoricalLifeChronicle({ ...input, subjectActorID: "future" }, "en")).toThrow();
  });

  it.each([0, 1328])("preserves quiet, gapped year %s without fabricating entries or death", year => {
    const { runtime, history, creditor } = fixture({ ...initialization, startYear: year - 2, endYear: year + 1 });
    history.push(runtime.advance(quiet(year - 2)), runtime.advance(quiet(year)));
    const input = { history, subjectActorID: creditor, asOfYear: year };
    const output = buildHistoricalLifeChronicle(input, "en");
    assertProjection(output, input, "en");
    expect(output.entries).toEqual([]);
    expect(output.scene.span.end).toBe(year);
    expect(output.scene.people[0].diedAt).toBeUndefined();
  });

  it("preserves physical death and past entries without creating a death narrative", () => {
    const { runtime, history, creditor, debtor } = fixture();
    history.push(runtime.advance({ ...quiet(1327), grants: [{ id: "grant", creditor, debtor, causes: [] }] }));
    history.push(runtime.advance({ ...quiet(1328), physical: [{ id: "death", kind: "death", actor: creditor, causes: [] }] }));
    const input = { history, subjectActorID: creditor, asOfYear: 1328 };
    const output = buildHistoricalLifeChronicle(input, "es");
    assertProjection(output, input, "es");
    expect(output.entries.map(e => e.id)).toEqual(["grant"]);
    expect(output.scene.span.end).toBe(1328.5);
  });

  it("retains initially dead point and outside-window causal actors as context, not invented friends", () => {
    const { runtime, history, debtor } = fixture({ seed: "sky7334-0", startYear: 1327, endYear: 1335,
      founderCount: 62, protagonist: { name: "Subject", sex: "f" } });
    const death = runtime.initial.origin.initial.events.find(e => e.kind === "death" && e.actors.includes("p009"))!;
    history.push(runtime.advance({ ...quiet(1327), grants: [{ id: "grant", creditor: "protagonist", debtor, causes: [death.id] }] }));
    const input = { history, subjectActorID: "protagonist", asOfYear: 1327 };
    const output = buildHistoricalLifeChronicle(input, "en");
    assertProjection(output, input, "en");
    const dead = output.scene.people.find(p => p.id === "p009")!;
    expect(dead).toMatchObject({ born: 1313, diedAt: 1313, group: "others", relCode: "participant" });
    expect(scenePresence(output.scene, dead, 1327)).toBe(0);
    expect(output.scene.edges).toEqual([]);
    const point = buildHistoricalLifeChronicle({ ...input, subjectActorID: "p009" }, "es");
    expect(point.scene.span).toEqual({ start: 1313, end: 1313 });
    expect(point.entries).toEqual([]);
  });

  it("returns detached recursively frozen data while keeping every caller object mutable", () => {
    const { runtime, history, creditor, debtor } = fixture();
    history.push(runtime.advance({ ...quiet(1327), grants: [{ id: "grant", creditor, debtor, causes: [] }] }));
    const borrowed = structuredClone(history);
    const before = structuredClone(borrowed);
    const output = buildHistoricalLifeChronicle({ history: borrowed, subjectActorID: creditor, asOfYear: 1327 }, "en");
    frozen(output);
    expect(borrowed).toEqual(before);
    const callerObjects = new Set<object>();
    function collect(value: unknown): void {
      if (value !== null && typeof value === "object") {
        expect(Object.isFrozen(value)).toBe(false);
        callerObjects.add(value);
        Object.values(value).forEach(collect);
      }
    }
    collect(borrowed);
    function detached(value: unknown): void {
      if (value !== null && typeof value === "object") {
        expect(callerObjects.has(value)).toBe(false);
        Object.values(value).forEach(detached);
      }
    }
    detached(output);
    const bytes = JSON.stringify(output);
    Reflect.set(borrowed[1].state.people[creditor], "name", "caller changed");
    const actors = borrowed[1].journal[0].entries[0].actors;
    Reflect.set(actors, actors.length, "caller changed");
    expect(JSON.stringify(output)).toBe(bytes);
    if (false) {
      // @ts-expect-error Entry metadata remains deeply readonly.
      output.entries[0].facts[0].kind = "origin";
      // @ts-expect-error Actor IDs are readonly.
      output.entries[0].who.push("other");
      // @ts-expect-error Required literal tokens are readonly.
      output.entries[0].proseTokens.push({ kind: "text", text: "changed" });
      // @ts-expect-error Individual literal tokens are readonly.
      output.entries[0].proseTokens[0].kind = "text";
      // @ts-expect-error Entry chronology is readonly.
      output.entries[0].at = 0;
      // @ts-expect-error Link identity is readonly.
      output.entries[0].links[0].name = "changed";
      // @ts-expect-error Scene is readonly.
      output.scene.people[0].name = "changed";
      // @ts-expect-error Evidence is deeply readonly.
      output.evidence[0].actors[0].id = "changed";
    }
  });

  it("requires explicit locale and rejects envelope/nested getters without touching hooks", () => {
    const { runtime, history, creditor } = fixture();
    history.push(runtime.advance(quiet(1327)));
    const input = { history, subjectActorID: creditor, asOfYear: 1327 };
    const hook = vi.fn(() => history);
    const envelope = { subjectActorID: creditor, asOfYear: 1327 };
    Object.defineProperty(envelope, "history", { enumerable: true, get: hook });
    for (const locale of [undefined, null, "fr", "EN", "", {}, 1]) {
      expect(() => buildHistoricalLifeChronicle(envelope as typeof input, locale as Locale)).toThrow(/locale/);
    }
    // @ts-expect-error Locale is required, no default.
    expect(() => buildHistoricalLifeChronicle(input)).toThrow(/locale/);
    expect(() => buildHistoricalLifeChronicle(envelope as typeof input, "en")).toThrow();
    const nested = structuredClone(history);
    Object.defineProperty(nested[1].state.people[creditor], "name", { enumerable: true, get: hook });
    expect(() => buildHistoricalLifeChronicle({ ...input, history: nested }, "es")).toThrow();
    expect(hook).not.toHaveBeenCalled();
  });
});

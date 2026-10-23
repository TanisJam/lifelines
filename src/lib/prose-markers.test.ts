import { describe, expect, it } from "vitest";
import type { ChronicleEntry, PersonLink } from "@/contracts/life";
import { parseProseMarkers, resolveEntryProse } from "./prose-markers";

type EntryProse = Pick<ChronicleEntry, "prose" | "links" | "proseTokens">;
const resolve = (proseTokens: unknown, prose = "", links: readonly PersonLink[] = []) =>
  resolveEntryProse({ proseTokens, prose, links } as EntryProse);

describe("resolveEntryProse", () => {
  it("uses unchanged legacy parsing only for absent or own undefined tokens", () => {
    const entry = { prose: "{{a}}{{missing}}!", links: [{ personId: "a", name: "{{b}}" }] };
    const expected = parseProseMarkers(entry.prose, entry.links);
    expect(resolveEntryProse(entry)).toEqual(expected);
    expect(resolveEntryProse({ ...entry, proseTokens: undefined })).toEqual(expected);
  });

  it("preserves literal tokens, empty parts, exact identities and last duplicate names", () => {
    const ids = ["constructor", "__proto__", "{a}", "a\r\n\0😀é\ud800\udfff"];
    const name = "<b>{{constructor}}</b>\r\n\0😀é\ud800\udfff";
    const links = [{ personId: ids[0], name: "old" }, ...ids.map(personId => ({ personId, name }))];
    const tokens = [{ kind: "text", text: "" }, ...ids.map(personId => ({ kind: "link", personId })), { kind: "text", text: "{{missing}}!" }];
    const prose = name.repeat(ids.length) + "{{missing}}!";
    expect(resolveEntryProse(JSON.parse(JSON.stringify({ prose, links, proseTokens: tokens })))).toEqual(resolve(tokens, prose, links));
    expect(resolve(tokens, prose, links)).toEqual([
      { kind: "text", text: "" }, ...ids.map(personId => ({ kind: "link", personId, name })), { kind: "text", text: "{{missing}}!" },
    ]);
    expect(resolve([{ kind: "link", personId: "empty" }], "", [{ personId: "empty", name: "" }]))
      .toEqual([{ kind: "link", personId: "empty", name: "" }]);
  });

  it("distinguishes deliberate empty tokens, null and plaintext mismatch without fallback", () => {
    expect(resolve([])).toEqual([]);
    for (const tokens of [null, {}, "", [], [{ kind: "text", text: "different" }]]) {
      expect(() => resolve(tokens, "{{missing}}!")).toThrow(TypeError);
    }
  });

  it.each([
    undefined, null, {}, [], { kind: "unknown", text: "" }, { kind: "text" },
    { kind: "text", text: 1 }, { kind: "text", text: new String("") },
    { kind: "link", personId: "" }, { kind: "link", personId: 1 },
    { kind: "link" }, { kind: "text", text: "", personId: "a" },
    { kind: "link", personId: "a", text: "" },
    Object.create({ kind: "text", text: "" }),
    Object.assign({ kind: "text", text: "" }, { [Symbol("extra")]: "" }),
    Object.defineProperty({ kind: "text", text: "" }, "extra", { value: 1 }),
    Object.defineProperty({ kind: "text" }, "text", { value: "", enumerable: false }),
  ])("rejects malformed token %#", token => {
    expect(() => resolve([token])).toThrow(TypeError);
  });

  it("rejects sparse, inherited, accessor and decorated arrays without executing hooks", () => {
    let calls = 0;
    const inherited = new Array(1);
    Object.setPrototypeOf(inherited, Object.assign(Object.create(Array.prototype), { 0: { kind: "text", text: "" } }));
    const accessor = Object.defineProperty(new Array(1), "0", { get() { calls++; return { kind: "text", text: "" }; } });
    const hidden = Object.defineProperty([{ kind: "text", text: "" }], "0", { enumerable: false });
    const arrays = [new Array(1), inherited, accessor, hidden,
      Object.assign([], { extra: 1 }), Object.assign([], { [Symbol("extra")]: 1 })];
    for (const array of arrays) expect(() => resolve(array)).toThrow(TypeError);
    expect(calls).toBe(0);
  });

  it("rejects accessor fields and inherited token opt-in without invoking getters", () => {
    let calls = 0;
    const getter = { get() { calls++; return ""; }, enumerable: true };
    for (const field of ["kind", "text"]) {
      const token = Object.defineProperty({ kind: "text", text: "" }, field, getter);
      expect(() => resolve([token])).toThrow(TypeError);
    }
    const base = { prose: "", links: [] };
    const own = Object.defineProperty({ ...base }, "proseTokens", getter);
    const inherited = Object.assign(Object.create(Object.defineProperty({}, "proseTokens", getter)), base);
    expect(() => resolveEntryProse(own)).toThrow(TypeError);
    expect(() => resolveEntryProse(inherited)).toThrow(TypeError);
    for (const proseTokens of [undefined, []]) {
      expect(() => resolveEntryProse(Object.assign(Object.create({ proseTokens }), base))).toThrow(TypeError);
    }
    const linkToken = Object.defineProperty({ kind: "link" }, "personId", getter);
    expect(() => resolve([linkToken])).toThrow(TypeError);
    expect(calls).toBe(0);
  });

  it("requires exact Map membership, not prototype keys or normalized identities", () => {
    for (const id of ["constructor", "__proto__", "a", "é", " a "]) {
      expect(() => resolve([{ kind: "link", personId: id }], "", [{ personId: "é", name: "" }])).toThrow(TypeError);
    }
  });

  it("validates token-bearing link data without getter-dependent plaintext", () => {
    let calls = 0;
    const token = [{ kind: "link", personId: "a" }];
    const badLinks = [{ personId: "", name: "" }, { personId: "a", name: 1 },
      Object.create({ personId: "a", name: "" }),
      Object.defineProperty({ personId: "a" }, "name", { get() { calls++; return ""; } }),
      Object.defineProperty({ name: "" }, "personId", { get() { calls++; return "a"; } })];
    for (const link of badLinks) expect(() => resolve(token, "", [link] as PersonLink[])).toThrow(TypeError);
    expect(calls).toBe(0);
  });

  it("preserves every UTF-16 code unit and field distinction through JSON", () => {
    const strings = ["", "{}{{id}}", "\r\n\0", "😀é", "\ud800", "\udfff"];
    for (const text of strings) {
      const entry = { prose: text, links: [], proseTokens: [{ kind: "text", text }] };
      const copy = JSON.parse(JSON.stringify(entry));
      expect(resolveEntryProse(copy)).toEqual([{ kind: "text", text }]);
      expect(copy.prose).toBe(text);
    }
    const old = { prose: "{{missing}}", links: [] };
    const bytes = JSON.stringify(old);
    resolveEntryProse(old);
    expect(JSON.stringify(old)).toBe(bytes);
    expect(Object.hasOwn(JSON.parse(bytes), "proseTokens")).toBe(false);
    expect(JSON.stringify({ ...old, proseTokens: undefined })).toBe(bytes);
    expect(() => resolveEntryProse(JSON.parse(JSON.stringify({ ...old, proseTokens: null })))).toThrow(TypeError);
    expect(resolveEntryProse(JSON.parse(JSON.stringify({ prose: "", links: [], proseTokens: [] })))).toEqual([]);
  });
});

describe("parseProseMarkers", () => {
  it("returns the whole string as one text part when there are no markers", () => {
    expect(parseProseMarkers("She grew up in Hallowmere.", [])).toEqual([{ kind: "text", text: "She grew up in Hallowmere." }]);
  });

  it("resolves a single marker to its linked name", () => {
    const parts = parseProseMarkers("Elin marries {{tomas}} at midsummer.", [{ personId: "tomas", name: "Tomas Vell" }]);
    expect(parts).toEqual([
      { kind: "text", text: "Elin marries " },
      { kind: "link", personId: "tomas", name: "Tomas Vell" },
      { kind: "text", text: " at midsummer." },
    ]);
  });

  it("resolves multiple distinct markers in order", () => {
    const parts = parseProseMarkers("{{petra}} and {{joren}} welcome a daughter.", [
      { personId: "petra", name: "Petra Marrow" },
      { personId: "joren", name: "Joren Marrow" },
    ]);
    expect(parts).toEqual([
      { kind: "link", personId: "petra", name: "Petra Marrow" },
      { kind: "text", text: " and " },
      { kind: "link", personId: "joren", name: "Joren Marrow" },
      { kind: "text", text: " welcome a daughter." },
    ]);
  });

  it("drops a marker that has no matching link instead of showing its id", () => {
    expect(parseProseMarkers("She meets {{ghost}}.", [])).toEqual([
      { kind: "text", text: "She meets " },
      { kind: "text", text: "." },
    ]);
  });

  it("handles a marker at the very start and end of the prose", () => {
    const parts = parseProseMarkers("{{a}}{{b}}", [
      { personId: "a", name: "A" },
      { personId: "b", name: "B" },
    ]);
    expect(parts).toEqual([
      { kind: "link", personId: "a", name: "A" },
      { kind: "link", personId: "b", name: "B" },
    ]);
  });

  it("returns an empty array for an empty string", () => {
    expect(parseProseMarkers("", [])).toEqual([]);
  });
});

describe("parseProseMarkers: unresolved markers", () => {
  it("never leaks the raw id or braces when a marker has no link", () => {
    const parts = parseProseMarkers("Pancho mourned {{child-p052-1340}} deeply.", []);
    const plain = parts.map((p) => (p.kind === "link" ? p.name : p.text)).join("");
    expect(plain).not.toContain("{{");
    expect(plain).not.toContain("child-p052-1340");
    expect(parts.every((p) => p.kind === "text")).toBe(true);
  });
});

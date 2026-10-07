import { describe, expect, it, vi } from "vitest";
import { canonicalLifecycleData } from "./e-lifecycle-genesis";
import { decodeLifecycleDag, deserializeLifecycleDag, encodeLifecycleDag, serializeLifecycleDag } from "./e-lifecycle-dag";

describe("internal lifecycle data dictionary (not authority)", () => {
  it("interns complete equal content, not just borrowed identity", () => {
    const table = encodeLifecycleDag([{ x: 1 }, { x: 1 }]);
    expect(table.nodes).toEqual([["n", "1"], ["r", [["x", 0]]], ["a", [1, 1]]]);
    expect(table.root).toBe(2);
    expect(decodeLifecycleDag(table)).toEqual([{ x: 1 }, { x: 1 }]);
  });
  it("preserves complete canonical values and explicit registry order", () => {
    const values = [undefined, null, true, false, -0, 0, 1e21, 1e-7, Number.MIN_VALUE,
      "\ud800\udfff\u0000\"\\\u2028😀", [], {}, { own: undefined },
      { registryOrder: ["z", "a"], history: [{ mind: { a: -0 } }], z: null, a: false }];
    for (const value of values) {
      const restored = deserializeLifecycleDag(serializeLifecycleDag(value));
      expect(canonicalLifecycleData(restored)).toBe(canonicalLifecycleData(value));
    }
    expect(serializeLifecycleDag({ b: 2, a: 1 })).toBe(serializeLifecycleDag({ a: 1, b: 2 }));
    expect(serializeLifecycleDag({ own: undefined })).not.toBe(serializeLifecycleDag({}));
    expect(serializeLifecycleDag(-0)).not.toBe(serializeLifecycleDag(0));
  });
  it("represents repeated diamonds by linear compact edges without a large unfolded oracle", () => {
    let value: unknown = { leaf: "full" };
    for (let i = 0; i < 12; i++) value = [value, value];
    const table = encodeLifecycleDag(value);
    expect(table.nodes).toHaveLength(14);
    expect(JSON.stringify(table).length).toBeLessThan(300);
    expect(encodeLifecycleDag(decodeLifecycleDag(table))).toEqual(table);
  });
  it("captures borrowed data without freezing or adopting owners", () => {
    const source = { nested: { mind: [1], history: undefined } };
    const encoded = encodeLifecycleDag(source);
    source.nested.mind.push(2);
    const decoded = decodeLifecycleDag(encoded) as typeof source;
    expect(decoded.nested.mind).toEqual([1]);
    expect(decoded.nested).not.toBe(source.nested);
    expect(Object.isFrozen(source)).toBe(false);
    const table = encodeLifecycleDag([{}]);
    const captured = decodeLifecycleDag(table);
    table.nodes.length = 0;
    expect(captured).toEqual([{}]);
    expect(() => encodeLifecycleDag(Object.freeze({ run() {} }))).toThrow();
  });
  it("allows all guard-admitted prototype-looking keys without pollution", () => {
    const source = Object.create(null);
    for (const key of ["__proto__", "constructor", "prototype", "\ud800", "😀", "\u0000"])
      Object.defineProperty(source, key, { value: { intact: true }, enumerable: true });
    const result = decodeLifecycleDag(encodeLifecycleDag(source)) as Record<string, unknown>;
    expect(Object.getPrototypeOf(result)).toBeNull();
    expect(Object.hasOwn(result, "__proto__")).toBe(true);
    expect(canonicalLifecycleData(result)).toBe(canonicalLifecycleData(source));
  });
  it("rejects unknown executables before cloning or invoking any getters/toJSON", () => {
    let calls = 0;
    const getter = { get hostile() { calls++; return 1; } };
    const hidden = Object.defineProperty({}, "hidden", { value: 1 });
    const symbol = { [Symbol("x")]: 1 };
    const extended = Object.assign([1], { extra: 1 });
    const cycle: unknown[] = []; cycle.push(cycle);
    const clone = vi.spyOn(globalThis, "structuredClone");
    const invalid = [getter, hidden, symbol, extended, new Array(2), new Date(), cycle,
      () => 1, { valid: 1, late: getter }, { toJSON() { calls++; return {}; } },
      { get toJSON() { calls++; return () => ({}); } }, Object.freeze(getter)];
    try {
      for (const value of invalid) {
        expect(() => encodeLifecycleDag(value)).toThrow();
        expect(() => decodeLifecycleDag(value)).toThrow();
        expect(() => deserializeLifecycleDag(value)).toThrow();
      }
      expect(clone).not.toHaveBeenCalled();
      expect(calls).toBe(0);
    } finally { clone.mockRestore(); }
  });
  const malformed: unknown[] = [
    {}, { root: 0, nodes: [] }, { root: 0, nodes: [["z"]], extra: 1 },
    { root: -0, nodes: [["z"]] }, { root: 0, nodes: [["unknown"]] },
    { root: 0, nodes: [["u", 1]] }, { root: 0, nodes: [["b", 1]] },
    { root: 0, nodes: [["s", null]] }, { root: 0, nodes: [["a", {}]] },
    { root: 0, nodes: [["z"], ["wrong-late-unused"]] },
    { root: 1, nodes: [["z"], ["z"]] },
    { root: 1, nodes: [["z"], ["u"]] },
    { root: 2, nodes: [["z"], ["u"], ["a", [1, 0]]] },
    { root: 1, nodes: [["z"], ["r", [["x", 0], ["x", 0]]]] },
    { root: 1, nodes: [["z"], ["r", [["z", 0], ["a", 0]]]] },
    { root: 1, nodes: [["z"], ["r", [[1, 0]]]] },
    { root: 1, nodes: [["z"], ["r", [["a", 0, 0]]]] },
    { root: 0, nodes: [["a", [0]]] },
    { root: 1, nodes: [["a", [1]], ["z"]] },
  ];
  for (const ref of [-0, -1, 0.5, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN, 2, "0"])
    malformed.push({ root: 1, nodes: [["z"], ["a", [ref]]] });
  for (const number of ["", " 0", "+0", "00", "1.0", "-00", "NaN", "Infinity", "1e309", "1e+01", 1])
    malformed.push({ root: 0, nodes: [["n", number]] });
  it.each(malformed.map((value, index) => [index, value]))("rejects closed grammar case %s", (_index, value) => {
    expect(() => decodeLifecycleDag(value)).toThrow();
    // JSON.stringify erases numeric -0; test those raw spellings separately.
    if (_index !== 3 && _index !== 19)
      expect(() => deserializeLifecycleDag(JSON.stringify(value))).toThrow();
  });
  it("requires exact canonical JSON and complete validation before construction", () => {
    const text = serializeLifecycleDag(null);
    expect(() => deserializeLifecycleDag(` ${text}`)).toThrow();
    expect(() => deserializeLifecycleDag('{"nodes":[["z"]],"root":0}')).toThrow();
    expect(() => deserializeLifecycleDag('{"root":0,"root":0,"nodes":[["z"]]}')).toThrow();
    expect(() => deserializeLifecycleDag('{"root":0,"nodes":[["z"]],"nodes":[["z"]]}')).toThrow();
    expect(() => deserializeLifecycleDag('not json')).toThrow();
    expect(() => deserializeLifecycleDag('{"root":-0,"nodes":[["z"]]}')).toThrow();
    expect(() => deserializeLifecycleDag('{"root":1,"nodes":[["z"],["a",[-0]]]}')).toThrow();
    const define = vi.spyOn(Object, "defineProperty");
    let rejected = false;
    try { decodeLifecycleDag({ root: 2, nodes: [["z"], ["r", [["x", 0]]], ["bad"]] }); }
    catch { rejected = true; }
    const constructionCalls = define.mock.calls.length;
    define.mockRestore();
    expect(rejected).toBe(true);
    expect(constructionCalls).toBe(0);
  });
  it("roundtrips the same exact definition limits without charging dictionary headers", () => {
    for (const value of [null, undefined, -0, true, "\ud800", [], {}]) {
      const options = { nodes: 1, edges: 0, depth: 1, bytes: Buffer.byteLength(serializeLifecycleDag(value), "utf8") };
      const table = encodeLifecycleDag(value, options);
      expect(canonicalLifecycleData(decodeLifecycleDag(table, options))).toBe(canonicalLifecycleData(value));
      expect(canonicalLifecycleData(deserializeLifecycleDag(serializeLifecycleDag(value, options), options))).toBe(canonicalLifecycleData(value));
    }
    for (const [value, nodes, edges, depth] of [
      [null, 1, 0, 1], [[], 1, 0, 1], [{}, 1, 0, 1],
      [[null, null], 2, 2, 2], [{ a: null, b: null }, 2, 2, 2],
      [[null, [null]], 3, 3, 3], [{ a: null, b: { c: null } }, 3, 3, 3],
    ] as const) {
      const text = serializeLifecycleDag(value);
      const options = { nodes, edges, depth, bytes: Buffer.byteLength(text, "utf8") };
      expect(serializeLifecycleDag(value, options)).toBe(text);
      const table = encodeLifecycleDag(value, options);
      expect(canonicalLifecycleData(decodeLifecycleDag(table, options))).toBe(canonicalLifecycleData(value));
      expect(canonicalLifecycleData(deserializeLifecycleDag(text, options))).toBe(canonicalLifecycleData(value));
      expect(() => encodeLifecycleDag(value, { ...options, bytes: options.bytes - 1 })).toThrow();
      expect(() => decodeLifecycleDag(table, { ...options, bytes: options.bytes - 1 })).toThrow();
      if (nodes > 1) {
        expect(() => encodeLifecycleDag(value, { ...options, nodes: nodes - 1 })).toThrow();
        expect(() => decodeLifecycleDag(table, { ...options, nodes: nodes - 1 })).toThrow();
      }
    }
    const nested = { a: null, z: [null] };
    expect(() => encodeLifecycleDag(nested, { depth: 2 })).toThrow();
    expect(() => decodeLifecycleDag(encodeLifecycleDag(nested), { depth: 2 })).toThrow();
  });
  it("rejects bounded nodes, edges, depth, bytes and malformed limits without truncating", () => {
    let deep: unknown = null;
    for (let i = 0; i < 10; i++) deep = [deep];
    const cases = [
      { value: [0, 1, 2], limit: { nodes: 2 } },
      { value: [0, 0, 0], limit: { edges: 2 } },
      { value: deep, limit: { depth: 8 } },
      { value: "x".repeat(100), limit: { bytes: 64 } },
    ];
    for (const { value, limit } of cases) {
      expect(() => encodeLifecycleDag(value, limit)).toThrow();
      const table = encodeLifecycleDag(value);
      expect(() => decodeLifecycleDag(table, limit)).toThrow();
      expect(() => deserializeLifecycleDag(JSON.stringify(table), limit)).toThrow();
    }
    for (const nodes of [-0, -1, 0.5, Infinity, 100_001])
      expect(() => encodeLifecycleDag(null, { nodes })).toThrow();
    expect(() => deserializeLifecycleDag("x".repeat(65), { bytes: 64 })).toThrow();
    let malformed: unknown = null;
    for (let i = 0; i < 135; i++) malformed = [malformed];
    const clone = vi.spyOn(globalThis, "structuredClone");
    let rejected = false;
    try { decodeLifecycleDag(malformed); } catch { rejected = true; }
    const calls = clone.mock.calls.length;
    clone.mockRestore();
    expect(rejected && calls === 0).toBe(true);
  });
});

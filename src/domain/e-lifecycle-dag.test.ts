import { describe, expect, it, vi } from "vitest";
import { canonicalLifecycleData } from "./e-lifecycle-genesis";
import { decodeCompactLifecycleDag, decodeLifecycleDag, deserializeCompactLifecycleDag, deserializeLifecycleDag,
  encodeCompactLifecycleDag, encodeLifecycleDag, serializeCompactLifecycleDag, serializeLifecycleDag,
  LIFECYCLE_DAG_WIRE_LIMITS, type LifecycleDag, type LifecycleDagNode } from "./e-lifecycle-dag";

function binaryTable(depth: number, leaf: LifecycleDagNode = ["z"]): LifecycleDag {
  const nodes: LifecycleDagNode[] = [leaf];
  for (let i = 0; i < depth; i++) nodes.push(["a", [i, i]]);
  return { root: depth, nodes };
}

describe("internal lifecycle data dictionary (not authority)", () => {
  it("rejects canonical exponential expansion before constructing decoded records", () => {
    const table = binaryTable(100, ["r", []]);
    // 101 definitions, 200 edges, depth 101; never unfold this root in an oracle.
    const define = vi.spyOn(Object, "create");
    let rejected = false;
    try { decodeLifecycleDag(table); } catch { rejected = true; }
    const calls = define.mock.calls.length;
    define.mockRestore();
    expect(rejected).toBe(true);
    expect(calls).toBe(0);
    expect(() => deserializeLifecycleDag(JSON.stringify(table))).toThrow();
  });
  it.each([1_600_003, 1_600_004, 1_600_005])("accounts exact unfolded node visits %s and their repeated edges", visits => {
    // A tree has edges = visits - 1; with equal caps, node admission binds first.
    // Decompose visits - 1 into weights 2^(d+1)-1, not an unfolded value.
    const table = binaryTable(19);
    const refs: number[] = [];
    let remaining = visits - 1;
    for (let d = 19; d >= 0; d--) {
      const weight = 2 ** (d + 1) - 1;
      while (remaining >= weight) { refs.push(d); remaining -= weight; }
    }
    table.nodes.push(["a", refs]); table.root++;
    if (visits > 1_600_004) {
      expect(() => decodeLifecycleDag(table)).toThrow();
      expect(() => deserializeLifecycleDag(JSON.stringify(table))).toThrow();
    } else {
      const value = decodeLifecycleDag(table) as unknown[];
      expect(value).toHaveLength(refs.length);
      // Inspect only compact alias identity, never the expanded comparison guard.
      const binary = value[0] as unknown[];
      expect(binary[0]).toBe(binary[1]);
      expect(() => deserializeLifecycleDag(JSON.stringify(table))).not.toThrow();
    }
  });
  it("rejects the exact repeated-edge cap (which necessarily exceeds the node cap)", () => {
    // Root edges: 2 * (800001 child edges + 1) = 1,600,004.
    // Each child is a compact canonical chain with 800001 unfolded edges.
    const table = binaryTable(18);
    let remaining = 800_001;
    const refs: number[] = [];
    for (let d = 18; d >= 0; d--) {
      const weight = 2 ** (d + 1) - 1;
      while (remaining >= weight) { refs.push(d); remaining -= weight; }
    }
    table.nodes.push(["a", refs]);
    table.nodes.push(["a", [19, 19]]); table.root = 20;
    expect(() => decodeLifecycleDag(table)).toThrow();
  });
  it.each([-1, 0, 1])("counts repeated strings and array-index keys at text cap %+i", delta => {
    const table = binaryTable(10, ["s", "s".repeat(3900)]);
    // 1024 strings * 3900 + 2046 one-code-unit array keys + root key "x".
    table.nodes.push(["s", "t".repeat(4353 + delta)]);
    table.nodes.push(["r", [["", 10], ["x", 11]]]); table.root = 12;
    if (delta > 0) expect(() => decodeLifecycleDag(table)).toThrow();
    else expect(() => deserializeLifecycleDag(JSON.stringify(table))).not.toThrow();
    let repeated: unknown = "s".repeat(3900);
    for (let i = 0; i < 10; i++) repeated = [repeated, repeated];
    const source = { "": repeated, x: "t".repeat(4353 + delta) };
    if (delta > 0) expect(() => encodeLifecycleDag(source)).toThrow();
    else {
      const options = { nodes: 13, edges: 22, depth: 12, bytes: Buffer.byteLength(JSON.stringify(table)) };
      expect(encodeLifecycleDag(source, options)).toEqual(table);
      expect(() => decodeLifecycleDag(encodeLifecycleDag(source, options), options)).not.toThrow();
    }
  });
  it.each([-1, 0, 1])("counts each repeated record key at text cap %+i", delta => {
    const key = "k".repeat(3900);
    const nodes: LifecycleDagNode[] = [["u"]];
    let source: unknown = undefined;
    for (let i = 0; i < 10; i++) {
      nodes.push(["r", [["", i], [key, i]]]);
      source = { "": source, [key]: source };
    }
    // 1023 repeated binary records * 3900 + the root key.
    const rootKey = "w".repeat(10300 + delta);
    nodes.push(["r", [[rootKey, 10]]]);
    const table = { root: 11, nodes };
    if (delta > 0) {
      expect(() => decodeLifecycleDag(table)).toThrow();
      expect(() => encodeLifecycleDag({ [rootKey]: source })).toThrow();
    } else {
      const restored = decodeLifecycleDag(table) as Record<string, Record<string, unknown>>;
      expect(Object.hasOwn(restored[rootKey], "")).toBe(true);
      expect(restored[rootKey][""]).toBe(restored[rootKey][key]);
      expect(encodeLifecycleDag({ [rootKey]: source })).toEqual(table);
    }
  });
  it("charges multi-digit array-index keys, not just edge counts", () => {
    // Per occurrence: 11 strings of 355 + keys 0..10 (12 code units).
    // 1024 occurrences plus binary keys: 4,013,054 code units, over cap.
    const table: LifecycleDag = { root: 11, nodes: [["s", "v".repeat(355)], ["a", Array(11).fill(0)]] };
    for (let i = 1; i <= 10; i++) table.nodes.push(["a", [i, i]]);
    expect(() => decodeLifecycleDag(table)).toThrow();
  });
  it("saturates long chains and still rejects malformed late tails without construction", () => {
    for (const depth of [53, 100, 127]) {
      const table = binaryTable(depth, ["r", []]);
      expect(() => decodeLifecycleDag(table)).toThrow();
    }
    const table = binaryTable(100, ["r", []]);
    const define = vi.spyOn(Object, "create");
    let rejected = false;
    try { decodeLifecycleDag({ root: 101, nodes: [...table.nodes, ["r", [["late", 102]]]] }); }
    catch { rejected = true; }
    const calls = define.mock.calls.length;
    define.mockRestore();
    expect(rejected).toBe(true);
    expect(calls).toBe(0);
  });
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

describe("measured compact-wire profile (CA1p)", () => {
  const repeated = (edges: number) => new Array<number>(edges).fill(0);

  it("publishes the measured 15-year wire profile ceilings", () => {
    expect(LIFECYCLE_DAG_WIRE_LIMITS).toEqual({ nodes: 220_000, edges: 4_500_000, depth: 128, bytes: 36_000_000 });
  });

  it("admits a normal run whose dictionary edges exceed the default table ceiling", () => {
    // 200,001 references intern to two definitions: the default 200,000-edge
    // table rejects the normal payload's shape, the measured profile does not.
    const normal = repeated(200_001);
    expect(() => encodeLifecycleDag(normal)).toThrow();
    const table = encodeCompactLifecycleDag(normal);
    expect(table.nodes).toHaveLength(2);
    const decoded = decodeCompactLifecycleDag(table) as number[];
    expect(decoded).toHaveLength(200_001);
    expect(decoded[0]).toBe(0);
  });

  it("admits a normal run whose expanded key/string work exceeds the default fixed ceiling", () => {
    const text = "x".repeat(4_500_000);
    expect(() => encodeLifecycleDag(text)).toThrow();
    expect(decodeCompactLifecycleDag(encodeCompactLifecycleDag(text))).toBe(text);
  });

  it("binds dictionary edges exactly at a lowered profile ceiling", () => {
    // The published ceiling (millions of edges) cannot be materialised in a test. A lowered option
    // runs the SAME edge accounting, so the boundary is still proven exactly: a table with N
    // references is admitted at a ceiling of N and refused at N - 1, on encode and on decode.
    const exact = 4_096;
    const value = repeated(exact);
    const table: LifecycleDag = { root: 1, nodes: [["n", "0"], ["a", repeated(exact)]] };
    expect(() => encodeCompactLifecycleDag(value, { edges: exact - 1 })).toThrow();
    expect(encodeCompactLifecycleDag(value, { edges: exact })).toEqual(table);
    expect(() => decodeCompactLifecycleDag(table, { edges: exact - 1 })).toThrow();
    expect(decodeCompactLifecycleDag(table, { edges: exact })).toEqual(value);
  });

  it("binds wire characters exactly at a lowered profile ceiling, counting UTF-8 bytes", () => {
    // Same wire accounting as the published `bytes` ceiling, without allocating it: the exact
    // canonical JSON byte length is the boundary. The astral payload proves bytes, not code units.
    const value = { text: "x".repeat(1_000), emoji: "😀".repeat(100) };
    const table = encodeCompactLifecycleDag(value);
    const exact = Buffer.byteLength(JSON.stringify(table), "utf8");
    expect(() => encodeCompactLifecycleDag(value, { bytes: exact - 1 })).toThrow();
    expect(encodeCompactLifecycleDag(value, { bytes: exact })).toEqual(table);
    expect(() => decodeCompactLifecycleDag(table, { bytes: exact - 1 })).toThrow();
    expect(() => decodeCompactLifecycleDag(table, { bytes: exact })).not.toThrow();
    // 100 astral code points are 200 UTF-16 units but 400 UTF-8 bytes.
    expect(exact - JSON.stringify(table).length).toBe(200);
  });

  it("keeps profile options lower-only and round-trips through its own exact-bytes codec", () => {
    const normal = repeated(200_001);
    expect(() => encodeCompactLifecycleDag(normal, { edges: 200_000 })).toThrow();
    expect(() => encodeCompactLifecycleDag(normal, { edges: 4_500_001 })).toThrow();
    const value = { negativeZero: -0, absent: undefined, text: "x".repeat(4_500_000) };
    const wire = serializeCompactLifecycleDag(value);
    const decoded = deserializeCompactLifecycleDag(wire) as Record<string, unknown>;
    expect(Object.is(decoded.negativeZero, -0)).toBe(true);
    expect(Object.hasOwn(decoded, "absent")).toBe(true);
    expect(decoded.text).toBe("x".repeat(4_500_000));
    expect(() => deserializeCompactLifecycleDag(`${wire} `)).toThrow();
  });
});

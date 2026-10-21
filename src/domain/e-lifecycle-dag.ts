import { requireFavorData } from "./effects";

/** INTERNAL data only. Neither dictionary validity nor aliases certify physics,
 * Person/Mind identity, genesis or replay. No lifecycle wire/version integration. */
export type LifecycleDagNode = ["u"] | ["z"] | ["b", boolean] | ["s", string]
  | ["n", string] | ["a", number[]] | ["r", [string, number][]];
export interface LifecycleDag { root: number; nodes: LifecycleDagNode[] }
/** nodes = unique definitions; edges = dictionary child references; depth =
 * longest decoded value path (leaf is 1); bytes = canonical JSON UTF8 bytes,
 * including the envelope. Capture work is a separate fixed internal ceiling. */
export interface LifecycleDagLimits { nodes: number; edges: number; depth: number; bytes: number }
// Conservative experimental internal ceilings, NOT measured production capacity.
const DEFAULT: LifecycleDagLimits = { nodes: 100_000, edges: 200_000, depth: 128, bytes: 4_000_000 };
/** Explicit compact-wire FORMAT profile, MEASURED 2026-10-21 against the production
 * fixture (85 people, four years): 987,205 expanded node visits, 26,783,965
 * key/string UTF16 codeunits, 17,957 unique definitions, 381,708 dictionary
 * edges, 3,034,851 canonical table bytes. It bounds DATA admitted by the wire
 * format, NOT server capacity or a physics ceiling. Options may only LOWER it. */
export const LIFECYCLE_DAG_WIRE_LIMITS: LifecycleDagLimits = Object.freeze({
  nodes: 100_000, edges: 512_000, depth: 128, bytes: 8_000_000,
});
// Safely below MAX_SAFE_INTEGER. A valid table needs at most 8 visits per
// definition and 4 per edge, plus its envelope; metadata depth is at most 6.
function workCeilings(base: LifecycleDagLimits, text: number): LifecycleDagLimits {
  const visits = 8 * base.nodes + 4 * base.edges + 4;
  return { nodes: visits, edges: visits, depth: base.depth + 6, bytes: text };
}
const CAPTURE_WORK = workCeilings(DEFAULT, DEFAULT.bytes);
const WIRE_WORK = workCeilings(LIFECYCLE_DAG_WIRE_LIMITS, 32_000_000);
function fail(): never { throw new Error("Invalid or oversized lifecycle data dictionary"); }
function integer(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0);
}
function limits(input?: Partial<LifecycleDagLimits>, base: LifecycleDagLimits = DEFAULT): LifecycleDagLimits {
  if (input === undefined) return base;
  requireFavorData(input);
  if (input === null || typeof input !== "object" || Array.isArray(input)) fail();
  const result = { ...base };
  for (const key of Object.keys(input)) {
    if (!Object.hasOwn(base, key)) fail();
    const value = input[key as keyof LifecycleDagLimits];
    if (!integer(value) || (key !== "edges" && value < 1) || value > base[key as keyof LifecycleDagLimits]) fail();
    result[key as keyof LifecycleDagLimits] = value;
  }
  return result;
}
function budget(cap: LifecycleDagLimits) {
  let nodes = 0, edges = 0, bytes = 0;
  return {
    node(depth: number) { if (++nodes > cap.nodes || depth > cap.depth) fail(); },
    edge(count: number) { edges += count; if (edges > cap.edges) fail(); },
    text(text: string) {
      // Check length before allocating any escaped signature/string.
      bytes += text.length;
      if (bytes > cap.bytes) fail();
    },
  };
}
/** Guard first, then bounded descriptor traversal BEFORE private clone. This
 * deliberately revisits borrowed DAGs (no unknown-object memo/certificate).
 * Admission-work limits can reject a highly repeated input even if its compact
 * representation is small. They bound capture, not released capacity. The
 * existing whole guard unfolds borrowed DAGs BEFORE these work limits: this is
 * NOT a total adversarial preflight bound; changing that guard belongs to CT1. */
function capture(input: unknown, ceiling: LifecycleDagLimits): unknown {
  requireFavorData(input, true);
  const work = budget(ceiling);
  function visit(value: unknown, depth: number): void {
    work.node(depth);
    if (typeof value === "string") work.text(value);
    if (value === null || typeof value !== "object") return;
    const keys = Object.keys(value);
    work.edge(keys.length);
    for (const key of keys) {
      work.text(key);
      visit(Object.getOwnPropertyDescriptor(value, key)!.value, depth + 1);
    }
  }
  visit(input, 1);
  return structuredClone(input);
}
/** Fixed format admission envelope, in unfolded capture units, not authority.
 * `text` counts UTF16 string values AND every own key (including array indices).
 * Keep the sentinel at cap + 1: every operand stays small even for 2^127 work. */
interface ExpandedWork { nodes: number; edges: number; text: number; depth: number }
function saturatedAdd(a: number, b: number, cap: number): number {
  return a > cap || b > cap - a ? cap + 1 : a + b;
}
function expandedWork(node: LifecycleDagNode, earlier: ExpandedWork[], ceiling: LifecycleDagLimits): ExpandedWork {
  const result: ExpandedWork = { nodes: 1, edges: 0, text: node[0] === "s" ? node[1].length : 0, depth: 1 };
  const refs = children(node);
  for (let i = 0; i < refs.length; i++) {
    const child = earlier[refs[i]];
    const key = node[0] === "r" ? node[1][i][0] : String(i);
    result.nodes = saturatedAdd(result.nodes, child.nodes, ceiling.nodes);
    result.edges = saturatedAdd(result.edges, 1, ceiling.edges);
    result.edges = saturatedAdd(result.edges, child.edges, ceiling.edges);
    result.text = saturatedAdd(result.text, key.length, ceiling.bytes);
    result.text = saturatedAdd(result.text, child.text, ceiling.bytes);
    result.depth = Math.max(result.depth, child.depth + 1);
  }
  // A single leaf can itself exceed the text ceiling.
  result.text = saturatedAdd(0, result.text, ceiling.bytes);
  return result;
}
function admitExpansion(work: ExpandedWork, ceiling: LifecycleDagLimits): void {
  if (work.nodes > ceiling.nodes || work.edges > ceiling.edges ||
    work.text > ceiling.bytes || work.depth > ceiling.depth) fail();
}
function children(node: LifecycleDagNode): number[] {
  return node[0] === "a" ? node[1] : node[0] === "r" ? node[1].map(pair => pair[1]) : [];
}
function wire(table: LifecycleDag, cap: LifecycleDagLimits): string {
  const text = JSON.stringify(table);
  if (Buffer.byteLength(text, "utf8") > cap.bytes) fail();
  return text;
}
function encodeDag(input: unknown, cap: LifecycleDagLimits, ceiling: LifecycleDagLimits): LifecycleDag {
  const owned = capture(input, ceiling), work = budget(cap);
  const nodes: LifecycleDagNode[] = [], heights: number[] = [], signatures = new Map<string, number>();
  // Identity memo ONLY over the private clone; exact complete signatures intern
  // values independently of identity. Signatures contain child IDs, not subtrees.
  const memo = new Map<object, number>();
  function visit(value: unknown): number {
    if (value !== null && typeof value === "object" && memo.has(value)) return memo.get(value)!;
    let node: LifecycleDagNode;
    if (value === undefined) node = ["u"];
    else if (value === null) node = ["z"];
    else if (typeof value === "boolean") node = ["b", value];
    else if (typeof value === "string") node = ["s", value];
    else if (typeof value === "number") node = ["n", Object.is(value, -0) ? "-0" : String(value)];
    else if (Array.isArray(value)) node = ["a", value.map(child => visit(child))];
    else node = ["r", Object.keys(value as object).sort().map((key): [string, number] =>
      [key, visit((value as Record<string, unknown>)[key])])];
    const signature = JSON.stringify(node);
    let id = signatures.get(signature);
    if (id === undefined) {
      const refs = children(node);
      let height = 1;
      for (const ref of refs) height = Math.max(height, heights[ref] + 1);
      work.node(height); work.edge(refs.length); work.text(signature);
      id = nodes.length; nodes.push(node); heights.push(height); signatures.set(signature, id);
    }
    if (value !== null && typeof value === "object") memo.set(value, id);
    return id;
  }
  const table = { root: visit(owned), nodes };
  // Use the exact decoder admission path, including compact-envelope capture:
  // encoding must never emit a table rejected by same-options decoding.
  return validate(table, cap, ceiling);
}
/** Validate every definition, including unused tails, before materializing any
 * decoded data. Canonical DFS walks compact edges once, never unfolded values. */
function validate(input: unknown, cap: LifecycleDagLimits, ceiling: LifecycleDagLimits): LifecycleDag {
  const owned = capture(input, ceiling);
  if (owned === null || typeof owned !== "object" || Array.isArray(owned)) fail();
  const record = owned as Record<string, unknown>;
  if (Object.keys(record).sort().join(",") !== "nodes,root" || !Array.isArray(record.nodes)) fail();
  const raw = record.nodes;
  if (!raw.length || raw.length > cap.nodes || !integer(record.root) || record.root !== raw.length - 1) fail();
  const signatures = new Set<string>(), nodes: LifecycleDagNode[] = [], heights: number[] = [];
  const work = budget(cap), expanded: ExpandedWork[] = [];
  for (let index = 0; index < raw.length; index++) {
    const cell = raw[index];
    if (!Array.isArray(cell)) fail();
    const tag = cell[0], value = cell[1];
    if (tag === "u" || tag === "z") { if (cell.length !== 1) fail(); }
    else {
      if (cell.length !== 2) fail();
      if (tag === "b") { if (typeof value !== "boolean") fail(); }
      else if (tag === "s") { if (typeof value !== "string") fail(); }
      else if (tag === "n") {
        if (typeof value !== "string" || !Number.isFinite(Number(value)) ||
          (value !== "-0" && String(Number(value)) !== value)) fail();
      } else if (tag === "a" || tag === "r") {
        if (!Array.isArray(value)) fail();
        let previous: string | undefined;
        for (const entry of value) {
          let ref = entry;
          if (tag === "r") {
            if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== "string" ||
              (previous !== undefined && previous >= entry[0])) fail();
            previous = entry[0]; ref = entry[1];
          }
          if (!integer(ref) || ref >= index) fail();
        }
      } else fail();
    }
    const node = cell as LifecycleDagNode, refs = children(node);
    let height = 1;
    for (const ref of refs) height = Math.max(height, heights[ref] + 1);
    work.node(height); work.edge(refs.length);
    const signature = JSON.stringify(node);
    work.text(signature);
    if (signatures.has(signature)) fail();
    signatures.add(signature); nodes.push(node); heights.push(height);
    // Earlier-only refs were checked above. Saturate, but finish all structural
    // and canonical checks even after an intermediate definition is oversized.
    expanded.push(expandedWork(node, expanded, ceiling));
  }
  const seen = new Set<number>();
  let next = 0;
  function order(id: number): void {
    if (seen.has(id)) return;
    for (const ref of children(nodes[id])) order(ref);
    if (id !== next++) fail();
    seen.add(id);
  }
  order(record.root);
  if (seen.size !== nodes.length) fail();
  const table = { root: record.root, nodes };
  wire(table, cap);
  admitExpansion(expanded[record.root], ceiling);
  return table;
}
function materialize(table: LifecycleDag): unknown {
  const values: unknown[] = [];
  for (const node of table.nodes) {
    const tag = node[0];
    let value: unknown;
    if (tag === "u") value = undefined;
    else if (tag === "z") value = null;
    else if (tag === "n") value = Number(node[1]);
    else if (tag === "b" || tag === "s") value = node[1];
    else if (tag === "a") value = node[1].map(ref => values[ref]);
    else {
      const record: Record<string, unknown> = Object.create(null);
      for (const [key, ref] of node[1]) Object.defineProperty(record, key,
        { value: values[ref], enumerable: true, writable: true, configurable: true });
      value = record;
    }
    values.push(value);
  }
  // Mutable but privately owned data aliases, never a world or certificate.
  return values[table.root];
}
export function encodeLifecycleDag(input: unknown, options?: Partial<LifecycleDagLimits>): LifecycleDag {
  return encodeDag(input, limits(options), CAPTURE_WORK);
}
/** Explicit compact-wire entry points. They use ONLY the measured profile and
 * never change the default functions above; options may still lower it. */
export function encodeCompactLifecycleDag(input: unknown, options?: Partial<LifecycleDagLimits>): LifecycleDag {
  return encodeDag(input, limits(options, LIFECYCLE_DAG_WIRE_LIMITS), WIRE_WORK);
}
export function decodeLifecycleDag(input: unknown, options?: Partial<LifecycleDagLimits>): unknown {
  return materialize(validate(input, limits(options), CAPTURE_WORK));
}
export function decodeCompactLifecycleDag(input: unknown, options?: Partial<LifecycleDagLimits>): unknown {
  return materialize(validate(input, limits(options, LIFECYCLE_DAG_WIRE_LIMITS), WIRE_WORK));
}
export function serializeLifecycleDag(input: unknown, options?: Partial<LifecycleDagLimits>): string {
  return serializeDag(input, limits(options), CAPTURE_WORK);
}
export function serializeCompactLifecycleDag(input: unknown, options?: Partial<LifecycleDagLimits>): string {
  return serializeDag(input, limits(options, LIFECYCLE_DAG_WIRE_LIMITS), WIRE_WORK);
}
function serializeDag(input: unknown, cap: LifecycleDagLimits, ceiling: LifecycleDagLimits): string {
  return wire(encodeDag(input, cap, ceiling), cap);
}
export function deserializeLifecycleDag(input: unknown, options?: Partial<LifecycleDagLimits>): unknown {
  return deserializeDag(input, limits(options), CAPTURE_WORK);
}
export function deserializeCompactLifecycleDag(input: unknown, options?: Partial<LifecycleDagLimits>): unknown {
  return deserializeDag(input, limits(options, LIFECYCLE_DAG_WIRE_LIMITS), WIRE_WORK);
}
function deserializeDag(input: unknown, cap: LifecycleDagLimits, ceiling: LifecycleDagLimits): unknown {
  if (typeof input !== "string" || input.length > cap.bytes || Buffer.byteLength(input, "utf8") > cap.bytes) fail();
  const table = validate(JSON.parse(input), cap, ceiling);
  if (wire(table, cap) !== input) fail();
  return materialize(table);
}

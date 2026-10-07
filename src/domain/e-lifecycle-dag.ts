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
// Safely below MAX_SAFE_INTEGER. A valid table needs at most 8 visits per
// definition and 4 per edge, plus its envelope; metadata depth is at most 6.
const CAPTURE_WORK: LifecycleDagLimits = {
  nodes: 8 * DEFAULT.nodes + 4 * DEFAULT.edges + 4,
  edges: 8 * DEFAULT.nodes + 4 * DEFAULT.edges + 4,
  depth: DEFAULT.depth + 6, bytes: DEFAULT.bytes,
};
function fail(): never { throw new Error("Invalid or oversized lifecycle data dictionary"); }
function integer(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0);
}
function limits(input?: Partial<LifecycleDagLimits>): LifecycleDagLimits {
  if (input === undefined) return DEFAULT;
  requireFavorData(input);
  if (input === null || typeof input !== "object" || Array.isArray(input)) fail();
  const result = { ...DEFAULT };
  for (const key of Object.keys(input)) {
    if (!Object.hasOwn(DEFAULT, key)) fail();
    const value = input[key as keyof LifecycleDagLimits];
    if (!integer(value) || (key !== "edges" && value < 1) || value > DEFAULT[key as keyof LifecycleDagLimits]) fail();
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
function capture(input: unknown): unknown {
  requireFavorData(input, true);
  const work = budget(CAPTURE_WORK);
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
function children(node: LifecycleDagNode): number[] {
  return node[0] === "a" ? node[1] : node[0] === "r" ? node[1].map(pair => pair[1]) : [];
}
function wire(table: LifecycleDag, cap: LifecycleDagLimits): string {
  const text = JSON.stringify(table);
  if (Buffer.byteLength(text, "utf8") > cap.bytes) fail();
  return text;
}
export function encodeLifecycleDag(input: unknown, options?: Partial<LifecycleDagLimits>): LifecycleDag {
  const cap = limits(options), owned = capture(input), work = budget(cap);
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
  wire(table, cap);
  return table;
}
/** Validate every definition, including unused tails, before materializing any
 * decoded data. Canonical DFS walks compact edges once, never unfolded values. */
function validate(input: unknown, cap: LifecycleDagLimits): LifecycleDag {
  const owned = capture(input);
  if (owned === null || typeof owned !== "object" || Array.isArray(owned)) fail();
  const record = owned as Record<string, unknown>;
  if (Object.keys(record).sort().join(",") !== "nodes,root" || !Array.isArray(record.nodes)) fail();
  const raw = record.nodes;
  if (!raw.length || raw.length > cap.nodes || !integer(record.root) || record.root !== raw.length - 1) fail();
  const signatures = new Set<string>(), nodes: LifecycleDagNode[] = [], heights: number[] = [];
  const work = budget(cap);
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
export function decodeLifecycleDag(input: unknown, options?: Partial<LifecycleDagLimits>): unknown {
  return materialize(validate(input, limits(options)));
}
export function serializeLifecycleDag(input: unknown, options?: Partial<LifecycleDagLimits>): string {
  const cap = limits(options);
  return wire(encodeLifecycleDag(input, cap), cap);
}
export function deserializeLifecycleDag(input: unknown, options?: Partial<LifecycleDagLimits>): unknown {
  const cap = limits(options);
  if (typeof input !== "string" || input.length > cap.bytes || Buffer.byteLength(input, "utf8") > cap.bytes) fail();
  const table = validate(JSON.parse(input), cap);
  if (wire(table, cap) !== input) fail();
  return materialize(table);
}

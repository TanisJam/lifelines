import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { beginLegacyYear, resolveLegacyVitalDecision } from "./legacy-year";
import * as legacyYear from "./legacy-year";
import { RuleDecisionMaker } from "@/adapters/decision/rule-decision-maker";
import { createMind } from "./mind";
import { createMarriageFunnelCollector, simulateYears, type SimulateOptions } from "./simulate";
import type { Event, Person, WorldConfig } from "./types";
import { generateWorld } from "./worldgen";

// Ordered, typed graph encoding: JSON alone loses own undefined, -0 and aliases.
// Every enumerable key (including array indices) is retained in traversal order.
function canonical(value: unknown): string {
  const seen = new Map<object, number>();
  function encode(v: unknown): unknown {
    if (v === undefined) return ["undefined"];
    if (typeof v === "number") return ["number", Object.is(v, -0) ? "-0" : String(v)];
    if (v === null || typeof v !== "object") return [typeof v, v];
    const previous = seen.get(v);
    if (previous !== undefined) return ["ref", previous];
    const id = seen.size;
    seen.set(v, id);
    if (v instanceof Map) return ["map", id, [...v].map(([k, item]) => [encode(k), encode(item)])];
    return [Array.isArray(v) ? "array" : "object", id, Object.keys(v).map((key) => [key, encode((v as Record<string, unknown>)[key])])];
  }
  return JSON.stringify(encode(value));
}
function digest(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

async function observe(config: WorldConfig, people: Record<string, Person>, events: Event[], options: Partial<SimulateOptions> = {}) {
  const debug = createMarriageFunnelCollector();
  const generator = simulateYears(config, people, events, {
    decisionMaker: new RuleDecisionMaker(), engineSource: "rules", marriageFunnelDebug: debug, ...options,
  });
  const years: [number, string][] = [];
  for (;;) {
    const step = await generator.next();
    if (step.done) {
      const { wallTimeMs: _wallTimeMs, ...report } = step.value;
      void _wallTimeMs;
      return { years: digest(years), final: digest({ report, debug }), events: report.result.events, report };
    }
    // Hash each complete yielded snapshot immediately, not a terminal reconstruction.
    years.push([step.value.year, digest(step.value)]);
  }
}

function person(seed: string, id: string, sex: "f" | "m", overrides: Partial<Person> = {}): Person {
  return { id, name: id, sex, birthYear: 1500, traits: [], job: "none", founder: true,
    socialClass: "villein", mind: createMind(seed, id, 1500), ...overrides };
}
function force(kind: string, id: string, optionId: string) {
  return { id: `force-${kind}-${id}`, decisionId: `${kind}:${id}:1530`, optionId };
}

const seeded = [
  ["maternal-check-37", 24],
  ["artisan-widow-trade-dec083-1", 30],
  ["lockout-check-12", 24],
] as const;
// Captured from the unextracted public API at 4df561a, then rerun before moving source.
const pins: Record<string, { years: string; final: string }> = {
  "maternal-check-37": { years: "e6b28ed0e44cb6ff65066d46d212b5ba42e569b59b7e6913cc6ba9726dbc5a6c", final: "5f89559cd1b109896d1ead3ca88ccdfe80a604ccbd03da6c2615c19b1be9d107" },
  "artisan-widow-trade-dec083-1": { years: "3c8358d49c84317d943a04d7027c4e93ae81c0bb401ce87741fe6f00a2f283fa", final: "dc1955c0c17592997b1e8e807aeb6c220bda506783c88bc3dafa63d6b56db81e" },
  "lockout-check-12": { years: "09201227246f2fda5a26b7093825b0ca86a5643ca721e8ed580e76f8b5406e30", final: "1181d26015a10d833b14b9eb169f622cb0ab498953e51cda6ffd0c904690837e" },
  "illness-death-widow": { years: "d4a1bffb9f88e526ba823b4d42e053398871e0a85a17896f6efdc2d4c3fd8dfa", final: "aa5e71d6ee9ebfa88fffcd8fcb946aa2707f8f9ecdc5dc4d8f18c1aaa66112a5" },
  "dead-suitors": { years: "354fd6bcecc9116be4f91192e7745d35673e528c731924e98c52a9ae75b346c5", final: "eef68ccdf78546b54f7e8171f8dfa0e2c5a4060b33f4a3bcfbce17f9bf9c8c05" },
  "arranged-departure": { years: "531399aad4a8193897f21102739b3dcd543cf050f502ae71fd311cf1026f48b3", final: "b2d61a5645d97f2d1dabcbdba47da766d30ccb35a4065dfc263f8c1589a7e127" },
  "away-birth": { years: "116ec4b7f951de66d3825c4bdfb8d08b3036fd3c444b1f151cd6e7e9b043b7dc", final: "44ebbb70ceb17ed4b68db7ec90ec3f56fbb6a8bc30d33ac6a3c3c9066cbd8341" },
  "return": { years: "9d1a96c5315c13d3eff73c10204d93ebc475c8eb725942a4e4daab8be636887d", final: "ba368c8ca4210551b14b797ac854360d7a34424f5e16523bc51549a49b1e5a7b" },
};

describe("legacy whole-year canonical baseline", () => {
  it("exposes the bounded annual phase kernel", () => {
    expect(beginLegacyYear).toBeTypeOf("function");
    expect(resolveLegacyVitalDecision).toBeTypeOf("function");
  });

  it("the public annual generator actively delegates on its owned state", async () => {
    const begin = vi.spyOn(legacyYear, "beginLegacyYear");
    const vital = vi.spyOn(legacyYear, "resolveLegacyVitalDecision");
    try {
      const world = generateWorld({ seed: "legacy-delegation", startYear: 1530, endYear: 1530, founderCount: 10 });
      const observed = await observe(world.config, world.people, world.events);
      expect(begin).toHaveBeenCalledTimes(1);
      expect(vital).toHaveBeenCalled();
      const context = begin.mock.calls[0]![0];
      for (const [used] of vital.mock.calls) {
        expect(used).toBe(context);
        expect(used.people).toBe(observed.report.result.people);
        expect(used.events).toBe(observed.report.result.events);
        expect(used.decisions).toBe(observed.report.result.decisions);
      }
      expect(context.counters.decisionCalls).toBe(observed.report.decisionCalls);
      expect(world.people).not.toBe(context.people);
    } finally {
      begin.mockRestore();
      vital.mockRestore();
    }
  });

  it("forced recovery retains same-year illness while override anchoring stays at fromYear", async () => {
    const seed = "legacy-recovery";
    const subject = person(seed, "subject", "m");
    const config = { seed, startYear: 1529, endYear: 1531, town: { name: "Testville" } };
    const observed = await observe(config, { subject }, [], {
      fromYear: 1530,
      overrides: [force("illness", "subject", "illness"), force("death", "subject", "survive")],
    });
    const illness = observed.events.find((e) => e.kind === "illness" && e.actors[0] === "subject");
    expect(illness?.year).toBe(1530);
    expect(illness?.payload.recovered).toBe(true);
    const forced = observed.report.result.decisions.filter((d) => d.source === "forced");
    expect(forced).toHaveLength(2);
    expect(forced.every((d) => d.year === 1530)).toBe(true);
    expect([...observed.report.snapshots.keys()]).toEqual([1529, 1530, 1531]);
  });
  it("distinguishes serialization quirks and identity", () => {
    expect(canonical({ a: undefined })).not.toBe(canonical({}));
    expect(canonical(-0)).not.toBe(canonical(0));
    expect(canonical({ a: 1, b: 2 })).not.toBe(canonical({ b: 2, a: 1 }));
    const shared = {};
    expect(canonical([shared, shared])).not.toBe(canonical([{}, {}]));
  });

  for (const [seed, founderCount] of seeded) {
    it(`pins every year and final canon: ${seed}`, async () => {
      const world = generateWorld({ seed, founderCount, startYear: 1498, endYear: 1558 });
      const observed = await observe(world.config, world.people, []);
      if (seed === "maternal-check-37") expect(observed.events.some((e) => e.kind === "death" && e.payload.cause === "childbirth")).toBe(true);
      if (seed === "artisan-widow-trade-dec083-1") expect(observed.events.some((e) => e.kind === "widowed" && e.payload.keptTrade)).toBe(true);
      expect({ years: observed.years, final: observed.final }).toEqual(pins[seed] ?? {});
    }, 30000);
  }

  for (const scenario of ["illness-death-widow", "dead-suitors", "arranged-departure", "away-birth", "return"] as const) {
    it(`pins forced ${scenario}`, async () => {
      const seed = "legacy-forced";
      const config = { seed, startYear: 1530, endYear: 1530, town: { name: "Testville" } };
      const people: Record<string, Person> = {};
      const events: Event[] = [];
      const overrides = [];
      let protagonistId: string | undefined;
      if (scenario === "illness-death-widow") {
        people.husband = person(seed, "husband", "m", { spouseId: "wife", socialClass: "artisan", // Deliberately retain this legacy fixture's unrecognized trade spelling: no normalization on extraction.
          job: "smith" as Person["job"] });
        people.wife = person(seed, "wife", "f", { spouseId: "husband" });
        overrides.push(force("illness", "husband", "illness"), force("death", "husband", "die"), force("death", "wife", "survive"));
      } else if (scenario === "dead-suitors") {
        people.alice = person(seed, "alice", "f");
        for (const id of ["bob1", "bob2"]) {
          people[id] = person(seed, id, "m");
          events.push({ id: `romance-${id}`, year: 1529, kind: "romance", actors: ["alice", id], payload: {}, causes: [] });
          overrides.push(force("death", id, "survive"));
        }
        overrides.push(force("death", "alice", "die"));
      } else if (scenario === "arranged-departure") {
        people.daughter = person(seed, "daughter", "f", { socialClass: "gentry" });
        overrides.push(force("death", "daughter", "survive"), force("arranged-match", "daughter", "arrange"));
      } else {
        people.protagonist = person(seed, "protagonist", "m", { spouseId: scenario === "away-birth" ? "wife" : undefined });
        protagonistId = "protagonist";
        events.push({ id: "move", year: 1525, kind: "move", actors: ["protagonist"], payload: { away: true }, causes: [] });
        overrides.push(force("death", "protagonist", "survive"), force("return", "protagonist", scenario === "return" ? "return" : "stay"));
        if (scenario === "away-birth") {
          people.wife = person(seed, "wife", "f", { spouseId: "protagonist", away: true });
          overrides.push(force("A2", "wife", "try"));
        }
      }
      const observed = await observe(config, people, events, { overrides, protagonistId });
      const fresh = observed.events.filter((e) => e.year === 1530);
      if (scenario === "illness-death-widow") {
        expect(fresh.map((e) => e.kind).slice(0, 3)).toEqual(["illness", "death", "widowed"]);
        expect(fresh.some((e) => e.payload.keptTrade === true)).toBe(true);
      }
      if (scenario === "dead-suitors") expect(fresh.filter((e) => e.kind === "breakup")).toHaveLength(2);
      if (scenario === "arranged-departure") expect(fresh.some((e) => e.kind === "move" && e.payload.arranged)).toBe(true);
      if (scenario === "away-birth") expect(Object.values(observed.report.result.people).some((p) => p.motherId === "wife" && p.away)).toBe(true);
      if (scenario === "return") expect(fresh.some((e) => e.kind === "move" && e.payload.returned)).toBe(true);
      expect({ years: observed.years, final: observed.final }).toEqual(pins[scenario] ?? {});
    });
  }
});

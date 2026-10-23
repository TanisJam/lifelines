import { describe, expect, it, vi } from "vitest";
import * as rng from "./rng";
import * as worldgen from "./worldgen";
import { initializationJson, initializeWorld } from "./world-initialization";
import { keyedRng } from "./rng";
import { generateWorld } from "./worldgen";

const options = { seed: "e1-core", founderCount: 6, startYear: 1327, endYear: 1332, protagonist: { name: "Mara", sex: "random" as const } };

describe("E1 initialization", () => {
  it("captures the complete actual initial world before mutation", () => {
    const { world, origin } = initializeWorld(options);
    expect(world).toEqual(generateWorld(options));
    expect(origin.initial.config).toEqual(world.config);
    expect(origin.initial.people).toEqual(world.people);
    expect(origin.initial.events).toEqual(world.events);
    expect(origin.initial.registryOrder).toEqual(Object.keys(world.people));
    expect(origin.sex).toEqual({ requested: "random", resolved: world.people.protagonist.sex, draw: { personId: "protagonist", year: 1327, purpose: "sex", salt: 0, value: keyedRng(options.seed, "protagonist", 1327, "sex")() } });
  });

  it("repeats generation and preserves caller and returned-world isolation", () => {
    const caller = structuredClone(options);
    const before = structuredClone(caller);
    const first = initializeWorld(caller);
    const second = initializeWorld(caller);
    expect(first.origin).toEqual(second.origin);
    expect(caller).toEqual(before);
    caller.protagonist.name = "Changed";
    first.world.people.protagonist.mind.facets.altruism = 0;
    first.world.events[0] = { ...first.world.events[0], payload: { changed: true } };
    expect(first.origin).toEqual(second.origin);
    expect(first.world.people).not.toBe(first.origin.initial.people);
    expect(Object.isFrozen(first.origin.initial.people.protagonist.mind.facets)).toBe(true);
    expect(() => Reflect.set(first.origin.initial.people.protagonist.mind.facets, "altruism", 101)).not.toThrow();
    expect(first.origin).toEqual(second.origin);
  });

  it("captures actual defaults and explicit equivalence without guessing town names", () => {
    const implicit = initializeWorld({ seed: "default-origin" });
    expect(implicit.world).toEqual(generateWorld({ seed: "default-origin" }));
    expect(implicit.origin.effective).toEqual({ seed: "default-origin", startYear: 1498, endYear: 1558, founderCount: 62, townName: implicit.world.config.town.name });
    const explicit = initializeWorld(implicit.origin.effective);
    expect(explicit.world).toEqual(implicit.world);
    expect(explicit.origin.initial).toEqual(implicit.origin.initial);
    expect(explicit.origin.effective).toEqual(implicit.origin.effective);
    expect(explicit.origin.requested).not.toEqual(implicit.origin.requested);
    expect(explicit.origin.digest).not.toBe(implicit.origin.digest);
  });

  it("keeps random selection name-blind across seeds, with both outcomes possible", () => {
    const sexes = new Set<string>();
    for (let i = 0; i < 12; i++) {
      const request = { ...options, seed: `sex-${i}` };
      const a = initializeWorld(request);
      const b = initializeWorld({ ...request, protagonist: { name: "Rowan", sex: "random" } });
      expect(a.origin.sex).toEqual(b.origin.sex);
      expect(a.world.people.protagonist.sex).toBe(keyedRng(request.seed, "protagonist", 1327, "sex")() < .5 ? "f" : "m");
      sexes.add(a.world.people.protagonist.sex);
    }
    expect([...sexes].sort()).toEqual(["f", "m"]);
  });

  it.each(["f", "m"] as const)("preserves explicit %s without manufacturing a draw", (sex) => {
    const initialized = initializeWorld({ ...options, protagonist: { name: "Mara", sex } });
    expect(initialized.world.people.protagonist.sex).toBe(sex);
    expect(initialized.origin.sex).toEqual({ requested: sex, resolved: sex });
  });

  it("draws at the random operation only, never for absent/explicit sex", () => {
    const real = rng.keyedRng;
    const draws: number[] = [];
    const spy = vi.spyOn(rng, "keyedRng").mockImplementation((...args) => {
      const next = real(...args);
      if (args[1] !== "protagonist" || args[3] !== "sex") return next;
      return () => { const value = next(); draws.push(value); return value; };
    });
    try {
      const random = initializeWorld(options);
      expect(draws).toEqual([random.origin.sex.requested === "random" ? random.origin.sex.draw!.value : -1]);
      draws.length = 0;
      initializeWorld({ ...options, protagonist: { name: "Mara", sex: "f" } });
      initializeWorld({ seed: options.seed, founderCount: 6 });
      expect(draws).toEqual([]);
    } finally { spy.mockRestore(); }
  });

  it.each(["startYear", "endYear", "founderCount"] as const)("rejects negative-zero %s before generation or random draws", (field) => {
    const generation = vi.spyOn(worldgen, "generateWorld");
    const random = vi.spyOn(rng, "keyedRng");
    try {
      const input = { ...options, startYear: 0, endYear: 0, [field]: -0 };
      expect(() => initializeWorld(input)).toThrow(/Negative zero/);
      expect(generation).not.toHaveBeenCalled();
      expect(random).not.toHaveBeenCalled();
      expect(Object.is(input[field], -0)).toBe(true);
    } finally { generation.mockRestore(); random.mockRestore(); }
  });

  it("captures no-protagonist and small/zero founder behavior faithfully", () => {
    const request = { seed: "zero-founders", founderCount: 0, townName: "" };
    const initialized = initializeWorld(request);
    expect(initialized.world).toEqual(generateWorld(request));
    expect(initialized.world.people.protagonist).toBeUndefined();
    expect(initialized.origin.sex).toEqual({ requested: null, resolved: null });
    expect(initialized.origin.effective.founderCount).toBe(0);
    expect(initialized.world.config.town.name).toBe("");
  });

  it("preserves lossless JS strings including lone surrogates, NUL and empty seed/name", () => {
    const request = { ...options, seed: "", townName: "\ud800\u0000é", protagonist: { name: "", sex: "f" as const } };
    const initialized = initializeWorld(request);
    expect(initialized.world).toEqual(generateWorld(request));
    expect(initialized.origin.effective.townName).toBe(request.townName);
    expect(initialized.origin.initial.people.protagonist.name).toBe("");
  });

  it("classifies all generated marriage/birth/death/period backstory as initial canon", () => {
    const kinds = new Set<string>();
    for (let i = 0; i < 8; i++) {
      const request = { ...options, seed: `famine-${i}` };
      const { world, origin } = initializeWorld(request);
      expect(origin.initial.events).toEqual(generateWorld(request).events);
      expect(origin.initial.people).toEqual(world.people);
      for (const event of origin.initial.events) kinds.add(event.kind);
      const birth = origin.initial.events.find((e) => e.kind === "birth" && e.actors[0] === "protagonist")!;
      expect(birth.year).toBe(1327);
      expect(initializationJson(birth.payload)).toBe("{}");
    }
    expect([...kinds].sort()).toEqual(["birth", "death", "marriage", "period-marker"]);
  });

  it("uses no fetch or ambient randomness", () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(() => { throw new Error("No network authority"); });
    const random = vi.spyOn(Math, "random").mockImplementation(() => { throw new Error("No ambient randomness"); });
    try {
      initializeWorld(options);
      expect(fetch).not.toHaveBeenCalled();
      expect(random).not.toHaveBeenCalled();
    } finally { fetch.mockRestore(); random.mockRestore(); }
  });
});

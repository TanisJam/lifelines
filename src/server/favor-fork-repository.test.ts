import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createHelpFavorState } from "../domain/effects";
import { createFavorScheduler } from "../domain/scheduler";
import { createFavorFork, runFavorForkYear } from "../domain/favor-fork";
import { createFavorForkCapsule, serializeFavorForkCapsule } from "../domain/favor-fork-capsule";
import { MemoryFavorRecords, type FavorRecords } from "./favor-repository";
import { FavorForkRepository } from "./favor-fork-repository";

const capsule = (key = "root") => createFavorForkCapsule(runFavorForkYear(createFavorFork(createFavorScheduler(createHelpFavorState({}, [], {}, {}, {}), "seed", 1335), key), 1337));
describe("D2b serialized immutable records", () => {
  it("cold loads from a fresh repository instance, detached from save/load objects", async () => {
    const map = new Map<string, string>();
    const input = capsule();
    const wire = serializeFavorForkCapsule(input);
    const repo = new FavorForkRepository(new MemoryFavorRecords(map));
    const key = await repo.save(input);
    expect(map.get(key)).toBe(wire);
    input.fork.key = "mutated";
    const fresh = new FavorForkRepository(new MemoryFavorRecords(map));
    const loaded = (await fresh.load(key))!;
    expect(serializeFavorForkCapsule(loaded)).toBe(wire);
    expect(await fresh.save(loaded)).toBe(key);
    loaded.fork.prefix.completedYear = 9999;
    expect(serializeFavorForkCapsule(await fresh.load(key))).toBe(wire);
    expect(map.size).toBe(1);
    expect(await fresh.load("0".repeat(64))).toBeUndefined();
  });
  it.each(["broken", "wrong-key", "noncanonical", "semantic"])("rejects existing %s bytes on load AND retry without replacement", async kind => {
    const input = capsule();
    let wire = "not JSON";
    if (kind === "wrong-key") wire = serializeFavorForkCapsule(capsule("other"));
    if (kind === "noncanonical") wire = ` ${serializeFavorForkCapsule(input)}`;
    if (kind === "semantic") wire = serializeFavorForkCapsule(input).replace('"completedYear":1337', '"completedYear":1338');
    const map = new Map([[input.digest, wire]]);
    const repo = new FavorForkRepository(new MemoryFavorRecords(map));
    await expect(repo.load(input.digest)).rejects.toThrow();
    await expect(repo.save(input)).rejects.toThrow();
    expect(map.get(input.digest)).toBe(wire);
  });
  it("rejects semantically forged stored canon even under a recomputed matching key", async () => {
    const input = capsule();
    input.fork.lineage = "forged";
    function encode(value: unknown): string {
      if (Array.isArray(value)) return `[${value.map(encode).join(",")}]`;
      if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${encode((value as Record<string, unknown>)[key])}`).join(",")}}`;
      return JSON.stringify(value);
    }
    const { digest: _digest, ...payload } = input;
    void _digest;
    input.digest = createHash("sha256").update(encode(payload), "utf8").digest("hex");
    const wire = encode(input);
    const map = new Map([[input.digest, wire]]);
    const repo = new FavorForkRepository(new MemoryFavorRecords(map));
    await expect(repo.load(input.digest)).rejects.toThrow("disagreement");
    await expect(repo.save(input)).rejects.toThrow("disagreement");
    expect(map.get(input.digest)).toBe(wire);
  });
  it("propagates insertion failure with no publication", async () => {
    const map = new Map<string, string>();
    const records: FavorRecords = { read: key => map.get(key), insert() { throw new Error("failed atomically"); } };
    await expect(new FavorForkRepository(records).save(capsule())).rejects.toThrow("failed atomically");
    expect(map.size).toBe(0);
  });
  it("relies on adapter atomic immutable insertion rather than race-prone pre-read", async () => {
    const map = new Map<string, string>();
    const memory = new MemoryFavorRecords(map);
    let reads = 0;
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const records: FavorRecords = {
      async read() { if (++reads === 2) release(); await gate; return undefined; },
      insert: (key, wire) => memory.insert(key, wire),
    };
    const input = capsule();
    expect(await Promise.all([new FavorForkRepository(records).save(input), new FavorForkRepository(records).save(input)])).toEqual([input.digest, input.digest]);
    expect(map.size).toBe(1);
    expect(() => memory.insert(input.digest, "conflict")).toThrow();
    expect(map.get(input.digest)).toBe(serializeFavorForkCapsule(input));
  });
  it("cannot overwrite a conflicting record inserted after pre-read", async () => {
    const input = capsule();
    const map = new Map<string, string>();
    const memory = new MemoryFavorRecords(map);
    const records: FavorRecords = {
      read() { map.set(input.digest, "concurrent conflicting bytes"); return undefined; },
      insert: (key, wire) => memory.insert(key, wire),
    };
    await expect(new FavorForkRepository(records).save(input)).rejects.toThrow("Conflicting");
    expect(map.get(input.digest)).toBe("concurrent conflicting bytes");
  });
  it("rejects bad keys and inputs before touching records", async () => {
    let calls = 0;
    const repo = new FavorForkRepository({ read() { calls++; return undefined; }, insert() { calls++; } });
    await expect(repo.load("bad")).rejects.toThrow();
    await expect(repo.load({ toString() { calls++; return "bad"; } })).rejects.toThrow();
    await expect(repo.save({})).rejects.toThrow();
    expect(calls).toBe(0);
  });
  it("imports no production/legacy DB, simulation or providers", () => {
    const source = readFileSync(new URL("./favor-fork-repository.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/(?:from\s+["'][^"']*(?:simulate|life-store|\/db|decision-engine|worldgen|replay|adapters)|require\()/);
  });
});

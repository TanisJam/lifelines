import { admitFavorForkCapsule, deserializeFavorForkCapsule, serializeFavorForkCapsule, type FavorForkCapsule } from "../domain/favor-fork-capsule";
import type { FavorRecords } from "./favor-repository";

function requireKey(key: unknown): asserts key is string {
  if (typeof key !== "string" || !/^[a-f0-9]{64}$/.test(key)) throw new Error("Invalid D capsule key");
}
function decode(key: string, wire: unknown): FavorForkCapsule {
  const capsule = deserializeFavorForkCapsule(wire);
  if (capsule.digest !== key) throw new Error("Repository key/hash disagreement");
  return capsule;
}

/** Opaque serialized strings only. FavorRecords is a trusted capability: insert MUST
 * atomically accept identical bytes or reject conflicts, with no publication on failure.
 * The pre-read optimizes validated retries; it is NOT race protection. No DB, branch
 * binding, latest pointer or durability claim is introduced by this wrapper. */
export class FavorForkRepository {
  constructor(private readonly records: FavorRecords) {}
  async save(input: unknown): Promise<string> {
    const capsule = admitFavorForkCapsule(input);
    const wire = serializeFavorForkCapsule(capsule);
    const key = capsule.digest;
    const existing = await this.records.read(key);
    if (existing !== undefined) {
      decode(key, existing); // Even retries independently re-admit untrusted stored bytes.
      if (existing !== wire) throw new Error("Conflicting immutable record");
      return key;
    }
    await this.records.insert(key, wire);
    return key;
  }
  async load(key: unknown): Promise<FavorForkCapsule | undefined> {
    requireKey(key);
    const wire = await this.records.read(key);
    return wire === undefined ? undefined : decode(key, wire);
  }
}

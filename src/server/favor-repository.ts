import { admitFavorCapsule, deserializeFavorCapsule, serializeFavorCapsule, type FavorCapsule } from "../domain/favor-capsule";

/** Trusted storage capability: immutable atomic insert, including failure with no publication.
 * Records (unlike the capability) are untrusted and always admitted on retrieval.
 * D1 intentionally has no DB/provider/environment imports or latest/fork pointers. */
export interface FavorRecords {
  read(key: string): string | undefined | Promise<string | undefined>;
  insert(key: string, wire: string): void | Promise<void>;
}
function requireKey(key: unknown): asserts key is string {
  if (typeof key !== "string" || !/^[a-f0-9]{64}$/.test(key)) throw new Error("Invalid capsule key");
}
function decode(key: string, wire: unknown): FavorCapsule {
  const capsule = deserializeFavorCapsule(wire);
  if (capsule.digest !== key) throw new Error("Repository key/hash disagreement");
  return capsule;
}

/** Serialized-memory proof only; a shared Map enables fresh-instance cold loads, not durability. */
export class MemoryFavorRecords implements FavorRecords {
  constructor(private readonly records: Map<string, string> = new Map()) {}
  read(key: string): string | undefined { return this.records.get(key); }
  insert(key: string, wire: string): void {
    const previous = this.records.get(key);
    if (previous !== undefined && previous !== wire) throw new Error("Conflicting immutable record");
    this.records.set(key, wire);
  }
}

export class FavorRepository {
  constructor(private readonly records: FavorRecords) {}
  async save(input: unknown): Promise<string> {
    const capsule = admitFavorCapsule(input);
    const wire = serializeFavorCapsule(capsule);
    const key = capsule.digest;
    const existing = await this.records.read(key);
    if (existing !== undefined) {
      decode(key, existing);
      if (existing !== wire) throw new Error("Conflicting immutable record");
      return key;
    }
    await this.records.insert(key, wire);
    return key;
  }
  async load(key: unknown): Promise<FavorCapsule | undefined> {
    requireKey(key);
    const wire = await this.records.read(key);
    return wire === undefined ? undefined : decode(key, wire);
  }
}

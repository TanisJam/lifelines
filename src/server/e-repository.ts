import {
  admitAnnualRuntimeCapsule,
  deserializeAnnualRuntimeCapsule,
  serializeAnnualRuntimeCapsule,
  type AnnualRuntimeCapsule,
} from "../domain/e-capsule";
import type { FavorRecords } from "./favor-repository";

function requireKey(key: unknown): asserts key is string {
  if (typeof key !== "string" || key.length !== 64 || !/^[a-f0-9]{64}$/.test(key)) {
    throw new Error("Invalid capsule key");
  }
}

function decode(key: string, wire: unknown): AnnualRuntimeCapsule {
  const capsule = deserializeAnnualRuntimeCapsule(wire);
  if (capsule.digest !== key) throw new Error("Repository key/hash disagreement");
  return capsule;
}

/** Inactive content-addressed storage for one complete rules-only runtime capsule.
 * The injected port owns atomic immutable insertion; retrieved bytes are untrusted.
 * Admission is semantic integrity, not authenticated authorship or retained history. */
export class AnnualRuntimeRepository {
  constructor(private readonly records: FavorRecords) {}

  async save(input: unknown): Promise<string> {
    const capsule = admitAnnualRuntimeCapsule(input);
    const wire = serializeAnnualRuntimeCapsule(capsule);
    const key = capsule.digest;
    const existing = await this.records.read(key);
    if (existing !== undefined) {
      decode(key, existing);
      if (existing !== wire) throw new Error("Conflicting immutable record");
      return key;
    }
    // A concurrent winner is checked by the trusted insert capability, not this
    // pre-read. Propagate conflicts/failures rather than returning a false key.
    await this.records.insert(key, wire);
    return key;
  }

  async load(key: unknown): Promise<AnnualRuntimeCapsule | undefined> {
    requireKey(key);
    const wire = await this.records.read(key);
    return wire === undefined ? undefined : decode(key, wire);
  }
}

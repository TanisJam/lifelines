import { requireFields } from "./obligations";

/** Only consumed factors; resources and actor eligibility belong to the reducer. */
export interface FavorFactors {
  openDebt: boolean;
  altruism: number;
  anxiety: number;
  wealthPreference: number;
  trust: number;
  resentment: number;
}
export interface FavorPolicy {
  factors: FavorFactors;
  options: ["help", "refuse"];
  distribution: [number, number];
}

/** Calibrated-later engineering defaults, not a historical model of motives. */
export function favorPolicy(factors: FavorFactors, maskDebt = false): FavorPolicy {
  if (!factors || typeof factors !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(factors))) throw new Error("Expected plain factors");
  for (const key of Reflect.ownKeys(factors)) {
    const descriptor = Object.getOwnPropertyDescriptor(factors, key)!;
    if (typeof key !== "string" || !descriptor.enumerable || !("value" in descriptor)) throw new Error("Expected own-data factors");
  }
  requireFields(factors, ["openDebt", "altruism", "anxiety", "wealthPreference", "trust", "resentment"]);
  if (typeof factors.openDebt !== "boolean" || typeof maskDebt !== "boolean") throw new Error("Expected boolean debt salience");
  for (const [key, min, max] of [["altruism", 0, 100], ["anxiety", 0, 100], ["wealthPreference", -50, 50], ["trust", -100, 100], ["resentment", 0, 100]] as const) {
    const value = factors[key];
    if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) throw new Error("Invalid consumed factor");
  }
  const p = Math.max(0.1, Math.min(0.9, 0.4 + 0.2 * Number(factors.openDebt && !maskDebt) + (factors.altruism - 50) / 500 - (factors.anxiety - 50) / 1000 - factors.wealthPreference / 500 + factors.trust / 1000 - factors.resentment / 1000));
  return { factors: { ...factors, openDebt: factors.openDebt && !maskDebt }, options: ["help", "refuse"], distribution: [p, 1 - p] };
}

/** Derive the option from validated factors, never an arbitrary distribution. */
export function selectFavorResponse(factors: FavorFactors, noise: number): "help" | "refuse" {
  const policy = favorPolicy(factors);
  if (typeof noise !== "number" || !Number.isFinite(noise) || noise < 0 || noise >= 1) throw new Error("Invalid uniform draw");
  return noise < policy.distribution[0] ? "help" : "refuse";
}

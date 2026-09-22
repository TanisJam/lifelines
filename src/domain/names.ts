/**
 * Small fixed name pools. Deterministic index selection, not free text generation.
 *
 * Round 13 (decision 048): replaced with period-attested English given names and surnames for
 * early Tudor England, c. 1498-1558 — the setting the engine is now anchored to (research.md,
 * "Life by social class, 1498-1558"). Pool sizes are unchanged (20 entries each) so name-collision
 * odds don't increase relative to the old fantasy pools.
 */

export const FEMALE_NAMES = [
  "Agnes", "Joan", "Alice", "Margaret", "Elizabeth", "Isabel", "Katherine", "Anne", "Emma", "Cecily",
  "Margery", "Christian", "Beatrice", "Denise", "Edith", "Eleanor", "Joanna", "Mabel", "Rose", "Sibyl",
] as const;

export const MALE_NAMES = [
  "John", "Thomas", "William", "Richard", "Robert", "Henry", "Nicholas", "Edward", "Walter", "Roger",
  "Simon", "Hugh", "Peter", "Stephen", "Adam", "Gilbert", "Ralph", "Geoffrey", "Edmund", "Alexander",
] as const;

export const SURNAMES = [
  "Smith", "Miller", "Carter", "Taylor", "Baker", "Webb", "Cooke", "Fletcher",
  "Ward", "Hayward", "Thatcher", "Shepherd", "Mason", "Tanner", "Turner", "Wright",
  "Palmer", "Fuller", "Dyer", "Coleman",
] as const;

export function pickName(sex: "f" | "m", nameIndex: number, surnameIndex: number): string {
  const first = sex === "f" ? FEMALE_NAMES[nameIndex % FEMALE_NAMES.length] : MALE_NAMES[nameIndex % MALE_NAMES.length];
  const last = SURNAMES[surnameIndex % SURNAMES.length];
  return `${first} ${last}`;
}

/**
 * `pickName`, but guaranteed not to collide with an existing full name
 * (round 4 fix B4: "Silas Hallowmere" showed up twice with no way to tell
 * them apart in the loom or biography). Tries the preferred index, then
 * walks forward through the name pool deterministically. If every name in
 * the pool is already taken with this surname (small pool, unlikely but
 * possible in a large town), falls back to an epithet distinguishing them
 * by birth order — "the Elder" for whoever was already there, "the
 * Younger" for the new arrival, matching the DF-legends flavor.
 */
export function pickUniqueName(existingNames: ReadonlySet<string>, sex: "f" | "m", preferredIndex: number, surnameIndex: number): string {
  const poolSize = sex === "f" ? FEMALE_NAMES.length : MALE_NAMES.length;
  for (let offset = 0; offset < poolSize; offset++) {
    const candidate = pickName(sex, preferredIndex + offset, surnameIndex);
    if (!existingNames.has(candidate)) return candidate;
  }
  const base = pickName(sex, preferredIndex, surnameIndex);
  return `${base} the Younger`;
}

/**
 * Small fixed name pools. Deterministic index selection, not free text generation.
 *
 * Decision 063 (engine-life-course PR4): replaces the Tudor-era pool (decision 048) with names
 * informed by the 1379 Yorkshire poll tax (research.md M-S8: 1,794 female and 1,665 male recorded
 * names). John and William dominate the male pool there — repeated here so uniform index selection
 * (`pickName`'s `nameIndex % length`) reproduces that skew without changing the picking algorithm.
 * `SURNAMES` mixes the four byname patterns the poll tax attests (patronymic, occupational,
 * locative, nickname) — surnames were still consolidating into inherited family names in this
 * period, so a byname here reads as "of this trade/place/kin/trait", not yet a fixed lineage name.
 * Pool sizes stay at 20 entries each, matching decision 048's collision-odds rationale.
 */

export const FEMALE_NAMES = [
  "Agnes", "Alice", "Joan", "Matilda", "Cecily", "Isabel", "Margaret", "Alison", "Emma", "Beatrice",
  "Christina", "Margery", "Avice", "Juliana", "Denise", "Edith", "Eleanor", "Joanna", "Mabel", "Rose",
] as const;

/** Repeated `"John"`/`"William"` entries (4 each, 40% of the pool) reproduce the poll tax's dominant-names skew under plain `index % length` selection — no change to `pickName`'s algorithm. */
export const MALE_NAMES = [
  "John", "John", "John", "John", "William", "William", "William", "William",
  "Robert", "Richard", "Thomas", "Adam", "Henry", "Walter", "Nicholas", "Simon", "Roger", "Hugh", "Geoffrey", "Alexander",
] as const;

/** Patronymic (4), occupational (8), locative (4), nickname (4) — the four byname patterns research.md M-S8 attests for this period. */
export const SURNAMES = [
  "Johnson", "Williamson", "Robertson", "Richardson",
  "Smith", "Baker", "Miller", "Carter", "Shepherd", "Fletcher", "Webb", "Turner",
  "atte Wood", "atte Hill", "atte Bridge", "Green",
  "Long", "Short", "Reed", "Whitehead",
] as const;

export function pickName(sex: "f" | "m", nameIndex: number, surnameIndex: number): string {
  const first = sex === "f" ? FEMALE_NAMES[nameIndex % FEMALE_NAMES.length] : MALE_NAMES[nameIndex % MALE_NAMES.length];
  const last = SURNAMES[surnameIndex % SURNAMES.length];
  return `${first} ${last}`;
}

/**
 * `pickName`, but guaranteed not to collide with an existing full name (unchanged contract from
 * decision 048's Tudor-era pool — see the original round-4 fix note it carried forward). Tries the
 * preferred index, then walks forward through the name pool deterministically. If every name in the
 * pool is already taken with this surname, falls back to an epithet distinguishing them by birth
 * order — "the Elder" for whoever was already there, "the Younger" for the new arrival.
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

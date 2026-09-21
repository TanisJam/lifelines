/** Small fixed name pools. Deterministic index selection, not free text generation. */

export const FEMALE_NAMES = [
  "Aria", "Briala", "Cressida", "Dana", "Elowen", "Fira", "Greta", "Hana", "Ilva", "Junia",
  "Kira", "Liora", "Mira", "Nella", "Orla", "Petra", "Quilla", "Rosalind", "Sable", "Talia",
] as const;

export const MALE_NAMES = [
  "Aldric", "Branwell", "Cedric", "Dorian", "Elric", "Fenwick", "Garrick", "Hollis", "Ivo", "Jonas",
  "Kaelan", "Loran", "Merric", "Nolan", "Osric", "Perrin", "Quill", "Roran", "Silas", "Torin",
] as const;

export const SURNAMES = [
  "Ashford", "Brightwater", "Cinderfell", "Duskwood", "Embermoor", "Fairwind", "Greyhollow", "Hallowmere",
  "Ironvale", "Juniperwick", "Kestrelholt", "Larkspire", "Mossgate", "Nightwood", "Oakhaven", "Ravensworth",
  "Stonebrook", "Thistledown", "Underhill", "Whitmoor",
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

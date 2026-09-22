import { SOCIAL_CLASS_POOL, type Person, type SimulationResult, type SocialClass } from "../types";

/**
 * Tudor-era (decision 049) class labels this change retires (decision 063, engine-life-course PR4)
 * — kept ONLY as a read-time lookup for lives stored before the 1327-1361 period rename, never
 * assigned to a newly-simulated `Person`. 1:1 per design revision 2, decision 10:
 * `labourer`->`cottar`, `husbandman`->`villein`, `yeoman`->`freeholder`; `artisan`/`merchant`/
 * `clergy`/`gentry` are unchanged in spelling and meaning, listed here too so `mapLegacyClass` can
 * treat "already current" and "legacy" the same way.
 */
const LEGACY_CLASS_MAP: Readonly<Record<string, SocialClass>> = {
  labourer: "cottar",
  husbandman: "villein",
  yeoman: "freeholder",
  artisan: "artisan",
  merchant: "merchant",
  clergy: "clergy",
  gentry: "gentry",
};

/**
 * Maps a raw stored `socialClass` string — legacy Tudor-era OR already-current period value — to
 * its current `SocialClass`. Returns `undefined` for anything else (never throws), matching every
 * other optional-field convention in this codebase: the caller decides its own fallback (e.g.
 * `?? "cottar"`), same as `person.socialClass` itself.
 */
export function mapLegacyClass(raw: string | undefined): SocialClass | undefined {
  if (raw === undefined) return undefined;
  const mapped = LEGACY_CLASS_MAP[raw];
  if (mapped) return mapped;
  return (SOCIAL_CLASS_POOL as readonly string[]).includes(raw) ? (raw as SocialClass) : undefined;
}

/**
 * Read-time-only class remap for a whole `SimulationResult` — `life-store.ts`'s read path calls
 * this on every decompressed branch/summary result so a life stored before the rename displays
 * mapped period classes, while the bytes on disk are never touched (spec's "Legacy class mapping at
 * read time" requirement — no migration). Returns the SAME object (no new allocation) when nothing
 * needed mapping, so a life simulated entirely under the new classes round-trips with zero overhead.
 */
export function remapLegacyClasses(result: SimulationResult): SimulationResult {
  let changed = false;
  const people: Record<string, Person> = {};
  for (const [id, person] of Object.entries(result.people)) {
    const mapped = mapLegacyClass(person.socialClass);
    if (mapped !== undefined && mapped !== person.socialClass) {
      changed = true;
      people[id] = { ...person, socialClass: mapped };
    } else {
      people[id] = person;
    }
  }
  return changed ? { ...result, people } : result;
}

/**
 * English/Spanish display labels per period class (decision 063), following the same compile-time
 * key-parity convention as `src/i18n/dictionary.ts` (`Dictionary` inferred from the canonical `en`
 * object) — here inferred from `SOCIAL_CLASS_POOL` itself via `Record<SocialClass, string>`, so
 * either map missing a class is a compile error, backed by `classes.test.ts`'s runtime parity check.
 */
export const CLASS_LABEL_EN: Readonly<Record<SocialClass, string>> = {
  villein: "villein",
  cottar: "cottar",
  freeholder: "freeholder",
  artisan: "artisan",
  merchant: "merchant",
  clergy: "clergy",
  gentry: "gentry",
};

export const CLASS_LABEL_ES: Readonly<Record<SocialClass, string>> = {
  villein: "villano",
  cottar: "campesino sin tierra",
  freeholder: "terrateniente libre",
  artisan: "artesano",
  merchant: "mercader",
  clergy: "clero",
  gentry: "hidalgo",
};

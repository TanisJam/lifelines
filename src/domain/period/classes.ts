import { SOCIAL_CLASS_POOL, type Person, type SimulationResult, type SocialClass, type YearSnapshot } from "../types";

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
 * Documented fallback for a `Record<SocialClass, X>` lookup that somehow receives an unrecognized
 * string at runtime — deliberate defense in depth: every deserialization path (branch `result`,
 * branch `snapshots`, life summaries) SHOULD already be routed through `mapLegacyClass`/
 * `remapLegacyClasses`/`remapSnapshots` before a `Person.socialClass` reaches any class-keyed table,
 * but `SimulationResult`/`YearSnapshot` are `decompressJson<T>`-cast from stored bytes — TypeScript
 * trusts that cast, runtime data does not have to honor it. A lookup miss degrades to this class
 * instead of throwing (`MIN_MARRIAGE_AGE[undefined]`) or silently NaN-ing (`CLASS_MORTALITY_
 * MULTIPLIER[undefined]`), matching the design's "hazard lookup never throws" principle
 * (`period/literacy.ts`'s design counterpart, `lookupHazard`, is PR6's job — this is PR4's).
 */
export const FALLBACK_CLASS: SocialClass = "cottar";

/**
 * Remaps every `Person.socialClass` in a `people` record (shared by `remapLegacyClasses` and
 * `remapSnapshotClasses` below). Returns the SAME object reference when nothing needed mapping.
 */
function remapPeopleClasses(people: Readonly<Record<string, Person>>): { people: Readonly<Record<string, Person>>; changed: boolean } {
  let changed = false;
  const mapped: Record<string, Person> = {};
  for (const [id, person] of Object.entries(people)) {
    const mappedClass = mapLegacyClass(person.socialClass);
    if (mappedClass !== undefined && mappedClass !== person.socialClass) {
      changed = true;
      mapped[id] = { ...person, socialClass: mappedClass };
    } else {
      mapped[id] = person;
    }
  }
  return changed ? { people: mapped, changed } : { people, changed };
}

/**
 * Read-time-only class remap for a whole `SimulationResult` — `life-store.ts`'s read path calls
 * this on every decompressed branch/summary result so a life stored before the rename displays
 * mapped period classes, while the bytes on disk are never touched (spec's "Legacy class mapping at
 * read time" requirement — no migration). Returns the SAME object (no new allocation) when nothing
 * needed mapping, so a life simulated entirely under the new classes round-trips with zero overhead.
 */
export function remapLegacyClasses(result: SimulationResult): SimulationResult {
  const { people, changed } = remapPeopleClasses(result.people);
  return changed ? { ...result, people } : result;
}

/**
 * Same read-time-only remap as `remapLegacyClasses`, for a single `YearSnapshot` — the exact fix for
 * the CRITICAL follow-up bug: PR4 originally remapped a branch's `result` but NOT its `snapshots`,
 * so restoring a fork (`fork.ts#getRestoreSnapshot`) from a life stored before the rename handed
 * `simulate()` people still carrying Tudor-era classes, which then throws inside `MIN_MARRIAGE_AGE`
 * lookups. Returns the SAME object reference when nothing needed mapping.
 */
export function remapSnapshotClasses(snapshot: YearSnapshot): YearSnapshot {
  const { people, changed } = remapPeopleClasses(snapshot.people);
  return changed ? { ...snapshot, people } : snapshot;
}

/**
 * Maps every snapshot in a branch's snapshot map — `life-store.ts#rowToBranch`'s read path for the
 * `snapshots_blob` field, the sibling of `remapLegacyClasses` for `result_json`. Always returns a
 * fresh `Map` (cheap — it only re-wraps references), but each individual snapshot inside it is the
 * SAME object when unchanged, same allocation discipline as `remapSnapshotClasses`.
 */
export function remapSnapshots(snapshots: ReadonlyMap<number, YearSnapshot>): Map<number, YearSnapshot> {
  const mapped = new Map<number, YearSnapshot>();
  for (const [year, snapshot] of snapshots) mapped.set(year, remapSnapshotClasses(snapshot));
  return mapped;
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

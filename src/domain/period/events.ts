/**
 * Engine life course PR5: dated national/period events for the 1327-1361 window (spec's
 * "period-setting-1327-1361" capability, "Dated national events" requirement; design revision 2's
 * "Period events" table; research.md M-S3/M-S4/M-S5). Every constant with no firm historical figure
 * ships as a NAMED, DOCUMENTED default plus its research range (spec's tunable-ranges requirement) —
 * never a silent magic number.
 */
import { keyedDraw } from "../rng";
import type { SocialClass } from "../types";

// --- Great Famine 1315-22 (pre-window backstory only; the run starts 1327) -------------------------

/**
 * The founder/founder-child birth cohort the Great Famine can plausibly have thinned — Kershaw 1973
 * via research.md M-S4. Deliberately wider than the famine's own 1315-22 span: someone born as
 * early as 1305 was still an infant/small child (0-10) during the famine years and part of the same
 * at-risk cohort research reports mortality for.
 */
export const FAMINE_WINDOW = { start: 1305, end: 1322 } as const;

/** research.md M-S4 (Kershaw 1973): 10-15% rural mortality, 10-25% (up to town-specific 25%) urban. Point defaults per design revision 2. */
export const FAMINE_COHORT_THINNING = { rural: 0.12, urban: 0.25 } as const;

/** The year research dates the famine's worst dearth; a founder born by this year minus `FAMINE_MARKER_MIN_AGE` was old enough to remember living through it (design: "backfilled period-marker for founders aged >=5 in 1315"). */
export const FAMINE_MARKER_YEAR = 1315;
export const FAMINE_MARKER_MIN_AGE = 5;

export function isBornInFamineWindow(birthYear: number): boolean {
  return birthYear >= FAMINE_WINDOW.start && birthYear <= FAMINE_WINDOW.end;
}

/**
 * Deterministic, keyed cohort-thinning check (design: "worldgen thins founder birth cohorts
 * 1305-1322 by x(1-M)") — a NEW, dedicated `"famine-cohort-thinning"` key so it never perturbs any
 * OTHER worldgen draw for the same person (age/name/traits/job/literacy all keep their own keys).
 * Pre-window backstory only: this never runs against an in-sim birth (the sim starts 1327, well
 * after the window closes), only against founders/founder-children generated at world creation.
 */
export function famineClaimedChildhood(seed: string, personId: string, birthYear: number, isUrban = false): boolean {
  if (!isBornInFamineWindow(birthYear)) return false;
  const thinning = isUrban ? FAMINE_COHORT_THINNING.urban : FAMINE_COHORT_THINNING.rural;
  return keyedDraw(seed, personId, birthYear, "famine-cohort-thinning") < thinning;
}

/**
 * A deterministic death year for a famine-claimed founder child, bounded to fall within the famine
 * window and no more than 6 years after birth (era-typical famine-driven child mortality strikes
 * early, not a decade later) — never before birth, never after the window closes.
 */
export function famineDeathYear(seed: string, personId: string, birthYear: number): number {
  const windowEnd = Math.min(FAMINE_WINDOW.end, birthYear + 6);
  const span = Math.max(0, windowEnd - birthYear);
  const offset = Math.floor(keyedDraw(seed, personId, birthYear, "famine-death-year") * (span + 1));
  return birthYear + offset;
}

/** True if a person born this year was already `>=FAMINE_MARKER_MIN_AGE` by `FAMINE_MARKER_YEAR` — old enough to carry a real childhood memory of the famine, not too young to have been claimed by it instead. */
export function survivedFamineAsChild(birthYear: number): boolean {
  return birthYear <= FAMINE_MARKER_YEAR - FAMINE_MARKER_MIN_AGE;
}

// --- Cattle murrain 1319-21 (pre-window backstory only) ---------------------------------------------

export const MURRAIN_WINDOW = { start: 1319, end: 1321 } as const;

/** research.md M-S4: ~62% (0.50-0.70) cattle loss, but it acts on FOOD, not people directly — the design's own framing ("no wealth model exists; adding one is out of scope"). Kept at 1.0 (no direct human-mortality effect) so nothing double-counts it against the famine's own dearth multiplier. */
export const MURRAIN_HUMAN_MULTIPLIER = 1.0;
export const MURRAIN_CATTLE_LOSS = { default: 0.62, min: 0.5, max: 0.7 } as const;

/** Only tenant-farming classes plausibly kept enough cattle for the murrain to be a real household memory (design's markers table: "villein/freeholder founder households get a backstory marker"). */
export const MURRAIN_MARKER_CLASSES: ReadonlySet<SocialClass> = new Set(["villein", "freeholder"]);

export function eligibleForMurrainMarker(socialClass: SocialClass | undefined): boolean {
  return socialClass !== undefined && MURRAIN_MARKER_CLASSES.has(socialClass);
}

// --- Black Death 1348-49 -----------------------------------------------------------------------------

export const BLACK_DEATH_YEARS: ReadonlySet<number> = new Set([1348, 1349]);

/** research.md M-S3: Russell ~20-23.6%, Goldberg ~45%, Benedictow 62.5% — a genuinely contested range (spec's gap-flagged, tunable requirement). */
export const BLACK_DEATH_MORTALITY = { default: 0.4, min: 0.2, max: 0.625 } as const;

/** How the two dated years split the total (share of the plague YEAR, June 1348 - Dec 1349, per M-S3's own dating) — a DESIGN ASSUMPTION (no year-by-year split is sourced), weighted toward the first wave. */
const BLACK_DEATH_YEAR_SHARE: Readonly<Record<number, number>> = { 1348: 0.6, 1349: 0.4 };

/**
 * Per-year mortality probability for `year`, given a total two-year mortality `totalMortality`
 * (default `BLACK_DEATH_MORTALITY.default`), via the design's own formula `p_y = 1-(1-M)^share` —
 * chosen so that surviving BOTH dated years has exactly `(1-totalMortality)` probability. `undefined`
 * outside 1348-49 (this is a dated shock, never rolled for any other year).
 */
export function blackDeathMortalityForYear(year: number, totalMortality: number = BLACK_DEATH_MORTALITY.default): number | undefined {
  const share = BLACK_DEATH_YEAR_SHARE[year];
  if (share === undefined) return undefined;
  return 1 - Math.pow(1 - totalMortality, share);
}

// --- Second pestilence 1361-62 (child-skewed) --------------------------------------------------------

export const SECOND_PESTILENCE_YEARS: ReadonlySet<number> = new Set([1361, 1362]);

/** research.md's "pestis puerorum ~20-24%, young-skewed" (low-medium confidence). The adult figure is a DESIGN ASSUMPTION (no adult-specific rate is sourced) — set low enough to keep the documented child skew real. */
export const SECOND_PESTILENCE_MORTALITY = { child: 0.22, childMin: 0.2, childMax: 0.24, adult: 0.05 } as const;
const SECOND_PESTILENCE_YEAR_SHARE: Readonly<Record<number, number>> = { 1361: 0.6, 1362: 0.4 };

/** The age at or under which someone counts as a "child" for this pestilence's documented skew. */
export const SECOND_PESTILENCE_CHILD_MAX_AGE = 15;

/** Same `p_y=1-(1-M)^share` construction as the Black Death, with `M` chosen per age band (child vs. adult) so the documented skew survives the two-year split intact. `undefined` outside 1361-62. */
export function secondPestilenceMortalityForYear(year: number, age: number): number | undefined {
  const share = SECOND_PESTILENCE_YEAR_SHARE[year];
  if (share === undefined) return undefined;
  const total = age <= SECOND_PESTILENCE_CHILD_MAX_AGE ? SECOND_PESTILENCE_MORTALITY.child : SECOND_PESTILENCE_MORTALITY.adult;
  return 1 - Math.pow(1 - total, share);
}

// --- Hundred Years' War levies, Ordinance and Statute of Labourers -----------------------------------

/** research.md's event list: the war (and its taxation) opens in 1337; the levy/taxation spike this engine models runs through 1347, the year before the Black Death changes everything. */
export const HUNDRED_YEARS_WAR_LEVY_START_YEAR = 1337;
export const HUNDRED_YEARS_WAR_LEVY_END_YEAR = 1347;

export function isHundredYearsWarLevyYear(year: number): boolean {
  return year >= HUNDRED_YEARS_WAR_LEVY_START_YEAR && year <= HUNDRED_YEARS_WAR_LEVY_END_YEAR;
}

/** research.md M-S5: the Ordinance (18 Jun 1349) and the Statute (9 Feb 1351) — wages pinned at 1346 levels, leaving the vill banned, work compelled under 68. */
export const ORDINANCE_OF_LABOURERS_YEAR = 1349;
export const STATUTE_OF_LABOURERS_YEAR = 1351;

/**
 * One-time, dated national events pushed unconditionally at their historical year(s) — narrative
 * markers, independent of `townEventForYear`'s own single-slot roll for that year (mirrors decision
 * 058's Tudor-era pattern, now dated for 1327-1361). Deliberately NOT given their own mortality
 * multiplier: the Hundred Years' War levy years' real effect is the protagonist's own levy odds
 * (`isHundredYearsWarLevyYear`, wired in `simulate.ts`), and the Statute's mobility/wage effects are
 * deferred to PR6's hazard system (design's own "Hazard shapes" table: "after 1349 xm (mobility) with
 * a Statute factor" needs `hazards.ts`, not yet built).
 */
export const DATED_NATIONAL_EVENTS: readonly { readonly year: number; readonly type: string }[] = [
  { year: HUNDRED_YEARS_WAR_LEVY_START_YEAR, type: "hundred-years-war-begins" },
  { year: ORDINANCE_OF_LABOURERS_YEAR, type: "ordinance-of-labourers" },
  { year: STATUTE_OF_LABOURERS_YEAR, type: "statute-of-labourers" },
];

export function datedNationalEventTypesForYear(year: number): readonly string[] {
  return DATED_NATIONAL_EVENTS.filter((e) => e.year === year).map((e) => e.type);
}

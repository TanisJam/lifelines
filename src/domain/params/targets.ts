/**
 * Engine life course PR6 (design revision 2, decision 11): calibration targets from
 * `sdd/engine-life-course/research` #6144, consumed by PR8's `check-demographics --stats --assert`
 * harness (tasks 8.1-8.5). Declared here (not just in prose) so a later PR's assertion reads one
 * shared source of truth instead of re-deriving the numbers from docs.
 */

export interface CalibrationBand {
  readonly min: number;
  readonly max: number;
  readonly unit: string;
  readonly note: string;
}

export const CALIBRATION_TARGETS: Readonly<Record<string, CalibrationBand>> = {
  firstMarriageAgeWomen: { min: 18, max: 22, unit: "years", note: "Mean age at first marriage, women (design revision 2, decision 14)." },
  firstMarriageAgeMen: { min: 21, max: 25, unit: "years", note: "Mean age at first marriage, men. Merchant men are explicitly checked against this upper bound." },
  widowRemarriagePreBlackDeath: { min: 60, max: 66, unit: "% of widows", note: "research #6144 M-S2 (Razi): 63% before the Black Death." },
  widowRemarriagePostBlackDeath: { min: 23, max: 29, unit: "% of widows", note: "research #6144 M-S2 (Razi): 26% after the Black Death." },
  blackDeathMortality: { min: 20, max: 62.5, unit: "% of cohort", note: "research #6144 M-S3 (Russell ~20-23.6%, Benedictow 62.5%); tunable, contested." },
  lifeExpectancyAtBirth: { min: 22, max: 35, unit: "years", note: "research #6144 calibration targets; low confidence." },
  infantMortality: { min: 30, max: 30, unit: "% by age 1", note: "research #6144: ~30%, plus a further 20-30% more by age 7." },
  under15DeathShare: { min: 20, max: 30, unit: "% additional by age 7", note: "research #6144: a further 20-30% of survivors die by age 7." },
  literacyOverall: { min: 4, max: 6, unit: "% c.1330", note: "research #6144: literacy ~5% c.1330, low confidence." },
} as const;

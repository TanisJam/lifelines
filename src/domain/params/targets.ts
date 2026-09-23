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
  /**
   * PR10 (decision 071): widened from a degenerate point band (min=max=30) — structurally
   * unhittable by any stochastic run, per decision 069/070's own repeated finding. `research
   * #6144: ~30%, plus a further 20-30% more by age 7` names 30% as a single best estimate, not a
   * measured range; +/-5 keeps the same central estimate while making the band statistically
   * reachable, matching how every other researched figure here (e.g. `under15DeathShare`) is
   * already expressed as a range rather than a point.
   */
  infantMortality: { min: 25, max: 35, unit: "% by age 1", note: "research #6144: ~30% (central estimate; widened to a real range, decision 071), plus a further 20-30% more by age 7." },
  under15DeathShare: { min: 20, max: 30, unit: "% additional by age 7", note: "research #6144: a further 20-30% of survivors die by age 7." },
  literacyOverall: { min: 4, max: 6, unit: "% c.1330", note: "research #6144: literacy ~5% c.1330, low confidence." },
  /**
   * PR10 (GOAL B, decision 071): gentry/noble women married markedly earlier via arranged
   * matches. `docs/research.md`'s own marriage-age table (line 340) interpolates Hollingsworth's
   * long-run nobility trend back to a 14th-century anchor of ~17 for women — squarely inside this
   * engine's own 1327-1361 window, more directly applicable than the table's 16th-century
   * endpoint. The user-approved band (14-18) brackets that anchor and matches the Follett
   * narrative reference (Tilly's arranged marriage at 14, engram #6321/#6149) on its low end.
   */
  firstMarriageAgeWomenGentry: { min: 14, max: 18, unit: "years", note: "docs/research.md line 340 (Hollingsworth 14th c. interpolation, women ~17) + Follett narrative reference (Tilly m. 14, engram #6321)." },
  /**
   * PR10 (GOAL B, decision 071): gentry/noble men married later than their brides, per the same
   * `docs/research.md` table's 14th-century anchor (~22 for men) — early-to-mid 20s, matching the
   * task's own stated expectation. Kept a real band (not a point) since the anchor is itself an
   * interpolation, not a direct period measurement.
   */
  firstMarriageAgeMenGentry: { min: 20, max: 24, unit: "years", note: "docs/research.md line 340 (Hollingsworth 14th c. interpolation, men ~22)." },
  /**
   * PR10 (GOAL A, decision 071): the population-trajectory shape the task itself specifies for a
   * plausible 14th-century English village — not a primary-source figure, but the orchestrator's
   * own stated plausibility band for this engine's 1327-1361 default play window. Measured as
   * `scripts/check-demographics.ts`'s own trajectory checkpoints (1327/1347/1350/1361), same
   * 25-seed methodology decision 070 used.
   */
  populationPrePlagueChangePercent: { min: -10, max: 10, unit: "% change, 1327->1347", note: "PR10 task instruction (GOAL A): pre-plague should be flat to mild change, not a steep decline." },
  populationPlagueShockPercent: { min: -50, max: -40, unit: "% change, 1347->1350", note: "PR10 task instruction (GOAL A): a ~40-50% Black Death shock." },
  populationRecoveryChangePercent: { min: -10, max: 60, unit: "% change, 1350->1361", note: "PR10 task instruction (GOAL A): partial recovery or stabilization after the plague, not continued collapse." },
} as const;

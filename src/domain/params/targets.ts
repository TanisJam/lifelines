/**
 * Decision 078: the calibration goal is now "Follett-plausible", not historically exact. The user
 * wants lives that read like Ken Follett's Kingsbridge novels (World Without End covers exactly the
 * 1327-1361 default window): drama, plot, novelistic events. Bands marked `Follett-plausible` are
 * invented narrative targets, NOT sourced figures. Bands still citing research are kept because the
 * history already serves the drama (the plague shock, infant death).
 *
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
  firstMarriageAgeWomen: { min: 18, max: 23, unit: "years", note: "Follett-plausible (decision 078): young marriages keep courtship, family pressure and elopement on the page. Invented." },
  firstMarriageAgeMen: { min: 21, max: 27, unit: "years", note: "Follett-plausible (decision 078): men marry once they can hold land or a trade. Invented." },
  /** Decision 078: merchants marry once established (the wool trade, the guild), so they get their own later band. */
  firstMarriageAgeMenMerchant: { min: 23, max: 30, unit: "years", note: "Follett-plausible (decision 078): merchants marry after building a business. Invented." },
  /**
   * Decision 078: remarriage stays a live plot engine on both sides of the plague, instead of
   * collapsing after it as Razi measured. Roughly half of widows remarry either way.
   */
  widowRemarriagePreBlackDeath: { min: 40, max: 65, unit: "% of widows", note: "Follett-plausible (decision 078): widows remarry often; land and children need a man on the tenancy. Invented." },
  widowRemarriagePostBlackDeath: { min: 35, max: 60, unit: "% of widows", note: "Follett-plausible (decision 078): the plague frees land and partners, so remarriage stays common. Invented." },
  blackDeathMortality: { min: 20, max: 62.5, unit: "% of cohort", note: "research #6144 M-S3 (Russell ~20-23.6%, Benedictow 62.5%); tunable, contested." },
  /** Decision 078: widened down; child death is part of the drama, and adults who survive childhood still carry long arcs. */
  lifeExpectancyAtBirth: { min: 18, max: 32, unit: "years", note: "Follett-plausible (decision 078), loosely anchored on research #6144 (22-35, low confidence). Invented." },
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
  /** Decision 078: Follett's clergy, nuns, merchants and craftsmen read and write more than a real village did. */
  literacyOverall: { min: 5, max: 10, unit: "% c.1330", note: "Follett-plausible (decision 078): above research #6144's ~5%. Invented." },
  /**
   * PR10 (GOAL B, decision 071): gentry/noble women married markedly earlier via arranged
   * matches. `docs/research.md`'s own marriage-age table (line 340) interpolates Hollingsworth's
   * long-run nobility trend back to a 14th-century anchor of ~17 for women — squarely inside this
   * engine's own 1327-1361 window, more directly applicable than the table's 16th-century
   * endpoint. The user-approved band (14-18) brackets that anchor and matches the Follett
   * narrative reference (Tilly's arranged marriage at 14, engram #6321/#6149) on its low end.
   */
  firstMarriageAgeWomenGentry: { min: 14, max: 18, unit: "years", note: "Follett-plausible (decision 078), unchanged: arranged matches (Tilly m. 14) + Hollingsworth 14th c. interpolation (women ~17)." },
  /**
   * PR10 (GOAL B, decision 071): gentry/noble men married later than their brides, per the same
   * `docs/research.md` table's 14th-century anchor (~22 for men) — early-to-mid 20s, matching the
   * task's own stated expectation. Kept a real band (not a point) since the anchor is itself an
   * interpolation, not a direct period measurement.
   */
  firstMarriageAgeMenGentry: { min: 20, max: 26, unit: "years", note: "Follett-plausible (decision 078): knights marry once they win land or favour. Widened from Hollingsworth's ~22. Invented." },
  /**
   * PR10 (GOAL A, decision 071): the population-trajectory shape the task itself specifies for a
   * plausible 14th-century English village — not a primary-source figure, but the orchestrator's
   * own stated plausibility band for this engine's 1327-1361 default play window. Measured as
   * `scripts/check-demographics.ts`'s own trajectory checkpoints (1327/1347/1350/1361), same
   * 25-seed methodology decision 070 used.
   */
  /** Decision 078: Kingsbridge grows before the plague (the fair, the bridge); the town must not be dying before the story's catastrophe. */
  populationPrePlagueChangePercent: { min: -5, max: 20, unit: "% change, 1327->1347", note: "Follett-plausible (decision 078): a stable-to-growing town before the plague. Invented." },
  populationPlagueShockPercent: { min: -55, max: -35, unit: "% change, 1347->1350", note: "Follett-plausible (decision 078): the plague is the story's catastrophe, killing a third to over half. Widened from PR10's 40-50%." },
  populationRecoveryChangePercent: { min: 0, max: 60, unit: "% change, 1350->1361", note: "Follett-plausible (decision 078): the survivors rebuild; the town must visibly recover, not keep shrinking. Invented." },
} as const;

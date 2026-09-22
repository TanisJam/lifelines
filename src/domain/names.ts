/**
 * Decision 063 (engine-life-course PR4): the actual pools/logic moved to `period/names.ts` (the
 * 1379-poll-tax-informed replacement for decision 048's Tudor-era pool). Re-exported here, unchanged
 * shape, so every existing caller (`worldgen.ts#makeAdult`/`makeChild`) keeps importing from `./names`
 * with zero further changes.
 */
export { FEMALE_NAMES, MALE_NAMES, pickName, pickUniqueName, SURNAMES } from "./period/names";

# Narrative public participant compatibility

## Authority and scope

Parent feature: `odd/tasks/narrative-engine.md`; approvals Engram7227 (journal-ordered, non-calendar display positions) and Engram7232 (neutral public participant representation). Current branch `feat/narrative-engine`, implementation base `205a20c7793dd40f9f36cc98048cfc7f3e94be2d`. Local work-unit commits authorized; publication is not.

## Work unit

- [ ] Add, independently verify, review and commit neutral public participant compatibility. **In progress: writer and independent checks passed; native review and commit pending.**

Extend `RelCode` with `participant`, used with existing group `others`. Labels: EN `participant`, ES `participante`, identical for either sex and without ordinal prefixes. This is an evidenced entry participant, not an asserted friendship, kinship, rivalry, romance or acquaintance. Preserve required scene fields, legacy output, existing geometry and edgeless outside-story-circle behavior.

Allowed source surfaces:
- `src/contracts/life.ts`
- `src/i18n/dictionaries/en.ts`
- `src/i18n/dictionaries/es.ts`
- `src/lib/sky/describe-star.test.ts`
- `src/lib/sky/scene-model.test.ts`
- `docs/design/narrative-engine.md` — narrow approved compatibility contract only.

Observed RED → GREEN must cover exact bilingual labels, both sexes/multiple participants, descriptions, finite layout/frame presence, appearance/death and forward/backward scrubbing, unchanged edgeless counts/edges, JSON field preservation and existing relationship behavior. Run focused/related consumer and legacy scene tests, TypeScript, ESLint and whitespace checks; independent Node24/26 checks and native review precede closure. The installed Next TypeScript guide must be read completely before code. Helper compatibility is not browser verification.

## Boundaries

No component/route activation, server bridge, database/repository, canonical relationship, `SceneGroup`, `EdgeKind`, `PersonMind`, transport codec or invented version protocol changes. Existing calendar month/feast interpretation prohibits activating E's synthetic order-only timestamps in the UI. Historical `appearsAt`, complete actor resolution, ID-directed links, causal closure and placement precision belong to the subsequent historical bridge.

## Evidence and continuity

Read-only mapping: `musru9nf-w-w9yr`, detailed Engram7239. Writer `muss0njt-x-dfjl` completed six authorized files, +133/-1. Actual RED: 3 failures/10 passes included an incorrect pre-existing spouse-copy expectation; correcting that test expectation yielded 2 intended Spanish-label failures/11 passes before production edits. TypeScript separately rejected participant fixtures and then missing exhaustive dictionary keys. GREEN: 13/13 focused (302ms), 47/47 related across six files (1.01s); TypeScript (5.269s), ESLint (1.284s), whitespace passed on Node26. Mandatory installed guide read fully. Both trackers and bounded 19-file `.claude` manifest unchanged; HEAD205a20c. Detailed hashes and discovery Engram7242. Existing Spanish spouse copy `segunda esposo` remains unchanged; Vite warning persists. No consumer implementation, server bridge, canon or UI activation changes; no browser/build/full-suite claims. Independent `muss8yfx-y-w8mc` PASS13 focused/47 related across six files on each Node24/26, TypeScript/ESLint exit0, 188 fresh assertions per runtime (192/180ms), whitespace/conflict scans and exact scratch cleanup. Both trackers, all six source hashes, HEAD/status and bounded 19-file `.claude` manifest unchanged; no candidate fixes or oracle corrections. Detailed evidence Engram7246. Native review/local commit pending. Parent owns this document and its full Engram mirror at `odd/narrative-public-participant/tasks`. Update bookkeeping before independent verifier launch; freeze all candidate writes throughout that verification window. Preserve `.claude/`; no installs, network/providers, live databases, push, PR or merge.

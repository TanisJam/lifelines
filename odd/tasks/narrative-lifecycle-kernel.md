# Narrative lifecycle kernel — release work units

RL1a1 is closed; RL1a2 remains IN PROGRESS. Its implementation is frozen and independently verified, but native review, commit, and parent integration remain pending. This transaction updates only this task document and its full Engram mirror; it neither changes source nor declares the release ready.

## Authority and current boundary

| Boundary | Recorded state |
|---|---|
| Project | `lifelines` |
| Local task | `odd/tasks/narrative-lifecycle-kernel.md` |
| Full mirror topic | `odd/narrative-lifecycle-kernel/tasks` |
| Isolated child root HEAD | `93b56e33faa2c99074b6facdd2a31002e16e3393` (`93b56e3`); four frozen modified source paths plus this untracked document |
| RL1a1 | DONE as a work unit, not completion of all lifecycle phases |
| Parent integration | `835f30f`; parent reports exact integrated source hashes |
| Parent verifier | Main `835f30f`: combined 18-suite serial verification PASS, 713/713 in 211.09s; types and lint PASS (parent-reported) |
| Existing release record | `7504`; parent-updated full 161-line source plan, SHA-256 `58963c63fe7532791b282190a2715229cff8617fa7ad8da8136c1eac4a2f5cb0`; untouched here |
| Release continuation | `7496` / `7500`; all existing constraints remain in force |
| Delivery | `7008` unchanged; feature-branch chain and delivery owned by parent |

Do not write in the parent root, edit record `7504`, or change main anywhere. Parent owns user interaction, native review, commits, and delivery. No child delegation or Git delivery actions.

## Closed unit: RL1a1

Parent-provided closure evidence:

- Source boundary: `93b56e3`.
- Native review: `review-310f49c76adf7814`, approved; ACK BURNED.
- Review target: `b872a2bfb542112deba47b49154181b810049b0e074960fccc1b1bf1c1964487`.
- Consumed acknowledgment: `70c1c2f685b4fc56b1ff535cf837d97e3867033d01c160a705e2aefdfa8213c9`.
- These receipt values are immutable evidence, never standalone status authority and never reusable approval for RL1a2.
- Standalone Node 24: 300+ tests; Node 26 spot check: 12 tests; types and lint PASS, as reported by parent.
- Parent integrated at `835f30f`; parent now reports combined 18-suite serial verification PASS: 713/713 in 211.09s, plus types and lint PASS.
- Historical combined run: 711 passed and two timed out. No actual test timeout was changed and no source fix was applied for that run. Contention is plausible, not proven; retain that history separately from the successful serial result.

## Active unit: RL1a2 — extract the complete pre-social phase

Move the actively used implementation bodies into the lifecycle kernel; a callback shell around the old bodies is not an extraction. Keep behavior and execution order unchanged.

### Required ordered boundary

1. Emit town and national shocks.
2. Traverse the entire biology phase, including illness and death, inside the original comparator.
3. Preserve the subsequent levy, arrivals, returns, arranged marriage, immigration, and school-piggyback sequence.
4. Keep leyrwite ordering before the social filter.

The owned context must retain the same people, events, decisions, and counters. Preserve the original override anchor, raw ordering, seeded tuples, slots, and commit behavior. Do not introduce physics changes.

### Mechanics to move unchanged

- School helpers and `uniqueFirstName`.
- `spawnImmigrant`, `spawnGentrySuitor`, `spawnAwayPerson`, and `spawnChild`.
- `pickAwayDestination` and `SETTLEMENT_KINDS`.
- Levy class multiplier and levy table.
- `overrideFor`.

The active A2 phase must still call the child helper. Preserve the existing `resolveBiologyDecision` language-catalog port until its separately scoped phase. The kernel must never import `simulate` and create a circular dependency.

### Frozen source boundary

The completed extraction touches these four exact domain paths. They are frozen evidence, not permission to write them in this documentation-only transaction:

| Path | Intended responsibility |
|---|---|
| `src/domain/simulate.ts` | Delegate the actual pre-social phase without changing ordering |
| `src/domain/legacy-year.ts` | Own the extracted lifecycle phase and context |
| `src/domain/legacy-year-mechanics.ts` | Relocate the listed mechanics unchanged |
| `src/domain/legacy-year.test.ts` | Prove API, delegation, ordering, and compatibility contracts |

Forecast: 800–1400 authored lines including moves and tests. Actual frozen diff: 1120 authored lines, 696 additions / 424 deletions across four paths. This is a review heuristic, not a hard cap. Never minify, omit readable coverage, or compress code to meet it. Keep tests and behavior together as reviewable work units; parent determines native-review and commit boundaries after source is frozen.

## Acceptance and test-first gates for the source transaction

- [x] Capture pre-existing pins BASELINE before source writes: 12 passed.
- [x] Preserve all eight pins; no expected hashes changed.
- [x] Observe intended RED: two missing-API failures, ten passed.
- [x] Move real bodies and observe focused GREEN: 12 passed; final focused coverage: 21 passed.
- [x] Exercise comparator traversal, ordering, overrides, helper usage, and alternate cases.
- [x] Complete the parent-approved five-file validation under the source transaction's 600-second limits.
- [x] Writer Node 26: 309 tests / five files passed in 151.65s; types and lint PASS.
- [x] Independent Node 24.20.0: 309 tests / five files passed in 159.91s; nonincremental types and lint PASS.
- [x] Freeze source before parent native review and commits; source hashes stable before/after verification.
- [ ] Obtain native approval for RL1a2, commit the exact reviewed range, and integrate into the parent.

Node 24 compatibility is VERIFIED, not outstanding: the independent verifier used `/home/tanisjam/.nvm/versions/node/v24.20.0/bin/node` and confirmed actual version 24.20.0. The earlier writer search had not searched nvm. Independent Node 26 spot verification passed all 21 focused tests in 17.56s.

These source outcomes are parent-provided evidence, not commands executed by this documentation writer. Exact executable source commands remain in the source-validation handoff; this document does not invent command strings or treat documentation checks as source tests.

### Independent semantic review

The independent four-path full semantic diff/source-baseline review found no defect. It checked comparator interleaving across seven kinds, active implementation bodies, causal death emission, the existing school-after-death quirk, original town/national ordering, captured vital getters versus LIVE arranged getters, and byte-preserving helper class/job/RNG/raw-ID behavior. No mind backfill was introduced. All source hashes remained stable before and after review.

Intermediate import and fixture failures were fixed before final validation, without changing hash pins. The invalid smith fixture was not normalized. The explicit newcomer descriptor is a handoff, not admission of a new catalog entry.

No forced-death changes, provider changes, live database access, network installs, physics changes, Git delivery, or child agents. Existing release constraints continue unchanged.

## Still pending — not release-ready

The old phase 3 remains pending: social-batch selection/application, including interleaved birth/maternal death, vignette work, and snapshots. Remaining future phases, the new E-version journal/continuation, genuine unforced death, RI1, and RA1 are incomplete. RL1a2 is not completion of those phases or the full release.

## Documentation-only transaction and evidence

Allowed edit surface: `odd/tasks/narrative-lifecycle-kernel.md` only. No source writes, parent-root writes, Git mutation, native review, source tests, provider/network/install actions, or children are permitted. Update the FULL existing mirror `7536` for expected project `lifelines`, topic `odd/narrative-lifecycle-kernel/tasks`, and read it back fully; keep `7504` untouched.

The initial document transaction observed a clean tree at HEAD `93b56e33faa2c99074b6facdd2a31002e16e3393`. Its historical pre-extraction source baseline is retained below, not asserted as today's frozen source:

| Path | SHA-256 |
|---|---|
| `src/domain/simulate.ts` | `142824206e88e4eb1146469a324d2155bc0265798186166f762f448fd147a609` |
| `src/domain/legacy-year.ts` | `84d6bebb8ead13a55e25d68c5979176f22acd2733313beab36ea71da3675ea30` |
| `src/domain/legacy-year-mechanics.ts` | `c1b75d257d9278934482ea40aa6375efc4a193d65d17911942c9f41fbb96199d` |
| `src/domain/legacy-year.test.ts` | `6d74c274b4f70ce181ba717f1bdf776fedb870f3d65a4cb885b92961f8a2cfbe` |

Current frozen RL1a2 source SHA-256, observed before this documentation update:

| Path | SHA-256 |
|---|---|
| `src/domain/simulate.ts` | `b9330c6ce1200fc9640b1161cc865372181af617358b53d248fbb91bbb5bd662` |
| `src/domain/legacy-year.ts` | `8a8b875d3810630b86ec3f8ca2cd5b36e937d11b3ff12d23290b4d80ea11d280` |
| `src/domain/legacy-year-mechanics.ts` | `56a76709976b1b9174800d3006b83087bf5a2d2419604b18cf23035f6998ed13` |
| `src/domain/legacy-year.test.ts` | `c4ab97592e03670f6d9e74260bc2f32850e745b91fbdd81b244efeab01550602` |

Required checks for this transaction:

```text
git diff --check
full updated file readback
full existing mirror 7536 readback and exact content equality
wc -l -c odd/tasks/narrative-lifecycle-kernel.md
sha256sum odd/tasks/narrative-lifecycle-kernel.md
git diff --stat
git rev-parse HEAD
git status --short
sha256sum src/domain/simulate.ts src/domain/legacy-year.ts src/domain/legacy-year-mechanics.ts src/domain/legacy-year.test.ts
```

Report mirror `7536`, full-readback line/byte counts and hash equality, unchanged frozen source hashes and HEAD, and documentation-only status. Documentation-only RED/GREEN exception: prose synchronization has no meaningful executable pre-implementation behavior test. Source BASELINE/RED/GREEN evidence above belongs to the implementation transaction, not this update.

## Next step

Parent owns native review and the RL1a2 commit: review the exact range `93b56e3` → new commit, then cherry-pick into the parent and run combined verification. The expected combined count is 722 (713 plus nine new tests), not an observed result; do not claim it passed before observation. RL1a2 remains IN PROGRESS until native approval, commit, and integration. Keep later lifecycle phases and release gates explicitly pending.
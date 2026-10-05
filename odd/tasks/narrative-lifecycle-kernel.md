# Narrative lifecycle kernel — release work units

RL1a1 and RL1a2 are DONE as work units. RL1a2 has native approval, a committed source boundary, parent integration, and observed combined verification. RL1a3 is IN PROGRESS with a FROZEN source boundary: focused and independent five-file validation, final types/lint, and independent semantic review are observed complete. Native review, commit, integration, and combined verification remain pending. This documentation sync does not write source or declare RL1a3 DONE. This update changes only this task document and its full Engram mirror, not release readiness.

## Authority and current boundary

| Boundary | Recorded state |
|---|---|
| Project | `lifelines` |
| Local task | `odd/tasks/narrative-lifecycle-kernel.md` |
| Full mirror topic | `odd/narrative-lifecycle-kernel/tasks` |
| Isolated child root HEAD | `0a010442b2edf29c0be397c4af7fa5f8a7985c65`; three pre-existing RL1a3 source modifications preserved |
| Main boundary | `0e35e275`; source unchanged by this recovery (parent-provided) |
| RL1a1 | DONE as a work unit, not completion of all lifecycle phases |
| Parent integration | RL1a1: `835f30f`; RL1a2: `7ff46c88f0e76f49c00558911ca90b14653ba1e5`; parent reports exact integrated source hashes |
| Parent verifier | Main RL1a2 post-integration: 722/722 across 18 files in 215.39s, Node 26 serial `--maxWorkers=1`; types and lint PASS, six hashes stable (parent-reported). Historical RL1a1 main `835f30f`: 713/713 in 211.09s |
| Existing release record | `7504`; last recorded full 161-line source plan, SHA-256 `58963c63fe7532791b282190a2715229cff8617fa7ad8da8136c1eac4a2f5cb0`; stale about RL1a2 closure, untouched here; parent will synchronize next |
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

## Closed unit: RL1a2 — extract the complete pre-social phase

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

Forecast: 800–1400 authored lines including moves and tests. Actual frozen source diff: 1120 authored lines, 696 additions / 424 deletions across four paths. The native reviewed unit including this document contained five files and 1260 authored lines. This is a review heuristic, not a hard cap. Never minify, omit readable coverage, or compress code to meet it. Keep tests and behavior together as reviewable work units; parent determines native-review and commit boundaries after source is frozen.

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
- [x] Obtain native approval for RL1a2, commit the exact reviewed range, and integrate into the parent.
- [x] Observe parent post-integration verification: 722/722 across 18 files in 215.39s; Node 26 serial `--maxWorkers=1`, types and lint PASS, six hashes stable.

### Immutable RL1a2 closure evidence

- Source commit: `5819af7a56645bd38127138130cf0b6999d8f0d9`; parent integration: `7ff46c88f0e76f49c00558911ca90b14653ba1e5`.
- Native review: `review-ad443813b17a2860`, APPROVED; ACK BURNED.
- Review target: `5c47f091fe1cc1921475aef74ffa070ce20efcf61c824f69be7ea3d4047b7669`.
- Consumed acknowledgment: `bb1e6bf48ea6c22e9a3eda948296e0964f1a54871ddc067afe1ccd863f3f7c21`.
- Candidate `d24348e45a3e3e3511664844da8b054d045e4ff8`: ASSESS-derived closed, consumed=true, already reviewed. Receipt values are immutable evidence, NEVER standalone STATUS authority or reusable approval for RL1a3.
- The previously expected combined count of 722 is now an observed parent result. It does not erase RL1a1's separate 713-pass serial result or its earlier 711-pass/two-timeout run. No timeout increase or semantic fix was applied; CPU contention remains a hypothesis, not a proven cause.

Node 24 compatibility is VERIFIED, not outstanding: the independent verifier used `/home/tanisjam/.nvm/versions/node/v24.20.0/bin/node` and confirmed actual version 24.20.0. The earlier writer search had not searched nvm. Independent Node 26 spot verification passed all 21 focused tests in 17.56s.

These source outcomes are parent-provided evidence, not commands executed by this documentation writer. Exact executable source commands remain in the source-validation handoff; this document does not invent command strings or treat documentation checks as source tests.

### Independent semantic review

The independent four-path full semantic diff/source-baseline review found no defect. It checked comparator interleaving across seven kinds, active implementation bodies, causal death emission, the existing school-after-death quirk, original town/national ordering, captured vital getters versus LIVE arranged getters, and byte-preserving helper class/job/RNG/raw-ID behavior. No mind backfill was introduced. All source hashes remained stable before and after review.

Intermediate import and fixture failures were fixed before final validation, without changing hash pins. The invalid smith fixture was not normalized. The explicit newcomer descriptor is a handoff, not admission of a new catalog entry.

No forced-death changes, provider changes, live database access, network installs, physics changes, Git delivery, or child agents. Existing release constraints continue unchanged.

## Active unit: RL1a3 — extract live social-batch preparation and resolution

RL1a3 is IN PROGRESS with FROZEN implementation and completed source gates, not native approval or integration. The kernel now owns the actual social filter, question construction, batching, asynchronous resolution, and resolution metadata formerly in `simulate.ts` lines 2170–2330, not a callback wrapping the whole body. The observed extraction preserves question creation after biology and leyrwite, read references, the background/non-protagonist fast path, counters, forced/fallback flags, mint/selection metadata, and the exact D1-prefetched result.

Typed phase output carries pending/resolved question, year turn, and D1 prefetch needed by the old ordered application. The actual ordered application at original `simulate.ts` lines 2342–3045 stays in `simulate` for now. Preserve newborn/current-parent Mind handling and the later maternal-death outcome alive guard. Old private language-catalog ports may remain until a future catalog lift; never introduce a kernel → `simulate` import or a circular dependency. Snapshots and D1 extraction belong to future units.

### Exact bounded source surface and eight task gates

The authorized four-path source surface remains `src/domain/simulate.ts`, `src/domain/legacy-year.ts`, `src/domain/legacy-year-mechanics.ts`, and `src/domain/legacy-year.test.ts`. Actual modifications are the first, second, and fourth paths only; mechanics is unchanged. All four are read-only during this recovery.

- [x] Capture the existing 21-test pre-source baseline: 21 passed before writes.
- [x] Add the new phase API behavior test and observe intended RED: two missing-export/delegation failures; original 21 passed.
- [x] Extract actual live preparation and asynchronous resolution bodies, preserving question timing and all listed metadata/reference contracts (writer evidence and independent semantic review complete).
- [x] Return typed pending/resolved question, year-turn, and D1-prefetch output; leave ordered application and later guards in place.
- [x] Observe focused GREEN: 23 passed, then final focused alternate/negative coverage 32/32 in 18.02s; all eight pins and the invalid smith fixture unchanged.
- [x] Complete independent Node 26 five-file validation: 320/320 in 177.27s, nonincremental types/lint clean; Node 24 focused spot: 32/32 in 17.79s. Independent full Node 24.20.0 five-file validation: 320/320 in 167.32s, types/lint PASS. Exact commands remain in the source-validation handoff.
- [x] Freeze hashes and complete independent three-source full-diff/baseline `0a010442` semantic review: no new defect. Four source hashes and the document hash stayed stable before/after both full validation runs; no scope widening.
- [ ] Parent obtains native review, commits, integrates, and verifies the complete unit.

Forecast: 500–1000 authored lines including moves and tests; a review heuristic, not a cap. Actual frozen source diff: 499 additions / 210 deletions, 709 authored lines across three paths; mechanics unchanged. Do not compress coverage or broaden ownership to meet it. Parent owns commit/native review/integration. No new product question is required: genuine unforced death and minimal economy remain approved directions.

### Runtime and future continuation invariants

- Existing structural evidence at `E1e-runtime` lines 41–195 shows one actual owned `Record<string, Person>` and the same `Person`/`Mind`, not a dual Map. Grain, debt, tie, and appraisal are separate ledgers, not equivalent legacy Mind writes.
- `simulateYears` clones: do not reuse it as a whole-physical-phase callback. Social work performs actual Mind relationship, dream/stress, birth-parent grief, and NPC no-op writes even without events. It is not Mind-free physics; an event log alone is not replay proof. No historical Mind backfill.
- A future NEW tuple/runtime must close creation, class, literacy, parents, away state, operations, Mind, identity, events, and adjudication authority, and replay complete owned state. Current E1 is rules-only, human-reject, wire-unchanged; no implicit migration.

## Still pending — not release-ready

RL1a3 preparation/resolution is not completion of old phase 3. Ordered social application, interleaved birth/maternal death, vignette work, snapshots/D1, remaining lifecycle phases, the new E-version journal/continuation, genuine unforced death, RI1, and RA1 remain incomplete. Neither closed RL1a2 nor source-verified RL1a3 implementation declares the full release ready. Preserve `.claude/perf`; no push, PR, deployment, installs, network/provider work, live database access, or destructive actions.

## Documentation-only transaction and evidence

Allowed edit surface: `odd/tasks/narrative-lifecycle-kernel.md` only. No source writes, parent-root writes, Git mutation, native review, source tests, provider/network/install actions, or children are permitted. Update the FULL existing mirror `7536` for expected project `lifelines`, topic `odd/narrative-lifecycle-kernel/tasks`, and read it back fully; keep `7504` untouched.

The prior RL1a2 documentation transaction observed a clean tree at HEAD `5819af7a56645bd38127138130cf0b6999d8f0d9`; this is historical, not the recovery baseline. The initial document transaction observed a clean tree at HEAD `93b56e33faa2c99074b6facdd2a31002e16e3393`. Its historical pre-extraction source baseline is retained below, not asserted as today's frozen source:

| Path | SHA-256 |
|---|---|
| `src/domain/simulate.ts` | `142824206e88e4eb1146469a324d2155bc0265798186166f762f448fd147a609` |
| `src/domain/legacy-year.ts` | `84d6bebb8ead13a55e25d68c5979176f22acd2733313beab36ea71da3675ea30` |
| `src/domain/legacy-year-mechanics.ts` | `c1b75d257d9278934482ea40aa6375efc4a193d65d17911942c9f41fbb96199d` |
| `src/domain/legacy-year.test.ts` | `6d74c274b4f70ce181ba717f1bdf776fedb870f3d65a4cb885b92961f8a2cfbe` |

Historical frozen RL1a2 source SHA-256, observed before the prior documentation update:

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

### Recovery evidence — 2026-10-05

Failed writer `muvs09lp-2m-0581` ended with the external message “assistant reported an error”; cause UNKNOWN. A read-only recovery continuation established the implementation evidence below without edits or tests. This documentation recovery also runs no source tests; it preserves the original RL1a3 unit, not a replacement unit or approval.

- Implementation sequence: BASELINE 21 before writes → RED two missing-export/delegation failures plus original 21 PASS → GREEN 23 → final focused 32/32 in 18.02s. Original eight pins and invalid smith fixture unchanged.
- Earlier static errors (missing batchable/fallback fields and town-event type) were fixed; invalid D1 `none` fixtures and literal widening were fixed. Final TypeScript PASS was NOT OBSERVED. An unused lint warning was corrected with NO final rerun. The five-file suite was NOT RUN; no broad PASS is claimed.
- Partial FROZEN boundary: HEAD `0a010442b2edf29c0be397c4af7fa5f8a7985c65`, with three source modifications, 499 additions / 210 deletions (709 authored lines). Main `0e35e275` remains source-unchanged (parent-provided). Hash capture does not complete the independent-review/hash-freeze gate or confer native approval; no RL1a3 status/ACK was burned.

| Recovery source path | SHA-256 |
|---|---|
| `src/domain/simulate.ts` | `b0a590d37712d3c25e15f024342171ebe2519a56ed3ae0b2c5552d288511832a` |
| `src/domain/legacy-year.ts` | `df75dc9053e747aa73c328f000dcd79a697485932d3153beb4e93de6214daa1d` |
| `src/domain/legacy-year-mechanics.ts` | `56a76709976b1b9174800d3006b83087bf5a2d2419604b18cf23035f6998ed13` |
| `src/domain/legacy-year.test.ts` | `71da75a422e53d753b21406fd0164c6f91ca049bd88e853d515aa4c273f05ff7` |

These hashes and HEAD were observed at recovery entry; source and HEAD must remain unchanged through documentation validation. At that historical recovery point, independent semantic review, completed validation/hash freeze, native review, commit, integration, and post-integration verification were pending. The source gates have since closed as recorded below; native/delivery gates remain pending. Ordered application, birth/maternal-death handling, and snapshots/D1 extraction remain future work; typed D1 output above does not claim that later extraction.

### Source-gate closure and final documentation checks — 2026-10-05

Parent-provided subsequent evidence closes RL1a3 gates 6 and 7, without erasing recovery history:

- Independent Node 26: five files, 320/320 in 177.27s; nonincremental TypeScript and lint clean. Independent Node 24 spot: 32/32 in 17.79s. Independent full Node 24.20.0: five files, 320/320 in 167.32s; types/lint PASS. Earlier type, fixture, and unused-lint issues were fixed; the historical absence of final writer validation above is not a current failure.
- Independent semantic review of all three modified source files, full diff and baseline `0a010442`, found no new defect. The kernel owns actual post-biology filtering/questions/batching, asynchronous selection/resolution, counters, raw identities, live options, response aliases, background handling, and D1 prefetch; no whole-body callback shell or cycle. Ordered application, birth/maternal guard, Mind, and later D1/snapshot extraction remain unchanged future work. Original eight pins, invalid smith fixture, `undefined` and `-0` aliases remain untouched.
- All four source hashes and the document hash were stable before/after both full runs. Current source boundary remains HEAD `0a010442b2edf29c0be397c4af7fa5f8a7985c65`, three modified source files, 499 additions / 210 deletions (709 authored lines), mechanics unchanged. Pre-sync document SHA-256: `0c5ca454d73bb535cce16d8c25d0b7b34b67477d0fc9abf309c470d0e2dfe19f`.
- Final documentation checks: full file and mirror `7536` readbacks/equality with byte counts and SHA-256; `git diff --check`, HEAD/status, and unchanged four source hashes. These checks are documentation-only, not repeated source validation. Failed-writer cause remains UNKNOWN, not proven to be model or tooling.

## Next step

Parent prepares the original RL1a3 unit's native candidate as a unit commit against `0a010442` after this document/mirror sync, then obtains native approval, commits, cherry-picks into main, and observes combined verification. The anticipated combined count is 733 (prior 722 plus 11 new tests: 32 versus 21), NOT an observed result. Native gate 8 remains unchecked; no RL1a3 acknowledgment is burned or reused. Parent separately synchronizes stale release record `7504`; this sync leaves it and main untouched. RL1a2 remains DONE with historical observed 722-test verification; RL1a3 remains IN PROGRESS with source gates complete, not DONE. Start no new unit; all approved product choices and later lifecycle/release gates remain unchanged and pending.
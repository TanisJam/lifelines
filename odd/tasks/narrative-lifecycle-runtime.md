# Lifecycle runtime — reviewable ODD units

CURRENT: LR1a, LR1b, LR2a, LR2b and memory LP1a / LP1b DONE bounded; main integration HEAD `c066234c4a9ef19dcedfb9f71ce950e7cbd81291` (LP1b source `5e13cf7`, after passive `f537e3f`). LC1 BLOCKED / pending (not active): isolated WIP `9b7af0b`, clean committed checkpoint, 593 authored lines across three source/test/design paths, NOT integrated. Representative LIFE coverage FAIL; genuine ≥60-year proof and capacity remain pending. No approved LC1. FE1 remains DONE bounded and explicitly unreviewed for that candidate only (Engram7625). Not release-ready; LIFE proof, RI1 and RA1 remain pending. Continue automatically until release. **Memory LP1e IN PROGRESS, mapped before first source write** in [FULL featurebook7658](narrative-lifecycle-memory.md); exact two capsule source/test surfaces, redundant outer capture removal ONLY. LP1c conditional / LP1d pending. Human7678 permits local verified release commits/integration branches ONLY, not push/PR/main-default merge/deploy. Parent prepares a new isolated worktree after doc commit. Historical wording below is preserved, superseded by CURRENT and the latest transition append.

## Intent and recovery

User resumed with “continuamos” and selected small reviewable units (Engram7602): reusable live favor executor first, new lifecycle runtime/admission/full replay later. Parent base `23f2163bcbf658e540e6e24613ae37a4f6903bc9`, branch `feat/narrative-engine`, sourceb0963b0; unrelated `.claude/` preserved. Isolated root `/home/tanisjam/Projects/Personal/lifelines-worktrees/lifecycle-favors` reuses existing dependencies without installation. Parent alone owns Git/review/integration. No push/PR/deploy/network/live DB/destructive operations.

Locator `odd/tasks/narrative-lifecycle-runtime.md`; FULL Engram7604 topic `odd/narrative-lifecycle-runtime/tasks`. Umbrella release book/full7504 remains historical paused lead, superseded by explicit resume7602; valid gates/history unchanged. Closed lifecycle book/full7536 remains untouched (capacity limited).

## Tasks

- [x] **FE1 — DONE (bounded extraction):** source `ae01652`, fast-forward main `46565a3`, integrated413/7 PASS plus types/lint, four hashes unchanged. Explicit human unreviewed7625; RDD stays on, no native approval. Writer plus independent verifier and main gate observed.
- [x] **LR1a — DONE (bounded genesis/admission):** source/main `1418dfb`, exactly two genesis source/test paths plus narrow design docs; 84 focused and 430/10 related tests PASS on both nodes, types/lint PASS, native APPROVED/ACK BURNED. First prerequisite only, not full runtime.
- [x] **LR1b — DONE (bounded annual execution/frontier):** source/main `dfa38b6`; three paths, 714 authored lines (154 production/522 tests/38 docs); dual-node 540/13 PASS, types/lint PASS, native APPROVED/ACK BURNED. Not full replay or LIFE-scale proof.
- [x] **LR2a — DONE (bounded full replay):** source/main `fff9123`; five paths, 517 authored lines (516+/1−, including 28 design-doc lines). Both nodes 514/11 PASS, types/lint PASS; native APPROVED/ACK BURNED. No LIFE-scale performance proof.
- [x] **LR2b — DONE (bounded lossless capsule):** source/main `0adc844`; three paths, 464 authored lines (138 production/296 tests/30 docs); dual-node 597/12 PASS, types/lint PASS, native APPROVED/ACK BURNED. No LIFE-scale proof.
- [ ] **LC1 — BLOCKED / pending (not active; isolated WIP `9b7af0b`, not integrated):** clean three-path, 593-line checkpoint; representative LIFE coverage FAIL. Certified start/resume, genuine death/budget/abort remain the contract; fast checks are not long-LIFE proof. RAM guidance gives a provisional 1 GB target within 1–2 GB, not a hard server limit; LP1a still uses about2.09–2.46GB for four genuine years. Next: LP1e mapped in [the separate featurebook](narrative-lifecycle-memory.md), exactly two capsule source/test surfaces, no source written yet; LP1b DONE bounded. No LC1 source authorization, capacity/release cut or DONE claim.

## FE1 scope and invariants

Four source paths: `src/domain/e-favor-executor.ts`, `src/domain/e-favor-executor.test.ts`, `src/domain/e-runtime.ts`, `src/domain/e-runtime.test.ts`. Source412+/99−=511 authored lines; source+initial taskbook462+/99−=561 at commit. Advisory forecast490–715, not cap; never compress coverage. Retain ask-on-risk / feature-branch-chain delivery decision. New-workstream source running committed count511; no accumulated feature review.

Executor borrows one private draft actual Person/Mind registry; economic ledgers remain separate. Extracts identity/history, ordered resources/grants and immediate HELP response. Physical operations share identity/history helpers; runtime owns physical phases, allowance planning, creditor/two .25 slot traversal with current revalidation, admission/frontier/reentrancy, rollback and detached publication. Executor is NOT independently transactional: discard failed drafts. Preserve complete causes/reason precedence/positions, optional undefined and signed zero, hostile own keys, E1 version/replay/wire and human-history rejection. No lifecycle version/admission/genesis/wire/UI/persistence/mortality change or implicit migration. Genuine unforced continuation beyond former horizon remains future obligation; bounded alive is not completion.

Rollback boundary: remove executor and restore runtime nested execution/delegation without unrelated changes. Canon/wire pins protect explicit and composed full output; runtime genuinely calls executor. Runtime-boundary evidence is focused runtime/capsule/baseline suite, not a browser/build or full release check.

## Observed implementation and verification

All commands foreground serial, timeout600, existing test timeouts unchanged. N26=`/home/linuxbrew/.linuxbrew/bin/node`; N24=`/home/tanisjam/.nvm/versions/node/v24.20.0/bin/node` (available).

- Baseline N26 `node_modules/vitest/vitest.mjs run src/domain/e-runtime.test.ts src/domain/e-annual-composition.test.ts src/domain/annual-runtime-baseline.test.ts --maxWorkers=1`:99 PASS.
- Pre-extraction canon/wire pin capture deliberately failed twice, then observed hashes pinned: runtime75 PASS before production change. Missing executor module RED observed; live delegation zero-call RED observed after correcting invalid home→home fixture.
- Focused N26 executor/runtime: initial resource underflow regression corrected by preserving explicit minimum0; subsequent78/104/107 PASS. Type-check readonly fixture assignments/unknown narrowing corrected. Historical failures retained, latest checks PASS.
- Final BOTH N26/N24 `node_modules/vitest/vitest.mjs run src/domain/e-favor-executor.test.ts src/domain/e-runtime.test.ts src/domain/e-annual-policy.test.ts src/domain/e-annual-composition.test.ts src/domain/effects.test.ts src/domain/e-capsule.test.ts src/domain/annual-runtime-baseline.test.ts --maxWorkers=1`:413/7 PASS each, rerun after type corrections.
- Independent N26 executor/runtime same run prefix:107/2 PASS,2.64s. Independent N24 exact seven-file command:413/7 PASS,43.83s. Complete four-path semantic diff against HEAD found no deterministic defect. Independent historical RED/pin capture NOT rerun; N26 independent scope107/2, not413/7.
- Writer and independent N26 `node_modules/typescript/bin/tsc --noEmit --incremental false`:PASS; `node_modules/eslint/bin/eslint.js` exact four source paths:PASS; `git diff --check`:PASS (untracked files excluded before commit). Existing Vite configuration warning nonfatal. No Next guide applicable domain-only; CodeGraph attempted first, wrong-root/absent-index fallback to scoped reads, no initialization.

Final four source hashes matched writer/independent before/after checks:

| Path under src/domain | SHA256 |
|---|---|
| e-favor-executor.ts | c9380ac12a203a122b00e05375ed4a236d8c4d0ead1e705013d615a356439dbb |
| e-favor-executor.test.ts | 11f8f0ee324346cff6c2bdf7f9fc470ac283ec8febb23e567bcfa53ded133a4d |
| e-runtime.ts | 5ee871c94a0a049cb5ec79fc001c61301ae9b6681f87d5ce8e4603c6486b5396 |
| e-runtime.test.ts | 92656c29a5d798a4d275f6118cdcc6df7a2ce9c573cc31f76ff8531a2f616076 |

## Native review blocker and next action

Initial ASSESS unassessable: untracked scope undeclared; independent verification completed as required. After scoped work-unit commit `ae01652`, committed-range ASSESS base23f2163 reports medium561/5, reviewDue slice_budget_reached, consumed=false; large runtime-recorded writer profile, writer verification stands.

INSPECT before START found clean workspace needing committed base. Two exact ordinary START attempts used full base23f2163 plus committedOnly:true and fresh keys. Host-mediated consent returned `consent-binding-expired` both times, lineage_created=false, mutation_performed=false, native_invocation_attempted=false. First provider continuation offered restart for fresh consent; one retry also expired. Old bindings must NOT be answered/replayed. No approved review, acknowledgement, correction, reset or recovery. No source defect inferred from expiration; STOP further retries in this turn.

Historical blocker above is superseded: user “bueno, segui hasta completar el release” resumed; third fresh START expired before native invocation, no lineage. User selected FE1 explicitly unreviewed7625. Committed ASSESS explicit declined medium563/5, consumed=false; ordinary checks stand, RDD unchanged. Parent preserved untracked full taskbook bytes, fast-forwarded exact46565a3, removed only its own identical backup. Main gate Node26413/7 PASS47.37s, types/scopedlint/diffcheckPASS; fourhashes unchanged, HEAD stable only unrelated.claude. Verifier first hash snapshot followed suite/tsc: do not claim pre-suite hashes there. Next LR1a; native review remains required under user switch for new candidates. Full-suite/build/browser/death continuation/RI1/RA1 remain pending.

## LR1a mapped scope and checks

New src/domain/e-lifecycle-genesis.ts and src/domain/e-lifecycle-genesis.test.ts; narrow docs/design/narrative-engine.md contract section. Taskbook parent-owned. Complete creation, cold admission and private reconstruction APIs; explicit new lifecycle tuple, E1 origin + trusted rules-year declaration + protagonist own identity + complete initial resources + canonical digest. Preserve old E1/C2/capsule codecs unchanged. Descriptor-first closed data before reads/hash/cloning: reject getters/symbols/hidden/executable/nonplain/cyclic/sparse/extended/nonfinite data; permitted legacy own undefined and signed zero lossless. Regenerate full actual Person/Mind/events/config through existing E1 origin; compare COMPLETE canonical genesis, not digest alone. No arbitrary imported world, demographic policy, hydration/history backfill, quotas or callbacks. One fresh private actual registry; separate favor ledgers; config endYear origin metadata not execution ceiling. Do not build unused checkpoint framework or advance stub. Future runtime/replay must consume this reconstruction.

Advisory550–850 authored lines including tests/docs, not cap. RED missing module/API then getter/unknown tuple/forged-rehashed/caller alias/signedzero/undefined/resources negatives; true origin semantic parity and two independent instantiations. Exact foreground timeout600 commands: Node26 and Node24 prefixes above, node_modules/vitest/vitest.mjs run src/domain/e-lifecycle-genesis.test.ts --maxWorkers=1; final related run includes src/domain/e-lifecycle-genesis.test.ts src/domain/world-initialization.test.ts src/domain/world-origin.test.ts src/domain/e-year-source.test.ts src/domain/e-favor-executor.test.ts src/domain/e-runtime.test.ts src/domain/e-capsule.test.ts src/domain/e-annual-policy.test.ts src/domain/e-annual-composition.test.ts src/domain/annual-runtime-baseline.test.ts --maxWorkers=1. Node26 tsc --noEmit --incremental false, scoped ESLint two new source paths, diffcheck. No Next guides apply domain-only. Parent owns new isolated worktree/commit/native/integration; no LR1a source writes existed at this historical mapping checkpoint (superseded by closure below).

## LR1a closure — bounded, integrated

Parent-provided proof: source/main `1418dfbba5a65bdfe243c1f923d2f8f91ec5fc80`, exactly three paths, 597 authored lines = 168 production + 399 tests + 30 design docs. Baseline120 PASS → missing-module RED → focused84 GREEN. Final related Node26/Node24 430/10 PASS, 57.68s/55.50s; types/scoped lint PASS and writer hashes recorded. Main fast-forward matched all three hashes, then focused84 PASS, types/lint/diffcheck PASS and three hashes stable; only unrelated `.claude/` remained. These are inherited observations, not tests rerun by this documentation update.

Native `review-1d7bcdc836d2482b` APPROVED; ACK BURNED target `7a0b4bd2d7837b40da0b33f52a75c0f2c994d7a6f3670e5205fc93016296676e`, consumed revision `e1b6f00ac694328762b2555878b9ced7ad7f538b7615f4acd01f2c1b2ca2ba95`. First ACK with controller-only input was rejected without mutation; exact-lineage-only ACK succeeded. No STATUS queried after burn. This approval closes LR1a only, not FE1 or release gates.

| Path | SHA256 at source/main integration |
|---|---|
| src/domain/e-lifecycle-genesis.ts | 6ca33f3d53e034494788d395a4bf8bb3217c7e6513f183c86d17b00f6edff21d |
| src/domain/e-lifecycle-genesis.test.ts | 334e42694a05d75214217f5de869a284b835e962753efa2526bac38d1a7d97c7 |
| docs/design/narrative-engine.md | cfd8534b46a8652cee9d14ecb371e4e1164056fdd2352909f1a504e302f0754b |

Running new-workstream source count: FE1 511 + LR1a 567 = 1,078, excluding docs. Initial all-path units: FE1 561 + LR1a 597 = 1,158, excluding passive taskbook updates. This current documentation update is passive, not counted as source. Historical forecasts and evidence above remain intact.

## LR1b contract — annual execution and atomic frontier

Exact derived source scope: new `src/domain/e-lifecycle-runtime.ts` and `src/domain/e-lifecycle-runtime.test.ts`; bounded append to `docs/design/narrative-engine.md`. No genesis canonical export is needed in this unit: no hash comparison. Taskbook remains parent-owned; no runtime writes yet. Parent prepares an isolated writer only after full file/Engram7604 synchronization. Advisory scope must be reforecast with the worker before growing beyond a coherent unit; never compress coverage.

### Admission and annual transaction

- `createLifecycleRuntime(genesis: unknown)` exposes a frozen initial result, async `advance(year)` and `snapshot`. Contiguous frontier starts at `startYear - 1`, must be a safe integer and not `-0`; `origin.endYear` is not an execution ceiling. No future checkpoint import, authority callbacks, human resolver or external plans input.
- Clone the combined actual owned state and favors graph transactionally, preserving aliases. Use trusted `createRulesYearSource` with fresh private execution for exactly one physical year. Retain the pre-economic physical snapshot and FULL post-native people/Mind, logs, decisions and counters; never substitute an E2 physical projection. Preserve native births, deaths, genotype and class.
- Apply `planAnnualFavorDraft` → FE1 resources/grants → stable eligible creditor traversal with two `.25` slots. Replan each response from the current draft. Next year's native execution reads the favor-updated actual Mind.
- Detach and deep-freeze final owned/favors state and journal BEFORE swapping frontier/state atomically. The journal retains full post-native and final actual states/ledgers, resolved economic plans, slot-null observations and entries. Life-position and economic-position namespaces are distinct. This evidence is NOT a full replay certificate; LR2 remains pending.

### Failure, status and cancellation boundaries

Alive status is incomplete. Only observed genuine death completes the death year; reject the next advance. No forced death or horizon completion. Reject overlapping advances. Late failure rolls back state/frontier, clears the guard and permits retry with a fresh source. Cancellation is between closed steps only: no source cancellation port exists. A later controller abort may discard before commit, but there is no mid-step interruption claim. This is a technical boundary, not a new product choice.

### Test-first checks and exact future commands

Require new-module RED before implementation, then GREEN and triangulation: real independent public native-physics parity BEFORE economic comparison; real life/genetic birth and maternal effects; full properties, signed zero, own undefined, registry order and counters; newborn/dead resources; two current slots; detached final Mind; rollback/retry and overlap; beyond-horizon execution and dead status. This is not full LR2, death continuation, RI1 or RA1 release proof.

All future validation is foreground serial with timeout600, unchanged test timeouts. Use both node prefixes: N26 `/home/linuxbrew/.linuxbrew/bin/node`, N24 `/home/tanisjam/.nvm/versions/node/v24.20.0/bin/node`.

- Baseline: `<node> node_modules/vitest/vitest.mjs run src/domain/e-lifecycle-genesis.test.ts src/domain/e-year-source.test.ts src/domain/e-favor-executor.test.ts --maxWorkers=1`.
- Focused RED/GREEN/triangulation: `<node> node_modules/vitest/vitest.mjs run src/domain/e-lifecycle-runtime.test.ts --maxWorkers=1`.
- Final exact related suite on BOTH nodes: `<node> node_modules/vitest/vitest.mjs run src/domain/e-lifecycle-runtime.test.ts src/domain/e-lifecycle-genesis.test.ts src/domain/e-year-source.test.ts src/domain/e-favor-executor.test.ts src/domain/e-annual-policy.test.ts src/domain/e-annual-composition.test.ts src/domain/legacy-year.test.ts src/domain/e-runtime.test.ts src/domain/e-capsule.test.ts src/domain/simulate.test.ts src/domain/simulate-decide-year.test.ts src/domain/replay.test.ts src/domain/fork.test.ts --maxWorkers=1`.
- Types: `/home/linuxbrew/.linuxbrew/bin/node node_modules/typescript/bin/tsc --noEmit --incremental false`.
- Scoped lint: `/home/linuxbrew/.linuxbrew/bin/node node_modules/eslint/bin/eslint.js src/domain/e-lifecycle-runtime.ts src/domain/e-lifecycle-runtime.test.ts`.
- Whitespace: `git diff --check`.

Commands above are the future writer contract, not executed during this documentation-only synchronization. Parent retains native review, integration and terminal Git ownership; no release completion is claimed.

## LR1b closure / LR2a mapped replay

Inherited evidence, not rerun: baseline137 → missing-module RED → 23 GREEN. Two diagnostic Vitest heap failures corrected with bounded fixtures, no flags/timeouts changed; Mind/genotype/optional assumptions corrected. N26/N24 540/13 PASS (212.49/204.20s), types/lint PASS; main spot23 PASS, types/lint/diffcheck and three hashes stable, only `.claude/`. Source count1,078+676=1,754 excludes docs. Cumulative journals/LIFE scale unproved.

Native `review-bc049fd9d1fef069` APPROVED/ACK BURNED target `b571651dcde0ac4bd3307e773bf4aa7e58ef60fc0d4f543f4c558c4b1ec8adaa`, consumed `1558581ca241212ea7ee015b4ccdc45fd8f9dc3d30beb8c723ad271ac6d149d6`; never STATUS after burn.

LR2a `replayLifecycleRuntime(unknown)` accepts exactly `{genesis,output}`: descriptor-check WHOLE envelope before reads/clone/hash/await; cold-admit genesis and detach input before await. Regenerate `createLifecycleRuntime` for contiguous candidate years, no horizon cap. Losslessly compare full annual records/final output: actual people/Mind/logs/decisions/counters, native/final states, favor ledgers/resources/grants/slots/null meaning/entries/position ranges/frontier/status/snapshot. Return regenerated frozen output restoring aliases/registry order. Zero/incomplete alive/death valid; reject human entries, unknown nested fields, forged/rehashed/gappy/accessor/executable/cyclic/nonfinite data. No callbacks/hash-only proof; canonical wrapper is NOT certificate, existing bytes unchanged.

Future checks: existing N26/N24 prefixes, foreground serial timeout600, unchanged test timeouts. Baseline genesis/runtime; replay RED/GREEN; final BOTH: `src/domain/{e-lifecycle-genesis,e-lifecycle-runtime,e-lifecycle-replay,e-year-source,e-favor-executor,e-annual-policy,e-annual-composition,e-runtime,e-capsule,e-fork,annual-runtime-baseline}.test.ts` (expand each path), `node_modules/vitest/vitest.mjs run … --maxWorkers=1`. N26 tsc `--noEmit --incremental false`; ESLint exact four genesis/replay paths; `git diff --check`. No writer launched; parent owns launch/review/commit.

## LR2a closure / LR2b mapped capsule

Inherited, not rerun: baseline107 → missing-module RED → 103 GREEN; immigrant order, single-creditor reversal/history fields and TS2589 corrected. N26/N24 514/11 PASS (91.26/89.92s), types/lint PASS; main spot103 PASS, types/lint/diffcheck, five hashes stable; only `.claude/`. Running source1,754+489=2,243 excludes docs; no LIFE-scale performance proof.

Native `review-1d4a7dc1953b1b2b` APPROVED/ACK BURNED target `1a59494a0cbf794c24fbc75a71e2e0e50d5460cf5ce38c5eb77fdab918e43415`, consumed `5ecdbb20748117d11f5a9df3c1247e90886bf9135f01d9446218f39726e33b62`; never STATUS after burn.

LR2b async create/admit/serialize/deserializeLifecycleCapsule takes closed unknown input. Capsule `{manifest,digest,genesis,output}`; canonical wire `{manifest,payload,digest}`. Closed manifest includes full LIFECYCLE_GENESIS_VERSIONS plus new capsule schema/codec technical strings. Reuse canonicalLifecycleData EXACT tagged grammar; add strict inverse only. Digest frames manifest + encoded genesis/output, excluding digest; rehashed input NEVER bypasses FULL async LR2 replay. Return regenerated frozen graph restoring aliases/registry order.

Descriptor-check WHOLE input before await. Preserve signed zero, own undefined, UTF16 strings, array order; sort record keys and safely define hostile keys. Strict decode + EXACT reencode rejects malformed tags, duplicate keys, noncanonical numbers and alternate JSON envelopes (whitespace/duplicates). Zero/incomplete alive/death capsules valid, not release. No E1/C2/capsule-codec edits, branch storage, nested rewrite or human-authority activation; future RB1 extension needed for old repository hardcoded E3.

Checks: existing N26/N24 prefixes, foreground serial timeout600, unchanged test timeouts. Baseline genesis/replay; new capsule RED/GREEN. Final BOTH `node_modules/vitest/vitest.mjs run src/domain/{e-lifecycle-genesis,e-lifecycle-runtime,e-lifecycle-replay,e-lifecycle-capsule,e-year-source,e-favor-executor,e-annual-policy,e-annual-composition,e-runtime,e-capsule,e-fork,annual-runtime-baseline}.test.ts --maxWorkers=1` (expand paths). N26 tsc `--noEmit --incremental false`; ESLint two new capsule paths; `git diff --check`. Parent writer/native/Git/integration pending; no LR2b source writes yet.

## LR2b closure / LC1 controller and checks

Inherited, not rerun: baseline189 → missing-module RED → 83 GREEN; N26/N24 597/12 PASS (95.82/93.13s), types/lint PASS. Main83/types/lint/diffcheck PASS, three hashes stable, HEAD unchanged. Verifier status NOT run (no after-`.claude/` proof); parent only `.claude/` before gate. Source2,243+434=2,677 excludes docs.

Native `review-226708585e7e6fcd` APPROVED/ACK BURNED target `a566dd22b35978fa63da1a5744f6ac0c314a881ace480265c56874ce6513ca1c`, consumed `c29c63c1704eb4568a59c4a4f6d95953a49bf3642dfb67df3b2b0d3905fcfedd`; never STATUS after burn.

`runLifecycle(input:unknown, options:{maxSteps,signal?})`: closed certified-genesis start/full-capsule resume; finite safe-integer budget. Typed complete/incomplete(budget)/aborted, each full certified capsule. Resume FULL admission/replay, reconstruct owner via trusted journal years, compare output before advancing; no checkpoint forge. Contiguous until genuine death/budget/cancel; alive NEVER complete, endYear NEVER death. Signal before/after committed year/event-loop yield; no source/admission/replay interruption. Observed abort wins over death capsule (runtime death ≠ producer aborted). Errors propagate; actual canonicalYearSnapshot, no E2 projection. Final capsule replays all output; necessary duplication, no weaker authority. No routes/store/human rewrite.

Checks: API RED→GREEN; start/resume/zero/budget/beyond-horizon genuine death/inflight and prior abort/forged resume/errors/caller fidelity. LIFEsmoke: `baseline-1327-0`, start/end1327, founders6 Alice/f, all actors grain2/effort3/need1, max4; unforced death expected by1330, no exact year; serialized cold replay/alias/canon. Also normal E1 default62 founders, real protagonist age0, ~60+ years before UI release; log elapsed/RSS/heap/wire bytes. No seed search/forced death/mocks/heap flags/timeout override. Memory risk: partial; journal optimization needs mapping. Cancellation cannot bound retention.

Existing nodes, foreground timeout600: focused run test, `-t LIFEsmoke`; final BOTH `node_modules/vitest/vitest.mjs run src/domain/e-lifecycle-run.test.ts src/domain/e-lifecycle-genesis.test.ts src/domain/e-lifecycle-runtime.test.ts src/domain/e-lifecycle-replay.test.ts src/domain/e-lifecycle-capsule.test.ts src/domain/e-year-source.test.ts src/domain/e-favor-executor.test.ts --maxWorkers=1`. N26 types/lint two new paths/diffcheck as above. RI1: human version/replay/storage choice, no product choice/MVP cut.

## LC1 partial — coverage FAIL / capacity decision pending

Inherited only; no reruns. Isolated lifecycle-run3 HEAD70dca9a32c979a643dc58dd969ce864822dce9f0; uncommitted3paths593=90prod/414tests/89docs. Baseline106PASS→missing-moduleRED→fast32GREEN, types/lintPASS. baseline1327/default-origin first-year deaths were short, not long proof.

Predeclared lifecycle-representative-v1/0..4: once each, E1default62founders1498/1558, Alice/f age0, resources2/3/1, max128. All5 genuine complete; years3/2/3/2/4, frontiers1500/1499/1500/1499/1501; cold canon/alias/traversalPASS. Aggregate LIFE coverageFAIL117.979s: no ≥60-year member, no death beyond1558. No seed search/forcing/age override/OOM/timeout/string limit. Wires31723585/17407793/30759790/15953474/56561271 bytes. Largest sampled process RSS3092930560/heap-used2604526176 bytes: NOT peaks or exclusive per-member measurements. Capacity risk needs human deployment RAM budget; invent no limit/cut.

Fast32PASS4.16s; explicit representative1skipped. Dual-node seven-file gates SKIPPED after failed gate. No LC1 native commit/review/integration; main source70dca9a unchanged; no RA1 release. Next map bounded journal/canon-wire performance units before writer; preserve semantic full-execution certification, old-version replay, no forced death. Continue-until-release active, not blanket pause.

Isolated SHA256 prod0f2d53b6e16c913a14f716b3747cc110a49e9c0305d179841425e80628a6f65d; test0a4c0e5a483c29cf96b3a82094630f574139ca9de3698a7ccf158054131db9ac; docs eae2f3c45482caeb21492255c4657552e1020d1a42d7399656abdaa2300442b5.

## Current checkpoint — LC1 pending; memory feature mapped

Main `0de392699d2c9e9e54e22058e3049d4561705648` is the stable integrated base. Parent reports isolated LC1 WIP `9b7af0b` clean, retaining the same 593-line three-path partial unit; not integrated or approved. Earlier uncommitted/main70dca9a wording records the earlier checkpoint, not current status. No new receipt or source changes in this documentation update.

Decision7656 / map7657: user “nose, uno o dos” RAM guidance means conservative 1 GB PROVISIONAL target within 1–2 GB, not a server hard limit; concurrency and actual capacity unknown. Five fixed cohort members genuinely completed in 2–4 years, full cold canon/alias/traversal PASS, ≥60-year coverage FAIL. Sampled 3.09 GB RSS is cumulative process sampling, NOT peak/exclusive per-member usage. Do not force ages/death, search survivors, reseed, cap completion or change coverage to fake proof.

[Memory featurebook](narrative-lifecycle-memory.md), FULL topic `odd/narrative-lifecycle-memory/tasks`, maps LP1a IN PROGRESS (immutable journal-prefix reuse + fresh-process measurement), LP1b PENDING (measured transient copies), LP1c PENDING conditional (explicit versioned graph-sharing wire), LP1d PENDING (independent capacity). No memory source writes yet; no LP1b/LP1c implementation path permission. LP1d connects back to LC1 long coverage, never automatically closes LC1. Old E1 wire/human rules and bounded LR approvals remain intact; FE1 unreviewed applies only to FE1. Ask-on-risk / feature-branch-chain remains local only, no push/deploy. Parent owns timeline projection after durable full book/mirror writes.

## Memory transition — LP1a DONE / LP1b active mapping

Parent-reported, not rerun here: LP1a source `c230539` (six feature-branch paths) is integrated via four source/design paths at main `0d3858dc0829c81fe8d3030e5ebd625c12232720`, after passive `f9491da`. Independent BOTH552/11 plus fresh memory/types/lint PASS; main spot30/types/lint/diff-check PASS, four source hashes stable, HEAD unchanged, only unrelated `.claude/`. Native `review-3ca656937db22083` medium400 APPROVED / exact ACK BURNED; exhausted target/consumed identifiers are preserved in the featurebook. NEVER STATUS again; no next native approval inferred.

Human7678 allows local verified release commits/integration branches only; no push/PR/main-default merge/deploy. [FULL featurebook7658](narrative-lifecycle-memory.md) owns LP1b's private bounded canonical append-writer contract, two genesis source/test surfaces, unchanged canonical/digest/grammar/wire guarantees, meaningful-functional-RED exception and BOTH-node baseline/candidate checks. Parent prepares its worktree after durable tracking; no LP1b source yet. LP1c conditional and LP1d pending. LC1 stays BLOCKED: 1GB target unmet and genuine ≥60-year proof absent; memory improvements never auto-close it. This historical reference update preserves its evidence; the latest transition below supersedes its LP1b-active mapping. FULL runtime mirror7604 must match the complete current local book.

## Memory transition — LP1b DONE / LP1e active before source

Parent-reported, not rerun here: LP1b source `5e13cf7`, four source/test paths228+/4− including retained62 fixture tests; MAIN integration `c066234c4a9ef19dcedfb9f71ce950e7cbd81291` after passive `f537e3f`. Missing-pair-helper RED → full593/11 GREEN BOTH (85.11/94.94s); fresh baseline/candidate memory BOTH PASS, full cold four genuine years/death1501, wire56561271 and same canonical/wire pins. Types/lint/diff-check/hashes PASS. Main spot313/3 plus types/lint/diff-check PASS, four hashes match, HEAD unchanged, only unrelated `.claude/`.

ASSESS medium294/5, large writer, independentVerifier=false; self-verification stands, no independent-verifier claim. Native `review-47deeed972f5d125` medium294/5 reliability APPROVED / exact ACK BURNED. Target `f424e54410dadc47b123a9ad4db9f532b0b5958dc95754514b024ef777746394`, consumed `0a902a27c435b257c7628fdbc8ff5a318ac3b547e90398df7d7484e193197973`: NEVER STATUS again. LP1b DONE bounded only, not capacity/release approval.

Actual total maxRSS bytes: N26 baseline2055032832 → candidate1998364672; N24 baseline2046025728 → candidate1888108544. Elapsed ms53241.859→54914.201 /49326.177→48807.571. Small mixed benefit, NO no-regression claim; process total includes Vitest, baseline difference not exclusive memory; provisional1GB NOT met.

[FULL featurebook7658](narrative-lifecycle-memory.md) owns ACTIVE LP1e: ONLY `src/domain/e-lifecycle-capsule.ts` and `src/domain/e-lifecycle-capsule.test.ts`, no source written yet. Remove redundant outer create/admit clone after whole original data guards; keep synchronous manifest/digest checks, synchronous independent genesis regeneration and essential whole replay capture before first await. After await never use caller record; return frozen module manifest/detached genesis/regenerated output only. Full semantic replay, deserialize strict inverse and old exact wire/digest/grammar/pins unchanged; no owned flags, callbacks or trusted bypass.

Test-first allocation call-through spy distinguishes outer duplicate from essential replay clone; mutation isolation is baseline GREEN, not false RED. Full anti-hook/forgery/aliases/order/tag/wire checks; fresh BOTH-node fixed v1/4 baseline before production and candidate after, related11 suite, types/two-file lint/diff/hashes under existing timeout600 rules. Advisory≤250 changed lines, not cap; multiarea need STOP mapper. Parent prepares new isolated worktree after doc commit and copies FULL books before source. LP1c conditional/d pending, LC1 BLOCKED ≥60-year proof/capacity pending, RI1/RA1 unfinished. Human7678 local-only permissions and automatic continuation until release remain active. FULL mirrors7658/7604 must match current complete MAIN books; this doc-only update performs no commands/source/tests/native/children/commits/network.

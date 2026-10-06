# Lifecycle memory — measured, lossless performance units

CURRENT: LP1a DONE bounded; LP1b IN PROGRESS (mapped encoder-only unit; no source writes yet); LP1c conditional / LP1d PENDING. Main `0d3858dc0829c81fe8d3030e5ebd625c12232720` integrates LP1a source `c230539` after passive bookkeeping `f9491da`; four source hashes match approved bytes. Human7678 explicitly permits local verified release commits/integration branches ONLY: no push, PR, main/default merge or deploy. LC1 remains BLOCKED/pending; isolated clean WIP `9b7af0b` is NOT integrated. Parent prepares a new LP1b worktree after durable book tracking. FULL mirror: observation7658, `odd/narrative-lifecycle-memory/tasks`, project `lifelines`. Historical checkpoints below are preserved, superseded by CURRENT and the transition append.

## Decision and proof boundary

User RAM guidance “nose, uno o dos” establishes a conservative **1 GB PROVISIONAL target within 1–2 GB**, not a server hard limit. Concurrency and actual deployment capacity remain unknown. Decision7656 / map7657 are inherited context, not new receipts.

LC1's fixed five-member cohort genuinely completed in 2–4 years; full cold canonical replay, aliases and traversal PASS, ≥60-year coverage FAIL. Sampled 3.09 GB process RSS was cumulative across members, NOT peak or exclusive per-member usage. Do not force ages/death, search survivors, change seeds, cap completion or change coverage to manufacture proof. Fixed worst member v1/4 already ran four genuine years: default62 founders, Alice/f age0, origin1498/1558, resources grain2/effort3/need1, budget128.

Native approvals remain bounded LR1a/LR1b/LR2a/LR2b only. FE1 is explicitly unreviewed for that candidate only; user RDD unchanged. No new receipt or approved LC1. Preserve old E1 wire and human-authority rules. Delivery remains ask-on-risk / feature-branch-chain, local only; no push/deploy. Doc-only: no source/test/native/child/network execution.

## Automatic task chain

| Unit | State | Deliverable / gate |
|---|---|---|
| LP1a | DONE bounded | Immutable annual-journal prefix reuse verified, native APPROVED / exact ACK BURNED, locally integrated at main0d3858d. Capacity/LC1 remain open. |
| LP1b | IN PROGRESS, mapped | Encoder-only private canonical allocation reduction; exact two genesis source/test surfaces below. No source writes yet. |
| LP1c | PENDING, conditional | If needed, map explicitly versioned graph-sharing wire preserving full semantic replay. Never silently change old capsule bytes. No unmapped implementation authorized. |
| LP1d | PENDING | Independently measure capacity: total high-water RSS and baseline delta for fixed workload against provisional target. Connect evidence to LC1 long-coverage gate; never automatically close LC1. |

## LP1a mapped scope and invariants

Inherited implemented scope: `src/domain/e-lifecycle-runtime.ts`, `src/domain/e-lifecycle-runtime.test.ts`, new `src/domain/e-lifecycle-memory.test.ts`; bounded append to `docs/design/narrative-engine.md`. This correction authorizes only the design append and featurebook, not source/test writes. Stable integrated main is the base; harness uses runtime + capsule directly, without controller dependency.

Detach/freeze each NEW record once. Privately retain and share the published immutable prefix as identical objects; clone only the publication frame/new record, not earlier committed graphs. Trust private provenance, never caller `Object.isFrozen`; freezing must avoid recursing known prefixes. Preserve transactional combined owned+favors cloning, one actual registry and atomic pointer swap. Baseline runtime duplicated private/published journals; reuse removes repeated prefix copying, not a promise of 1 GB.

Keep full frozen publication semantics and unchanged content after advance/failure/retry. Preserve canonical identity, wire bytes, field presence, signed zero, aliases and order. Canonical encoder, replay, capsule and controller remain untouched in LP1a. Baseline canonical/wire pins precede production edits; retain all old proof, full replay and capsule forgery tests.

Inherited test sequence: immutable-prefix RED → runtime30 GREEN, with rollback/retry/frozen-content coverage. Advisory 400–700 authored lines, not a cap; no minification. This documentation correction runs no tests.

## Fresh-process measurement contract

New measurement test supervises one child Vitest using the same runner, `--pool=threads -t memory-child`, selected by environment. Fixed v1/4 workload only; no heap/GC flags. New measurement test timeout600000 is explicitly permitted; existing test timeouts remain unchanged. Run the SAME harness baseline before production edits and candidate afterward.

Measure CHILD `process.resourceUsage().maxRSS` (KiB converted to bytes), pre-genesis baseline RSS, phase RSS/heap/elapsed/wire bytes, complete cold canonical equality/traversal/aliases. Report total high-water RSS and high-water minus baseline separately: the difference is NOT exclusive per-memory usage. A 1 GB target is not an assumed PASS. Baseline/candidate claims require separate fresh processes on both nodes.

## Recovered LP1a evidence (parent supplied; not rerun here)

LP1 writer recovery succeeded. Original mux `28ee3-u7rb`: tools59, failure unknown, final error; do not infer source failure. Runtime/test/new memory test exist. Production baseline restoration was confirmed by an empty scoped git diff BEFORE corrected baseline runs, then the candidate was reapplied.

Corrected fixed v1/4 omits E1 dates and uses defaults: Alice/f, 85 initial people, origin1498/1558, grain2/effort3/need1, budget128; four genuine years, death1501. Full cold canon/traversal/aliases/freezing PASS. Explicit-dates fixture (+74 wire bytes) is superseded, not the older historical gate.

| Fresh run | Pre-genesis RSS bytes | Max RSS bytes | Delta bytes | Elapsed ms |
|---|---:|---:|---:|---:|
| N26 baseline | 332046336 | 2594684928 | 2262638592 | 51679.553 |
| N26 candidate | 342724608 | 2341330944 | 1998606336 | 51409.777 |
| N24 baseline | 358608896 | 2467655680 | 2109046784 | 49828.308 |
| N24 candidate | 339611648 | 2108043264 | 1768431616 | 47891.789 |

Annual4 heap bytes: N26 198485080→115860992; N24 193776000→111092680. Child maxRSS includes Vitest (KiB→bytes); delta is NOT exclusive generation memory. Both candidates exceed provisional1GB: no capacity or ≥60-year closure.

All four corrected runs: wire56561271 bytes; canon SHA256 `2f83c72b46391454fbc44e2288be27f09ef161ebf7d5c794a610bc072e881451`; wire SHA256 `1ef4498df18f17cf3b17df4cfee86749450485bfdc29623a0e358ea830e709e8`.

Inherited checks: N26 baseline295/4 PASS; full suite BOTH552/11 PASS (88.60/84.66s); corrected memory baseline/candidate on BOTH PASS. tsc passed BEFORE final prefer-const refactor. Lint FAILED prefer-const; binding fixed, NOT rerun. Final diff-check/hash/status not captured. Final validation, native review and integration remain pending; no approved receipt. Observation7604 remains untouched. Parent owns later memory mapping after this unit; LP1b/c/d permissions remain unchanged.

## Validation commands (inherited plan; not run by this documentation update)

Foreground serial, shell timeout600. N26=`/home/linuxbrew/.linuxbrew/bin/node`; N24=`/home/tanisjam/.nvm/versions/node/v24.20.0/bin/node`.

1. Before production: baseline genesis/runtime/replay/capsule tests with `--maxWorkers=1`; pin canon/wire. First measurement: N26 `node_modules/vitest/vitest.mjs run src/domain/e-lifecycle-memory.test.ts --maxWorkers=1 --pool=threads`.
2. Focused RED/GREEN: runtime tests; keep replay/capsule forgery coverage.
3. Final BOTH node prefixes: `node_modules/vitest/vitest.mjs run src/domain/e-lifecycle-runtime.test.ts src/domain/e-lifecycle-genesis.test.ts src/domain/e-lifecycle-replay.test.ts src/domain/e-lifecycle-capsule.test.ts src/domain/e-year-source.test.ts src/domain/e-favor-executor.test.ts src/domain/e-annual-policy.test.ts src/domain/e-annual-composition.test.ts src/domain/e-runtime.test.ts src/domain/e-capsule.test.ts src/domain/annual-runtime-baseline.test.ts --maxWorkers=1`. New memory test separately, fresh on both nodes for baseline/candidate claims.
4. N26 `node_modules/typescript/bin/tsc --noEmit --incremental false`; N26 `node_modules/eslint/bin/eslint.js src/domain/e-lifecycle-runtime.ts src/domain/e-lifecycle-runtime.test.ts src/domain/e-lifecycle-memory.test.ts`; `git diff --check`.

Parent owns final validation, native ASSESS/INSPECT, work-unit review, terminal Git and featurebook propagation to MAIN after observed checks. Native candidate excludes accumulated feature history. No release, capacity or long-LIFE closure claim. See [runtime gate/history](narrative-lifecycle-runtime.md).

## LP1a checkpoint (supersedes recovered unknowns; preserves history)

Independent CURRENT, parent-reported: BOTH N26/N24 552/11 PASS (92.36/90.92s); fresh memory BOTH PASS; types/lint/diff-check PASS; four source hashes stable before/after. RSS bytes baseline/max/delta, elapsed ms: N26 347320320/2461437952/2114117632, 51072.791; N24 333357056/2088644608/1755287552, 48472.570. Both 1GB-target false; delta not exclusive memory. Full cold canon/aliases/order/freeze PASS: genuine4 years, death1501, wire56561271, same recorded pins.

Native `review-3ca656937db22083`: medium400 lines/6 paths APPROVED; exact ACK BURNED. Target `b12fbe05455a489b9819a7ba202aade5a466090829adae1ad8db9b800aabe6db`; consumed `6418066e554cf5506fd66890f4fa370de53a1a8771548ccb3ebe4e4257d29417`. NEVER STATUS again. Source322: runtime24+/11-, test97, memory173, design17; native400 includes bookkeeping. Approval freezes original trees/400 scope, not later book bytes. Passive post-ACK bookkeeping, not new source or invented writer result. No commits/integration; isolated HEAD unchanged. LP1a IN PROGRESS, LP1b/c/d pending; human commit choice required.

## LP1a closure / LP1b mapped encoder unit

Parent-supplied transition, not rerun here: human7678 permits local verified release commits/integration branches only. LP1a source `c230539` covers six feature-branch paths; parent integration `0d3858dc0829c81fe8d3030e5ebd625c12232720` cherry-picks the four source/design paths after passive `f9491da`. Independent BOTH552/11, fresh memory, types/lint PASS remain the evidence above. Main spot30/types/lint/diff-check PASS; four source hashes stable and HEAD unchanged, only unrelated `.claude/`. LP1a DONE bounded. Native review/target/consumed receipt above is exhausted: NEVER STATUS again and no next approval inferred.

Capacity target1GB remains unmet (fresh totals about 2.09–2.46GB for four genuine years). LC1 BLOCKED pending genuine ≥60-year proof; no automatic closure, forced death or survivor search. LP1c/d remain pending as mapped.

### LP1b contract and scope

Only future source surfaces: `src/domain/e-lifecycle-genesis.ts` and `src/domain/e-lifecycle-genesis.test.ts`. Replace private canonical recursive map/join with append traversal and a private bounded coalescing chunk writer, joining once. Keep public `canonicalLifecycleData` string, digests, tagged grammar and old wire EXACT. Preserve the WHOLE descriptor guard BEFORE traversal: zero hooks; hostile own keys; UTF16/JSON escaping; own undefined versus absence; signed zero; ordered arrays; sorted records; finite-number grammar.

No frame clone, replay, capsule or controller edits; no new design-document permission (two source files, source comments and this taskbook suffice). Existing private canonical also serves digests. Remove child arrays/strings, NOT final two comparison strings or wire JSON escaping. Avoid token-per-array-item explosion. Advisory growth: ≤200 added test lines / about100 production lines, not a cap or reason to minify. Pause parent if a third source surface or huge growth is needed.

### LP1b evidence plan — not executed

Meaningful functional RED is unavailable for an unchanged-output allocation optimization. Record that exception explicitly: do not fake a mocked-map or heap-threshold RED. Before production, capture literal byte-fixture baseline GREEN and all canonical/wire pins; afterward require exact byte equivalence, full functional/forgery checks and fresh resource measurements. No LP1b baseline, implementation or pass is claimed yet.

Foreground serial, timeout600; existing timeouts unchanged. Use N26/N24 prefixes above:

1. Before production, focused N26 `node_modules/vitest/vitest.mjs run src/domain/e-lifecycle-genesis.test.ts src/domain/e-lifecycle-replay.test.ts src/domain/e-lifecycle-capsule.test.ts --maxWorkers=1`; retain literal canonical/wire fixtures and forgery checks.
2. CURRENT LP1a full baseline on BOTH nodes: the exact eleven-file final suite already listed above, `--maxWorkers=1`; fixed v1/4 memory baseline separately in fresh processes on BOTH: `node_modules/vitest/vitest.mjs run src/domain/e-lifecycle-memory.test.ts --maxWorkers=1 --pool=threads`.
3. Candidate: focused genesis first, then SAME eleven-file final suite on BOTH and SAME fresh memory workload on BOTH. Compare baseline/candidate maxRSS, baseline delta, phase heap/elapsed/wire and full cold canon/aliases/traversal without invented thresholds.
4. N26 `node_modules/typescript/bin/tsc --noEmit --incremental false`; N26 `node_modules/eslint/bin/eslint.js src/domain/e-lifecycle-genesis.ts src/domain/e-lifecycle-genesis.test.ts`; `git diff --check`; exact two-source hashes before/after validation.

Parent owns worktree, independent verification, native review and permitted terminal Git. This update is docs/mirrors only: no commands, source/tests, native calls, children or network delivery. See [runtime CURRENT and LC1 reference](narrative-lifecycle-runtime.md).


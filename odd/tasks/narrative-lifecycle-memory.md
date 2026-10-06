# Lifecycle memory — measured, lossless performance units

CURRENT: LP1a DONE bounded; LP1b IN PROGRESS (new mapped full-tree pair comparison, NOT the rejected chunk encoder); LP1c conditional / LP1d PENDING. MAIN HEAD `c3abaca`; scoped owned production restored to that HEAD, unchanged; new canonical tests62 retained in the child. Failed encoder attempt discarded, not integrated or committed. Human7678 permits local verified release commits/integration branches ONLY: no push, PR, main/default merge or deploy. LC1 remains BLOCKED/pending; isolated LC1 WIP `9b7af0b` is NOT integrated. FULL mirror target: existing observation7658, `odd/narrative-lifecycle-memory/tasks`, project `lifelines`. No observation7604 mirror update needed: same LP1b-active pointer. Parent must copy this complete MAIN book to the isolated tree before writer/source candidate work. Historical checkpoints below are superseded by CURRENT and the latest LP1b contract.

## Decision and proof boundary

User RAM guidance “nose, uno o dos” establishes a conservative **1 GB PROVISIONAL target within 1–2 GB**, not a server hard limit. Concurrency and actual deployment capacity remain unknown. Decision7656 / map7657 are inherited context, not new receipts.

LC1's fixed five-member cohort genuinely completed in 2–4 years; full cold canonical replay, aliases and traversal PASS, ≥60-year coverage FAIL. Sampled 3.09 GB process RSS was cumulative across members, NOT peak or exclusive per-member usage. Do not force ages/death, search survivors, change seeds, cap completion or change coverage to manufacture proof. Fixed worst member v1/4 already ran four genuine years: default62 founders, Alice/f age0, origin1498/1558, resources grain2/effort3/need1, budget128.

Native approvals remain bounded LR1a/LR1b/LR2a/LR2b only. FE1 is explicitly unreviewed for that candidate only; user RDD unchanged. No new receipt or approved LC1. Preserve old E1 wire and human-authority rules. Delivery remains ask-on-risk / feature-branch-chain, local only; no push/deploy. Doc-only: no source/test/native/child/network execution.

## Automatic task chain

| Unit | State | Deliverable / gate |
|---|---|---|
| LP1a | DONE bounded | Immutable annual-journal prefix reuse verified, native APPROVED / exact ACK BURNED, locally integrated at main0d3858d. Capacity/LC1 remain open. |
| LP1b | IN PROGRESS, newly mapped | Full-tree canonical pair equality; exact four genesis/replay source/test surfaces below. Chunk encoder rejected; production restored, tests62 retained. |
| LP1c | PENDING, conditional | If needed, map explicitly versioned graph-sharing wire preserving full semantic replay. Never silently change old capsule bytes. No unmapped implementation authorized. |
| LP1d | PENDING | Independently measure capacity: total high-water RSS and baseline delta for fixed workload against provisional target. Connect evidence to LC1 long-coverage gate; never automatically close LC1. |

## LP1a mapped scope and invariants

Historical implemented surfaces: `src/domain/e-lifecycle-runtime.ts`, `src/domain/e-lifecycle-runtime.test.ts`, new `src/domain/e-lifecycle-memory.test.ts`, bounded `docs/design/narrative-engine.md` append. Harness uses runtime + capsule directly, no controller.

Detach/freeze each NEW record once; privately share published immutable prefixes as identical objects. Clone publication frame/new record, not earlier graphs; trust private provenance, never caller `Object.isFrozen`, and skip known prefixes during freeze. Preserve transactional combined owned+favors cloning, one registry, atomic pointer swap. Baseline duplicated private/published journals; reuse removes repeated prefix copying, not a1GB promise.

Preserve frozen content after advance/failure/retry, canonical identity/wire/field presence/signed zero/aliases/order. LP1a leaves encoder/replay/capsule/controller untouched; baseline pins precede edits and all replay/capsule forgery proof remains.

Inherited immutable-prefix RED → runtime30 GREEN includes rollback/retry/frozen-content. Advisory400–700 lines, not a cap; no minification. No tests run by this documentation update.

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

Reusable eleven-file suite, BOTH node prefixes: `node_modules/vitest/vitest.mjs run src/domain/e-lifecycle-runtime.test.ts src/domain/e-lifecycle-genesis.test.ts src/domain/e-lifecycle-replay.test.ts src/domain/e-lifecycle-capsule.test.ts src/domain/e-year-source.test.ts src/domain/e-favor-executor.test.ts src/domain/e-annual-policy.test.ts src/domain/e-annual-composition.test.ts src/domain/e-runtime.test.ts src/domain/e-capsule.test.ts src/domain/annual-runtime-baseline.test.ts --maxWorkers=1`. New memory test separately, fresh on both nodes for baseline/candidate claims.

Historical LP1a prospective commands are superseded by its checkpoint/closure and CURRENT LP1b proof plan. Parent owns validation/review/Git; native candidate excludes accumulated feature history. No capacity or long-LIFE closure. See [runtime gate/history](narrative-lifecycle-runtime.md).

## LP1a checkpoint (supersedes recovered unknowns; preserves history)

Independent CURRENT, parent-reported: BOTH N26/N24 552/11 PASS (92.36/90.92s); fresh memory BOTH PASS; types/lint/diff-check PASS; four source hashes stable before/after. RSS bytes baseline/max/delta, elapsed ms: N26 347320320/2461437952/2114117632, 51072.791; N24 333357056/2088644608/1755287552, 48472.570. Both 1GB-target false; delta not exclusive memory. Full cold canon/aliases/order/freeze PASS: genuine4 years, death1501, wire56561271, same recorded pins.

Native `review-3ca656937db22083`: medium400 lines/6 paths APPROVED; exact ACK BURNED. Target `b12fbe05455a489b9819a7ba202aade5a466090829adae1ad8db9b800aabe6db`; consumed `6418066e554cf5506fd66890f4fa370de53a1a8771548ccb3ebe4e4257d29417`. NEVER STATUS again. Source322: runtime24+/11-, test97, memory173, design17; native400 includes bookkeeping. Approval freezes original trees/400 scope, not later book bytes. Passive post-ACK bookkeeping, not new source or invented writer result. No commits/integration; isolated HEAD unchanged. LP1a IN PROGRESS, LP1b/c/d pending; human commit choice required.

## LP1a closure / LP1b transition history

Parent-supplied transition, not rerun here: human7678 permits local verified release commits/integration branches only. LP1a source `c230539` covers six feature-branch paths; parent integration `0d3858dc0829c81fe8d3030e5ebd625c12232720` cherry-picks the four source/design paths after passive `f9491da`. Independent BOTH552/11, fresh memory, types/lint PASS remain the evidence above. Main spot30/types/lint/diff-check PASS; four source hashes stable and HEAD unchanged, only unrelated `.claude/`. LP1a DONE bounded. Native review/target/consumed receipt above is exhausted: NEVER STATUS again and no next approval inferred.

Capacity target1GB remains unmet (fresh totals about 2.09–2.46GB for four genuine years). LC1 BLOCKED pending genuine ≥60-year proof; no automatic closure, forced death or survivor search. LP1c/d remain pending as mapped.

### Rejected LP1b encoder attempt — historical evidence only

Superseded mapping: private append traversal with a 32 Ki UTF16 coalescing chunk writer, two genesis source/test surfaces; public canonical strings/digests/grammar/wire unchanged. Its unchanged-output optimization had no meaningful functional RED; the earlier exception applied ONLY to that attempt, not the new helper contract.

Parent-reported attempt: all572/11 PASS; cold canonical/wire pins stable. RSS improved only5.6%/1.4% on N26/N24, while elapsed increased63.9%/40.5%. Parent7684 rejected it: no integration, native review or commit. Scoped owned production restored to MAIN HEAD `c3abaca`; new canonical tests62 retained. These measurements are rejected-attempt evidence, NOT proof for the new pair comparator. The old chunk-writer plan is NOT a live instruction.

### LP1b CURRENT contract — full-tree canonical pair equality

Exact four future source/test surfaces ONLY:
- `src/domain/e-lifecycle-genesis.ts`
- `src/domain/e-lifecycle-genesis.test.ts`
- `src/domain/e-lifecycle-replay.ts`
- `src/domain/e-lifecycle-replay.test.ts`

Add explicit internal-module export `canonicalLifecycleDataEqual(left, right): boolean`. Before ANY early false or same-argument `Object.is`, preflight BOTH WHOLE arguments with `requireFavorData(left, true)` and `requireFavorData(right, true)`. Unknown malformed data on either side must reject even when an earlier field mismatches; late getters/cycles must not evade admission, and hooks remain ZERO. Preserve existing descriptor guards against sparse/extended arrays, symbol keys and nonfinite numbers.

After preflight, compare the FULL trees, exactly matching the unchanged old canonical string equality:
- Finite numbers use `Object.is`, preserving signed zero; strings compare exact UTF16 code units.
- Arrays require the same kind and length, ordered recursive values.
- Records require the same own-key count, `hasOwn` for each left name, and recursive values. Ignore insertion order and ordinary-versus-null prototype, as old canonical encoding does. Hostile keys are data, not prototype lookup.
- Own undefined and absence remain distinct via key counts/own-key presence. Repeated references unfold to the same canonical values, not identity-based equality. No WeakMap cache, hashes or projection.

Public original `canonicalLifecycleData` string encoder, digest, byte format and version remain UNCHANGED. The tiny helper is not a trusted callback, new product API, external-unknown authority or cache. Runtime aliases must still be checked separately on independently regenerated returned output: tree comparison is not an alias certificate.

Replace ONLY replay's two string-comparison sites (annual record and final output) with this helper. Preserve FULL regeneration, closed-envelope cloning BEFORE await, all unknown-data checks and admission-frontier checks. No bypass of regeneration; no capsule/controller/runtime edits or design-document permission. Advisory150–350 authored lines, not a cap: two production files plus two tests, without minification.

### LP1b CURRENT proof plan — pending, not executed here

Strict behavior-level RED: the named helper is missing. Then GREEN: pair truth agrees with the UNCHANGED OLD canonical strings on bounded fixtures covering all tags/keys, +/-0, null prototypes, repeated references, hostile keys, surrogates and insertion order. Exercise all malformed/closed-data cases with zero hooks, both sides including early mismatch/late invalid data, and existing replay forgeries across all fields. Tests must assert actual replay uses the pair helper while the byte-encoding helper is NOT called for comparison, without bypassing full regeneration.

Foreground serial, timeout600; existing timeouts unchanged. Use the N26/N24 prefixes above; no heap/GC/timeout/seed/mortality changes:
1. BEFORE production edits: focused N26 `node_modules/vitest/vitest.mjs run src/domain/e-lifecycle-genesis.test.ts src/domain/e-lifecycle-replay.test.ts src/domain/e-lifecycle-capsule.test.ts --maxWorkers=1`; then fresh memory baseline on BOTH nodes using `node_modules/vitest/vitest.mjs run src/domain/e-lifecycle-memory.test.ts --maxWorkers=1 --pool=threads`. Production must be unchanged for these baselines. Fixed default v1/4:85 initial people, four genuine years, death1501, wire56561271; retain old canonical/wire pins above.
2. Capture meaningful missing-helper RED, implement minimum pair walk/replay replacement, then focused GREEN and negative/alternate triangulation. Retained tests62 do not replace new behavior evidence.
3. Final BOTH: exact eleven-file suite listed above plus SAME fresh memory workload separately on BOTH. Compare maxRSS, baseline delta, phase heap/elapsed/wire and full cold canonical/aliases/traversal. Baseline/candidate must each be fresh processes; delta is not exclusive memory.
4. N26 `node_modules/typescript/bin/tsc --noEmit --incremental false`; N26 `node_modules/eslint/bin/eslint.js src/domain/e-lifecycle-genesis.ts src/domain/e-lifecycle-genesis.test.ts src/domain/e-lifecycle-replay.ts src/domain/e-lifecycle-replay.test.ts`; `git diff --check`; four scoped source/test diff checks and hashes before/after validation.

Goal: eliminate paired full-string materializations, NOT promise1GB; other capsule/wire peak capture costs persist. Capacity and LC1 remain open. Parent owns copying this FULL MAIN book to the isolated tree before writer/source candidate, independent verification, native review and permitted terminal Git. This documentation update performs no source/tests, commands, children, native calls, network delivery or commits. See [runtime CURRENT and LC1 reference](narrative-lifecycle-runtime.md).


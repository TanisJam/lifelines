# Narrative engine — ODD tasks

## Authority and invariants

- User authorizes implementation through completion and local work-unit commits on `feat/narrative-engine`; no push, PR creation, merge, deployment, installs, network operations or live database changes.
- One writer per worktree. Parallel read-only mapping and verification are authorized. Preserve pre-existing untracked `.claude/`.
- English artifacts; Spanish conversation. Applicable behavior uses observed RED → GREEN → refactor, writer checks, applicable independent checks and native review under the user-owned switch.
- Initial branch point: `d5d9ad5`. Current committed/reviewed boundary: `9254234b25c6229ee8f334a4c75c9560d0725794`.
- Source of truth: `docs/design/narrative-engine.md`; original handoff: `/home/tanisjam/Downloads/lifelines_narrative_engine_handoff.md`. This complete current task document is mirrored in Engram6902, topic `odd/narrative-engine/tasks`.
- Deterministic rules own canon. Directors weight opportunities, never eligibility/outcomes. Selection/prose are downstream and cannot mutate canon or leak future evidence. Hidden activity is material, not a displayed-card quota.
- Preserve frozen A/B/C contracts. New authority/projection/rules require explicit versions. One Person registry with supplemental ledgers; final people/cards cannot reconstruct historical canonical inputs.
- About 400 authored lines per task is advisory, not a hard cap or stop trigger. Never delete formatting, omit tests or introduce abstractions merely to fit it. Split only coherent behavior boundaries.

## Delivery strategy — human selected

`delivery_strategy=ask-on-risk` with the one shape question resolved; `chain_strategy=feature-branch-chain` (Engram7008). Preserve the existing feature assembly branch; plan dependent review slices with a draft/no-merge tracker when publication is separately authorized. No PRs, child refs, history rewrites or tracker PR have been created.

Prospective work-unit ranges, not published PRs:

| Unit | Base → end | Authored additions + deletions |
|---|---|---:|
| Design | d5d9ad5 → 0acd452 | 492 |
| A | 0acd452 → 927c346 | 614 |
| A-baseline | 927c346 → b683054 | 401 |
| B | b683054 → 62e73d8 | 603 |
| C1 | 62e73d8 → 4492d53 | 710 |
| C2 | 4492d53 → 9de9631 | 540 |
| D1 | 9de9631 → e3f0e8e | 547 |
| D2a-prep | e3f0e8e → a414349 | 307 |
| D2a | a414349 → 9254234 | 631 |

Running authored count: **4,845** (including design/tracker; no generated/vendor diff). D2a actual source/tests/design: 511 lines; tracker adds 120. Forks/production need per-unit refinement. At PR preparation, make one honest slicing pass, retain tests/docs with behavior and disclose any inseparable overage. No size exception or repository-specific label is authorized. Chaining shape grants no publication, maintenance or review consent.

## Closed work units

- [x] **A — Strict replay:** `927c346094091e0b11b2bd3dd2159b70e004b0b2`. 44 tests Node24/26; bond/accessor regressions observed RED. Native approval acknowledged. Frozen A tuple/projection/rules preserved.
- [x] **A-baseline — Measured corpus:** `b68305478e899b64d788dca6f2ae9992b3b7442f`. 49 tests and four paired cases Node24/26. Compression bytes differ across runtimes; no universal portability/scaling claim.
- [x] **B — Atomic favor/obligation:** `62e73d803836a552a03eff50d0db2e1beb47ab73`. 101 tests Node24/26; inherited-array hook blocker fixed with RED regressions. Explicit abstract grain, objective HELP debt and supplemental directed ties; no inferred gratitude.
- [x] **C1 — Causal request/response:** `4492d53d7c9417540d39d50ae602cf8db286a115`. 178 tests Node24/26, 14 adversarial rejections/zero hooks. Explicit effort/need; current feasibility and policy recomputed; ineligibility is not refusal; no resource regeneration.
- [x] **C2 — Seeded opportunities:** `9de9631970dbdf06df8ed196b1995ec82ba95ca2`. 221 tests Node24/26, 20 adversarial rejections/zero hooks. Two slots/creditor/year, .25 activation, monotonic/quiet frontiers, exact cold continuation and stable semantic draws. C1/C2 are standalone demonstrations, not production integration.
- [x] **D1 — Canonical capsule/repository:** `e3f0e8e64ae8decf0a916d6a792b8df43ac92530`. 272 tests Node24/26, nine independent rejection probes/zero hooks. Explicit C2 tuple/config/order, descriptor-first optional normalization, canonical SHA256 wire and detached serialized-memory loads/retries. Native `review-61186173d5d4a046` consumed. NOT SQLite durability/authenticated provenance. R3 surrogate-fixture warning is nonblocking later test work.
- [x] **D2a-prep — Shared physics:** `a41434954d214b4efc532ce55e85aec99d7a8ce5`. Source284 authored lines plus tracker23. Missing API RED2/116pass, root-accessor RED1/118pass → focused GREEN → 302 total. Independent `murhwncq-y-f0q2`:302PASS Node26.8.1 (1.03s)/24.21.0 (1.17s), type/lint/whitespace and 19 additional checks/zero hooks. C JSON/version/identity/evidence/noise checks unchanged. Borrowed current view, detached physical ledgers, no people/log duplication. Native `review-5717a0b75c1f9286` approved/ACK burned target `14da4cba1f1076c828c93b4089f59ecebf251baf7d8704b437169632f881f268`, revision `964ee64ac012def2dad8ca4ab1abbb35f293984cfaffe24f8d502dee9927d1f1`. Post-commit ASSESS over e3f0e8e reports medium307, committed candidate unconsumed/under budget: deferred to its delivery slice, not claimed as committed-range receipt. Matching bytes already independently verified. Runtime harness N/A: pure domain helpers, no new process/UI/storage boundary. Rollback: helpers/tests/design only, retaining existing C wrappers. Detailed evidence: Engram6996 and immutable commits/design.

### D2a — Explicit response authority (closed)
- [x] Implement versioned D response/reducer admission without weakening C.
Commit `9254234b25c6229ee8f334a4c75c9560d0725794`; delegated writer `murm5co4-z-1qp1` (multi-file trigger). Missing-module RED → opposite-baseline GREEN → 78 new/380 total tests. Independent verifier `murn27sc-10-ci4r`: 380 PASS Node26 (1.71s)/Node24 (1.58s), 18 additional probes/zero hooks, type/lint/whitespace PASS; supplied source/test/design hashes unchanged. Vite warning only.

One D authority resolver/shared physical seam preserves factors/distribution/noise/baseline while admitting eligible declared human choices. Strict cold D replay with unchanged C prefix; C/D1 reject mixed projections. No fork/storage/production proof; declared authority is not authentication. Native workspace `review-f3592d004f31b8c3` approved/ACK burned. Postcommit ASSESS: medium631, slice budget reached, committed candidate initially unconsumed; committed-range `review-dbd19acbf8acc824` then approved/exact ACK burned target `4dbe068a0bc20136adabd82a3505445993a4297606dffa6e1eac7251c359ad2a`, revision `e3e887cff4311161debc8699af439c988c0d513b4b2726e2f75a4f665d101049`. Reviewed boundary advances to 9254234. Rollback remains standalone module/tests/design; full suite/build/browser/storage deferred to applicable integration units.

## Current work

### D2b-prep — Shared grant/request/opportunity physics
- [ ] Extract version-neutral physical seams without changing C/B authority.
In progress; delegated writer route (multi-file trigger). Allowed surfaces: `src/domain/effects.ts`, `src/domain/effects.test.ts`, `docs/design/narrative-engine.md`. Borrow one admitted current registry/view; stage detached grant ledgers, validate request context and inspect opportunities independently of checkpoint decoding. Existing C wrappers retain all versions, identities, evidence, canonical JSON and rejection behavior. No D2b history/scheduler/fork/storage behavior yet. Test-first, focused Node checks, applicable independent verification, native review and local work-unit commit.

### D2b — Fork identity and inheritance
- [ ] Fork from prior-year prefixes with explicit eligible human choice and inherited overrides.
Pending shared-physics preparation; delegated writer route (multi-file trigger). Map derives `favor-fork.ts`/test, D scheduler and narrow scheduler/capsule/repository extensions. Preserve prefix data/IDs verbatim, including quiet frontier. Keep C2 baseline RNG tuple literals/transport and semantic obligation order; separate semantic grant/obligation/request IDs from physical lineage suffix IDs/references. No future parent choices/outcomes/people leakage.

**Human-approved policy** (Engram7019, `child_override_preserve_history`): nearest-child replacement with ordered history, identical target/actors/year, no earlier-prefix replacement and one effective application. Unreachable inherited targets are explicitly inactive, never forced. Parent choices after the branch point are not inherited. Declaration time is separate from execution year: earlier-declared future commands may be inherited. D2a has no declaration chronology, so ambiguous D2a histories fail closed rather than inventing provenance. D2b captures ordered declarations from inception. Fresh map `murneih9-11-1imi` estimates 1,200–1,900 authored lines including tests/docs; advisory only. Stage shared physics, then coherent fork/scheduler/history and canonical cold persistence; derive narrow surfaces per unit. Existing C2 scheduler/capsule remain unchanged; `FavorRecords` opaque port needs no change.

## Pending work

### D3 — Real SQLite records
- [ ] Durable adapter and restart proof using temporary/disposable databases only.
Map: new `src/server/sqlite-favor-records.ts`/test, injected `DatabaseSync`, additive immutable records table over serialized-string repository port. Existing db/life-store need not change for standalone storage. Atomic immutable insert must enforce races independently of repository pre-read. Test exact bytes/capsule across close/reopen, conflicts, rollback and corruption. Never open production DATA_DIR/lifelines.db or run live migrations.

Life/branch association and deletion/retention are product decisions before affected code, not silently chosen here. Canonical capsules bypass legacy class remapping. New legacy rewrite branches remain canonical-absent unless explicitly captured; do not fabricate old provenance.

### E1 — Production capture and deterministic policy
- [ ] Capture true initial inputs and remove LLM authority, including initialization.
Map: worldgen/simulate/decisions/decision-engine/abuse-guard and versioned canonical capture. Resolve/capture random sex deterministically before world mutation. Preserve A/legacy behavior; explicit E policy shared by batched/nonbatched/daily paths, not callback-shape/budget-dependent occurrence.

### E2 — Annual causal integration
- [ ] Integrate one evolving Person registry with real favor/resource ledgers.
Map: simulate/types/shared D physics and canonical journal. Record actor introductions and resource/state transitions; static C2 admission cannot certify annual Person evolution. Remove E's forced annual display-vignette guarantee from physics, not frozen legacy/A.

**Product decisions before affected code:** grant opportunity origin/participants/surplus/need/frequency; units/bounds/initial and newcomer allocations/regeneration; supplemental ties versus existing Mind relationships; annual phase/newcomer eligibility. Recommend explicit versioned/journaled abstract policy, not wealth-preference/class/final-mind inference. No defaults silently approved.

### E3 — Production forks and persistence
- [ ] Atomically bind completed branches to capsules and restore full inherited canon.
Map: fork/life-store/rewrite SSE, D repository/SQLite adapter. Preserve prefix decisions/snapshots/ledgers/history, cold nested equality and immutable branch→digest bindings; do not reuse old single-override/empty-decisions behavior. Canonical-absent legacy remains viewable; canonical rewrite fails closed. Binding lifecycle policy needs approval before implementation.

### E4 — Read-only selection, rendering and SSE
- [ ] Render selected as-of material without changing canon or requiring a provider.
Map: narrate/life-chronicle/chronicle-data/life-scene/contracts/lives create/rewrite streams. Deterministic EN/ES favor templates, cause/actor links, contextual historical minds rather than final people. Quiet progress/cancellation/completed-only persistence; hidden causal activity remains journaled, not display quotas. Read installed Next guides before Next mutations.

### F — Director and calibration
- [ ] Fix reproducible corpus/budgets, then calibrate bounded opportunity weights.
Clamp/cooldown/no-op and unchanged eligibility/outcomes. Measure runtime distribution, memory, journal/snapshot/storage bytes, cold fork equality and consequence/density measures before tuning. No unsupported global performance claims.

## Checks and continuity

Host Node26.8.1/V8 14.6.202.34-node.28; cached offline Node24.21.0/V8 13.6.233.17-node.53. Existing Vite warning persists. Writer RED is observed writer evidence, not independently rerun RED. Full suite/build/browser/corpus/real SQLite excluded from standalone units; applicable production checks remain required at E/F closure with mocked providers/blocked network and disposable databases. Avoid remote determinism and storage-writing richness/mortality scripts.

Preserve existing review authorities: obsolete `review-312a51d4f1149abd` e52 TDD snapshot remains correction-required, never reset/abandoned/reused; later exact-target reviews do not erase it. Intermediate079 approval did not close preparation. The complete14da approval and verified a414349 commit close preparation only. No native review substitutes functional checks or authorizes publication.

Sixteen units: eight closed, D2b-prep in progress, seven pending. Source task metadata updates are folded into the next coherent unit; don't review moving/unfinished writer bytes as a completed implementation. Parent owns tracker/mirror/UI and commits. Continue D2b under the selected child-override policy, then resolve actual product decisions when needed.

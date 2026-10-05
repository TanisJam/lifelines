# Narrative release execution — ODD tasks

**ACTIVE — resumed by the current human request, “continua iterando hasta el relase”, superseding pause7514. RC1 remains DONE for its observed domain unit only.** Continue toward the full release without a further pause constraint; no new product choices are introduced. The parent owns all launches: RB1 and the bounded RG1 guard unit are native-approved and integrated; the full RG1 gate still depends on RL1 genuine continuation. RL1a remains IN PROGRESS: RL1a1 and RL1a2 are closed and integrated; RL1a3 social-batch preparation/resolution is IN PROGRESS as plan ONLY, with no unit-3 source writes yet. Main source is frozen at `7ff46c88f0e76f49c00558911ca90b14653ba1e5`; post-integration verification is complete and no CPU tests or source writers are active. Legacy-phase extraction remains a prerequisite before new-version lifecycle work. This tracker-only worker launches no tasks. AP1 is closed at `507f9b9eee15eee7b3055a093c61fedd57616cd0`; it is an inactive planner, not a full product release. The parent owns the shared contract, visible status projection, integration commits and reviews. This full tracker is mirrored in project `lifelines`, topic `odd/narrative-release-execution/tasks`, locator `odd/tasks/narrative-release-execution.md`.

## Accepted release boundary

- Engram7496 approves parallel isolated work. After the parent passively commits and reads back this documentation base, all future source writes use isolated same-clone worktrees and scoped branches. The parent alone coordinates shared contracts and integration; parallel front notes may record running work later without marking gates DONE.
- Engram7500 requires a genuine seeded full run until recorded protagonist death. Continue mortality beyond the prior horizon; never force death. Cancellation, horizon/budget exhaustion and bounded incomplete runs are not completion and must not publish a completed branch.
- Adopt two HELP request opportunities per creditor per executed year, seeded activation 25%, for eligible earlier-year debt. Revalidate against current world; preserve physical → resources → grants → earlier-debt requests/responses order and keep the evolving registry separate from frozen C2 certification.
- Canonical bindings/history block explicit life deletion. No automatic garbage collection. Publication must be atomic and branch→digest bindings durable and immutable, with complete inherited prefix/history restoration.
- Preserve old immutable runtime-version replay unless a new version is explicitly introduced. RC1 uses existing physical vocabulary only; full physical migration is not complete and no large physical executor migration starts until RC1 is ready.
- Engram7008 remains resolved: `delivery_strategy=ask-on-risk`, `chain_strategy=feature-branch-chain`. Local reviewable slices only; no push, PR, child remote refs, deployment, destructive Git/data actions, installers, network providers or live database work.

## Stable execution map

| Task | Status | Deliverable and gate | Advisory authored forecast |
|---|---|---|---|
| RC1 | DONE (unit only) | First domain unit: atomic post-physical annual-policy composition and two HELP opportunities; existing physical vocabulary only. | 500–900 |
| RB1 | DONE (standalone binding unit only) | Implemented, native-approved and integrated durable bindings, atomic publication, cold nested restoration and deletion blocking; no RI1 active-caller/auth or human-history claim. | 500–900 |
| RG1 | IN PROGRESS — guard unit approved/integrated; genuine continuation pending RL1 | Death-completed publication guard; full gate also requires genuine seeded continuation beyond prior horizon (RL1 pending), never forced death. | 300–600 |
| RL1 | IN PROGRESS — umbrella, not closed | New-version factual E private lifecycle journal, unchanged old capsules, one owned registry and canonical full-run DTO; depends on RL1a. Physical migration is not done. | Reforecast after RL1a integration |
| RL1a | IN PROGRESS — a1/a2 DONE standalone and integrated; a3 plan ONLY | Extract actively-used legacy annual phases unchanged, with observed pre-extraction whole-year parity baseline. | 600–2,000; coupling may increase this |
| RL1b | PENDING — depends on RL1a | Implement new-version factual E private lifecycle journal while preserving old capsules and one owned registry. | Bound after first-unit integration |
| RI1 | PENDING | Integrate creation/rewrite/view UI, SSE persistence and versioned contracts. | 600–1,000 |
| RA1 | PENDING | Full applicable tests, types/lint/build, offline browser and disposable-file restart creation/rewrite end-to-end evidence; release readiness. | 300–600 test harness |

Forecasts are advisory, not caps. Keep behavior, tests and relevant documentation together; split reviewable work units without compressing coverage. Only the parent projects task progression; parallel activity does not imply gate completion.

## Prospective isolated edit surfaces

These are documented future scopes, not permission for this tracker-only transaction to edit source.

### RC1 — domain contract

- `src/domain/e-runtime.ts`
- `src/domain/e-runtime.test.ts`
- `src/domain/e-annual-policy.ts`
- `src/domain/e-annual-policy.test.ts`
- `src/domain/e-annual-composition.ts`
- `src/domain/e-annual-composition.test.ts`

### RB1 — durable storage

- `src/server/e-branch-repository.ts`
- `src/server/e-branch-repository.test.ts`
- `src/server/life-store.ts`
- `src/server/life-store.test.ts`
- `src/server/db.ts`

No annual-execution, routes or domain changes in RB1.

### RG1 — completion and route publication

- `src/server/completed-life.ts`
- `src/server/completed-life.test.ts`
- `src/server/life-chronicle.ts`
- `src/server/life-chronicle.test.ts`
- `src/app/api/lives/stream/route.ts`
- `src/app/api/lives/stream/route.test.ts`
- `src/app/api/lives/[lifeId]/rewrite/stream/route.ts`
- `src/app/api/lives/[lifeId]/rewrite/stream/route.test.ts`

The two life-chronicle technical paths were parent-approved; RG1 now has eight prospective paths. No domain/store-contract changes in RG1. Preserve legacy physics while fixing the publication constraint authorized by Engram7500. RI1/RA1 and later RL1 scopes require parent mapping before writes; these task rows do not authorize unspecified paths.

### RL1a — bounded first-writer prospective extraction

- `src/domain/simulate.ts`
- `src/domain/legacy-year.ts` (new)
- `src/domain/legacy-year.test.ts` (new)
- `src/domain/legacy-year-mechanics.ts` (optional new helper)

These four paths are prospective, not authority for this tracker-only worker. Extract a SMALL first phased kernel preserving order only if needed ports fit; otherwise return a derived bounded broader surface to the parent before further writes. No E capsule, UI, server or world-generation contract changes yet. Public old simulation must actually delegate to the kernel: no simulate-legacy-then-retrofit favors and no circular kernel import of `simulate`.

## Verification and release gates

- [x] RC1 (observed unit only): atomic post-physical eligibility/resources/grants and approved request composition, including negative cases and unchanged runtime-version replay. Existing physical vocabulary only; not full physical migration or full-life release.
- [x] RB1 (standalone binding unit only): immutable binding, atomic visibility, cold nested restoration, delete block and no GC; implemented, approved and integrated. RI1 active-caller/auth and human-history activation remain outside this closure.
- [ ] RG1: creation/rewrite publishes only real death-completed branches; seeded continuation, cancellation and bounded-incomplete failures covered.
- [ ] RL1: unchanged seeded life course and physical migration, factual historical metadata and canonical full-run DTO verified.
- [ ] RL1a: actively-used legacy annual phases extracted unchanged after observed pre-extraction canonical whole-year baseline.
- [ ] RL1b: new-version factual E private lifecycle journal with unchanged old capsules and one owned registry verified.
- [ ] RI1: UI/SSE creation, rewrite, persistence and versioned contract integration verified.
- [ ] RA1: applicable suite, types, scoped lint, build, offline browser, disposable-file restart and creation/rewrite end-to-end gates pass; parent confirms release readiness.

Delegated multiple-file source/tests work requires observed **RED → GREEN** with exact commands and results, followed by relevant alternate/negative cases. Never claim tests before execution. Use Node26 with `node_modules/vitest/vitest.mjs run` and exact allowed unit paths, plus Node24 compatibility; `tsc --noEmit --incremental false`, scoped ESLint and diff checks. The parent must record executable invocations/paths per work unit. No source tests ran in this documentation transaction.

Resumed sequence: RB1, the RG1 guard unit and RL1a1/a2 are approved/integrated. NEXT: bounded RL1a3 social-batch preparation/resolution planning, then parent-owned scoped implementation, independent verification, unit commit/native closure and integration. Continue remaining legacy phases, then RL1b new E journal/version and genuine unforced death continuation, RI1 activation and RA1 release evidence. RL1 and RL1a umbrellas remain IN PROGRESS, not closed; RI1/RA1 remain pending. Full release is NOT ready: no build, full-suite, browser, provider or live-database completion is claimed. Continue iterating under current authorization; no wait-for-resume constraint.

## Observed RC1 closure and resumed fronts

The following implementation evidence is supplied by the parent; no source tests or native operations are rerun in this bookkeeping turn.

### RC1 — integrated domain unit

- Source/integrated HEAD: `263de19cca9a85a8f519ad9ff244a3faf4ac4978`; four paths, 365 additions / 9 deletions = 374 authored lines. Parent fast-forwarded `feat/narrative-engine`; actual tree equals the reviewed candidate and all four source hashes matched exactly.
- Native COMMITTED: `a33282b` → `263de19`; review `review-20415916ecd6927b` approved, ACK BURNED. Target `1ecff74ec4d85fac1583314561fa40a1979c71f7af5f226debe397b9998f09b9`; consumed `4339533daa90a18c20202f1f0744ee74985cc619bc76c9572a94e1ad5fc42d6d`.
- Immutable candidate `14586a043e2d7db45179559d250d258dc0c2de7e`; root `/home/tanisjam/Projects/Personal/lifelines-worktrees/release-composition`. This is a recorded candidate, never a current-status source.
- `runtime.advanceWithAnnualPolicy({year, physical})` atomically composes private physical execution/resources/grants/HELP: two 25% creditor opportunities for earlier debts, revalidation, unchanged version. Existing physical vocabulary only.
- Writer RED: missing module → 11 GREEN → 15 final focused tests; Node26 473 tests / 8 files plus types/lint PASS. Independent Node24 473 tests plus types/lint PASS; Node26 spot 15 and adversarial review PASS. No outstanding failures; non-failing Vite warning remains.

### RB1 — native-approved and integrated standalone binding unit

- `feat/release-binding`, `/home/tanisjam/Projects/Personal/lifelines-worktrees/release-binding`; isolated candidate `86a58f5f8fc507abcc08da7c733e8884ee1a2392`, base `a33282b`. Four paths, 711 additions / 3 deletions = 714 authored lines. Parent cherry-picked `86a58f5`; historical integration checkpoint is `48bc59fbf6566f2682a62cc4428f277746645e06`. All four source hashes match the isolated native candidate.
- Native COMMITTED: `a332` → `86a58f5`; review `review-f5f6c1efaece720a` APPROVED, ACK BURNED. Target `8b408ac90037c364d94a391682abf207605d837f365e62647552a8ff78958182`; consumed `3f4382d27ee0fe75c63237b02f0a4efda672711a2bca08e6a284267837e48d66`. Root `release-binding` is recorded receipt provenance, NEVER a native STATUS target after consumption.
- `publishCanonicalBranch` / `loadCanonicalBranch`: immutable bindings, atomic visibility, cold three-level nested on-disk restoration, no GC, deletion blocking. Empty legacy decisions/snapshots are required; do not invent projections. Human-history support remains rules-only/unsupported. Closure covers the standalone implemented/integrated binding unit, not RI1 active callers, auth or human-history activation.
- Writer Node26 167 tests / 5 test files; independent Node24 167 and Node26 spot 40, types/lint PASS previously observed.
- Native informational nonblocking `R3-config-order` WARNING at `life-store.ts:437`: approval stands, no correction reoffer. Track config ordering as a separate follow-up, not a reopened RB1 gate.
- Parent combined main Node26.8.1: 348 tests / 9 files in 15.99s; types, lint and whitespace PASS. HEAD/status and nine source hashes stayed stable after integration; all four binding-source hashes remained unchanged. Independent cold on-disk check passed. This is a dormant production unit only; these are parent-observed results, not rerun here.

### RG1 — approved/integrated publication-guard unit, full gate incomplete

- `feat/release-completion`, `/home/tanisjam/Projects/Personal/lifelines-worktrees/release-completion`; isolated guard checkpoint `c042539e098e65fd175c02e2e9239b616d6f9c64`, base `a33282b`, integrated at `240b624`. Eight paths, 547 additions / 78 deletions = 625 authored lines.
- Publication guard only: completed-life requires consistent death plus executed frontier. `buildCandidateLifeChronicle` assembles an unpublished authoritative candidate, preserving the existing persisted reader; both routes publish only after construction and abort check. No open-life completed branch.
- Writer RED: 14 failures / 32 passes plus missing helper → 66 GREEN → 76 final tests / 5 files; types/lint PASS. Independent Node24.20: 76 tests / 5 files in 10.65s, types/lint/whitespace PASS; Node26 spot: 43 tests / 3 files in 943ms. All eight source hashes stayed stable.
- Earlier source-only snapshot identity robustness and mocked-route/multihop coverage gaps were not demonstrated production blockers. Native COMMITTED `a332` → `c042539`, review `review-37ae141ee46557e8` APPROVED, ACK BURNED; NEVER a native STATUS target. Guard unit integrated at `240b624`; parent combined 413 tests / 13 files PASS. Informational nonblocking `R3-worldgen-mock` at `creationroute.test.ts:12` remains a follow-up, not a reopened unit. Genuine beyond-former-horizon continuation still depends on RL1; full RG1 is NOT DONE.

All three linked worktrees were reported clean. Existing dependency `node_modules` symlinks were reused, not installed. Unrelated parent `.claude/` remains preserved. Historical isolated WIP was not integration evidence; subsequent RB1/RG1 integrations are separately recorded above. No agents are writing now; preserve the existing unrelated performance worktree.

### Resume episode — current human authorization

Pause7514 is retained as history, not an active constraint. The current human request resumes full-release iteration under existing parallel isolation7496 and human policy7500. Historical resume check: main `9503b3e` tracked-clean with only unrelated untracked `.claude/`; RB1 root `release-binding` at `86a58f5` clean; RG1 root `release-completion` at `c042539` clean. Historical main was `4df561aa5d2b515a0d6d864fc2000f1570db269a`; `release-lifecycle` was born from that base (original native base `a332`). Historical unit-1 main was `835f30f19002239dbcf3f6af20de1855341f05ac`. Current main is `7ff46c88f0e76f49c00558911ca90b14653ba1e5`, with only the two existing task documents modified and unrelated untracked `.claude/`. RB1 source integration remains `48bc59fbf6566f2682a62cc4428f277746645e06`, RG1 guard integration `240b624`, RC1 integration `263de19cca9a85a8f519ad9ff244a3faf4ac4978`, and RL1a1 integration `835f30f`. RB1 is closed within standalone scope, not production-active; full RG1 and RL1a remain incomplete. All closed receipts remain authoritative and NEVER native STATUS targets; the four registered release roots and existing unrelated performance worktree remain preserved. Existing ignored `.claude/` content remains out of scope.

### RL1 mapping — prerequisite, not completed physical migration

Verified legacy annual order is not one upfront pass: decay and candidates are captured before biology; biology then filtering then forced/social outcomes, with births and maternal deaths interleaved. Preserve old functions, seed tuples, IDs/counter, factory order, own `undefined` properties and `-0` quirks.

Before moving code, observe a canonical whole-year parity baseline, including hashes, own `undefined`, `-0` and forced branches, using a deterministic CLI script without providers. Require public legacy simulation to call the extracted kernel. First-writer runner: Node26 and Node24 `node_modules/vitest/vitest.mjs run` over the four existing simulate/replay suites plus new `legacy-year` tests, 600s timeout, then types/lint/whitespace; the parent must supply exact four suite paths and invocations before launch.

RL1a forecast is 600–2,000 authored lines depending on coupling; moved lines count twice and may make it larger. This is advisory: protect readability, never minify to fit. Bound critical new-version scope after actual first-unit integration.

Later RL1b extends illness/recovery, parents, marriage, destinations, death and survivor consequences through explicit closed replay types. Keep chunks bounded/cancellable; `dead`, `incomplete` and `aborted` are distinct, and completion requires authentic death, not a cap or forced death. Configuration origin bounds remain separate from executed frontier. No physical migration or mortality continuation is claimed complete.

### RL1a1 — closed live vital-kernel unit

- Four allowed kernel paths, checkpoint `93b56e3`, integrated `835f30f`; 720 authored lines. Public legacy simulation delegates to the live vital kernel; RL1a umbrella remains IN PROGRESS, not full physical migration.
- Eight parity pins: BASELINE 9 → missing-module RED → GREEN 10 → final 12. Writer Node26 300 tests / 5 files plus types/lint PASS; independent Node24.20 same 300 plus Node26 spot 12 PASS.
- Native review `review-310f49c76adf7814` APPROVED, ACK BURNED. Target `b872a2bfb542112deba47b49154181b810049b0e074960fccc1b1bf1c1964487`; consumed `70c1c2f685b4fc56b1ff535cf837d97e3867033d01c160a705e2aefdfa8213c9`. Receipt provenance only, NEVER STATUS.

### Combined main verification — historical unit-1 and current unit-2 evidence, no source repair

- Parent first Node26 run: 711/713 over 18 files; two 5,000ms timeouts at simulate:218 and chronicle:260 during writer CPU load. CPU contention is plausible, NOT proven.
- Exact two files serial: 99 PASS in 152.07s. Exact 18 files serial: 713/713 PASS in 211.09s, plus types/lint PASS. No timeout override or source fix. Five hashes before/after stable, including prior tracker `03f3a9b58a3b064bfe79de4954c514a9fd5b5cddc897ed88fabdd2798cd5b95f`.
- Those results are historical unit-1 main evidence at `835f30f`, not the current integration count. Current post-RL1a2 main at `7ff46c88f0e76f49c00558911ca90b14653ba1e5`: exact 18 files serial, 722/722 PASS in 215.39s, types/lint PASS and six hashes stable. The arithmetic draft of 724 was corrected to the confirmed 722. No timeout override or source fix; earlier timeout/CPU observations are retained without asserting a proven cause.
- Current main source is frozen; no active CPU tests or writers. These are supplied parent observations, not validations executed by this documentation worker.

### RL1a2 — DONE standalone source unit, native-approved and integrated

- `feat/release-lifecycle`, root `release-lifecycle`, base `93b56e3`, actual source checkpoint `5819af7` → main `7ff46c88f0e76f49c00558911ca90b14653ba1e5`. Same four kernel paths, 696 additions / 424 deletions = 1,120 SOURCE-authored lines; plus 140 passive task-document lines = 1,260 native all-path authored lines across five paths. Keep source and passive documentation counts distinct without underclaiming review work.
- Native review `review-ad443813b17a2860` APPROVED, ACK BURNED. Target `5c47f091fe1cc1921475aef74ffa070ce20efcf61c824f69be7ea3d4047b7669`; consumed `bb1e6bf48ea6c22e9a3eda948296e0964f1a54871ddc067afe1ccd863f3f7c21`. Derived ASSESS is closed, `consumed=true`; receipt provenance only, NEVER native STATUS.
- Extracts actual shock and biology (all seven comparator vital cases), school and ley write, plus shared factory helpers including still-active A2/Y3, using the same people/shocks and preserving actual biology source order. Original eight pins and invalid-smith case remain untouched. No social birth, maternal-death, vignette or snapshot migration; no new E version or continuation completion. This is NOT full kernel or release closure.
- BASELINE 12 → RED 2 missing-API failures / 10 PASS → GREEN 12 → final 21. Writer Node26 309 tests / 5 files in 151.65s; independent Node24 309 in 159.91s; Node26 spot 21 in 17.56s. Types/lint PASS and all source hashes stable; intermediate import/fixture failures were fixed.
- Existing `/home/tanisjam/.nvm/versions/node/v24.20.0/bin/node` v24.20.0 was found, not installed. Earlier writer searched only system/Homebrew and falsely reported unavailable; subsequent compatibility verification above passed.
- Main lifecycle book `odd/tasks/narrative-lifecycle-kernel.md` was parent-copied byte-exact from the child: full 176 lines / 15,648 bytes, SHA-256 `b26008ef135b7bd249fa3f0a074707bfb62222652d1e78547fd17b6e91f59f0a`; full mirror7536 verified. Child documentation-only checkpoint `0a010442b2edf29c0be397c4af7fa5f8a7985c65` follows source `5819af7`. Parent owns commits; this transaction edits neither child/book nor mirror7536.

### RL1a3 — social-batch preparation/resolution IN PROGRESS, plan ONLY

- No unit-3 source writes yet; prospective scope remains the four domain paths above. Next bounded extraction is live social-preparation bodies at `simulate.ts:2170–2330`, preserving year/question timing, one people registry, logs/counters, background/forced fallback, asynchronous decider and D1 prefetch. Ordered social resolution at `2342–3045` and D1 snapshot belong to later units, not this first preparation slice.
- Parent-supplied read-only challenge7546: `PersonRecord` with one actual same `Mind` is structurally feasible. E1 closes the newcomer schema with no legacy fields; three operations need a NEW tuple plus a closed, ordered full-state/Mind/identity/effects/decisions-authority journal. An event log alone is NOT complete proof.
- Social execution is NOT Mind-free physics: birth reads current parent Mind, death interleaves survivor memories, and NPC no-op paths still write Mind. `simulateYears` clones rather than providing the shared seam; preserve these distinctions before defining the new executor.
- E1 human-history replay remains rules-only/rejected, wire unchanged; no implicit migration or historical Mind backfill. Unforced mortality and minimal economy are settled constraints, not new product questions. RL1 remains an IN PROGRESS umbrella; full RG1 genuine continuation, RI1 and RA1 remain pending.

## Continuity and tracker-only evidence

AP1 closure: [annual policy tracker](narrative-annual-policy.md), full mirror Engram7492. Parent observed source/tests 496 + tracker 111 + main 2 = 609 authored lines; cumulative 14,467 → 15,076. Preserve closed dedicated trackers as authority.

Main mirror Engram6902 remains capacity-pending and unchanged: prior exact replacement exceeded maximum observation length. Do not edit, retry, summarize or truncate it; dedicated full mirrors prevail until parent follow-up.

Historical count before the pause-document delta: 15,076 + passive documentation at `a33282b` (126) = 15,202; + RC1 (374) = 15,576. Historical resumed count was 15,622 + RB1 (714) = 16,336. Prior integrated SOURCE-authored count: 15,622 + integrated RB1 (714) + RG1 (625) + RL1a1 (720) = 17,681. Current integrated SOURCE-authored count: 17,681 + RL1a2 (1,120) = 18,801. Unit-2 passive task documentation (140) and later bookkeeping-commit lines are separate; its native all-path review volume is 1,260, not 1,120. This bookkeeping delta is separate and not yet counted.

This transaction changes only `odd/tasks/narrative-release-execution.md` and its full Engram7504 mirror (same locator/topic). AP1/Engram7492, main/Engram6902 and delivery/Engram7008 remain unchanged. Documentation-only prose has no meaningful pre-implementation behavior RED; this is an applicability exception, not an activation-toggle claim. Required passive checks: full-file/FULL7504 mirror readback including locator/project/topic, `git diff --check`, `git rev-parse HEAD` and `git status --short`. HEAD/source bytes and unrelated untracked `.claude/` must remain unchanged. No source implementation, tests, native operations, new task file, network/provider/live database work, child or background launches occur in this worker. Parent-owned launches described above remain authorized.

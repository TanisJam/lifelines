# Narrative release execution — ODD tasks

**ACTIVE — resumed by the current human request, “continua iterando hasta el relase”, superseding pause7514. RC1 remains DONE for its observed domain unit only.** Continue toward the full release without a further pause constraint; no new product choices are introduced. The parent owns all launches: RB1 native closure and integration are observed; RG1 independent verification is observed, with native review currently in progress and integration pending. RL1 mapping establishes a legacy-phase extraction prerequisite before new-version lifecycle work. This tracker-only worker launches no tasks. AP1 is closed at `507f9b9eee15eee7b3055a093c61fedd57616cd0`; it is an inactive planner, not a full product release. The parent owns the shared contract, visible status projection, integration commits and reviews. This full tracker is mirrored in project `lifelines`, topic `odd/narrative-release-execution/tasks`, locator `odd/tasks/narrative-release-execution.md`.

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
| RG1 | IN PROGRESS — independently verified; native review/integration pending | Death-completed publication guard; full gate also requires genuine seeded continuation beyond prior horizon (RL1 pending), never forced death. | 300–600 |
| RL1 | PENDING | New-version factual E private lifecycle journal, unchanged old capsules, one owned registry and canonical full-run DTO; depends on RL1a. Physical migration is not done. | Reforecast after RL1a integration |
| RL1a | PENDING — prerequisite | Extract actively-used legacy annual phases unchanged, with observed pre-extraction whole-year parity baseline. | 600–2,000; coupling may increase this |
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

Resumed sequence: RB1 closure/integration and combined main checks are observed. RG1 independent verification passed; parent native review is in progress, with no authority created yet and source unchanged. RG1 integration remains pending. RL1a extraction precedes RL1b new-version mortality continuation, followed by RI1 full UI activation and RA1 full tests/build/browser/cold-restart evidence. Each unit closes with parent-owned integration commit and review evidence. RL1/RI1/RA1 remain pending; no full-product completion claim is made here.

## Observed RC1 closure and resumed fronts

The following implementation evidence is supplied by the parent; no source tests or native operations are rerun in this bookkeeping turn.

### RC1 — integrated domain unit

- Source/integrated HEAD: `263de19cca9a85a8f519ad9ff244a3faf4ac4978`; four paths, 365 additions / 9 deletions = 374 authored lines. Parent fast-forwarded `feat/narrative-engine`; actual tree equals the reviewed candidate and all four source hashes matched exactly.
- Native COMMITTED: `a33282b` → `263de19`; review `review-20415916ecd6927b` approved, ACK BURNED. Target `1ecff74ec4d85fac1583314561fa40a1979c71f7af5f226debe397b9998f09b9`; consumed `4339533daa90a18c20202f1f0744ee74985cc619bc76c9572a94e1ad5fc42d6d`.
- Immutable candidate `14586a043e2d7db45179559d250d258dc0c2de7e`; root `/home/tanisjam/Projects/Personal/lifelines-worktrees/release-composition`. This is a recorded candidate, never a current-status source.
- `runtime.advanceWithAnnualPolicy({year, physical})` atomically composes private physical execution/resources/grants/HELP: two 25% creditor opportunities for earlier debts, revalidation, unchanged version. Existing physical vocabulary only.
- Writer RED: missing module → 11 GREEN → 15 final focused tests; Node26 473 tests / 8 files plus types/lint PASS. Independent Node24 473 tests plus types/lint PASS; Node26 spot 15 and adversarial review PASS. No outstanding failures; non-failing Vite warning remains.

### RB1 — native-approved and integrated standalone binding unit

- `feat/release-binding`, `/home/tanisjam/Projects/Personal/lifelines-worktrees/release-binding`; isolated candidate `86a58f5f8fc507abcc08da7c733e8884ee1a2392`, base `a33282b`. Four paths, 711 additions / 3 deletions = 714 authored lines. Parent cherry-picked `86a58f5`; actual main HEAD is `48bc59fbf6566f2682a62cc4428f277746645e06`. All four source hashes match the isolated native candidate.
- Native COMMITTED: `a332` → `86a58f5`; review `review-f5f6c1efaece720a` APPROVED, ACK BURNED. Target `8b408ac90037c364d94a391682abf207605d837f365e62647552a8ff78958182`; consumed `3f4382d27ee0fe75c63237b02f0a4efda672711a2bca08e6a284267837e48d66`. Root `release-binding` is recorded receipt provenance, NEVER a native STATUS target after consumption.
- `publishCanonicalBranch` / `loadCanonicalBranch`: immutable bindings, atomic visibility, cold three-level nested on-disk restoration, no GC, deletion blocking. Empty legacy decisions/snapshots are required; do not invent projections. Human-history support remains rules-only/unsupported. Closure covers the standalone implemented/integrated binding unit, not RI1 active callers, auth or human-history activation.
- Writer Node26 167 tests / 5 test files; independent Node24 167 and Node26 spot 40, types/lint PASS previously observed.
- Native informational nonblocking `R3-config-order` WARNING at `life-store.ts:437`: approval stands, no correction reoffer. Track config ordering as a separate follow-up, not a reopened RB1 gate.
- Parent combined main Node26.8.1: 348 tests / 9 files in 15.99s; types, lint and whitespace PASS. HEAD/status and nine source hashes stayed stable after integration. These are parent-observed results, not rerun here.

### RG1 — separate publication-guard WIP, full gate incomplete

- `feat/release-completion`, `/home/tanisjam/Projects/Personal/lifelines-worktrees/release-completion`; local WIP `c042539e098e65fd175c02e2e9239b616d6f9c64`, base `a33282b`. Eight paths, 547 additions / 78 deletions = 625 authored lines.
- Publication guard only: completed-life requires consistent death plus executed frontier. `buildCandidateLifeChronicle` assembles an unpublished authoritative candidate, preserving the existing persisted reader; both routes publish only after construction and abort check. No open-life completed branch.
- Writer RED: 14 failures / 32 passes plus missing helper → 66 GREEN → 76 final tests / 5 files; types/lint PASS. Independent Node24.20: 76 tests / 5 files in 10.65s, types/lint/whitespace PASS; Node26 spot: 43 tests / 3 files in 943ms. All eight source hashes stayed stable.
- Earlier source-only snapshot identity robustness and mocked-route/multihop coverage gaps were not demonstrated production blockers. Native review is currently in progress; authority has not been created yet, source unchanged, and parent integration remains pending. Genuine beyond-former-horizon continuation is still pending RL1; neither RG1 nor the entire RG gate is DONE.

All three linked worktrees were reported clean. Existing dependency `node_modules` symlinks were reused, not installed. Unrelated parent `.claude/` remains preserved. RG1 isolated WIP is not parent integration evidence; RB1 integration is separately observed above.

### Resume episode — current human authorization

Pause7514 is retained as history, not an active constraint. The current human request resumes full-release iteration under existing parallel isolation7496 and human policy7500. Historical resume check: main `9503b3e` tracked-clean with only unrelated untracked `.claude/`; RB1 root `release-binding` at `86a58f5` clean; RG1 root `release-completion` at `c042539` clean. Current main is `48bc59fbf6566f2682a62cc4428f277746645e06`; RB1 is closed and integrated, RG1 independent verification is observed with native/integration pending. RC1/AP1/RB1 closed receipts remain authoritative; no native STATUS is run against a burned receipt.

### RL1 mapping — prerequisite, not completed physical migration

Verified legacy annual order is not one upfront pass: decay and candidates are captured before biology; biology then filtering then forced/social outcomes, with births and maternal deaths interleaved. Preserve old functions, seed tuples, IDs/counter, factory order, own `undefined` properties and `-0` quirks.

Before moving code, observe a canonical whole-year parity baseline, including hashes, own `undefined`, `-0` and forced branches, using a deterministic CLI script without providers. Require public legacy simulation to call the extracted kernel. First-writer runner: Node26 and Node24 `node_modules/vitest/vitest.mjs run` over the four existing simulate/replay suites plus new `legacy-year` tests, 600s timeout, then types/lint/whitespace; the parent must supply exact four suite paths and invocations before launch.

RL1a forecast is 600–2,000 authored lines depending on coupling; moved lines count twice and may make it larger. This is advisory: protect readability, never minify to fit. Bound critical new-version scope after actual first-unit integration.

Later RL1b extends illness/recovery, parents, marriage, destinations, death and survivor consequences through explicit closed replay types. Keep chunks bounded/cancellable; `dead`, `incomplete` and `aborted` are distinct, and completion requires authentic death, not a cap or forced death. Configuration origin bounds remain separate from executed frontier. No physical migration or mortality continuation is claimed complete.

## Continuity and tracker-only evidence

AP1 closure: [annual policy tracker](narrative-annual-policy.md), full mirror Engram7492. Parent observed source/tests 496 + tracker 111 + main 2 = 609 authored lines; cumulative 14,467 → 15,076. Preserve closed dedicated trackers as authority.

Main mirror Engram6902 remains capacity-pending and unchanged: prior exact replacement exceeded maximum observation length. Do not edit, retry, summarize or truncate it; dedicated full mirrors prevail until parent follow-up.

Historical count before the pause-document delta: 15,076 + passive documentation at `a33282b` (126) = 15,202; + RC1 (374) = 15,576. Current parent running count: 15,622 + integrated RB1 (714) = 16,336 before the uncommitted resumed-document delta. Isolated RG1 (625) remains excluded. This bookkeeping delta is separate and not yet counted.

This transaction changes only `odd/tasks/narrative-release-execution.md` and its full Engram7504 mirror (same locator/topic). AP1/Engram7492, main/Engram6902 and delivery/Engram7008 remain unchanged. Strict behavior TDD is not active for docs. Required passive checks: full-file/FULL7504 mirror readback including locator/project/topic, `git diff --check`, `git rev-parse HEAD` and `git status --short`. HEAD/source bytes and unrelated untracked `.claude/` must remain unchanged. No source implementation, tests, native operations, new task file, network/provider/live database work, child or background launches occur in this worker. Parent-owned launches described above remain authorized.

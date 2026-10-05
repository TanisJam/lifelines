# Narrative release execution — ODD tasks

**PAUSED by user7514; RC1 is DONE for its observed domain unit only.** No agent tasks are running or will be launched. Full-release authorization remains, but resumption requires a new request; stop after bookkeeping. AP1 is closed at `507f9b9eee15eee7b3055a093c61fedd57616cd0`; it is an inactive planner, not a full product release. The parent owns the shared contract, visible status projection, integration commits and reviews. This full tracker is mirrored in project `lifelines`, topic `odd/narrative-release-execution/tasks`, locator `odd/tasks/narrative-release-execution.md`.

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
| RB1 | PAUSED — local WIP | Durable canonical branch bindings, atomic visible publication, cold nested restoration and deletion blocking; not integrated or reviewed. | 500–900 |
| RG1 | PAUSED — incomplete local WIP | Death-completed publication guard; full gate also requires genuine seeded continuation beyond prior horizon (RL1 pending), never forced death. Not independently reviewed or integrated. | 300–600 |
| RL1 | PENDING | Complete unchanged seeded life-course E physical migration, historical metadata and canonical full-run DTO; wait for RC1 readiness. | 1,000–2,000 |
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

The two life-chronicle technical paths were parent-approved; RG1 now has eight prospective paths. No domain/store-contract changes in RG1. Preserve legacy physics while fixing the publication constraint authorized by Engram7500. RL1/RI1/RA1 source scopes require parent mapping before writes; these task rows do not authorize unspecified paths.

## Verification and release gates

- [x] RC1 (observed unit only): atomic post-physical eligibility/resources/grants and approved request composition, including negative cases and unchanged runtime-version replay. Existing physical vocabulary only; not full physical migration or full-life release.
- [ ] RB1: immutable binding, atomic visibility, cold nested restoration, delete block and no GC.
- [ ] RG1: creation/rewrite publishes only real death-completed branches; seeded continuation, cancellation and bounded-incomplete failures covered.
- [ ] RL1: unchanged seeded life course and physical migration, factual historical metadata and canonical full-run DTO verified.
- [ ] RI1: UI/SSE creation, rewrite, persistence and versioned contract integration verified.
- [ ] RA1: applicable suite, types, scoped lint, build, offline browser, disposable-file restart and creation/rewrite end-to-end gates pass; parent confirms release readiness.

Delegated multiple-file source/tests work requires observed **RED → GREEN** with exact commands and results, followed by relevant alternate/negative cases. Never claim tests before execution. Use Node26 with `node_modules/vitest/vitest.mjs run` and exact allowed unit paths, plus Node24 compatibility; `tsc --noEmit --incremental false`, scoped ESLint and diff checks. The parent must record executable invocations/paths per work unit. No source tests ran in this documentation transaction.

On a new resume request only: RB1 review/integration → RG1 independent/native review and integration → RL1 life-course migration → RI1 full UI activation → RA1 full tests/build/browser/cold-restart evidence. Each unit closes with parent-owned integration commit and review evidence. No full-product completion claim is made here.

## Observed RC1 closure and paused fronts

The following implementation evidence is supplied by the parent; no source tests or native operations are rerun in this bookkeeping turn.

### RC1 — integrated domain unit

- Source/integrated HEAD: `263de19cca9a85a8f519ad9ff244a3faf4ac4978`; four paths, 365 additions / 9 deletions = 374 authored lines. Parent fast-forwarded `feat/narrative-engine`; actual tree equals the reviewed candidate and all four source hashes matched exactly.
- Native COMMITTED: `a33282b` → `263de19`; review `review-20415916ecd6927b` approved, ACK BURNED. Target `1ecff74ec4d85fac1583314561fa40a1979c71f7af5f226debe397b9998f09b9`; consumed `4339533daa90a18c20202f1f0744ee74985cc619bc76c9572a94e1ad5fc42d6d`.
- Immutable candidate `14586a043e2d7db45179559d250d258dc0c2de7e`; root `/home/tanisjam/Projects/Personal/lifelines-worktrees/release-composition`. This is a recorded candidate, never a current-status source.
- `runtime.advanceWithAnnualPolicy({year, physical})` atomically composes private physical execution/resources/grants/HELP: two 25% creditor opportunities for earlier debts, revalidation, unchanged version. Existing physical vocabulary only.
- Writer RED: missing module → 11 GREEN → 15 final focused tests; Node26 473 tests / 8 files plus types/lint PASS. Independent Node24 473 tests plus types/lint PASS; Node26 spot 15 and adversarial review PASS. No outstanding failures; non-failing Vite warning remains.

### RB1 — separate paused local WIP, not integrated/reviewed

- `feat/release-binding`, `/home/tanisjam/Projects/Personal/lifelines-worktrees/release-binding`; local WIP `86a58f5f8fc507abcc08da7c733e8884ee1a2392`, base `a33282b`. Four paths, 711 additions / 3 deletions = 714 authored lines.
- `publishCanonicalBranch` / `loadCanonicalBranch`: immutable bindings, atomic visibility, cold three-level nested on-disk restoration, no GC, deletion blocking. Empty legacy decisions/snapshots are required; do not invent projections. Human-history support remains rules-only/unsupported.
- Writer Node26 167 tests / 5 test files; independent Node24 167 and Node26 spot 40, types/lint PASS. Native review, integration and combined full checks remain pending. Four source hashes are retained in the existing parent/subagent report, not re-created here.

### RG1 — separate paused local WIP, full gate incomplete

- `feat/release-completion`, `/home/tanisjam/Projects/Personal/lifelines-worktrees/release-completion`; local WIP `c042539e098e65fd175c02e2e9239b616d6f9c64`, base `a33282b`. Eight paths, 547 additions / 78 deletions = 625 authored lines.
- Publication guard only: completed-life requires consistent death plus executed frontier. `buildCandidateLifeChronicle` assembles an unpublished authoritative candidate, preserving the existing persisted reader; both routes publish only after construction and abort check. No open-life completed branch.
- Writer RED: 14 failures / 32 passes plus missing helper → 66 GREEN → 76 final tests / 5 files; types/lint PASS. Independent/native review and integration have not run. Genuine beyond-former-horizon continuation is still pending RL1; RG1 is not DONE.

All three linked worktrees were reported clean. Existing dependency `node_modules` symlinks were reused, not installed. Unrelated parent `.claude/` remains preserved. Paused WIP is not parent integration evidence.

## Continuity and tracker-only evidence

AP1 closure: [annual policy tracker](narrative-annual-policy.md), full mirror Engram7492. Parent observed source/tests 496 + tracker 111 + main 2 = 609 authored lines; cumulative 14,467 → 15,076. Preserve closed dedicated trackers as authority.

Main mirror Engram6902 remains capacity-pending and unchanged: prior exact replacement exceeded maximum observation length. Do not edit, retry, summarize or truncate it; dedicated full mirrors prevail until parent follow-up.

Parent running count before this pause-document delta: 15,076 + passive documentation at `a33282b` (126) = 15,202; + RC1 (374) = 15,576. Isolated RB1 (714) and RG1 (625) WIP are excluded. This bookkeeping delta is separate and not yet counted.

This transaction changes only `odd/tasks/narrative-release-execution.md` and its full Engram7504 mirror (same locator/topic). AP1/Engram7492, main/Engram6902 and delivery/Engram7008 remain unchanged. Strict behavior TDD is not active for docs. Required passive checks: full-file/FULL7504 mirror locator readback, `git diff --check`, `git rev-parse HEAD`, `git status --short`, and `sha256sum src/domain/e-runtime.ts src/domain/e-annual-policy.ts src/domain/e-annual-composition.ts src/domain/e-annual-composition.test.ts odd/tasks/narrative-release-execution.md`. HEAD/source bytes and unrelated untracked `.claude/` must remain unchanged. No new implementation, source tests, native operations, force/push/PR/deploy, live database, new writer or future launch occurs here.

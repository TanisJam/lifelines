# Narrative release execution — ODD tasks

**Continue until release; only RC1 is IN PROGRESS.** AP1 is closed at `507f9b9eee15eee7b3055a093c61fedd57616cd0`; it is an inactive planner, not a full product release. The parent owns the shared contract, visible status projection, integration commits and reviews. This full tracker is mirrored in project `lifelines`, topic `odd/narrative-release-execution/tasks`, locator `odd/tasks/narrative-release-execution.md`.

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
| RC1 | IN PROGRESS | First domain unit: atomic post-physical annual-policy composition and two HELP opportunities; existing physical vocabulary only. | 500–900 |
| RB1 | PENDING | Durable canonical branch bindings, atomic visible publication, cold nested restoration and deletion blocking; reuse old R1 scope. Launch in parallel after documentation base. | 500–900 |
| RG1 | PENDING | Death-completed creation/rewrite publication; genuine seeded mortality beyond prior horizon; cancellation/bounded-incomplete errors, never forced death. Parallel server/routes front. | 300–600 |
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
- `src/app/api/lives/stream/route.ts`
- `src/app/api/lives/stream/route.test.ts`
- `src/app/api/lives/[lifeId]/rewrite/stream/route.ts`
- `src/app/api/lives/[lifeId]/rewrite/stream/route.test.ts`

No domain/store-contract changes in RG1. Preserve legacy physics while fixing the publication constraint authorized by Engram7500. RL1/RI1/RA1 source scopes require parent mapping before writes; these task rows do not authorize unspecified paths.

## Verification and release gates

- [ ] RC1: atomic post-physical eligibility/resources/grants and approved request composition, including negative cases and old-version replay preservation.
- [ ] RB1: immutable binding, atomic visibility, cold nested restoration, delete block and no GC.
- [ ] RG1: creation/rewrite publishes only real death-completed branches; seeded continuation, cancellation and bounded-incomplete failures covered.
- [ ] RL1: unchanged seeded life course and physical migration, factual historical metadata and canonical full-run DTO verified.
- [ ] RI1: UI/SSE creation, rewrite, persistence and versioned contract integration verified.
- [ ] RA1: applicable suite, types, scoped lint, build, offline browser, disposable-file restart and creation/rewrite end-to-end gates pass; parent confirms release readiness.

Delegated multiple-file source/tests work requires observed **RED → GREEN** with exact commands and results, followed by relevant alternate/negative cases. Never claim tests before execution. Use Node26 with `node_modules/vitest/vitest.mjs run` and exact allowed unit paths, plus Node24 compatibility; `tsc --noEmit --incremental false`, scoped ESLint and diff checks. The parent must record executable invocations/paths per work unit. No source tests ran in this documentation transaction.

Parent next steps: passive documentation commit/readback; create/register isolated worktrees and node_modules links; disposable-only test setup; then launch bounded fronts. Each unit closes with parent-owned integration commit and review evidence. No full-product completion claim is made here.

## Continuity and tracker-only evidence

AP1 closure: [annual policy tracker](narrative-annual-policy.md), full mirror Engram7492. Parent observed source/tests 496 + tracker 111 + main 2 = 609 authored lines; cumulative 14,467 → 15,076. Preserve closed dedicated trackers as authority.

Main mirror Engram6902 remains capacity-pending and unchanged: prior exact replacement exceeded maximum observation length. Do not edit, retry, summarize or truncate it; dedicated full mirrors prevail until parent follow-up.

This transaction changes only the two dedicated tracker files and their full mirrors. Strict behavior TDD is not active for docs; future implementation RED/GREEN is mandatory above. Required passive checks: full-file/full-mirror locator readback, `git diff --check`, `git rev-parse HEAD`, `git status --short`, and `sha256sum src/domain/e-annual-policy.ts src/domain/e-annual-policy.test.ts`. HEAD/source bytes and unrelated untracked `.claude/` must remain unchanged. No source, Git-native review, tests, network/database/provider or child operations occur here.

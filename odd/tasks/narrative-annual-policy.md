# Annual favor policy — ODD tasks

**AP1: DONE — inactive planner verified, native review approved and parent-owned local work-unit commit completed.** Human approval Engram7490, option 3 **including the common base**, accepts the numeric annual allowance and offer policy below. It does not activate autonomous production. This tracker is fully mirrored in project `lifelines`, topic `odd/narrative-annual-policy/tasks`, with repository-relative locator `odd/tasks/narrative-annual-policy.md`.

## Approved annual policy

| Concern | Accepted rule |
|---|---|
| Budget eligibility | Living, home adults, age >=16 using actual actuarial age, not a display-age approximation. |
| Annual allowance | For each eligible actor in each executed year: seeded 50% grain 0 or 2; effort 1; need 1. |
| Reset | Replace eligible leftover budgets using explicit resource add/subtract changes; do not accumulate annual allowance. Leave ineligible actors untouched rather than inventing a reset. |
| Meaning | Grain is an abstract annual allowance, not a harvest. Need is assistance need, not hunger. |
| Debt | Existing debts remain; resetting budgets must not erase obligations. |
| Offers | At most one offer per person per year; seeded activation 25%; transfer exactly 1 grain. |
| Feasibility | Locally staged creditor balance >=2 grain and >=1 need; recipient 0 grain and >=1 effort. |
| Pair protection | No stacking onto an open HELP pair in either direction; at most one receipt per person per year. |

Budgets and offers are explicit, versioned policy decisions, not class/wealth/Mind inferences. No hidden activation, regeneration of past years, or unbounded annual plan generation is approved.

## Release contract — human approval Engram7500

Human selected two policy choices and rejected the open-life release premise. These approved requirements supersede stale E2b/E3/UI policy-pending wording in the main tracker; they are **not claims of implemented source behavior**.

- **Full-life release:** execute the full simulation until the protagonist's recorded death, as already intended by the product. A living budget cutoff is not completion and must not publish a full branch. Require verified physical termination; never invent a forced death or death date to satisfy a budget. No open-life UI release policy was approved.
- **Historical projection/UI:** partial, alive historical as-of projections remain valid evidence, not final product presentation. The previously proposed inactive as-of UI wrapper is neither an approved release front nor necessary for a full-death run. Future maps must reuse the existing full presentation with factual metadata only; do not misrepresent final Mind as historical evidence.
- **Requests:** adopt two HELP request opportunities per creditor per executed year, seeded activation 25%, for eligible earlier-year debt. Keep the evolving dynamic registry separate from the frozen fixed-registry C2 certificate; do not claim C2 certifies annual evolution. Preserve current-world revalidation and the physical → resources → grants → earlier-debt requests/responses phase order.
- **Retention:** block explicit life deletion while canonical bindings or history exist; no automatic garbage collection. E3 still requires atomic completed-branch publication, immutable branch→digest bindings and full inherited prefix/history restoration; this approval does not implement them.

## AP1 — Inactive deterministic versioned planner (DONE)

- [x] Implement `buildAnnualFavorPlan(input: unknown /* RuntimeOutput */, year: number): AnnualPlan` as one coherent source-and-tests unit.
- [x] Admit RuntimeOutput through `replayAnnualRuntime`, reusing the verified guard rather than creating weaker parallel admission.
- [x] Require a strictly future year relative to the admitted frontier; never generate allocations or offers for unexecuted intervening years.
- [x] Emit resources and grants only: no physical operations or requests. Stage new budget balances locally before evaluating grants; never mutate the admitted input.
- [x] Apply the approved eligibility, reset, feasibility, open-pair and per-person limits above with deterministic conflict resolution.
- [x] Version the policy and JSON RNG tuples explicitly: policy version, world seed, actor, year and purpose must all participate. Separate purposes must not alias draws.
- [x] Use stable UTF-8 ordering with a raw-string tie-breaker for arbitrary IDs, including UTF-8 encoding ties; no locale-dependent ordering or ID restrictions.
- [x] Return detached output with canonical positive zero in emitted numeric values; preserve legitimate internal RuntimeOutput values through existing admission.
- [x] Cover runtime execution/capsule replay compatibility without claiming that replay certifies annual-policy provenance.

### Execution boundary

AP1 is an explicit-policy-only API, not an active consumer and not a production default. It plans from the admitted current frontier; it makes **no same-year physical-validity claim**. Later physical operations can change eligibility or feasibility, and the runtime must continue revalidating grants at execution. Future post-physical composition and annual demography remain pending rather than being smuggled into this planner.

Explicit caller plans can bypass this policy; runtime/capsule replay verifies canonical runtime semantics, not that a plan was generated by AP1. No policy-provenance certificate, automatic invocation, historical regeneration or authentication claim is part of this unit.

### Implemented candidate surfaces and review budget

The writer produced two new files:

- `src/domain/e-annual-policy.ts`
- `src/domain/e-annual-policy.test.ts`

They are **not** edit surfaces for this document-only transaction. Preserve frozen legacy/A/B/C/D contracts and existing runtime, worldgen, capsules, server, storage and routes.

Actual parent-reported authored count: **496 lines** — source 93, tests 403 — within the **400–650** forecast. The approximately 400-line tracker threshold is advisory, not a cap. This is one inseparable source-and-tests policy unit; preserve readable formatting and behavior coverage rather than splitting or compressing it to fit the advisory threshold.

## Acceptance and verification plan

All AP1 acceptance checks are DONE on parent-observed closure evidence below. Independent verification, native review and the parent-owned local commit completed; this document-only transaction does not reproduce source tests or review.

| Coverage | Required evidence |
|---|---|
| Admission | Genuine initial and executed RuntimeOutput; invalid/tampered/human-authority input; descriptor-first guard reuse and zero executed accessor hooks. |
| Time | Strict future-year rejection for same/past years; gapped planning touches only the requested executed year, not intervening years. |
| Eligibility/reset | Age boundary using actuarial age; living/home versus dead/away/minor; eligible leftover subtraction/addition, missing allocation, and ineligible untouched balances. |
| Determinism | Repeat planning, seed/year/purpose separation, stable arbitrary-ID ordering and raw-string tie-breaks, reordered input records, detached output and canonical positive zero. |
| Offers | 25% activation and 50% allowance draws under explicit tuples; transfer 1; staged balances; creditor/recipient thresholds; max one offer and receipt per person/year; open HELP protection in both directions; unchanged debts. |
| Compatibility | Explicit runtime advance and capsule cold replay, quiet plans/gaps, unchanged input and frozen contracts; no policy-provenance or same-year physical-validity inference. |

Next sequence: **freeze and passively commit this documentation base under parent ownership → isolated parallel worktrees → parent integration/review gates**. Continue through [the release execution tracker](narrative-release-execution.md). Engram7496 approves parallel isolation; Engram7500 governs full-death release. These approvals do not waive gates. No source work, review, commit, worktree creation or release is performed by this tracker-only writer.

### Parent-provided independent verification receipts

- Node24.20.0: **458 tests / 7 files PASS in 7.32s**; types, lint and whitespace PASS.
- Node26 spot check: **33 tests PASS in 2.60s**; source review found no deterministic defect.
- Four verification hashes remained stable per parent receipt. The two frozen source/test hashes below and unchanged HEAD are locally checked in this tracker-only transaction; do not invent the other hash values or exact test commands.
- AP1 is **DONE**, with native review and commit evidence below. These checks do not establish autonomous production, physical termination or E3/UI implementation.

### Parent-provided writer evidence — not independent verification

- Implemented inactive `buildAnnualFavorPlan`; explicit policy version `annual-favor-policy-ap1-1`. No production consumer was activated.
- Writer RED: missing-module failure. Initial GREEN: 29 focused tests after correcting the test's `__proto__` own-property assignment.
- Final focused coverage: **33 passing tests**, including actual-target draw ties, UTF-8/raw-string ties, signed zero, debt preservation, missing allocations, adult eligibility and explicit caller bypass.
- Full writer suite: **7 files, 458 tests passing**. Node26 types, lint and whitespace checks passed after correcting intermediate TypeScript narrowing/deep-instantiation issues. These intermediate corrections are not outstanding failures.
- Exact writer command strings were not supplied in this reconciliation; these are parent-reported results, not newly executed validation.
- Automated ASSESS was **unavailable because the untracked candidate was undeclared**, not because tests failed. Assessment is conservatively **high risk**; independent verification has since completed as recorded above, and native review subsequently approved the unit.
- Frozen source SHA-256: `8998aeb439e0ae9f72fedf786a352580d635e516315357d13881fcedc9bc86d7`.
- Frozen test SHA-256: `c94f5bccc0eac891b1f2564026d88694c5592e980e3b8289adffc7232884b149`.
- Parent-observed committed source HEAD: `507f9b9eee15eee7b3055a093c61fedd57616cd0`; AP1 is **DONE**, not a full product release. Runtime/capsule compatibility does not establish post-physical validity or annual-policy provenance.

### Parent-observed closure receipt

- COMMITTED boundary: `c3154ef78b9270b62b6b5a9bc56f2e84aacfa8f6` → `507f9b9eee15eee7b3055a093c61fedd57616cd0`.
- Native review `review-7f5f0feb5f97e8ec`: **approved**, assessed **medium**, **609 authored lines**. ACK **BURNED**.
- Target: `974f9ab02677d35fca95e2d803862d1ad83b682b8e6bf613504ecb01e698d76a`.
- Consumed: `ca7cd2ff6dcabd4de612351583d5e986f79ba65c6f102a6c2e32ce32e465de87`.
- Candidate: `34d2e669d964d94db56c375f833aab35b0b4fca1` (candidate identity, never a STATUS).
- Accounting: source/tests **496** + tracker **111** + main tracker **2** = **609**; running authored count **14,467 → 15,076**.
- Closure is parent-observed; this transaction verifies unchanged HEAD/source hashes and full tracker/mirror readback only.

## Delivery and continuity

- Preserve human-selected Engram7008: `delivery_strategy=ask-on-risk`, resolved shape, `chain_strategy=feature-branch-chain`. Mainline17 remains resolved; do not re-ask routine delivery shape.
- Tracker-only starting HEAD: `507f9b9eee15eee7b3055a093c61fedd57616cd0`; parent-provided running authored count: **15,076**. Preserve closed main-tracker counts and review receipts.
- No PR, push, child-ref creation or history rewriting. The parent owns review and local commit actions; this document-only writer performs none.
- Preserve pre-existing untracked `.claude/` and every unrelated closed unit/file/memory. The accepted-policy link already exists in [the main tracker](narrative-engine.md); preserve it. Do not update main mirror Engram6902, dedicated L17483, bridge7341 or repo7467 in this reconciliation.
- Current transaction edits only `odd/tasks/narrative-annual-policy.md`, `odd/tasks/narrative-release-execution.md` and their full mirrors with repository-relative locators. No source writes, Git-native review, network/install/provider/database/child-agent operations.

## Pending beyond AP1

- [ ] Compose annual policy after physical changes with explicit phase/current-world eligibility.
- [ ] Implement approved/explicit annual demography and autonomous consuming production integration; numeric acceptance alone does not close E2b/E1 production.
- [ ] Implement E3 production branch binding and the Engram7500 deletion-blocking/no-automatic-GC retention policy.
- [ ] Complete historical bridge/UI/E4 integration and later director/calibration work under their existing gates.

## Document-only evidence

Strict TDD is not active for this passive document transaction; no behavior tests are required. Required validation: full tracker and full mirrors readback, `git diff --check`, `git rev-parse HEAD` and `git status --short`. Source HEAD must remain unchanged. Mirror failures/limits must leave the full file intact and be reported as pending, never truncated or replaced with a summary.

**Main mirror update pending and unchanged:** Engram6902 rejected the exact E2b paragraph replacement with `replacement result exceeds maximum observation length`. Its original full observation remains intact; the repository main tracker contains the accepted-policy link. Do not retry, shorten or truncate the main mirror in this transaction. Parent follow-up remains pending. This annual-policy tracker remains a separate full mirror at Engram7492; full-file/full-mirror and locator readback are required before the documentation write freeze.

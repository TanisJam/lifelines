# Historical narrative bridge — ODD tasks

## Decision and continuity

Parent feature: [Narrative engine](narrative-engine.md). Human decision Engram7334 approves the **subject-life window**: subject birth through recorded death, or the selection frontier if no death is recorded. Outside-window people remain accessible as truthful context, labels and links, including `Scene.people`. Exact `asOfYear` limits evidence; it is not a fabricated opening date.

P2 is closed at `02ce3f2`; H1 is locally committed with exact reviewed tree `c1a84cb2d5ef7d9a22251fc5272dba649bed0fb9`, now HEAD `304ed9b70f2b80b27c679a7f0081e8f1ac9ec7ee`. Parent reports **257 authored lines / three paths**, running authored count **12,497 through `304ed9b`**. Latest reviewed committed boundary is now `304ed9b`. The COMMITTED P2 + H1 range `2420bad → 304ed9b` (**567 net lines / 11 paths**) is parent-reported **approved and ACK BURNED** under `review-ce8a0389b38f3b0f`, target `9955e07fadd2db6ecd4ffc22a1831102e6a575e67ee4ee002f57f9440aeda672`, consumed receipt `5502eb37721b83f0bb800120e7716fc72cd746c73f5357684d3ca02fe48140f5`. This authority is distinct from P2 and H1 workspace ACKs; **no STATUS on burned authority**. The prior MEDIUM / `reviewDue: true` / `slice_budget_reached` assessment is historical, superseded by this committed-range closure. This passive update records that boundary, not additional source-authored totals. Continue product delivery through coherent dependent units, not arbitrary turn stops.

Parent-authorized next source implementation is bounded to **H2**, the seven exact paths listed below; H1 is complete. This tracker records H2 IN PROGRESS before its first source write, not a source implementation claim. This integration transaction writes only this tracker and its full Engram7341 mirror at `odd/narrative-historical-bridge/tasks`, repository locator `odd/tasks/narrative-historical-bridge.md`. It grants no broader source authority, native review, staging/commit, child creation, provider/network, install or live DB operations. Preserve unrelated tracked/untracked files, including `.claude/`; do not grow the main tracker or Engram6902. Parent owns authority, verifier dispatch and terminal git actions; no push or PR.

## Sequential work units

- [x] **H1 — Journal placement primitive: DONE.** Writer checks, three independent foreground receipts, native workspace approval/consumed ACK and parent local commit are complete; exact authority and integrity are recorded below.
- [ ] **H2 — Exact historical scene: IN PROGRESS.** Depends on completed H1. Parent authorizes precisely the seven paths below; status precedes the first source write.
- [ ] **H3 — Faithful partial chronicle: PENDING.** Depends on H1/H2. Token mapping is settled as recorded-role literal/link **text**, not new prose. Prospective `src/server/historical-life-chronicle.ts` and its test remain unauthorised source surfaces.

H1 used the delegated route for source plus tests. H2 also triggers delegated implementation because it spans seven files: test-first focused existing **99 tests plus new H2 tests**, expanded scene/presence/determinism coverage, TypeScript, scoped lint and whitespace. Freeze all source/tracker writes before three independent Node24, Node26 and actual-browser checks. No source writer is active in this tracker transaction; maintain one focused writer per worktree. Each unit is independently meaningful, not an oversized all-area bridge.

## H1 — Complete-year chronology math

Public `journalPlacements` consumes typed readonly complete-year journal records, using `plan.year` and `entries.id`. Return a detached, deeply frozen, null-prototype `Readonly<Record<string, number>>`, not `ReadonlyMap`: `Object.freeze(map)` does not make Map entries immutable. Every result key must be own; arbitrary canonical nonempty JavaScript string IDs, including prototype keys, are safe and preserved exactly.

For each year record, count **all** entries, including hidden or ineligible entries. With zero-based ordinal `i` and count `n`, position is `year + (i + 1) / (n + 1)`. Reject duplicate IDs across records, duplicate years, noncanonical/empty IDs and invalid years; negative years are allowed when finite safe integers. Empty year records are accepted. Every computed position must be finite, strictly inside `(year, year + 1)` and strictly increasing within that year. Reject precision collapse even for hidden entries: the reachable safe-integer year `2^52` with two events must fail, not round or silently drop entries.

Keep a pure typed math API, not a new unknown-object/Proxy admission framework. TSDoc must state the actual formula, input/error invariants and detached frozen result; behavior-level tests provide sufficient companion documentation. Target source **30–70 lines**, tests **100–160 lines**, without padding, minification or sacrificing coverage. This is a usable standalone chronology primitive; no consumer or UI activation is needed to justify it.

Acceptance covers multiple/negative/empty years, complete-year hidden slots, exact arbitrary own-key IDs, duplicate and invalid inputs, strict interior/order, precision collapse and caller mutation after return. Do not manufacture model constants or calendar-month tags.

## H2 — Replay truth and opt-in window eligibility

Exact parent-authorized H2 source surfaces (not writable by this tracker transaction):

- `src/server/historical-scene.ts`
- `src/server/historical-scene.test.ts`
- `src/contracts/life.ts`
- `src/lib/sky/presence.ts`
- `src/lib/sky/presence.test.ts`
- `src/lib/sky/scene-model.ts`
- `src/lib/sky/scene-model.test.ts`

`deriveHistoricalScene({ history: unknown, subjectActorID: string, asOfYear: number }): LifeScene` uses the exact historical admission/checkpoint. Resolve only subject plus selected-entry/evidence actors, not the unrelated registry. Other participants are neutral; create no edges. Preserve `born` as real birth, `appearsAt` as origin birth or physical creation-journal placement, and `diedAt` as origin death or physical death slot. Set `scene.span.start` to subject birth and end to death or fixed frontier, including numeric zero and `1313/1313`. No semantic clamping. Optional `timeBasis: "journal-ordered"` opts into the guard; legacy behavior remains unchanged.

For `scenePresence`, use S/E, I = max(born, appearsAt), and optional D = death. Return zero for nonfinite t/E, null E, t outside [S,E], I > E, D < S, or t < I; otherwise retain legacy presence. Exact-opening death is retained as dead context with `alive: false`; death before opening is excluded. Dead context inside the window may be visible but is **not living**. `circleCount` uses the same guard plus alive/inCircle; journal-neutral others never enter the circle. `frameAt` shares the guard and suppresses journal anticipatory arrival/predictive fade; opacity remains finite, including zero, never NaN.

Test forward/backward evaluation, determinism, future-introduction exclusion, span-end exclusion, truthful dates/context and initially dead subject. Older newcomer birth 1300/introduction 1328 and posthumous CAUSE evidence remain valid. Unborn frontier is unreachable through admitted runtime; no new human choice. Existing dial `0.7` UI padding is unchanged: H2 is **not UI activation, calendar or SSE work**.

## H3 — Recorded-role prose and partial output

Produce an inactive, explicit partial output with `version`, `asOfYear`, `entries`, `scene` and `evidence`; do not fake a full `Chronicle`, IDs, death or epitaph. Admit existing EN/ES templates and exact runtime `asOfYear` first, then consume H1/H2. Literal/link tokens must be constructed from **recorded roles**, never by replacing name substrings. Resolved token plaintext must equal the exact existing template plaintext, including same-name actors, arbitrary IDs and hostile/marker-like literal names. Preserve outside-context labels/links and evidence cutoff.

Token mapping is settled: recorded-role literal/link text must reproduce safe existing bilingual template plaintext, not newly authored prose. H3 template admission plus H2 historical admission is intentional double admission; do not expand scope into a shared-admission refactor. No invented friendship, ties, calendar dates/month tags, summary/epitaph policy or quiet-provider fallback. H3 remains pending with **no source authorization**; existing legacy calendar E UI remains explicitly **OFF**.

## Evidence and closure gates

Parent-reported feasibility: Node26, **26 assertions**, seed `sky7334-0`, years **1327–1335**, **62 founders**, female selection produced **84 people**; `p009` was born and died in **1313**. This supports the initially dead subject case, not renderer-window correctness. Older newcomer birth 1300/introduction 1328 and posthumous CAUSE are valid acceptance cases, not reasons to alter canon. The frame/presence hazards above remain open until H2's opt-in consumer guard is tested. This tracker has not rerun or independently certified those observations.

Parent-reported H1 writer evidence, Node26.8.1: missing-module **RED 161ms → 21 GREEN 172ms → final 21 PASS 167ms**; compatibility suite **78 tests / five files PASS 468ms**. Initial required TypeScript check failed on a fixture; the fixture was corrected and the rerun passed. Final scoped ESLint, nonincremental TypeScript and whitespace checks passed. The worker conservatively returned **partial** because a required command historically failed; that preserved failure is not a currently failing check. These are writer observations, not independently rerun receipts.

Candidate integrity observed during tracker integration: source **50 lines**, SHA256 `481fbc40410a8bf83ff8dd9747467250c70dedb701c19720b2bae9391d6be03a`; test **140 lines**, SHA256 `9f5b98aa410f224f998f330e0f251d76a5b8162f428cc2f4e403c453c34250c0`. Both remain within the planned ranges and hashes were reverified in this closure integration. H1 source/test are now committed; this passive update adds no source-authored total and records the separately approved committed boundary `304ed9b`.

Parent-reported independent foreground receipts, completed after **ALL source and task/tracker writes were frozen during checks** (not merely H1); this bookkeeping transaction did not rerun them:

- **Node24 compatibility — `mut67cv9-26-5ce6`: PASS.** 99 tests / six files, 501ms; TypeScript 5.9.3 PASS 5.089s; ESLint 9.39.5 PASS 1.783s; 104 fresh assertions 0.124s; whitespace PASS. Own 267-file manifest SHA256 `514bf246ee60350526aadaa5fc6dadf157cf71d736f212bc77007f918cb651db` matched before/after.
- **Node26 math/adversarial — `mut67cva-27-o4eu`: PASS.** 21 focused tests, 171ms; 483,840 fresh assertions / 1,387 cases, 0.219s: all 65,536 UTF-16 code units, 975 year/count combinations (478 accepted / 497 precision-collapse rejections), 108 invalid-ID cases. Own 267-file enumeration digest `883933…` matched before/after (only this prefix supplied).
- **Actual `RuntimeOutput.journal` integration — `mut67cva-28-upue`: RESUMED / completed.** Supersedes earlier blocked queries. 106 tests / four files, 28.84s; 20,644 actual runtime checks on each of Node26 / Node24, 6.274s / 5.854s. All four CORPUS fixtures covered actual hidden complete-year slots, quiet-future prefix, cold-capsule fork nonsharing and input canon. Own 494-file SHA256 `9b793fe440232be8cd8fb3b7e610d12f7633357b1e42d6723ba634cdc9cc5e0e` matched before/after.

No source changed during these checks. Different enumeration hashes are **not cross-comparable**. Test-output requests were resolved: expected Vitest-owned `/tmp/lifelines-*` and `node_modules/.vite` outputs plus authorized local CLI subprocesses, not agent children. These bounded receipts do not claim a full suite, build or browser check; H1 makes no rendering change. Writer self-checks remain distinct from independent receipts.

Initial parent assessment was **UNASSESSABLE / HIGH**, due to an explicit untracked-declaration provider error, including inspect/select, before independent checks; that error was **not approval**. It is superseded for H1 workspace closure by parent-reported native review `review-d4b191cd35f466e7`: **approved and ACK BURNED**, target `69bf5f59eafdaecd4d06fe6071ea4c654ec6017996c8e0d6723bb124c71c8d1d`, consumed receipt `6d52650919c38dec040c5f9ff592f2d7c0aa18ce6feea09657212c10a6c7db19`. Together with the independent receipts and parent local commit, this closes H1. **No STATUS again.** The separately approved and consumed COMMITTED range authority recorded above closes `2420bad → 304ed9b`; it is not this H1 workspace receipt. The previously corrected fixture failure remains historical evidence, not a blocker.

Do not mark any unit done until its applicable checks, native review under the human-owned switch and parent local commit are complete. Preserve observed RED/GREEN evidence, exact native/ACK scope and committed-range distinction; no STATUS after burned authority. This passive tracker integration has no meaningful pre-implementation behavior test; structural readback is not a source PASS claim.

Product resource **E2b** and life/branch retention decisions remain human-owned and pending later. No births backdated for late arrival, fabricated friends/ties/epitaphs, legacy behavior changes, UI/calendar activation, provider calls, DB changes, publication or whole-product completion claims.

## Next dispatch

After full tracker/Engram7341 mirror readback and whitespace verification, parent owns the passive closure's local commit before dispatching the H2 source writer on the seven exact authorized paths. H1 is DONE; H2 is IN PROGRESS before source writes; H3 remains pending without source authority. Latest reviewed committed boundary is `304ed9b`; never poll either burned H1 workspace or COMMITTED range STATUS. Keep this complete recovery document mirrored under `odd/narrative-historical-bridge/tasks`, with repository locator and full readback, rather than a summary or append-only log. Leave main tracker/Engram6902 unchanged to preserve byte budget.

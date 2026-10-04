# Historical narrative bridge — ODD tasks

## Decision and continuity

Parent feature: [Narrative engine](narrative-engine.md). Human decision Engram7334 approves the **subject-life window**: subject birth through recorded death, or the selection frontier if no death is recorded. Outside-window people remain accessible as truthful context, labels and links, including `Scene.people`. Exact `asOfYear` limits evidence; it is not a fabricated opening date.

P2 is closed at `02ce3f2`, with passive reconciliation through `9fbf47d` (Engram7330). Latest reviewed committed boundary remains `2420bad`; pending P2 committed slice is **310 net lines**, running authored count **12,240 through `9fbf47d`**. Workspace approval/ACK is distinct from committed-range authority; do not claim the deferred slice reviewed. New tracker bookkeeping is deferred to the next slice, not included in those totals. Continue product delivery through coherent dependent units, not arbitrary turn stops.

Parent-authorized continuous implementation is currently bounded to **H1**, the new `src/server/historical-journal-placement.ts` and `src/server/historical-journal-placement.test.ts`; that delegated writer has finished its source work. This integration transaction writes only this tracker and its full Engram7341 mirror at `odd/narrative-historical-bridge/tasks`, repository locator `odd/tasks/narrative-historical-bridge.md`. It grants no broader source authority, native review, staging/commit, child creation, provider/network, install or live DB operations. Preserve unrelated tracked/untracked files, including `.claude/`; do not grow the main tracker or Engram6902. Parent owns authority, verifier dispatch and terminal git actions; no push or PR.

## Sequential work units

- [ ] **H1 — Journal placement primitive: IN PROGRESS.** Tracker preceded the first source write. Delegated implementation, final writer checks and three independent foreground checks are complete; applicable native review/ACK and parent local commit remain pending. Source/test are untracked at HEAD `9fbf47d`; this is not H1 closure.
- [ ] **H2 — Exact historical scene: PENDING / PROVISIONAL.** Depends on H1. Prospective new `src/server/historical-life-scene.ts` and `src/server/historical-life-scene.test.ts`; separate read-only window scout must derive additional actual renderer/count-helper paths before the H2 writer. These prospective paths are not authorization to write source.
- [ ] **H3 — Faithful partial chronicle: PENDING / PROVISIONAL.** Depends on H1/H2. Prospective new `src/server/historical-life-chronicle.ts` and `src/server/historical-life-chronicle.test.ts`; separate read-only tokens scout must settle semantic API/dependencies and closed copy strings before the H3 writer. These prospective paths are not authorization to write source.

H1 used the delegated route because it is a multi-file implementation (source plus behavior tests). H2 window and H3 token scouts remain read-only; neither provisional scope authorizes a writer. No source writer is active in this tracker transaction; maintain one focused writer per worktree. Each unit is independently meaningful, not an oversized all-area bridge.

## H1 — Complete-year chronology math

Public `journalPlacements` consumes typed readonly complete-year journal records, using `plan.year` and `entries.id`. Return a detached, deeply frozen, null-prototype `Readonly<Record<string, number>>`, not `ReadonlyMap`: `Object.freeze(map)` does not make Map entries immutable. Every result key must be own; arbitrary canonical nonempty JavaScript string IDs, including prototype keys, are safe and preserved exactly.

For each year record, count **all** entries, including hidden or ineligible entries. With zero-based ordinal `i` and count `n`, position is `year + (i + 1) / (n + 1)`. Reject duplicate IDs across records, duplicate years, noncanonical/empty IDs and invalid years; negative years are allowed when finite safe integers. Empty year records are accepted. Every computed position must be finite, strictly inside `(year, year + 1)` and strictly increasing within that year. Reject precision collapse even for hidden entries: the reachable safe-integer year `2^52` with two events must fail, not round or silently drop entries.

Keep a pure typed math API, not a new unknown-object/Proxy admission framework. TSDoc must state the actual formula, input/error invariants and detached frozen result; behavior-level tests provide sufficient companion documentation. Target source **30–70 lines**, tests **100–160 lines**, without padding, minification or sacrificing coverage. This is a usable standalone chronology primitive; no consumer or UI activation is needed to justify it.

Acceptance covers multiple/negative/empty years, complete-year hidden slots, exact arbitrary own-key IDs, duplicate and invalid inputs, strict interior/order, precision collapse and caller mutation after return. Do not manufacture model constants or calendar-month tags.

## H2 — Replay truth and opt-in window eligibility

Replay the exact selected checkpoint, resolving **required explicit actor IDs**: subject plus actors referenced by selected entries/evidence, not every unrelated registry member. Actual creation/arrival appears at its **INTRODUCTION placement**, never backdated to an older arrival's birth. Initial actors retain real births/dates. Outside-window actors retain truthful birth/death/introduction dates and IDs in `Scene.people`, labels and links; do not clamp them into the window, resurrect them or invent membership/ties.

Opt-in subject-window eligibility must protect the **actual renderer and count helper**, while preserving legacy behavior. Current `frameAt` ignores death/span end, and presence pre-fades future introductions to `0.45`; scene metadata alone therefore cannot prove that the subject-life window is shown. Derive the exact additional consumer paths before writer authorization. Use a narrow opt-in guard, not a generic mode framework. No UI activation.

Required alternate cases: initially dead selected subject is valid; older newcomer introduced in 1328 with birth 1300 is valid; posthumous CAUSE is evidence, not a posthumous action. Verify forward/backward evaluation, future-introduction exclusion, dead/span-end exclusion where applicable and truthful outside-window context. Preserve causal closure, real dates and IDs, without demanding unrelated registry resolution.

## H3 — Recorded-role prose and partial output

Produce an inactive, explicit partial output with `version`, `asOfYear`, `entries`, `scene` and `evidence`; do not fake a full `Chronicle`, IDs, death or epitaph. Admit existing EN/ES templates and exact runtime `asOfYear` first, then consume H1/H2. Literal/link tokens must be constructed from **recorded roles**, never by replacing name substrings. Resolved token plaintext must equal the exact existing template plaintext, including same-name actors, arbitrary IDs and hostile/marker-like literal names. Preserve outside-context labels/links and evidence cutoff.

The tokens scout must derive the semantic API, dependencies and closed bilingual copy strings safely. No invented friendship, ties, calendar dates/month tags, summary/epitaph policy or quiet-provider fallback. H3 scope remains provisional until that derivation and parent authorization; existing legacy calendar E UI remains explicitly **OFF**.

## Evidence and closure gates

Parent-reported feasibility: Node26, **26 assertions**, seed `sky7334-0`, years **1327–1335**, **62 founders**, female selection produced **84 people**; `p009` was born and died in **1313**. This supports the initially dead subject case, not renderer-window correctness. Older newcomer birth 1300/introduction 1328 and posthumous CAUSE are valid acceptance cases, not reasons to alter canon. The frame/presence hazards above remain open until H2's opt-in consumer guard is tested. This tracker has not rerun or independently certified those observations.

Parent-reported H1 writer evidence, Node26.8.1: missing-module **RED 161ms → 21 GREEN 172ms → final 21 PASS 167ms**; compatibility suite **78 tests / five files PASS 468ms**. Initial required TypeScript check failed on a fixture; the fixture was corrected and the rerun passed. Final scoped ESLint, nonincremental TypeScript and whitespace checks passed. The worker conservatively returned **partial** because a required command historically failed; that preserved failure is not a currently failing check. These are writer observations, not independently rerun receipts.

Candidate integrity observed during tracker integration: source **50 lines**, SHA256 `481fbc40410a8bf83ff8dd9747467250c70dedb701c19720b2bae9391d6be03a`; test **140 lines**, SHA256 `9f5b98aa410f224f998f330e0f251d76a5b8162f428cc2f4e403c453c34250c0`. Both remain within the planned ranges. Tracker is new and not yet committed; no authored-total or reviewed-boundary advance is claimed.

Parent-reported independent foreground receipts, completed after **ALL source and task/tracker writes were frozen during checks** (not merely H1); this bookkeeping transaction did not rerun them:

- **Node24 compatibility — `mut67cv9-26-5ce6`: PASS.** 99 tests / six files, 501ms; TypeScript 5.9.3 PASS 5.089s; ESLint 9.39.5 PASS 1.783s; 104 fresh assertions 0.124s; whitespace PASS. Own 267-file manifest SHA256 `514bf246ee60350526aadaa5fc6dadf157cf71d736f212bc77007f918cb651db` matched before/after.
- **Node26 math/adversarial — `mut67cva-27-o4eu`: PASS.** 21 focused tests, 171ms; 483,840 fresh assertions / 1,387 cases, 0.219s: all 65,536 UTF-16 code units, 975 year/count combinations (478 accepted / 497 precision-collapse rejections), 108 invalid-ID cases. Own 267-file enumeration digest `883933…` matched before/after (only this prefix supplied).
- **Actual `RuntimeOutput.journal` integration — `mut67cva-28-upue`: RESUMED / completed.** Supersedes earlier blocked queries. 106 tests / four files, 28.84s; 20,644 actual runtime checks on each of Node26 / Node24, 6.274s / 5.854s. All four CORPUS fixtures covered actual hidden complete-year slots, quiet-future prefix, cold-capsule fork nonsharing and input canon. Own 494-file SHA256 `9b793fe440232be8cd8fb3b7e610d12f7633357b1e42d6723ba634cdc9cc5e0e` matched before/after.

No source changed during these checks. Different enumeration hashes are **not cross-comparable**. Test-output requests were resolved: expected Vitest-owned `/tmp/lifelines-*` and `node_modules/.vite` outputs plus authorized local CLI subprocesses, not agent children. These bounded receipts do not claim a full suite, build or browser check; H1 makes no rendering change. Writer self-checks remain distinct from independent receipts.

Parent assessment: **UNASSESSABLE / HIGH**, due to an explicit untracked-declaration provider error, including inspect/select; **not approval**. Native review remains pending; H1 stays unchecked until applicable review/ACK and parent commit. The previously corrected historical TypeScript fixture failure remains recorded above, not a new blocker.

Do not mark any unit done until its applicable checks, native review under the human-owned switch and parent local commit are complete. Preserve observed RED/GREEN evidence, exact native/ACK scope and committed-range distinction; no STATUS after burned authority. This passive tracker integration has no meaningful pre-implementation behavior test; structural readback is not a source PASS claim.

Product resource **E2b** and life/branch retention decisions remain human-owned and pending later. No births backdated for late arrival, fabricated friends/ties/epitaphs, legacy behavior changes, UI/calendar activation, provider calls, DB changes, publication or whole-product completion claims.

## Next dispatch

After this tracker and full Engram7341 mirror are read back, parent owns resolution of the native-review provider failure, applicable review/ACK and local commit; the three independent foreground receipts are complete. **Do not mark H1 done now.** H2/H3 remain pending and scouts read-only; refine H2's final path names from the new read-only scout, without inventing or touching them, and derive final allowed surfaces before either writer. Keep this complete recovery document mirrored under `odd/narrative-historical-bridge/tasks`, with repository locator and full readback, rather than a summary or append-only log.

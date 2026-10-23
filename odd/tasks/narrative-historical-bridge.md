# Historical narrative bridge — ODD tasks

## Decision and continuity

Parent feature: [Narrative engine](narrative-engine.md). Human decision Engram7334 approves the **subject-life window**: subject birth through recorded death, or the selection frontier if no death is recorded. Outside-window people remain accessible as truthful context, labels and links, including `Scene.people`. Exact `asOfYear` limits evidence; it is not a fabricated opening date.

P2 is closed at `02ce3f2`; H1 is locally committed with exact reviewed tree `c1a84cb2d5ef7d9a22251fc5272dba649bed0fb9`, then HEAD `304ed9b70f2b80b27c679a7f0081e8f1ac9ec7ee`. Parent reports **257 authored lines / three paths**, running authored count **12,497 through `304ed9b`**. At H1 closure, the reviewed committed boundary was `304ed9b`. The COMMITTED P2 + H1 range `2420bad → 304ed9b` (**567 net lines / 11 paths**) is parent-reported **approved and ACK BURNED** under `review-ce8a0389b38f3b0f`, target `9955e07fadd2db6ecd4ffc22a1831102e6a575e67ee4ee002f57f9440aeda672`, consumed receipt `5502eb37721b83f0bb800120e7716fc72cd746c73f5357684d3ca02fe48140f5`. This authority is distinct from P2 and H1 workspace ACKs; **no STATUS on burned authority**. The prior MEDIUM / `reviewDue: true` / `slice_budget_reached` assessment is historical, superseded by this committed-range closure. This passive update records that boundary, not additional source-authored totals. Continue product delivery through coherent dependent units, not arbitrary turn stops.

Historical passive HEAD `39c58d176ad19f74793f1bfd561af38010aad448` added **23 additions / 13 deletions = 36 authored lines**, taking the running count to **12,533**. Its structural readback/assessment was not native source approval. H2 parent local commit is **`9a5e34e4738f414271109d5eaf72a0dcb8e8b21f`**, exact reviewed tree **`ad86c5d2b5f0de3a5a8f687bc42e6367f3de1969`**: **495 additions / 15 deletions = 510 authored lines across eight paths including tracker**, of which **426 authored lines across seven source paths**. H2 running authored count was **13,043 = 12,533 + 510**; latest reviewed committed boundary remains **`9a5e34e`**. Historical passive HEAD **`89cc7750fd73cf2ccbcd68e20b523ea82d77b86c`** added **32 assessed authored lines**, taking the running count to **13,075 including passive bookkeeping**. That passive assessment is not source approval. This new tracker-only transition is not yet counted; parent owns any later bookkeeping commit identity.

**H1, H2, H3 and H4 are DONE; the inactive historical bridge is complete, not the whole product.** H3 is locally committed at `6e7b57f0aff88afb42f284a23c591d274d8074e6`, exact reviewed tree `11ade5471d85eee15b6bd8dfa97f872efded0814`, with approved COMMITTED review and consumed ACK recorded below. Latest reviewed committed boundary is **`6e7b57f`**. Running authored count is **13,867 = 13,509 + 358**, excluding this current uncommitted post-review passive update. All three fresh independent combined H3 + H4 checks finished PASS; their source/tracker freeze has ended. H3's prior browser blocker is RESOLVED by fresh unskipped actual-browser acceptance, not a current blocker. Historical bounded receipts and harness failures remain preserved below; H3 is closed by its own separate observed authority, not H4's authority. This DOM-boundary repair is not a canon-policy change. User “dale, segui hasta terminar todo” explicitly authorizes H3 now and future routine scoped units; unresolved real product decisions still require the human. H2's corrected writer checks, three fresh independent PASS receipts, native workspace approval/consumed ACK, parent local commit and separate COMMITTED approval/consumed ACK are complete. Engram7422 (user7422, option 1) remains resolved: living endpoint is the last slot of the COMPLETE selected annual journal, with `asOfYear` fallback for a quiet selected year; exact recorded death remains unchanged. Historical pre-correction receipts are retained, not substituted for corrected-candidate validation. This passive writer changes only this tracker; the full Engram7341 mirror at `odd/narrative-historical-bridge/tasks`, repository locator `odd/tasks/narrative-historical-bridge.md`, requires parent update and untruncated readback separately. This tracker writer has no product-source write authority; the separate H3 sourcewriter authorization below belongs to parent dispatch. No native invocation, git mutation, children, provider/network, install or live DB operations occur in this transaction. Preserve `.claude/` and all unrelated files; leave main tracker/Engram6902 unchanged. Parent owns supervision, dispatch and terminal git actions; no push or PR.

## Sequential work units

- [x] **H1 — Journal placement primitive: DONE.** Writer checks, three independent foreground receipts, native workspace approval/consumed ACK and parent local commit are complete; exact authority and integrity are recorded below.
- [x] **H2 — Exact historical scene: DONE.** Engram7422 option 1 correction, writer checks, three fresh independent PASS receipts, native workspace approval/consumed ACK, parent exact-tree local commit and separate COMMITTED approval/consumed ACK are complete.
- [x] **H3 — Faithful partial chronicle: DONE.** Depends on completed H1/H2 and H4's DOM-boundary repair. The two source/test paths retain recorded-role literal/link **text**, not new prose. Writer evidence, three fresh combined independent PASS receipts including unskipped actual-browser acceptance, parent exact-tree local commit and separate COMMITTED approval/consumed ACK are complete. Output remains inactive and partial; no UI or whole-product activation follows.
- [x] **H4 — Exact lossless DOM coordinates: DONE.** Routine DOM-boundary repair authorized by the user's continuation consent and parent dispatch, prerequisite to H3 closure. The nine-path candidate, writer evidence and three fresh independent combined H3 + H4 PASS receipts are recorded below; parent exact-tree local commit and approved COMMITTED review/consumed ACK are complete. This authority closes H4 only; no H3 source changes are authorized.

H1 used the delegated route for source plus tests. H2 also triggers delegated implementation because it spans seven files: test-first focused existing **99 tests plus new H2 tests**, expanded scene/presence/determinism coverage, TypeScript, scoped lint and whitespace. All source/tracker writes were frozen throughout the three completed pre-correction independent Node24, Node26 and actual-browser checks; that historical freeze has ended. Correction, writer checks and all three fresh corrected-candidate independent checks are complete. Their historical source/tracker freeze ended for bookkeeping; the separate H3 authorization is confined to the two new paths above. No source writer is active in this tracker transaction; maintain one focused writer per worktree. Each unit is independently meaningful, not an oversized all-area bridge.

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

`deriveHistoricalScene({ history: unknown, subjectActorID: string, asOfYear: number }): LifeScene` uses the exact historical admission/checkpoint. Resolve only subject plus selected-entry/evidence actors, not the unrelated registry. Other participants are neutral; create no edges. Preserve `born` as real birth, `appearsAt` as origin birth or physical creation-journal placement, and `diedAt` as origin death or physical death slot. Set `scene.span.start` to subject birth and end to exact recorded subject death, or, for a living subject under Engram7422, the last slot of the COMPLETE selected annual journal with `asOfYear` fallback for a quiet selected year, including numeric zero and `1313/1313`. No semantic clamping. Optional `timeBasis: "journal-ordered"` opts into the guard; legacy behavior remains unchanged.

Parent decision Engram7359 resolves **B — instantaneous journal presence** without changing human policy Engram7334. H2 writer `mut75tyi-2g-5y40` paused without edits over the prior recipe's real technical contradiction: falling through to legacy presence yields **0.375** at physical creation because `ARRIVE_LEAD = 0.45` / `ARRIVE = 1.2`, not full presence. That pause is historical: the writer subsequently completed the bounded H2 candidate under resolved B. This does not constitute independent verification or native approval.

For journal-ordered `scenePresence`, use S/E, I = max(born, appearsAt), and optional D = death. Return zero for nonfinite t/E, nonnumeric E (including null), t outside [S,E], I > E, D < S, or t < I. After **all** eligibility guards pass, return **1**, never fall through to legacy presence. When the mode is absent, use legacy presence **exactly unchanged**. Exact-opening death D === S is retained as dead context with `alive: false`, including the `1313/1313` dead-point span; death before opening is excluded. Dead context inside the window may be visible but is **not living**. `circleCount` uses the same guard plus alive/inCircle; journal-neutral others never enter the circle. `frameAt` shares the guard: journal mode has no fade, anticipatory arrival or core predictive behavior; opacity remains finite, including zero, never NaN.

Test forward/backward evaluation, determinism, future-introduction exclusion, span-end exclusion, truthful dates/context and initially dead subject. Older newcomer birth 1300/introduction 1328 and posthumous CAUSE evidence remain valid. Unborn frontier is unreachable through admitted runtime; no new human choice. Existing dial `0.7` UI padding is unchanged: H2 is **not UI activation, calendar or SSE work**.

## H3 — Recorded-role prose and partial output

`buildHistoricalLifeChronicle({ history: unknown, subjectActorID, asOfYear }, locale)` requires explicit EN/ES locale and produces an inactive partial output with `version`, `asOfYear`, `entries`, `scene` and `evidence`. Preserve existing template entry metadata/text, adding required `at`, `who`, `prose`, `links` and `proseTokens`; do not invent a full `Chronicle`, title, level, turn, IDs, death or epitaph.

Call `renderHistoricalFavorTemplates` for admission first, then `deriveHistoricalScene`: this intentional double admission is not permission for a shared-admission refactor. Use the exact checkpoint and H1 placements from the COMPLETE annual journal, not filtered subject/evidence entries or future journals. Preserve outside-context labels/links and evidence cutoff.

Construct literal/link tokens from **recorded roles**, never name-substring replacement: grant creditor → debtor; help/refuse debtor → creditor. Preserve the literal ID suffix. `resolveEntryProse` plaintext must equal exactly the existing `template.text`, in both languages, including arbitrary exact IDs, hostile/marker-like literal names and same-name actors. Every lookup must be own-key safe. Return detached, deeply frozen data without freezing caller data.

Parent plans one delegated multi-file source/test write thread, strict test-first **RED → GREEN**, then alternate/adversarial cases, focused Vitest, nonincremental TypeScript, scoped lint and whitespace. Forecast **310–440 authored source/test lines**; 400 is advisory, never trim coverage to meet it. Freeze **all source and tracker writes** before three fresh independent Node24 compatibility, Node26 boundary/adversarial and actual-browser checks; each verifier owns a stable before/after manifest, not cross-comparable enumerations. H3 cannot be DONE until required checks, native review/consumed ACK and parent local commit are complete. Writer RED/GREEN is parent-reported in the candidate ledger below; independent receipts are now recorded below. Historical Node24 and Node26 passed, while the historical bounded browser run was NOT an overall PASS. Fresh combined H3 + H4 checks satisfy unskipped browser acceptance; the required separate commits and native closures are recorded complete below.

No UI/calendar/SSE/route, provider, DB or shared-admission refactor. No invented friendship, ties, calendar dates/month tags, summary/epitaph policy or quiet-provider fallback. Legacy calendar E UI remains explicitly **OFF**. This passive document transaction has no meaningful behavior-level RED; full readback and whitespace validation are structural only.

## Evidence and closure gates

Parent-reported feasibility: Node26, **26 assertions**, seed `sky7334-0`, years **1327–1335**, **62 founders**, female selection produced **84 people**; `p009` was born and died in **1313**. This supports the initially dead subject case, not renderer-window correctness. Older newcomer birth 1300/introduction 1328 and posthumous CAUSE are valid acceptance cases, not reasons to alter canon. The frame/presence hazards above are covered by the corrected H2 checks below. This tracker has not rerun or independently certified those observations.

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

## H2 pre-correction candidate — historical writer evidence and integrity

Parent-reported Node26.8.1 writer evidence: RED missing module plus eight guard/frame failures, with 35 legacy tests passing (369ms). First GREEN attempt: 53 PASS / one fixture failure; expected death slot 1327.5, actual `1327 + 1/3`. After fixture correction: 54 tests / four files PASS (1.17s), then 118 tests / seven files PASS (1.15s). Nonincremental TypeScript, seven-file ESLint, tracked whitespace and both new-file no-index whitespace checks passed without diagnostics. The writer conservatively returned partial for the historical failure; all final checks passed. These are writer observations, not independent receipts.

Historical pre-correction candidate source accounting against unchanged HEAD `39c58d176ad19f74793f1bfd561af38010aad448`: five tracked source/test files **145 additions / seven deletions = 152 authored lines**; two new files **57 + 176 = 233 authored lines**; total **378 additions / seven deletions = 385 authored lines across seven surfaces**, excluding tracker bookkeeping. Integration observed these SHA256 values; all seven were unchanged during the prior independent checks. They identify the historical pre-correction candidate, not the corrected, now-committed candidate below:

| Path | SHA256 |
| --- | --- |
| `src/server/historical-scene.ts` | `da5dceda34eac0f219e9589ed09243c9928f8ca6a7445d73096b60fe4f9b3d66` |
| `src/server/historical-scene.test.ts` | `5f215be354c84f23ead2ba39c5a809bef3f76348dfdbfaa45852023594243f75` |
| `src/contracts/life.ts` | `365a2ced0b140a9e5e93b8206f87e16591e2c886b6d016bbe692d4e25fc5b40c` |
| `src/lib/sky/presence.ts` | `cba7e98bc4e35fc91070c6dd265663834f4f6dbccb23c86ddceb46614b4fd0fb` |
| `src/lib/sky/presence.test.ts` | `38bdf6db18537095bb24b0afbf0a48ec9c64091b6792eb3f92617a78a7fde1e3` |
| `src/lib/sky/scene-model.ts` | `c2a5395b08922243123b7c59c0a2287b8e52c82567efaec6a2ebad699cd5a3b4` |
| `src/lib/sky/scene-model.test.ts` | `a88d8edefa05facc30d30ee27eef003201231d4e3c778ff98a892310c771ce60` |

The writer reports truthful dates, instantaneous guards, dead context and exact-window frame behavior, with no UI/SSE/calendar/dial-padding activation. All seven source hashes above remained unchanged during the three independent receipts; there was no source or task drift. Different enumerators are not cross-comparable.

## H2 pre-correction independent receipts — historical PASS

Parent-reported independent results; this passive integration did not rerun these checks. These PASS receipts apply only to the seven pre-correction hashes above, not the implemented Engram7422 correction. Fresh corrected-candidate receipts appear below:

- **Node24 compatibility: PASS.** 172 tests / 11 files, 1.61s; TypeScript 5.9.3, ESLint 9.39.5 and whitespace PASS; 394 fresh assertions. Own 269-file manifest SHA256 `271606379f19598c9ea376ac037bf908c1fba28da567b0d8bbd00a2f60dd2172` matched before/after.
- **Node26 boundary/adversarial: PASS.** 167 tests / seven files, 2.07s; 199,224 fresh assertions / 312 cases, 2.371s. Own 269-file enumeration SHA256 `f1afd126a75ad2ab81567712a33aca21a00ebd19292f412ef0dd214f02ccd99d` matched before/after.
- **Actual browser: PASS.** 38,644 assertions through actual `SkySvg`, `PlacePanel`, `PlayerStore` and `createSkyEngine`, offline Chromium 153.0.8010.12 / React 19.2.8; zero requests, page errors and remaining mounts. Genuine seed: 84 people; `p009` birth/death 1313, including zero and `1313/1313` spans. Older arrival birth 1300 / creation `1328 + 1/6` was absent before, full at introduction and restored after replay. Dead preopening causal evidence remained context but was omitted from sky; synthetic bad-edge neutral actors never entered circle. Actual legacy baseline core/counts were correct. Own 501-entry manifest SHA256 `5d74b2c073b12db6cc810918b980ae6580d801305e97af94f8b32bb68f6d899e` matched before/after.

Verifier startup failures only (missing esbuild / browser aliases for node crypto/util) were resolved before final PASS. The writer fixture failure and its corrected final PASS remain preserved above. Legacy `0.7` timeline padding is still known; no UI activation, full-app, styling or build claim follows from these checks. The historical untracked-declaration assessment was **UNASSESSABLE / HIGH**, not approval; it is now superseded by native workspace and COMMITTED closure below. Historical inspect-ready potential `3b233…` was not authority or usable lineage; do not STATUS it or use it as lineage.

## Human frontier decision — resolved Engram7422

**Historical premise PROVED:** actual canonical selected-year 1328 contains five entries, including creation `1328 + 1/6`, with actor birth 1300 or 1328 as subject and evidence. Living scene end 1328 makes I > E and hides that introduction. The initially quiet subject is visible at 1328, but a grant at 1328.5 exceeds end and yields an empty scene there; as of 1329 the introduced actor appears. The pre-correction integer-end guard was mechanically conforming; its source checks passed under that earlier recipe.

The user selected **option 1, Engram7422**: for a living subject, include the COMPLETE selected annual journal through its last slot, using `asOfYear` only as the quiet-selected-year fallback. Count all entries, including hidden/ineligible slots; do not derive the endpoint from filtered subject/evidence entries. This is noncalendar positioning with no future data. The exact recorded subject-death endpoint remains unchanged. Option 2 (integer cutoff with terminal-year actions as context only) was not selected. No source change is performed or authorised by this tracker-only transaction.

## H2 corrected candidate — writer and independent checks complete

Engram7422 (user7422) option 1 is implemented and H2 is closed. Parent-reported correction writer evidence on Node26.8.1: **RED seven intended failures / 50 PASS (1.36s) → GREEN 57 tests / four files PASS (1.61s)**. Nonincremental TypeScript, scoped lint and diff check PASS. New-file no-index checks exited **1 for differences**, with **no whitespace diagnostics**; this is not a whitespace FAIL. These are writer receipts, not independent validation or native approval.

Corrected source candidate accounting against historical baseline `39c58d`: **419 additions / seven deletions = 426 authored lines across seven paths**; new files are **63 + 211 lines**. The advisory 400-line threshold is naturally exceeded by necessary coverage; do not trim solely for size. Five other source hashes are unchanged from the historical table. Integration directly observed the corrected seven-path integrity:

| Path | SHA256 |
| --- | --- |
| `src/server/historical-scene.ts` | `60fe740811a43e44a2f3f800f6d4cf0617b2f002d8b4d3a0f46fc0beb93bd7d8` |
| `src/server/historical-scene.test.ts` | `6b78b841e41015466abb100de012c1b33cbbf73f748f56959d0922047ceb1459` |
| `src/contracts/life.ts` | `365a2ced0b140a9e5e93b8206f87e16591e2c886b6d016bbe692d4e25fc5b40c` |
| `src/lib/sky/presence.ts` | `cba7e98bc4e35fc91070c6dd265663834f4f6dbccb23c86ddceb46614b4fd0fb` |
| `src/lib/sky/presence.test.ts` | `38bdf6db18537095bb24b0afbf0a48ec9c64091b6792eb3f92617a78a7fde1e3` |
| `src/lib/sky/scene-model.ts` | `c2a5395b08922243123b7c59c0a2287b8e52c82567efaec6a2ebad699cd5a3b4` |
| `src/lib/sky/scene-model.test.ts` | `a88d8edefa05facc30d30ee27eef003201231d4e3c778ff98a892310c771ce60` |

## H2 corrected independent receipts — PASS; closure complete

Parent-reported checks completed with source/tracker writes frozen; this bookkeeping did not rerun tests. All seven corrected hashes above remain unchanged at HEAD `9a5e34e4738f414271109d5eaf72a0dcb8e8b21f`, directly reverified here. Own before/after manifests were stable; different enumerators are not cross-comparable.

- **Node24.20 compatibility: PASS.** 97 tests / eight files, 1.79s; TypeScript 5.9.3, ESLint 9.39.5 and whitespace PASS; 243 fresh assertions. The nonexistent `src/lib/chronicle/prose-markers.test.ts` coverage gap is RESOLVED: actual `src/lib/prose-markers.test.ts` 32 PASS (158ms), focused historical-scene 14 PASS (1.50s). Initial independent probe failed on invalid-frontier duplicate advance; the harness was corrected and final probes passed. Preserve that historical harness failure, not a product defect. Own 2,177-entry manifest SHA256 `681024016dc05d1c886a496917186fe6936758be3e0a9b4009c00978a2c4a56a` stable.
- **Node26.8 actual canonical boundary/adversarial: PASS.** 130 tests / four files, 2.03s; 16 actual canonical cases / 3,864 assertions covering prototype IDs, older/newborn actors, quiet years, future physical introduction and initial death. Prior 15 cases / 3,836 assertions were a separate run, not additive. Mistaken inspection ENOENT was not a test failure. Own 273-entry manifest SHA256 `a3171746ea46b9cb9d45c838b51bb62675bd87fe2e1519300010b7ab8b4cedae` stable.
- **Actual browser: final PASS.** Chromium 153.0.8010.12 / React 19.2.8; 139,441 assertions / 12 mounts through actual engine, `SkySvg`, `PlacePanel` and `PlayerStore`; zero requests, page errors and remaining mounts. Ephemeral verifier initially expected only one quiet actor and failed: the prior grant participant is truthfully retained. Corrected probe then passed; only the final run is PASS. Own 501-entry manifest SHA256 `f6ac1d7edaa5c96e70bbd44d642e54dd694ee61dd80b1064a221cabcdbcbbbc6` stable.

## H2 — Native and committed closure; historical H3 authorization

Parent-reported native workspace `review-6afd6c0629e7a890` is **approved and ACK BURNED**, target `5309208fcf60b970eb5332d1d7a929878b2a0d503055f2543ff3306fbcdcc761`, consumed receipt `17c379676f5d247c6deb027ffc60c15418038cf91154765257cb1b80f2ed5bc1`. Parent then locally committed the exact reviewed tree as `9a5e34e4738f414271109d5eaf72a0dcb8e8b21f`. Separate **COMMITTED `39c58d1 → 9a5e34e`** review `review-624272d90981c5c3` is **approved and ACK BURNED**, target `5ea1b538460c7d1ac0e6b042a9af8d4cee42d453eb8e7366d2a939be18c53e45`, consumed receipt `8e875574e631acdeea8b4bcd4eba00e763a111527d365d504f921f54e50cc253`. These are distinct workspace and committed-range authorities. **NEVER STATUS burned authority**, including earlier H1/P2 receipts.

Initial stale START consent expired with **no invocation, mutation or lineage**. Fresh retry created the workspace and then closed it. Historical UNASSESSABLE assessment was not approval and is superseded by the native workspace and COMMITTED closure; no current blocker remains. All corrected independent receipts and historical resolved failures remain recorded above, without rerun or full-app claims.

H1 and H2 are DONE; H3 is **IN PROGRESS**, inactive partial output only, parent-authorized on exactly the two new source/test surfaces above. User continuation consent covers future routine scoped units, not unresolved product decisions or premature whole-product closure. Parent supervises all product-code and integration workers under Engram7272; no inline product code here. UI/calendar/SSE remain **OFF**; no push, PR, build, full-suite or whole-product completion claim. E2b/E3/F and retention/product choices remain human-owned later work.

This tracker-only transition preserves HEAD `89cc7750fd73cf2ccbcd68e20b523ea82d77b86c`, all seven corrected source hashes and `.claude/`; running authored count is **13,075 including the prior assessed passive 32 lines**, excluding this uncommitted transition. It creates no native authority or commit. Parent owns any later passive-bookkeeping commit identity separately. Keep the full file mirrored in Engram7341 at `odd/narrative-historical-bridge/tasks` with repository locator and untruncated readback; leave main tracker/Engram6902 unchanged. Parent owns the authoritative root session summary `01a101ce-81e1-7608-8dd5-a3fafd9534c6`.

## H3 candidate ledger — historical pre-closure evidence

Integration observed two untracked files, **91 + 239 = 330 authored source/test lines**, excluding tracker bookkeeping; HEAD remains `89cc7750fd73cf2ccbcd68e20b523ea82d77b86c`. H1/H2 remain DONE; H3 remains IN PROGRESS.

| Path | Lines | SHA256 |
| --- | --- | --- |
| `src/server/historical-life-chronicle.ts` | 91 | `8ebe1390e75f43f0944981aa78a0b6434b2d38bdc2067125541b9090655c15fb` |
| `src/server/historical-life-chronicle.test.ts` | 239 | `39e7977c5ac3437bff2128bd44b3dd617c7508a39ed52f2b842e740ecec99b83` |

Parent-reported writer evidence: Node26.8.1 / Vitest5 / TypeScript5.9.3 / ESLint9.39.5; **RED missing module 376ms → 12 GREEN 2.95s → 15 PASS 3.66s**, then **144 tests / eight files PASS 4.28s**. Initial nonincremental TypeScript failed on optional `startYear` and readonly `.push` fixture types; both fixtures were corrected using a default and `Reflect.set`, then TypeScript PASS. Scoped lint and whitespace PASS; new-file no-index exit **1 means differences, with no diagnostics**, not a whitespace failure. These are writer reports, not independent receipts; this integration reruns no source checks.

The builder preserves template metadata/text and adds `at`, `who`, `prose`, `links` and `proseTokens` to inactive partial output; no fabricated full `Chronicle` or UI activation. Historical parent ASSESS was **UNASSESSABLE / HIGH** from the untracked-declaration error, **not approval**. The approved H4 COMMITTED range below supersedes that assessment for H4 only, not H3. Three independent checks and read-only diagnosis have now completed, as recorded below. H3's historical integration/browser blocker is now resolved by the combined checks below; native approval/consumed ACK and parent local commit remain pending, after H4 closure.

**The freeze for the three H3 checks has ended. H3 source remains frozen and unchanged throughout H4.** Each verifier retained its own stable before/after manifest; different enumerators are not cross-comparable. Preserve both H3 hashes, all seven corrected H2 hashes, HEAD and `.claude/`. Main tracker/Engram6902 remain unchanged. This tracker-only transaction performs no source/native/Git mutation, children, network, install or live DB operations; update only this tracker and its full Engram7341 mirror with repository locator and untruncated readback. It creates no independent PASS, native authority, commit or H3 closure.

## H3 independent receipts — historical integration blocker, now resolved

Parent-reported independent results after the source/tracker freeze; this passive integration does not rerun source checks. H3 data and canonical prose links passed. Read-only diagnosis identified a **pre-existing raw-ID CSS/DOM boundary**, not a historical-data admission or canon-policy defect.

- **Node24 compatibility: PASS.** 144 tests / eight files, 4.13s; TypeScript and scoped lint PASS; 12,440 assertions / four cases. Own manifest SHA256 `a557242d4bac1ea6a480f68afb3499d743caa8e5563fe5511c6779fbebd19053` stable before/after.
- **Node26 boundary/adversarial: PASS.** 160 tests / five files, 3.55s; 142,046 checks / 25 cases; zero getter hooks. Own manifest SHA256 `1b558dfcb55a8b2cd36a7eb6492143b27607170abcbce87d05646f05fd88a9b5` stable before/after.
- **Actual browser: bounded evidence, NOT overall PASS.** 271,781 assertions / 20 cases / 40 entries / 40 reel mounts / 80 clicks / 24 sky mounts; zero requests, errors and leaks in the final bounded run. The initial two runs FAILED on NUL/lone-surrogate Sky mounts with `null.querySelector` at engine line 67. The final run skipped those mounts, so its bounded successes do not establish full acceptance. Own 503-entry manifest SHA256 `a7c01a09dfef82779cca0f56eccfb1327bb8638326e3a3ee0fcc866a93245906` stable before/after.

## H4 — Lossless DOM boundary repair, prerequisite to H3 closure

User “finish all” continuation consent authorizes this routine repair; parent owns the derived worker scope and corrected its enumeration typo to **nine paths**, not a new human/product decision. Exact parent-authorized surfaces for the separate delegated H4 writer (not writable by this tracker transaction):

- `src/lib/sky/dom-coordinate.ts`
- `src/lib/sky/dom-coordinate.test.ts`
- `src/components/sky/sky-svg.tsx`
- `src/components/sky/engine/create-sky-engine.ts`
- `src/components/sky/engine/create-sky-engine.test.ts`
- `src/components/sky/engine/focus.ts`
- `src/components/sky/engine/focus.test.ts`
- `src/components/sky/engine/draw-reel.ts`
- `scripts/verify-sky-dom-identity.mjs`

`src/components/sky/engine/draw-reel.test.ts` is explicitly NOT added to this authorization. Keep one focused delegated write thread. H4 is a separate work unit with its own review/commit; parent owns native actions and terminal git. All H3 source remains unchanged during H4.

Encode exact IDs into stable, injective ASCII DOM coordinates using fixed-width UTF-16 code units. Preserve exact map keys and callback IDs unchanged. Person, trail, edge, head and bead DOM producers/query pairs must all use the same helper. Do not change URL/HTTP canon policy or expand edge-key tuples without a proven need; this is a DOM-boundary repair only.

Strict test-first acceptance for the separate H4 writer: helper coverage over all UTF-16 code units and actual offline Chromium **RED for NUL/lone-surrogate mounts before implementation → GREEN after repair**. Cover SSR/client mount, focus, click, keyboard, beads and update growth with **no skipped NUL/surrogate mounts**. Forecast **200–350 changed lines** is advisory; do not minify or trim necessary coverage. H4 cannot be DONE until applicable checks, native approval/consumed ACK and parent local commit are complete; H3 closure depends on that prerequisite and unskipped integration acceptance. No whole-product closure follows from this tracker transition.

## H4 candidate ledger — historical pre-closure evidence; combined freeze ended

Read-only integration observed **319 additions / 15 deletions = 334 authored lines across exactly nine source/test/script paths**, excluding tracker bookkeeping. Six tracked paths contribute 58 additions / 15 deletions; three new files contribute 12 + 29 + 220 = 261 additions. The **220-line actual offline-browser script** is included, not omitted from accounting. HEAD remains `89cc7750fd73cf2ccbcd68e20b523ea82d77b86c`; both H3 hashes above were directly reverified unchanged. H4's helper uses fixed-width UTF-16 coordinates across person, trail, edge, head and bead producer/query pairs; canonical IDs, map keys and callback IDs remain unchanged. Edge-key tuple collision is unproven and untouched.

| Path | SHA256 |
| --- | --- |
| `src/lib/sky/dom-coordinate.ts` | `54233b4f2c18fb9182a4391af5a39d935829a27cb1bf67a842a4ab911bb15ca0` |
| `src/lib/sky/dom-coordinate.test.ts` | `8dd23bf2f6e9f4bef197d98a741aa8a94f5610482aed38b3ad6eae8c26e2dbd3` |
| `src/components/sky/sky-svg.tsx` | `2956b623e388975c2efb4507435eb6b6d25f3f739f65dbadd95e7c34394b7f21` |
| `src/components/sky/engine/create-sky-engine.ts` | `99c07186ba2ad9d87f5622431f3efe440ae5e76db088b1a5fa030503f2d40d0a` |
| `src/components/sky/engine/create-sky-engine.test.ts` | `8c4c82e678fee9c0ef3d3ae0de332ff7ea1455cfc433fad10356fd6d23c23d11` |
| `src/components/sky/engine/focus.ts` | `198be362afda3049f49431f50b49fb92e30b4eb63f7a7d9162f1b479c8cd7efe` |
| `src/components/sky/engine/focus.test.ts` | `75a242894fa519c03d73021df82594b095bcad501a5f8bc7d6bf7db0429d8b51` |
| `src/components/sky/engine/draw-reel.ts` | `78f148a36cae1ec6fdd4f4b3c7419f06cdcdaf2f4743bdeec3a82d88ed77712a` |
| `scripts/verify-sky-dom-identity.mjs` | `2c4273a9bed0d24b37065d3222a64bbfa571987ec6238b90686fb4719978a1ac` |

Parent-reported writer evidence on **Node26.8 / Chromium153 / React19.2.8** (not rerun by this tracker integration):

1. **RED:** missing helper, plus actual-browser `null.querySelector` for client NUL and client/SSR lone-surrogate mounts; all 20 cases ran, with no skipped NUL/surrogate cases.
2. **GREEN:** 20 actual offline-browser cases / **39,680 checks**, zero requests, page errors and remaining mounts; **112 tests / eight files PASS, 3.75s**; nonincremental TypeScript, scoped lint and whitespace PASS. Coverage includes SSR/client mount, focus, click, keyboard, beads and update growth.
3. **Resolved historical harness failures:** SSR dynamic `util` loading was corrected with `createRequire`; a post-fix growth probe failed with React `removeChild`, then was corrected to hydrate and preserve the SVG. Preserve these failures as harness history, not hidden or currently failing product checks. Missing Next guide and exact-replacement unique-match errors were nonmutating.

## Combined H3 + H4 independent receipts — PASS; historical H4-only closure

**All three combined checks finished; the source/tracker freeze has ended for this bookkeeping. H4 is closed by the observed commit/native authority below; H3 is NOT closed.** Fresh unskipped browser acceptance resolves the prior H3 browser blocker; the historical bounded receipt remains NOT overall PASS for its own run. These are parent-reported independent receipts, not checks rerun by this tracker writer. No source changed after the freeze; all eleven candidate hashes above and HEAD `89cc7750fd73cf2ccbcd68e20b523ea82d77b86c` were directly reverified unchanged.

- **Node24 compatibility: PASS.** 187 tests / 12 files, 3.84s; TypeScript 5.9.3, ESLint 9.39.5 and whitespace PASS. Own manifest SHA256 `2839f047986a250541581b150bbc1cc377fcad70fa65d1a94ac220f849d767778e8` unchanged.
- **Node26 boundary/adversarial: PASS.** 203 tests / nine files, 3.83s; 25 actual canonical cases / 142,046 checks, zero getter hooks. Own ten-hash manifest unchanged (existing ledger). Helper tests verified all 65,536 UTF-16 code units. An independently authored coordinate sweep was NOT performed and is not a newly required gate in place of actual-browser acceptance. Initial verifier startup was blocked by a missing exact command and a timeout; parent commands resolved both. No tests failed in those startup attempts.
- **Actual Chromium: PASS.** Candidate script: 39,680 checks / 20 unskipped client/SSR hydration cases, zero failures, requests, errors and remaining mounts. Independent canonical H3 harness: 359,541 assertions / 20 UNSKIPPED H3 cases / 40 entries / 80 clicks / 40 reel mounts / 32 sky mounts; zero requests, errors and remaining mounts. Own full 506-entry manifest SHA256 `522005049ff1e41334b33b336b71c0211cfaaee90ffb51e72e235026c5606334` stable. Prior independent harness `Factories changed` guard exited 1; preserve that failure. Parent corrected only the ephemeral `/tmp` harness's obsolete guard, skip, raw selector and banner, then obtained fresh PASS. Corrected harness SHA256 `3ffd1dafb4fd36540a5f65f7b9bf20e6ed53f360444b3ab04f43f4fffaca38d2`. No product source changed.

Different verifier enumerations are not cross-comparable. H3's two files remain **330 authored lines**; H4's nine remain **334 authored lines**. No full-suite, build or UI activation claim is made. H1/H2 and every native/consumed-ACK authority above remain closed and unchanged; never STATUS burned authority. Parent completed **H4's nine files plus tracker**, with **no H3 files committed**, and native **COMMITTED work-unit review from `89cc775`**, as recorded below. H3's two files still require a separate later commit/native review; H4 authority is not H3 approval. Do not mark H3 DONE until its applicable closure is observed. This transaction changes only this tracker and the full existing Engram7341 topic mirror with repository locator/readback; no source writes, Git/native actions, network/provider/install, children or live DB operations. Preserve `.claude/`, main tracker/Engram6902 and unrelated files. Running authored count is now **13,509**, including the observed H4 commit below but excluding H3's uncommitted 330 lines and this passive update until committed.

## H4 — Observed local commit and native COMMITTED closure

Parent locally committed H4 as **`3bd4e2dd604db2b8fd26a33a30479c19f387e0fc`**, exact reviewed tree **`05d464656da9af674fbe5c69ffbe7f4f2654d8bd`**. Read-only integration verified HEAD/tree and the ten-path range: **410 additions / 24 deletions = 434 authored lines including tracker**; the nine source/test/script paths remain **334 authored lines**. Running authored count is **13,509 = 13,075 + 434**. H3's two untracked files remain **330 lines** with both ledger hashes unchanged; all nine H4 hashes were also directly reverified unchanged.

Parent-reported native **COMMITTED `89cc775 → 3bd4e2d`** review **`review-8d8df7b7384e2702`** is **approved and ACK BURNED**, target **`22f4ac65f4d38691ea3b431942792f5b5ea3e0b68e164a0062ed35e9d96d8002`**, consumed receipt **`8d0e2fbbae60363527d11fc787dd324c334d41d72ef02f987a356108b6c9c9cd`**. **NEVER STATUS burned authority.** Together with the existing writer/independent PASS receipts and exact-tree local commit, this closes H4 only. Historical UNASSESSABLE evidence is superseded for this H4 COMMITTED approval, not H3; no additional workspace authority is invented.

**Historical next parent action at H4 closure (now completed below):** locally commit H3's two files plus this tracker, then ASSESS/native **COMMITTED from `3bd4e2d`**, not the full branch. H3's canonical browser all-cases PASS is the latest existing receipt, not a rerun; the prior browser blocker is resolved. H3 remains IN PROGRESS until its own observed native/consumed-ACK and commit closure. No H3 or whole-product completion claim follows from H4 approval.

This passive tracker update is excluded from the running count until committed. Preserve HEAD `3bd4e2d`, all eleven H3/H4 hashes, `.claude/`, main tracker/Engram6902 and unrelated files. Update only this file and its full Engram7341 mirror with repository locator and full readback; no source/Git/native, network/install or child operations. Parent owns terminal git actions and the root session summary.

## H3 — Observed local commit and native COMMITTED closure

Parent locally committed H3 as **`6e7b57f0aff88afb42f284a23c591d274d8074e6`**, exact reviewed tree **`11ade5471d85eee15b6bd8dfa97f872efded0814`**. Read-only integration verified HEAD/tree and the three-path range: **349 additions / nine deletions = 358 authored lines including tracker**; the two source/test paths remain **330 authored lines**. Running authored count is **13,867 = 13,509 + 358**. All eleven H3/H4 ledger hashes were directly reverified unchanged and matching committed HEAD. Existing successful Node and actual unskipped-browser receipts remain retained; this passive update reruns no source checks.

Parent-reported native **COMMITTED `3bd4e2d → 6e7b57f`** review **`review-69033895ac4ece6d`** is **approved and ACK BURNED**, target **`c3e6218c7d6e06fab8e056ab144e2ad6535e9de6edcd3eab3ff988c1e2d17340`**, consumed receipt **`9daf6ec202a47e6698d8c2d3c341e8c7a7282f54dda9bea5ecbc7a5653748a08`**. **NEVER STATUS burned authority.** The prior MEDIUM assessment observed 358 authored lines under budget; parent slice-close review was performed. Assessment alone is not approval. Together with the existing writer/independent PASS receipts and exact-tree local commit, this separate COMMITTED authority closes H3. Latest reviewed committed boundary is **`6e7b57f`**; no workspace authority is invented.

**H1/H2/H3/H4 are DONE: the inactive historical bridge is complete, not the whole product.** Earlier pending-H3 statements above are historical checkpoints superseded by this closure. User continuation authorizes remaining routine scoped engineering, not consequential defaults. The next read-only, bounded E2b decision-proposal scout is parent-reported underway. E2b resource policy, E3 retention, full open-life UI and F budget remain human-owned; no invented defaults, provider calls, HTTP transport or UI activation.

This current post-review passive update is excluded from the running count until a separate parent bookkeeping commit. Preserve HEAD `6e7b57f`, all eleven source hashes, `.claude/`, main tracker/Engram6902 and unrelated files. The authorized filesystem write is this tracker only; parent owns its full Engram7341 mirror/readback, terminal git actions and root session summary. No source/Git/native, network/install or child operations occur here.

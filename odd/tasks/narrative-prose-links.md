# Narrative public prose links — ODD tasks

## Objective and authority

Implement faithful public link display and exact selection identity for every nonempty canonical JavaScript string ID before the E historical bridge (human decision Engram7257). Existing literal text and names must remain literal; no renaming, aliases, ID restrictions, dropped links, or fabricated relationships.

Parent feature: `odd/tasks/narrative-engine.md`. Worktree: `feat/narrative-engine`, starting HEAD `97a9df5a86f8c734a1f1a98da44bb40560968951`. Local work-unit commits authorized; no push/PR/merge/deployment, installs, network/providers or live DB changes. Preserve untracked `.claude/`. One writer per worktree; parallel read-only preparation has completed.

## Sequential work units

- [x] **P1 — Literal DOM rendering and exact selection identity** (closed: `c235b89cd69a2995f8560f5adc2e123c6eccd4d5`). Delegate one bounded writer: five renderer/typewriter/test paths plus a narrow design note. Existing resolved plaintext/ranges become text nodes and anchors; controller-owned WeakMap retains exact IDs. Keep caret, partial links, backward scrubbing, row seeking, keyboard exclusions and destroy behavior. Preserve legacy parser/unknown-marker behavior and intentional legacy non-controller anchor activation. Remove obsolete HTML serializer and serializer-only tests only when actual consumers no longer use it. No token-support claim in this unit. Independent checks PASS; exact workspace review approved/ACK burned and local implementation committed.
- [x] **P2 — Opt-in structured prose tokens** (closed: `02ce3f2598ecd66fe72d06ebeafa40d4783711ef`; exact workspace approved/ACK burned). Optional text/link token field on ChronicleEntry; text is literal, link ID resolves exactly through PersonLink[] with Map lookup. Resolve plaintext equal to prose; reject malformed, missing/empty IDs, unknown fields/kinds or mismatches explicitly. Absent/undefined tokens use unchanged legacy parser; present empty tokens are intentional, never fallback. Wire entryText, ranges and duration/end types. Narrow public-contract docs and tests accompany behavior. Closure receipt below; historical bridge remains pending.

## Scope and checks

P1 allowed source surfaces: `src/components/sky/engine/draw-reel.ts`, `src/components/sky/engine/draw-reel.test.ts`, `src/components/sky/engine/fake-dom.ts`, `src/lib/sky/typewriter.ts`, `src/lib/sky/typewriter.test.ts`, narrow `docs/design/narrative-engine.md`. Parent coordinates this tracker/mirror, native review and commits; this explicitly scoped tracker-only reconciliation is delegated. No worker edits outside its named allowed surface.

P2 scout-resolved surfaces: `src/contracts/life.ts`, `src/lib/prose-markers.ts`, `src/lib/prose-markers.test.ts`, `src/lib/sky/typewriter.ts`, `src/lib/sky/typewriter.test.ts`, narrow `docs/design/single-life-contract.md`. No HTTP/server producer, E UI or fixture JSON renaming changes. Preserve legacy duplicate-ID Map last-name-wins and empty display names with zero-width ranges; reject empty canonical IDs. No arbitrary-ID HTTP routing or fixture-renaming lossless claim.

Proposed resolver: `resolveEntryProse(Pick<ChronicleEntry, "prose" | "links" | "proseTokens">)` returns readonly `ProsePart` parts. New structured tokens require dense arrays and own data fields; reject unknown fields/symbols/accessors, malformed tokens and prose/resolved-plaintext mismatches with `TypeError`. Resolution is locale-independent. Absent/undefined tokens retain unchanged legacy behavior; no Proxy framework.

Parent updates UI before the first source write, then routes one bounded multi-file writer across these six surfaces, followed by THREE concurrent independent verifiers: Node24, Node26 and actual offline Chromium. Verify token text → `entryText`/reel-model → actual `createReel`, not primitives alone. Two parallel read-only scouts research original historical scene/window and E2b policy handoff; neither is a source writer. Continue product delivery without arbitrary turn stops, using supervisor/delegate blocks and at least three useful parallel activities where applicable.

The 14 prior passive metadata lines, already reviewed (`439e…`, exact ACK burned, Engram7290; no STATUS), fold into the P2 work unit. Last committed review boundary remains `2420bad6d8bce97133a5e16765f44345f1f79a6d`. This passive prerequisite has no meaningful behavior RED; structural readback and `git diff --check` only, with no source writes or implementation/verification PASS claim.

Use observed deterministic RED → GREEN → refactor. Run parser/typewriter/controller/reel-model/determinism focused tests, nonincremental typecheck, scoped ESLint and whitespace checks. Writer verification synchronous; independently verify applicable Node24/26 behavior and real offline browser/controller checks before closure. Freeze every candidate write, including trackers, before independent verification. No fake-DOM-as-browser claim.

Real browser check must execute the actual renderer/controller, not only a hand-built primitive fixture. Use installed Playwright and explicit cached Chromium, isolated context, blocked requests/service workers, no dev server or external profiles. An in-memory compiled browser test bundle is a functional test artifact, never a native review evidence substitute; do not copy source/candidate snapshots to scratch. Preserve original UTF-16 code units in names, suffixes, callback IDs, including CR/NUL and lone surrogates; include braces/marker-like strings, Unicode, prototype-key IDs, hostile markup, same-name actors, partial typing and click lifecycle.

About 400 authored lines per coherent task is advisory, not a hard stop or reason to omit tests/minify. Delivery remains existing ask-on-risk/feature-branch-chain; no oversized multi-area bridge exception. Native review only under user-owned switch; exact provider consent/ACK, no STATUS after burned authority. Latest reviewed committed boundary `2420bad6d8bce97133a5e16765f44345f1f79a6d`; prior13 passive closure +357 P1 +62 passive closure authored lines are covered by the closed range (Engram7287).

## Observed preparation evidence

- Primary grammar scout `must7kpz-10-6uuq`: a reserved marker prefix cannot represent all canonical IDs safely. Opt-in structured tokens preserve the legacy grammar. HTML escaping alone cannot guarantee literal JS-string fidelity.
- Split challenge `mustcl3y-11-59vw`: DOM-first has independently useful behavior and avoids a broken intermediate token contract. No disconnected helper or temporary activation flag.
- Baseline verifier `mustcxyh-12-0un4`: existing five files/38 tests passed Node26.8.1 (526ms) and cached Node24.20.0 (515ms); existing Vite warning only. HEAD/status unchanged, `.claude/` preserved.
- Same verifier's offline Chromium153.0.8010.12 primitive check: 108 assertions/13 nonempty IDs passed exact UTF-16 text nodes and direct/bubbling WeakMap callbacks, zero context requests. Browser observed innerHTML CR→LF and NUL removal. Owned probe cleaned. This proves primitives only, not candidate rendering. Installed Playwright and cached `chromium-1243` executable worked without downloads.

## Non-goals and remaining boundaries

No E UI/calendar activation, historical bridge, human-history support, HTTP route changes, persistence, director or product-policy defaults. Summary/epitaph remains legacy; no summary-token promise. Person-sheet `encodeURIComponent` still rejects lone surrogates: this feature targets public rendering/exact selection callback, not universal arbitrary-ID HTTP transport. E scene appearance semantics remain human-owned and unresolved (Engram7266); do not silently clamp introduction to protagonist death or backdate older arrivals.

## P1 writer evidence — verified implementation

Foreground worker `mustt75f-15-p97q` completed six authorized paths: 242 insertions/56 deletions (298 authored source/test/design lines). Observed 15 new controller regressions RED/38 existing PASS (503ms) → GREEN49 (537ms) → final52 tests/five files PASS (464ms) on Node26.8.1. RED reflects absent literal node/anchor rendering in the old fake-DOM path, not real browser normalization proof. Nonincremental TypeScript PASS5.115s, five-path ESLint PASS1.388s and whitespace PASS. One earlier no-this-alias lint failure was corrected. HEAD97a9df5 unchanged; `.claude/` and trackers preserved. This writer evidence alone claims no token implementation, browser/controller PASS, independent Node24 PASS or native receipt; independent results follow below.

Candidate SHA256: draw-reel.ts `e55a9d14c96a53318733643d087fc53c8ee3644b5adf33c2745d76ce6488545d`; draw-reel.test.ts `5600239e5cad26946b200ee66728c78050c2bfab12d58f303ea3080a0565586e`; fake-dom.ts `c39edcb6a01723231bc88bf53e8e78aa4377a734b1d2a048d79d8cf968f85a52`; typewriter.ts `c9c5486a29f46742ea5f480488d9847b38ff87762dd26be8247c78faf2baf56f`; typewriter.test.ts `3b62c7c471b4a235a612802379f70dea0b6d9440c83080eb1974f631eb93bfcb`; design `5e431f432b357ceb960373fc322a501edcdaf00ca379236ca3a08075e38bc803`.

## Historical pre-review ASSESS — not review authority

Parent observed ASSESS: unassessable because of undeclared untracked files; RDD on, outcome unknown, large runtime writer and high fallback. `independentVerifier=true` is required. No START or authority mutation occurred; no native receipt or verification PASS is implied.

## Observed independent verification — three concurrent checks PASS

All three read-only verifiers returned PASS under the candidate/task freeze. Only this named tracker is unfrozen for final bookkeeping; source implementation remains frozen.

1. **Node24.20.0** (`musue2he-17-j9hi`): focused parser/typewriter/controller/reel-model/determinism suite PASS52 tests/five files (498ms), nonincremental TypeScript PASS5.476s, scoped ESLint PASS1.719s and whitespace PASS. Fresh actual-module fake-DOM probes PASS199 assertions (174ms), independent of writer evidence.
2. **Node26.8.1** (`musue2he-18-k565`): same focused suite PASS52 tests/five files (610ms), nonincremental TypeScript PASS5.698s, scoped ESLint PASS1.649s and whitespace PASS. Fresh actual-module probes PASS9313 assertions across 1064 UTF-16 prefixes and 14 nonempty IDs (206ms).
3. **Offline Chromium153.0.8010.12/controller** (`musue2he-19-s106`): installed Playwright, cached `chromium-1243` and installed transitive esbuild0.28.2 through Vitest executed actual `createReel` in memory: PASS13 controllers/494 assertions/13 unsubscribes. Literal UTF-16 including CR/NUL, lone surrogates and hostile markup produced no injected nodes; partial/full/backward scrubbing, caret, exact IDs despite dataset tampering, direct/bubbling clicks, row keyboard and destroy passed. Zero observed context requests. No scratch source/bundle copies or installs; functional compilation is not native review evidence.

Each verifier's own before/after snapshots preserved all six candidate hashes above, HEAD97a9df5/status and all three task files. Browser also observed 308 tracked files stable. `.claude/` was stable within each verifier's own oracle: Node24 1893 entries/c1dcdd02 (hashes symlink targets; initial read-only EISDIR enumeration error corrected), Node26 1863 regular files/03772482, browser 1893 bounded files/df646e32. These differing oracles are not cross-comparable and do not establish exhaustive preservation. Full verifier facts: Engram7274.

## P1 closure and next boundary

Native workspace `review-2441c5b98457bf1b` approved/exact ACK burned (Engram7276): target `sha256:98e0f06b1e5c23cb8ed6aa0e40a5300e6eaf5a26b948f8b7e9691e275238063c`, consumed `sha256:560425eeb0f96c3fd7c76b5fe95a54fdda70c35ca845925a05cc1d3a77b83a8b`. Never STATUS after burned authority. This workspace receipt is not committed-range approval.

Parent committed the exact seven-path candidate as `c235b89cd69a2995f8560f5adc2e123c6eccd4d5`, tree `7bdc1b9bf85ae43c192c0953ce03090c93155887`, Conventional Commit `fix(sky): preserve literal reel text and selection identity`. Actual numstat: 301 additions/56 deletions =357 authored lines (298 source/test/design +59 new tracker). All six candidate hashes and the observed 52-test TDD/independent evidence above remain unchanged.

Rollback boundary: renderer, fake-DOM/controller tests, typewriter/tests and the narrow design note; no structured tokens, E activation or arbitrary-ID HTTP routing. This passive tracker/full Engram7267 reconciliation changes no source behavior. P1 is closed; P2 is now IN PROGRESS (unchecked), with source writing pending parent UI update. Parent committed passive closure `2420bad6d8bce97133a5e16765f44345f1f79a6d` (33 additions/29 deletions =62 authored). Running total11,922 =11,860 through P1 +62. Committed range `0d55bdd`→`2420bad` is410 net vs432 separately authored (13+357+62) because bookkeeping overlaps; latest reviewed committed boundary advances to2420bad. New metadata authored count is deferred to the next slice; no self-referencing commit hash. No P2 token/grammar implementation, arbitrary-ID HTTP transport, full-app validation or E activation is claimed.

Committed-range `review-27dc1dd091f88490` approved/exact ACK burned (Engram7287): target `sha256:9b23c51e1014950e75473cc89bb0b11f6b98b911f083e6c01e8eca1c15136e22`, consumed `sha256:fbc87717e523c962d41a9b89fe684a8e8fc81cc10ad38427528c32a3d36c31b0`. Never STATUS after burn. Original workspace receipt and all functional checks/hashes above remain intact. Full main6902 and prose7267 saves/readbacks succeeded; the earlier one-byte RAW mirror comparison remains CHECK pending only, not update pending or a functional blocker.

## P2 writer evidence and verification freeze

Parent-reported final writer result: six scoped source/test/design paths, 246 additions/11 deletions =257 authored lines. Node26.8.1 observed RED5 failures/73 passes across five files (499ms: missing resolver and tokens ignored as plaintext) → GREEN78 (468ms) → final78 PASS (527ms); nonincremental TypeScript PASS5.569s, scoped ESLint PASS2.030s and whitespace PASS. Legacy parser remains exactly unchanged; inherited new-token opt-in/accessors reject without getter execution. Duplicate-ID Map last-name-wins and empty display names/zero-length ranges remain preserved. Docs are narrow; no HTTP, fixture, production-producer or E UI changes. This records writer self-verification, not independent or browser PASS.

P2 candidate SHA256:
- `src/contracts/life.ts`: `984cccde36297e74c8c0d036f9907a05ac71e7cc205567949f25732f1783d8da`
- `src/lib/prose-markers.ts`: `68b03805ee7647efeb96c805173935bd7054ff4a2f42cbfe1ca50402a35d3b14`
- `src/lib/prose-markers.test.ts`: `8a4178f22e8c4a894f8d52ba0506725be8ebd61800893e6b5db4b8b74c464cf1`
- `src/lib/sky/typewriter.ts`: `fb5b8adbea1b0bbdcb9df8d040b0b40a8dd5f076cb0b6493de45211c32e2b880`
- `src/lib/sky/typewriter.test.ts`: `23a1e571f4a4ce2b70f66abe67677cc669d9df5c0c104a56f06e970612453b80`
- `docs/design/single-life-contract.md`: `5c7d903016020f4437aba83d1489eb854d1f1530da5a5fa33f17bce0de4db84a`

Writer before/after tracker hashes were stable: main `8183f4bf3bac65c03ea2b6c13f23f6ea7a2b44ca45697326d89c03ea0cc5e247`, prose `8f8a9c64cace2e3cc19551cee113971f770d97fea833d6e0c23eeb6c1d0f023e`; `.claude/` untouched within writer scope, not an exhaustive measurement claim. This reconciliation changes only the prose tracker/mirror; main6902 remains untouched.

Latest parent-observed native ASSESS after the writer: medium, 279 net lines/eight paths, under budget, reviewDue=false; large runtime writer/native outcome unknown. Writer self-verification stands and a separate verifier is not required by that assessment. The user's THREE concurrent independent spot-checks and actual-browser functional requirement still apply; do not import P1's historical mandatory-high fallback into P2. No P2 START, receipt or commit yet. HEAD/reviewed committed boundary remains `2420bad6d8bce97133a5e16765f44345f1f79a6d`; the 14 reviewed passive metadata lines (`439e…`, Engram7290, exact ACK burned) remain folded into P2.

## P2 independent verification — three concurrent checks PASS

Parent-recorded results (full independent facts: Engram7326): Node24.20.0 PASS78 tests/five files (487ms), typecheck5.281s/lint1.574s, plus262199 assertions/45 expected TypeErrors (977ms), all65536 UTF-16 code units and zero hooks; Node26.8.1 PASS78/five files (548ms), typecheck5.330s/lint1.279s, plus664017 assertions/29 rejections (1871ms), all65536 units/13 fake-DOM controllers/988 prefixes/zero hooks. Actual offline Chromium153.0.8010.12 passed JSON → resolver → `entryText` → `reelEntries` → actual `createReel`:1298 assertions/28 controllers and unsubscribes/23 boundary IDs/57 rejections/19 cases, zero context requests. Scoped ASCII, braces, CR/NUL/surrogates, prototype IDs, last-name-wins, empty names, offsets, tampering, caret, backwards scrubbing and destroy passed. Each verifier preserved six P2 hashes, all three tasks, HEAD2420bad/status; browser observed309 tracked files stable. Each own bounded `.claude/` before/after manifest was unchanged:1863 regular files+30 symlinks versus1893 aggregate entries are different oracles, not cross-comparable or exhaustive proof. All compilation/probes were in-memory TypeScript/esbuild/Playwright; no installs or scratch cleanup needed. Vite warning was nonfailure. No HTTP/fixture/producer, whole-app or E UI validation claim.

## P2 closure and next human-owned decision

P2 closed at `02ce3f2598ecd66fe72d06ebeafa40d4783711ef`, exact reviewed tree `aa2beee1a55f042711f104829eedf8ed3b16eb7c`: eight paths,283 additions/18 deletions =301 authored (257 source/test/docs +44 metadata). All six hashes and writer/three independent checks above remain intact; full receipt Engram7329, independent evidence7326.
Native workspace `review-cbf8a062a6b2f9ca` approved/exact ACK burned: target `sha256:750dd0da2e7373cd03c8d5614831c01ed82bbcb28d5cfd1a0d2e329ffac4b7d7`, consumed `sha256:ebba1b44d1cd5affb6083a36245dbd5ab701bda3492f1cb9d54d7d64b0787bf3`. Never STATUS after burn; workspace approval is not committed-range authority.
Postcommit ASSESS:301/medium/under_budget/reviewDue=false/consumed=false; small fallback→high independent check satisfied by all three verified unchanged source candidates. Committed review deferred to next slice, not consumed; latest reviewed committed boundary remains `2420bad6d8bce97133a5e16765f44345f1f79a6d`. Running count12,223 =11,922 +301; this passive metadata is deferred to next slice.
Next real decision (parent asks, then waits): should the historical sky cover the subject's life with outside context accessible as evidence (recommended), recorded history through the selected frontier, or new explicit context markers? Original handoff/recent read and scout7266 do not define scene appearance/window: exact `asOfYear` is an evidence cutoff, not an opening. No choice or new policy is inferred.
This decision blocks the immediate historical bridge, not completed P2; continue full-product delivery after the choice. No E UI activation, full E4/whole-product closure, raw-data/untrusted-API assumption or arbitrary-ID route/transport claim. Parent owns the question and passive commit; this reconciliation changes only two trackers/full mirrors. Passive bookkeeping has no meaningful behavior RED; structural readback/whitespace only. Earlier RAW terminal-LF comparison is not a functional blocker or new investigation.

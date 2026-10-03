# Narrative public prose links — ODD tasks

## Objective and authority

Implement faithful public link display and exact selection identity for every nonempty canonical JavaScript string ID before the E historical bridge (human decision Engram7257). Existing literal text and names must remain literal; no renaming, aliases, ID restrictions, dropped links, or fabricated relationships.

Parent feature: `odd/tasks/narrative-engine.md`. Worktree: `feat/narrative-engine`, starting HEAD `97a9df5a86f8c734a1f1a98da44bb40560968951`. Local work-unit commits authorized; no push/PR/merge/deployment, installs, network/providers or live DB changes. Preserve untracked `.claude/`. One writer per worktree; parallel read-only preparation has completed.

## Sequential work units

- [ ] **P1 — Literal DOM rendering and exact selection identity** (in progress). Delegate one bounded writer: five renderer/typewriter/test paths plus a narrow design note. Existing resolved plaintext/ranges become text nodes and anchors; controller-owned WeakMap retains exact IDs. Keep caret, partial links, backward scrubbing, row seeking, keyboard exclusions and destroy behavior. Preserve legacy parser/unknown-marker behavior and intentional legacy non-controller anchor activation. Remove obsolete HTML serializer and serializer-only tests only when actual consumers no longer use it. No token-support claim in this unit. Independent checks PASS; native review and local commit pending.
- [ ] **P2 — Opt-in structured prose tokens** (pending; depends on P1 closure). Optional text/link token field on ChronicleEntry; text is literal, link ID resolves exactly through PersonLink[] with Map lookup. Resolve plaintext equal to prose; reject malformed, missing/empty IDs, unknown fields/kinds or mismatches explicitly. Absent/undefined tokens use unchanged legacy parser; present empty tokens are intentional, never fallback. Wire entryText, ranges and duration/end types. Narrow public-contract docs and tests accompany behavior. Commit and independent/native checks pending.

## Scope and checks

P1 allowed source surfaces: `src/components/sky/engine/draw-reel.ts`, `src/components/sky/engine/draw-reel.test.ts`, `src/components/sky/engine/fake-dom.ts`, `src/lib/sky/typewriter.ts`, `src/lib/sky/typewriter.test.ts`, narrow `docs/design/narrative-engine.md`. Parent coordinates this tracker/mirror, native review and commits; this explicitly scoped tracker-only reconciliation is delegated. No worker edits outside its named allowed surface.

P2 prospective surfaces: `src/contracts/life.ts`, `src/lib/prose-markers.ts`, `src/lib/prose-markers.test.ts`, `src/lib/sky/typewriter.ts`, `src/lib/sky/typewriter.test.ts`, narrow `docs/design/single-life-contract.md`. Reconcile scope before delegation.

Use observed deterministic RED → GREEN → refactor. Run parser/typewriter/controller/reel-model/determinism focused tests, nonincremental typecheck, scoped ESLint and whitespace checks. Writer verification synchronous; independently verify applicable Node24/26 behavior and real offline browser/controller checks before closure. Freeze every candidate write, including trackers, before independent verification. No fake-DOM-as-browser claim.

Real browser check must execute the actual renderer/controller, not only a hand-built primitive fixture. Use installed Playwright and explicit cached Chromium, isolated context, blocked requests/service workers, no dev server or external profiles. An in-memory compiled browser test bundle is a functional test artifact, never a native review evidence substitute; do not copy source/candidate snapshots to scratch. Preserve original UTF-16 code units in names, suffixes, callback IDs, including CR/NUL and lone surrogates; include braces/marker-like strings, Unicode, prototype-key IDs, hostile markup, same-name actors, partial typing and click lifecycle.

About 400 authored lines per coherent task is advisory, not a hard stop or reason to omit tests/minify. Delivery remains existing ask-on-risk/feature-branch-chain; no oversized multi-area bridge exception. Native review only under user-owned switch; exact provider consent/ACK, no STATUS after burned authority. Latest reviewed committed boundary `0d55bdd674aecfb56a2aa3c756b01dd92c6beee2`; subsequent 13 passive closure lines belong to the next slice.

## Observed preparation evidence

- Primary grammar scout `must7kpz-10-6uuq`: a reserved marker prefix cannot represent all canonical IDs safely. Opt-in structured tokens preserve the legacy grammar. HTML escaping alone cannot guarantee literal JS-string fidelity.
- Split challenge `mustcl3y-11-59vw`: DOM-first has independently useful behavior and avoids a broken intermediate token contract. No disconnected helper or temporary activation flag.
- Baseline verifier `mustcxyh-12-0un4`: existing five files/38 tests passed Node26.8.1 (526ms) and cached Node24.20.0 (515ms); existing Vite warning only. HEAD/status unchanged, `.claude/` preserved.
- Same verifier's offline Chromium153.0.8010.12 primitive check: 108 assertions/13 nonempty IDs passed exact UTF-16 text nodes and direct/bubbling WeakMap callbacks, zero context requests. Browser observed innerHTML CR→LF and NUL removal. Owned probe cleaned. This proves primitives only, not candidate rendering. Installed Playwright and cached `chromium-1243` executable worked without downloads.

## Non-goals and remaining boundaries

No E UI/calendar activation, historical bridge, human-history support, HTTP route changes, persistence, director or product-policy defaults. Summary/epitaph remains legacy; no summary-token promise. Person-sheet `encodeURIComponent` still rejects lone surrogates: this feature targets public rendering/exact selection callback, not universal arbitrary-ID HTTP transport. E scene appearance semantics remain human-owned and unresolved (Engram7266); do not silently clamp introduction to protagonist death or backdate older arrivals.

## P1 writer evidence — candidate not closed

Foreground worker completed six authorized paths: 242 insertions/56 deletions (298 authored source/test/design lines). Observed 15 new controller regressions RED/38 existing PASS (503ms) → GREEN49 (537ms) → final52 tests/five files PASS (464ms) on Node26.8.1. RED reflects absent literal node/anchor rendering in the old fake-DOM path, not real browser normalization proof. Nonincremental TypeScript PASS5.115s, five-path ESLint PASS1.388s and whitespace PASS. One earlier no-this-alias lint failure was corrected. HEAD97a9df5 unchanged; `.claude/` and trackers preserved. This writer evidence alone claims no token implementation, browser/controller PASS, independent Node24 PASS or native receipt; independent results follow below.

Candidate SHA256: draw-reel.ts `e55a9d14c96a53318733643d087fc53c8ee3644b5adf33c2745d76ce6488545d`; draw-reel.test.ts `5600239e5cad26946b200ee66728c78050c2bfab12d58f303ea3080a0565586e`; fake-dom.ts `c39edcb6a01723231bc88bf53e8e78aa4377a734b1d2a048d79d8cf968f85a52`; typewriter.ts `c9c5486a29f46742ea5f480488d9847b38ff87762dd26be8247c78faf2baf56f`; typewriter.test.ts `3b62c7c471b4a235a612802379f70dea0b6d9440c83080eb1974f631eb93bfcb`; design `5e431f432b357ceb960373fc322a501edcdaf00ca379236ca3a08075e38bc803`.

## Native ASSESS — not review authority

Parent observed ASSESS: unassessable because of undeclared untracked files; RDD on, outcome unknown, large runtime writer and high fallback. `independentVerifier=true` is required. No START or authority mutation occurred; no native receipt or verification PASS is implied.

## Observed independent verification — three concurrent checks PASS

All three read-only verifiers returned PASS under the candidate/task freeze. Only this named tracker is unfrozen for final bookkeeping; source implementation remains frozen.

1. **Node24.20.0:** focused parser/typewriter/controller/reel-model/determinism suite PASS52 tests/five files (498ms), nonincremental TypeScript PASS5.476s, scoped ESLint PASS1.719s and whitespace PASS. Fresh actual-module fake-DOM probes PASS199 assertions (174ms), independent of writer evidence.
2. **Node26.8.1:** same focused suite PASS52 tests/five files (610ms), nonincremental TypeScript PASS5.698s, scoped ESLint PASS1.649s and whitespace PASS. Fresh actual-module probes PASS9313 assertions across 1064 UTF-16 prefixes and 14 nonempty IDs (206ms).
3. **Offline Chromium153.0.8010.12/controller:** installed Playwright, cached `chromium-1243` and installed transitive esbuild0.28.2 through Vitest executed actual `createReel` in memory: PASS13 controllers/494 assertions/13 unsubscribes. Literal UTF-16 including CR/NUL, lone surrogates and hostile markup produced no injected nodes; partial/full/backward scrubbing, caret, exact IDs despite dataset tampering, direct/bubbling clicks, row keyboard and destroy passed. Zero observed context requests. No scratch source/bundle copies or installs; functional compilation is not native review evidence.

Each verifier's own before/after snapshots preserved all six candidate hashes above, HEAD97a9df5/status and all three task files. Browser also observed 308 tracked files stable. `.claude/` was stable within each verifier's own oracle: Node24 1893 entries/c1dcdd02 (hashes symlink targets; initial read-only EISDIR enumeration error corrected), Node26 1863 regular files/03772482, browser 1893 bounded files/df646e32. These differing oracles are not cross-comparable and do not establish exhaustive preservation. Full verifier facts: Engram7274.

## Next step

Parent native review under the existing user-owned authority protocol, then local P1 work-unit commit, remain pending. Native START has not occurred and no receipt is claimed. Keep source implementation frozen; this tracker/full Engram7267 mirror reconciliation is bookkeeping only. P1 stays unchecked/in progress until native review and local commit; P2 stays pending and starts only after P1 closes. No P2 token/grammar implementation, arbitrary-ID HTTP transport, full-app validation or E activation is claimed.

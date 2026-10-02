# Narrative engine — ODD tasks

## Contract
Implement `docs/design/narrative-engine.md`: deterministic model-free reality, persistent causes, opportunity-only director, read-only narrative selection. Hidden activity is selection material, not displayed-card quotas. User authorized stepwise implementation and local commits; no push, PR, merge or deployment.

Branch `feat/narrative-engine`, original main `d5d9ad5`, current boundary `62e73d803836a552a03eff50d0db2e1beb47ab73`. Preserve pre-existing `.claude/`. One writer, independent readers/verifiers may run concurrently. English artifacts/Spanish conversation. Observed RED → GREEN for applicable deterministic behavior. Detailed evidence is in commits, design and Engram observations6961/6962; this file and full mirror6902 track current work.

## Closed units

### A — Replay
- [x] Implement strict versioned replay and independent validation.

Design `0acd452626203f596f71817a13980bb541d25032`; A `927c346094091e0b11b2bd3dd2159b70e004b0b2`. Complete initial people/events/effective options/registry order, strict canonical SHA256. No production/kernel/storage/forks or arbitrary historical-override changes. Independent bond-coercion/accessor defects:7RED→44GREEN;44PASS Node24/26,type/lint PASS. Earlier simulator timeout120s then77PASS/136.23s. Native `review-27ef7f8639835ce6` approved/acknowledged. A-v1 tuple/projection/rules remain frozen.

### A-baseline — Corpus
- [x] Measure actual paired replay evidence.

Commit `b68305478e899b64d788dca6f2ae9992b3b7442f`,357+/44-. Stdout-only CLI/tests; RED→5GREEN, combined49 independently PASS Node24/26,type/lint/whitespace. Native `review-8465a3307a368533` approved/acknowledged.

Four seeds1327–1362/six founders/Alice-f, initial population11; eight independent worlds/replays match. Reached1327/1351/1328/1349; generated1/124/4/94events,13/594/37/491decisions,7/212/15/186calls; no fallback. Two early deaths, none cap;1326checkpoint excluded from simulated years. Largest snapshots Node26:5,661,675raw/686,099gzip6/55,182Brotli5; Node24gzip686,079. Canonical/raw counts match these four cases. Incorrect gzip-equality verifier assertion corrected without source changes. No universal portability/p95/peak heap/scaling claim.

### B — Atomic favor
- [x] Implement and verify standalone conserved grant/effect replay.

Commit `62e73d803836a552a03eff50d0db2e1beb47ab73`,577+/26-, six reviewed files. `effects.ts`245/tests233, obligations30/tests13, design+27. Distinct `favor-b1` state/event/reducer; existing Person identity/liveness/location authority, one obligations/ties collection, no legacy schema/axes/kinship changes or obligation mirrors.

Explicit safe-integer nonnegative grain; grant1 opens objective HELP debt, not automatic grain repayment. Directed trust[-100,100]/resentment[0,100], legacy strength/bond unchanged. Source-linked supplied subjective appraisals may disagree, no automatic gratitude or objective-motive inference. Immutable full-batch staging; strict identities/versions/effects/actors/origins, duplicate retries, complete-prefix checkpoint reconstruction, earlier-position/year causes. Reject missing/self/future/cyclic causes; same-year dead/absent actors; legacy fallback uses pure ensureLifeState. No market/currency/UI/typed fear.

Writer43focused/92combinedPASS; independent92PASS Node24/26 but P2 custom-array hooks reproduced (key.toJSON before rejection; empty replay.iterator injected grant). Correction8RED/44PASS→52GREEN,9regressions. Arrays require exact Array.prototype before traversal; primitives validate before identity. Independent `murcgeuy-g-rw5w`:101PASS Node24/26,type/lint/whitespace; original/nested hooks reject with0executions, ordinary arrays/null-prototype records/JSON/empty checkpoints PASS. Prototype-preservation verifier assertion corrected as harness assumption. JSON equality is data equality.

Parent hashes matched effects `c7c114a045124ba35dca04fbf4914aca1aef64184dd61868762ee81d2ec786c6`, tests `5e3fb6962453ca64b60d3ba52d8610a88f4761ba28b8e7aae2fefc766d66c82f`. Native `review-685fd5bf5a7048de`, medium603diff/reliability approved and acknowledged: burned target779dfd234a045b306df93c99ab4afda76f23f8996b4ce654f4b480ed331e98a5/revision77fdc774f244926ab621995df2d0c51f1107e60148aed370ed358ec0ffd4ab1c. Commit poststatus only `.claude/`.548source/test/design additions exceed advisory280–420 but retain coherent grant/replay behavior. No authenticated provenance/scaling/Proxy/global-monkeypatch guarantees.

## Current and pending units

### C1 — Atomic help response
- [ ] Implement request/response and obligation-sensitive policy.

In progress; explorer `murcn0qj-h-wnwc` completed mapping, writer `murcxzrf-i-72w7` returned implementation. Independent verifier `murde09e-j-b4pd` running; native review/commit pending. Standalone demonstration before production D/E; C1 alone does not close C. Explicit C factory/state/events/reducer, e.g. `favor-c1`, shared narrow machinery; retain B admission/replay unchanged, reject mixed versions/no silent upgrade. One Person registry/obligations/ties collection. Frontier-valid fixtures: final persisted lifeState is not an as-of projection.

Grant1336→request1337+→response, strictly earlier causes/source origins. Help consumes1explicit abstract assistance-capacity unit, not grain repayment; explicit safe-integer current need, no implicit regeneration. Alive/present parties, matching open debt/capacity/need required; ineligibility is not refusal. Objective open→fulfilled/broken; creditor-directed actual bounded trust delta at most±5, refusal resentment at most+5. No automatic gratitude/typed fear. Evidence records ordered options, validated consumed factors/normalized distribution/draw; revalidate response frontier, reject stale evidence. Counterfactual debt masking is pure policy, not forged checkpoint.

Calibrated-later engineering default, not historical claim: p(help)=clamp(.10,.90,.40+.20*debt+(altruism−50)/500−(anxiety−50)/1000−wealthPreference/500+trust/1000−resentment/1000), mapped to actual existing fields. Neutral debt salience .60 versus .40, both help/refuse possible. Need/resource semantics explicitly documented. No large annual-rules rewrite.

Writer evidence: scoped568+/41- (609changed), no scheduler/production expansion. RED28failures/52PASS plus missing-policy suite;97initial GREEN→118focused final PASS. Combined178PASS (C/B/A+RNG) Node26.8.1, typecheck PASS after two readonly fixture assignment fixes, exact-six-file ESLint/whitespace PASS. Source hashes effects94c7eaf2e27a52c441a649c4c8a1121a1327178e9c1f9020934023bb40e3421f/tests48aa0a0269f3030360006585da1d3289c443cd42673252f9069217a891920310. Existing wealth preference confirmed mind.values.wealth; policy debtor→creditor, effects creditor→debtor. Explicit-noise selection/response identity excludes noise/prefix length; seeded draws deferred C2. ASSESS unassessable undeclared untracked scope mandates independent verifier; Node24/native review/commit pending. Historical RED is writer evidence, not independent rerun.

Allowed C1 surfaces: effects.ts/test, obligations.ts/test, new favor-policy.ts/test, concise design section; tracker parent-owned. All under src/domain except design. Types/mind/life-state/rng/events/decision-id/simulate/replay/production/UI/storage/deps read-only. RED tests: both outcomes, meaningful debt influence, invalid/dead/away/missing/exhausted/closed atomic rejection, strict imported effects/causes/evidence/duplicates, JSON replay and unchanged prefix/factors after suffix. Focused+C/B/A+RNG tests, Node24/26 independent verification, type/lint/whitespace/native approval before local commit.

### C2 — Multiple opportunities
- [ ] Schedule bounded annual requests and revalidate conflicts.

Pending C1. New scheduler.ts/test only plus narrowly derived integration surfaces. Up to2opportunities/creditor/year, independent activation .25/slot, quiet outcomes; no production annual hazards/providers called. Canonical tuple rule/ordered-parties/year/slot/purpose keys exclude log position/override transport identity. Stable candidate ordering, post-commit revalidation; no double capacity use/closure. Tests multiple/zero requests, conflicts, repeated seeds/JSON restoration/reversed candidate order, unrelated draws/semantic IDs unchanged (positions may shift). This proves isolation, not production integration. Combined C exceeds advisory400lines: split behavior, never tests/docs or compressed code.

### D — Persistence/forks
- [ ] Persist provenance and event-decision prefixes.
Pending A/C; explicit migration/versioning, cold-load equality, stable prefix IDs/inherited overrides, no fabricated canon. Storage/suffix gate first.

### E — Selection/production
- [ ] Integrate live/final selection, model-free canon and annual SSE.
Pending C/D; no hindsight leakage, causal context, canonical model removal including initialization, quiet progress/cancel/completed persistence. Compression/editability/time gate first.

### F — Director/calibration
- [ ] Add bounded deterministic opportunity weights and measured corpus comparison.
Pending C/E; clamp/cooldown/no-op, no outcome/eligibility authority/drama quotas. Runtime/storage/consequence/variation budgets first.

## Checks and delivery boundaries
Host Node26.8.1/V8 14.6.202.34-node.28; cached read-only/network-free Node24.21.0/V8 13.6.233.17-node.53. Vitest ephemeral token cache needed; host token predated work. ASSESS unassessable untracked scope required independent verifier. Explicit inspect selected four B files, excluding `.claude/`. Known Vite warning; historical RED writer evidence. Full suite/build/browser/corpus CLI not rerun for standalone B; integration/performance pending.

Passive tracker approvals `review-a5fb3a8372307f2b`, `review-f227fcad2e998866`(c95ace86…), `review-7b2f3b76f21c3455`(d3e7d6…) do not cover new code. Completion metadata uncommitted until next coherent unit. Update file/full Engram mirror6902/topic odd/narrative-engine/tasks/UI on transitions. Local commits authorized; publishing stays human-controlled. Optional LLM prose/resumability later scope.

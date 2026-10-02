# Narrative engine — ODD tasks

## Authority and invariants
User authorized stepwise implementation and local work-unit commits on `feat/narrative-engine`; no push/PR/merge/deploy. Original main `d5d9ad5`; current boundary `9de9631970dbdf06df8ed196b1995ec82ba95ca2`. Preserve pre-existing `.claude/`. Single writer; independent read-only agents may run concurrently. English artifacts/Spanish conversation. Applicable behavior uses observed RED → GREEN; independent/native review before commit.

Source contract: `docs/design/narrative-engine.md`; handoff `/home/tanisjam/Downloads/lifelines_narrative_engine_handoff.md`. Deterministic model-free canon, persistent causes, opportunity-only director, read-only selection. Hidden activity is material, not a displayed-card quota. Frozen A-v1 behavior remains unchanged; B/C prototypes are explicit distinct versions. No duplicated people/obligation/tie worlds. Final persisted Person/lifeState is not an as-of projection; use frontier-valid inputs.

This is the full current task document, mirrored in Engram6902/topic `odd/narrative-engine/tasks`. Detailed closed-unit evidence is retained in commits/design and observations6961–6967, not repeated here. Update document/mirror/UI on transitions. Local delivery remains separately authorized; review does not authorize publishing.

## Closed work units

### A — Deterministic replay
- [x] Implement standalone strict replay.
Design `0acd452626203f596f71817a13980bb541d25032`; A `927c346094091e0b11b2bd3dd2159b70e004b0b2`. Complete initial people/events/options/registry order, strict canonical SHA256, independent replay; no production/kernel/storage/forks or arbitrary historical overrides. Independent bond/accessor defects:7RED→44GREEN;44PASS Node24/26/type/lint. Earlier simulator120s timeout then77PASS/136.23s. Native `review-27ef7f8639835ce6` approved/acknowledged.

### A-baseline — Actual corpus
- [x] Measure reproducible paired runs.
Commit `b68305478e899b64d788dca6f2ae9992b3b7442f`,357+/44-. Stdout-only CLI: RED→5GREEN, combined49PASS Node24/26/type/lint/whitespace. Four seeds/eight worlds+replays match canonical/raw counts;1327–1362/six founders/Alice-f, initial11people. Reached1327/1351/1328/1349, events1/124/4/94; two early deaths/none cap/no hazard fallback. Largest snapshots Node26:5,661,675raw/686,099gzip6/55,182Brotli5; Node24gzip686,079. Incorrect gzip-equality verifier assumption corrected without code change. No general portability/p95/peak heap/scaling claim. Native `review-8465a3307a368533` consumed.

### B — Atomic grant and obligation
- [x] Implement conserved grant/effect replay.
Commit `62e73d803836a552a03eff50d0db2e1beb47ab73`,577+/26-. `favor-b1`, explicit safe-integer grain1 grant/open HELP debt, directed bounded supplemental ties, separate source-linked appraisals; no inferred wealth/gratitude/repayment. Immutable batch/prefix reconstruction/strict causal and own-data admission. Array-hook defect independently reproduced despite92green; correction8RED/44PASS→52GREEN,9regressions. Independent101PASS Node24/26/type/lint/whitespace; zero hooks, B JSON compatibility. Native `review-685fd5bf5a7048de` approved/acknowledged. No legacy schema, authenticated provenance, scaling or Proxy/global-monkeypatch guarantee.

### C1 — Atomic causal response
- [x] Implement grant → request → response with meaningful debt influence.
Commit `4492d53d7c9417540d39d50ae602cf8db286a115`,631+/79-. `favor-c1`, no implicit B upgrade. Explicit assistance/need; later request after earlier-year grant, response-current factors recomputed. Help consumes1effort/need and fulfills; feasible refusal breaks without consumption. Ineligibility is not refusal; policy debtor→creditor, bounded actual consequence creditor→debtor (trust±5/refusal resentment+5). No automatic appraisals/typed fear. Calibrated-later probability defaults .10–.90; neutral open-debt salience .60 versus masked .40, wealth preference is mind.values.wealth. Explicit validated uniform noise, semantic identity excludes noise/prefix count.
Writer28RED/52PASS+missing-policy→97GREEN→118focused; independent178PASS Node24/26/type/lint/whitespace,14adversarial rejects/zero hooks, exact B JSON retained. Parent hashes matched. Native `review-f755280e7732c6e1` medium710/reliability approved+acknowledged; targetae962ef41a9e0236ae6ab5ce88c67148ef71e69ee8dc719856ff72021c6e2af4/revision51bc75414f0f073c2427d3efed5ddf1a3cbaf5b062635b7608b43ef55f50f690 burned. C1 alone does not close C.

## Closed causal demonstration

### C2 — Seeded multiple opportunities
- [x] Verify/review/commit standalone scheduler; close causal demonstration.
Commit `9de9631970dbdf06df8ed196b1995ec82ba95ca2`,495+/45- across6exact-reviewed files. Mapper `murdn1lt-k-06hp`, writer `murdx74s-l-rqk2`, independent `muree7wi-m-y2g6` complete, no material findings. ASSESS unassessable undeclared-untracked scope required independent verification. Native `review-afaf6f98fd78e68b` medium540/reliability approved and acknowledged; target066caf4f05cefc1bcce15e0017f6bfe0ca69ecc61428999d2266614a1f2e1dc9/revision31477293fdb9b0e321a9899866119ec5191f4e1f5542c0cc5c22ef955c8ccd32 burned. Parent hashes matched; postcommit onlypreexisting.claude/untracked. C1+C2 close standalone demonstration, not production integration.

Allowed surfaces: scheduler.ts/test, additive C-only opportunity/admission helper in effects.ts/test, concise design. All domain files under src/domain. Existing C1/B/A command/replay/version behavior, obligations/policy/RNG/production/types/mind/life-state/storage/UI/deps read-only.

Contract: versioned envelope has one C world, seed, initial/completed-year frontier, original-prefix index and annual attempt evidence. Quiet years persist frontier; same-year/backwards/behind-event execution rejects. Monotonic gaps explicitly allowed, absent years not simulated. Metadata admission reconstructs initial prefix transiently and reproduces annual evidence/effects; forged metadata/suffix rejects, no authenticated authorship claim.

Exactly2slots PER creditor/year, canonical UTF8 creditor/debt ordering with deterministic raw-string fallback for lone-surrogate byte collisions. First currently eligible debt per slot; independent .25 activation, quiet/no-target consumes no draw; inactive records activation only. Immediate C1 request/response with appraisals[], revalidate between slots/creditors; no duplicate settlement, resampling, regeneration or annual-hazard/provider invocation. All viable factors validated before activation, including quiet outcomes. Explicit eligibility reasons; malformed checkpoints/references/resources/factors throw, never catchall skip.

Canonical scheduler/RNG-version/rule/ordered-actors/year/slot/debt/purpose keys; seed+key transported as one canonical variable RNG argument to avoid delimiter ambiguity. No prefix/draw/transport identity in semantic keys. Unrelated-creditor keys/draws/IDs stable; same-creditor competition may change target, log positions may shift. Single state registry, no world mirror.

Writer evidence:455+/1- (456changed), five files, stayed within scope. Missing scheduler/API RED1failed/119PASS+suitefailure→153GREEN→161focused. Combined221PASS C2/C1/B/A/RNG Node26.8.1/type/lint/tracked+untracked whitespace. Seeds c2-1/c2-2/c2-11 demonstrate two requests/zero/refusal; tests cover shared last effort/need, pending/dead/away/too-early, JSON restoration/quiet frontier/forged suffix, Unicode order, identity isolation/zero-hook/dependency traps. Historical RED writer evidence only.

Hashes: scheduler172be6bc692ee9fbf9ebc5481321ddb9a8331a0cfcf16fc28a1d8be797c838be/teste9ad0e708931ca058ddbcbb11fc49c4c58db1d257f4b6ed16c45f8b9bd6a3b75; effects58e6e477c239e75d72b5597a82764ac5c0fb12337f6839822e28b2def82c5b1e/test04944056fabe3581299903c691975e914380c667e19aeef85b97db29d22efb67; design73fe706f62b9f3b881457be64fa4cd50fc31b4965c3d7b794436c8c739f04143. Independent221PASS on Node26.8.1 (1.15s) and Node24.21.0 (929ms), type/lint/whitespace PASS, source/design hashes unchanged.20adversarial cases rejected (frontier/prefix/noise/outcomes/IDs/records/events/quiet-year repetition/inactive malformed factors/hooks), zero hooks/unexpected admissions; quiet JSON restoration+next year equals uninterrupted execution. Native approval/acknowledgement and local commit observed. Isolation is not production integration or scaling evidence.

## Current and pending work units

### D1 — Provenance capsule and repository
- [ ] Admit/serialize/save/cold-load standalone canonical records.
In progress; mapper `murenn35-n-rpgf` complete, user selected `d_include_sqlite`: full D includes real SQLite adapter tested only temporary/disposable DBs. No liveDBDDL/deploy/network. D1 starts first, no source edits yet; standalone memory proof is not production durability and D1 does not close D.

Allowed D1 surfaces: new src/domain/favor-capsule.ts/test, new src/server/favor-repository.ts/test, concise design; tracker parent-owned. Capsule explicit schema/projection/engine/reducer/scheduler/RNG/config tuple, seed/frontiers/prefix/order metadata, complete Cstate/events/effects/attempts, one registry. Existing C2 admission remains authority; no A orchestration import/hash/projection refactor or B/C runtime change. Strict descriptor-first wire admission/hash, normalize only explicitly declared optional legacy undefined fields; unknown undefined rejects. Preserve declared registry traversal order across canonical serialization, no provenance from legacy cards. Repository stores strings, fresh decoder/instance cold-loads; no live-object alias or duplicate retry effects. Unsupported legacy canonical import failclosed; old view compatibility untouched.

Acceptance: deterministic canonical payload/hash and versions/order/options/resources/events/attempts; tamper/hash disagreement/unsupported schemas/hooks reject before reads; detached save/load, fresh-instance cold-load equality, quiet-year restoration+next-year equality, no replay duplication. Tests first, retain221C/B/A/RNG regression baseline, independent Node24/26/type/lint/whitespace/native/localcommit per unit. Effective scheduler config is fixed2slots/.25activation, not caller-customized. Static frontier-valid Person inputs, not production as-of reconstruction.

### D2 — Explicit fork authority
- [ ] Branch from an earlier-year prefix with eligible human choice and inherited overrides.
Pending D1. Derived favor-fork.ts/test plus narrow versioned effects/scheduler/capsule/repository extensions mapped before writer. Distinct Dengine/reducer/projection/scheduler; seedbaseline draw/distribution unchanged plus explicit eligible human target/option, never forge noise. Stable pre-fork-year event/decisionprefix/IDs, ordered inherited/new overrides, semantic RNG keys independent of transport/lineage, lineage-qualified suffix IDs/references. Same-target override replacement policy is a real decision before affected behavior. No future finalPerson/legacycards leak; production fromYear currently resets decisions and old route lacks fullprefix history. D1+D2 alone not fullD.

### D3 — Real SQLite attachment
- [ ] Implement/test durable SQLite canonical attachment without rewriting legacy rows.
Pending D2 and bounded adapter map. Actual storage node:sqlite in db/life-store. User explicitly authorizes adapter scope and isolated temporary/disposable test databases; production DATA_DIR/lifelines.db untouched, no live schema migration/deploy. Derived db.ts/life-store.ts/tests + dedicatedcapsuleadapter/test only if needed, prefer additive optional attachment over casting C into SimulationResult. Canonical admission bypasses legacy class remap; old viewing/rewriteretention decision before affected surfaces. New production Ccanon/inputcapture/kernelintegration remains E. No fabricated provenance for old rows.

### E — Selection and production
- [ ] Integrate live/final selection, model-free canon and annual SSE.
Depends C/D. No hindsight leakage, causal context, canonical model removal including initialization, quiet progress/cancel/completed persistence; compression/editability/time gate first.

### F — Director and calibration
- [ ] Add bounded deterministic opportunity weights and measured corpus comparisons.
Depends C/E. Clamp/cooldown/no-op; no outcome/eligibility authority/drama quotas; runtime/storage/consequence/variation budgets first.

## Verification and next action
Host Node26.8.1/V8 14.6.202.34-node.28; cached read-only/network-free Node24.21.0/V8 13.6.233.17-node.53. Vitest ephemeral token cache required; host token predates work. Known Vite warning. Full suite/build/browser/corpus CLI not rerun for standalone C1/C2; integration/performance pending. Prior passive tracker reviews cover no new code. Preserve .claude/ in untracked scope selection/staging. Completion metadata remains uncommitted until next coherent unit.

User scope resolved: D includes D1/D2/D3 with SQLite temporary-DB checks only. Dispatch D1 bounded test-first writer, independently verify/native-review/localcommit before D2. No production DB operations or source outside mapped surfaces. Optional LLM prose/resumability later scope.

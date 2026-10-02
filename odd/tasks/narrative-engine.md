# Narrative engine — ODD tasks

## Intent, authorization and invariants
Implement `docs/design/narrative-engine.md`: deterministic model-free reality, persistent causes, opportunity-only director, read-only selection. Hidden activity supplies material, not UI-card quotas. User authorized stepwise implementation and local commits2026-10-02; push/PR/merge/deploy unauthorized. Branch `feat/narrative-engine`; baseline `main`/d5d9ad5. One writer; independent readers/verifiers parallel, preserve `.claude/`. English artifacts; Spanish conversation. Applicable tests RED/GREEN, no fake evidence.

## Tasks and acceptance
### A — Standalone replay
- [x] A: envelope/strict SHA256 canonicalization/projection/full independent rules replay.
Complete people/events/options and registry order; reject unsupported versions/types/undefined/nonfinite/sparse/cycles/accessors/coerced enums before simulation; separate narrative/diagnostics; tamper/alias/roundtrip tests. No engine/production changes, no general override-history promise. Commits design0acd452626203f596f71817a13980bb541d25032(492 additions), replay/tests/tracker927c346094091e0b11b2bd3dd2159b70e004b0b2(614 additions). Mapping mur9md1k-3-5n6v, writer mur9ttyr-4-va5a, correction murakyk5-7-q1t8, verifier muraoa13-8-0drf PASS.44tests Node24/26/type/lint PASS; two-case runtime hashes equal, no universal portability.

### A-baseline — Corpus metrics
- [ ] A-baseline: guarded CLI/measurement helpers/tests, actual paired corpus evidence.
Depends A closed. Surfaces `scripts/replay-baseline.ts`, `src/domain/replay-baseline.test.ts`, concise design methodology. Planner muraf2m3-6-89q8, writer murb77g0-9-ijff completed; verifier murbfl2u-a-7yqu PARTIAL, corrective capture murbkvka-c-5s77 running. No baseline commit yet.
Acceptance: four explicit1327–1362/six-founder/Alice-f seeds, eight independently generated worlds/replays/fresh rules; actual reached years vs age/start-1 checkpoint, UTF8/Map bytes, separated generation/admission/replay/simulation/serialization/compression timings; Brotli5/gzip6 documented, hashes invariant after metrics, no DB/models/data file, no tiny-corpus p95/true peak heap/coverage/scaling claim.
Writer RED missing module->5GREEN, combined49/type/lint/whitespace PASS. Node26 paired runs all match, reached1327/1351/1328/1349, generated events1/124/4/94, decisions13/594/37/491, calls7/212/15/186, no fallback. Two early deaths/no cap. Largest snapshots5,661,675 raw/686,099 gzip6/55,182 Brotli5; replay7.08–178.58ms/simulation3–134ms observations only. Script164/tests102/design62+/4-;328 additions.
Independent source review: no material defect,49tests PASS local/Node24, tsc/lint PASS. Corpus parser wrongly asserted cross-runtime gzip equality, aborted seed1/discarded later data. Verification-tool issue, NOT code failure. Node24 seed1 gzip54,646(result)/686,079(snapshots) differs from Node26 54,649/686,099; raw/Brotli matched checked records. One extra buffered capture authorized; canonical hashes/counts compared, compressed bytes recorded per runtime. Seeds2/3 complete verification/native review pending.

### B — Atomic favor/obligation
- [ ] B: conserved grain favor, objective help obligation, directional effects/evidence-linked appraisal.
Depends A; map murbg1n6-b-kpkc complete. Proposed bounded defaults accepted for prototype: integer abstract grain, trust-100..100/resentment0..100, no economic calibration/UI, typed fear deferred. Supplemental versioned state does not duplicate Person identities/axes or obligation copies; B not admitted as A-v1. New effects/obligations modules+tests candidate; exact surfaces before dispatch. Atomic rejection/missing causes/replay/contradictory appraisal tests required. No B implementation yet; baseline closure first.

### C — Causal slice
- [ ] C: favor->obligation->later help/refusal->relationship change; director off.
Depends B; scheduler/numeric gate. Replay stable, liveness/location/resources/conflicts, unrelated keyed RNG, annual hazards unchanged, obligation actually influences choices. Delegated writer; pending.
### D — Durable replay/forks
- [ ] D: provenance persistence/event-decision prefix IDs.
Depends A/C; legacy/suffix gate. Cold-load equality, year-before prefix unchanged, inherited overrides explicit/no invented legacy state. Delegated writer; pending.
### E — Sifter/production
- [ ] E: live/final selection and model-free canonical path with annual SSE.
Depends C/D; compression/editability/time gate. No hindsight leakage, causal evidence, no canonical models including init, quiet progress/abort/completed persistence. Delegated writer; pending.
### F — Director/calibration
- [ ] F: bounded deterministic opportunity weights/measured corpus comparisons.
Depends C/E; budget gate. Clamp/cooldown/no-op, no outcome/eligibility authority or drama/closure quota; real runtime/storage/variation metrics. Delegated writer/verifier; pending.

## Review, checks and limitations
A initial RED->28GREEN; simulator120s timeout then77PASS/136.23s; pre-fix verifier found bond coercion/getters, correction7RED->44GREEN independent PASS. Source hashes d4b627d0ce86fa1ec942f6a41816a7e9f6451ffbc6bb9329061fa0be387687c2(replay),931b0898c1ebe27262d7af4b0d8cd895d305ae85cc374501207f7f1e63b0266a(test) parent-matched. Native A review-27ef7f8639835ce6 medium reliability approved/acknowledged target65fdd45157907186b49518471b26d57ac14f39875bf8a06855722205c419b0bd; passive tracker review-a5fb3a8372307f2b consumed separately, not baseline approval.
ASSESS unassessable due untracked declaration; independent verifier required. Node24 cached Docker read-only repo/network none/tmpfs cache solved Vitest token startup; host token predates work/no new mutation/cleanup. No full-suite/build/browser rerun for standalone/guard work; baseline/broader budgets scoped, no universal portability. B-F still unimplemented.

## Delivery and next step
Local verified work-unit commits authorized; publishing strategy ask-on-risk/undecided. Committed1106 additions across two units, A-source563 kept coherent over advisory400. Baseline forecast180–280/actual328; B-F unknown. Current boundary927c346, no code-golf/fake closure. Await corrected complete Node24 capture, then native review/commit baseline and dispatch B after exact tracking/surfaces. Optional LLM prose/resumability later scopes. Full Engram mirror/UI reflect this file.

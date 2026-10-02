# Narrative engine — ODD implementation tracking

## Goal and authorization
Implement `docs/design/narrative-engine.md` step by step: seeded model-free reality, persistent causal consequences, opportunity-only director, downstream narrative selection. Hidden activity is a selection pool, not more UI cards.
User authorized implementation on 2026-10-02: "dale, vamos con todo paso por paso" and local work-unit commits: "si, anda haciendo comits". Push/PR/merge/deploy remain unauthorized. Functional acceptance is separate from full task closure, which needs a work-unit commit. Branch `feat/narrative-engine`, baseline `main`/`d5d9ad5`. One writer; parallel independent readers/verifiers allowed. Preserve `.claude/` and design. English artifacts, Spanish conversation; test-first when applicable.

## Stable tasks and acceptance

### A — Standalone versioned rules replay
- [ ] A: implement, verify and close replay work unit.
Surfaces: `src/domain/replay.ts`, `src/domain/replay.test.ts`, design contract clarification. Standalone full rules runs only; no simulation/RNG/adapter/route/storage/fork behavior changes. Complete initial people/events, registry order/effective options captured; general override history unsupported. Strict SHA-256 canonical JSON, version/options admission before simulation, no getters/coercion, array order/behavior state retained; narrative/diagnostics excluded; independent complete worlds, tampering, alias safety and roundtrip covered.
Route: mapper `mur9md1k-3-5n6v`; writer `mur9ttyr-4-va5a`; correction `murakyk5-7-q1t8`; corrected independent verifier `muraoa13-8-0drf` PASS. Status: functional acceptance PASS; local commit authorized and being recorded. Full task closure follows observed commit evidence.

### A-baseline — Measurements
- [ ] A-baseline: reproducible rules corpus and actual timing/size evidence.
Depends A functional acceptance (met); source execution still awaiting A work-unit closure decision. Planner `muraf2m3-6-89q8` complete; candidate script `scripts/replay-baseline.ts`, test `src/domain/replay-baseline.test.ts`, concise methodology. Forecast180–280 additions. Four fixed seeds, explicit1327–1362/six founders/Alice-f, two complete independent worlds/runs per seed. Measure actual reached years/counts, simulation/external replay/serialization/compression separately, snapshot Map converted, UTF-8 bytes, Brotli5/gzip settings. No persisted lives/remote calls, tiny-corpus p95 or true peak heap. Status pending; local commit authorized after verification.

### B — Atomic favor/obligation
- [ ] B: validated transfer, objective obligation, directed ties, evidence-linked appraisal.
Depends A; vocabulary/exact surfaces gated before delegated writer. Reject half-effects/duplicates/invalid causes atomically; objective commitments differ from subjective memories. Status pending resource/relationship decision; local commit authorized after verification.

### C — Annual causal slice
- [ ] C: favor -> obligation -> later help/refusal -> relationship consequence, director off.
Depends B; scheduling/numeric gate. Delegated writer; replay equality, liveness/absence/resources/conflicts guarded, unrelated keyed draws stable, annual hazards not multiplied, obligation genuinely consumed by policy. Status pending; local commit authorized after verification.

### D — Durable replay/forks
- [ ] D: provenance persistence, event/decision-prefix preservation.
Depends A/C; legacy/suffix gates. Delegated writer; cold-load equality, year-before prefix IDs retained, inherited overrides explicit, no fabricated legacy state. Status pending; local commit authorized after verification.

### E — Sifter/production integration
- [ ] E: live/retrospective selection, model-free canonical path, compatible annual SSE.
Depends C/D; compression/editability/display-time gates. Delegated writer; no hindsight leakage, causal context preserved, no canonical model calls including initialization, quiet progress/cancellation/completed persistence preserved. Status pending; local commit authorized after verification.

### F — Director/calibration
- [ ] F: bounded deterministic opportunity-only weighting and measured comparisons.
Depends C/E; budget gate. Delegated writer/verifier; clamp/cooldown/no-op, no outcome/eligibility authority, no drama/closure quotas, measured runtime/storage/consequence/variation. Status pending; local commit authorized after verification.

## Observed checks and correction evidence
- Design writer `mur8c8vk-1-lqts`, verifier `mur8ndxu-2-bevh`: documentation PASS. Design commit `0acd452626203f596f71817a13980bb541d25032` (492 authored additions).
- Initial A RED missing module then GREEN28. Simulator first120s timeout, rerun PASS77/136.23s. Initial type/lint errors corrected; checks PASS, whitespace clean, Vite warning unchanged.
- Pre-fix verifier `muraet3d-5-q1vh`: FAIL two P2 despite 28tests Node24/26: bond array admitted via String; getter evaluated before rejection. Correction RED7 failures, GREEN44, type/lint/whitespace PASS. No engine/production changes.
- Corrected verifier PASS: 44/44 Node26.8.1/V8 14.6.202.34-node.28 and Node24.21.0/V8 13.6.233.17-node.53; independent bond rejection and zero-getter probes PASS, local tsc/eslint PASS.
- Two explicit verify-a-1/verify-a-2 worlds (Verification,1327–1350,six founders,Alice/f) retain equal direct/roundtrip and Node24/26 output hashes after corrections: `0e244e9778dd783f0e803883ced154ff351d77647dfd4d6f90384b8a25f5bd68`, `10041c61b175222459267805160b7016ec8eec4e5f2b70e0310c14175043ee6e`. Limited corpus, not universal portability.
- Corrected source SHA256 parent-readback matches verifier: replay.ts `d4b627d0ce86fa1ec942f6a41816a7e9f6451ffbc6bb9329061fa0be387687c2`; test `931b0898c1ebe27262d7af4b0d8cd895d305ae85cc374501207f7f1e63b0266a`.
- Node24 Vitest initial token-cache startup failed, passed with ephemeral cache/tmpfs, read-only repo/network none. Host token predates work; no new token/project mutation observed. No cleanup.
- Native review on A source/tests only: `review-27ef7f8639835ce6`, medium,563 changed lines, one reliability lens. Approved then exact acknowledgement completed; authority burned for target `sha256:65fdd45157907186b49518471b26d57ac14f39875bf8a06855722205c419b0bd`, consumed revision `sha256:97e9f57c5af4efebe38b130d7fc8ab8ebf720b5d7c684359dbba3b14507db472`. Review grants no delivery authority.
- ASSESS unavailable earlier due untracked declaration; independent verifier completed instead. No full-suite/build/browser rerun for isolated guard correction. Full feature/runtime budgets/baseline benchmarks remain pending.

## Delivery and next step
Strategy ask-on-risk, publication/PR shape undecided. A source563 lines; readability/tests retained over advisory400 heuristic. Design currently492 lines, separate passive design artifact. Full B–F forecast unknown. Committed lines0, boundary `d5d9ad5`. No task marked closed without commit; ask explicit authorization for local work-unit commits before accumulating subsequent source units. Push/PR/merge/deploy remain separate decisions. Optional LLM prose/resumability later scopes.
A is functionally verified and native review consumed. Resolve local commit authorization; then start A-baseline test-first from bounded surfaces and updated task/mirror. Keep product gates for B–F visible.

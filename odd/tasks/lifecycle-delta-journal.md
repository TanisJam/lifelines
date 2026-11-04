# Lifecycle delta journal

Objective: stop the lifecycle engine from retaining a full world copy per year; store per-year differences instead, and measure before and after.
Branch: `feat/lifecycle-delta-journal` (worktree `../lifelines-delta-journal`). Delivery: ask-on-risk; ff-merge to main only on owner approval. Test runner: vitest (`pnpm vitest run <file>`).

## Specs

- **S1 — Store differences, not copies.** Owner: "me imagino como tipo ir guardando la diferencia. No toda la copia de todos los años." The lifecycle journal must not hold a full deep copy of the world per year (today `final: structuredClone(draft)` in `src/domain/e-lifecycle-runtime.ts:205-223`). Append-only data (events, decisions, favor events) is stored once, with per-year positions. Per-year mutable state (people, favor ledger) is stored as a per-year delta, or as sparse checkpoints plus deltas. Retained journal size must grow roughly linearly with years, not quadratically.
- **S2 — Measure before and after.** A benchmark script under `scripts/` reports, for one foreground run of at most 3 simulated years: wall time per phase (init, each annual step, each tick projection, final chronicle/person-sheet projection, persistence), heap peak and RSS, and the retained journal bytes per year. It runs on `main` (baseline) and on this branch; both results are recorded in this document. Never more than 1–3 simulated years, and one run at a time (machine RAM).
- **S3 — Observable output unchanged.** For the same seed and inputs, every SSE tick frame, the final chronicle in every locale, every person sheet, and the persisted indexed projections are byte-identical to the baseline.
- **S4 — Stored lives keep working.** Lives already persisted in the old format are still readable, and still branchable where they were before. No migration or regeneration of stored lives.
- **S5 — No per-tick whole-journal re-walk.** `projectLifecycleTick` must not admit/re-walk the whole journal on every tick (`src/server/lifecycle-projection.ts:186-195`). Per-tick work is bounded by that year's data. (Assumption: proposed by the coordinator as part of the same memory/CPU fix; the owner accepted the proposal.)

## Tasks

| ID | Specs | Route | Status | Evidence |
| --- | --- | --- | --- | --- |
| T1 | S2 (baseline) | delegated (herdr builder-terra; reason: substantial cross-module change, thin-coordinator rule) | open | |
| T2 | S1, S3, S4, S5, S2 (after) | delegated, same worker after T1 | open | |
| T3 | S3, S4 | independent verifier (Risk item 1: persisted format) | open | |

## Log

- L1 (2026-11-04, owner, verbatim): "Claro, me imagino como tipo ir guardando la diferencia. No toda la copia de todos los años." Replying to the coordinator's proposal to bring PLAN phase 2A forward (replace per-year full world retention), together with the phase 0B measurement before and after, using 1–3 simulated years.
- L2: Context: `.herdr-agents/engine-plan-terra/PLAN.md` (phases 0B, 2A, 2B); `docs/design/rich-lives-streaming.md`. The legacy engine will be discarded (owner, 2026-11-04), so put no effort into legacy. Historical measurement: a 57-year lifecycle create took 46 s with a 1.77 GB cgroup peak under a 2 GiB limit.
- L4 (2026-11-04): The first builder-terra run was blocked before any edit. Its runtime requires an explorer with model `gpt-6.1-luna`, which the runtime rejects as unknown. Recovery: a read-only mapping worker writes `.herdr-agents/delta-map/MAP.md`, then a new builder implements from that map without spawning sub-agents.
- L3: Follow-up, not in scope: the per-year people view that S1 produces is also the input the Luna prose layer needs to avoid leaking future facts.

### Baseline benchmark (T1)
`pnpm --config.verify-deps-before-run=ignore exec tsx scripts/lifecycle-delta-benchmark.ts` (foreground, cap-0, 3 years, in-memory SQLite): init 135.66 ms; years 69.85/89.35/124.91 ms; ticks 4.90/1.90/2.16 ms; chronicles 7.68 ms; person sheets 11.00 ms; persistence 377.14 ms. Sampled heap peak 80,427,624 bytes; process max RSS 219,009,024 bytes; V8-serialized retained journal 220,184/557,822/1,014,632 bytes by year. Heap is sampled at phase boundaries, not a continuous peak; serialization is a comparable retained-size proxy.

### Writer handoff
Baseline script: commit e05ffef. Fixed-seed legacy golden: commit 7438d0b; index readback added in the following commit. Golden test passed for two years in each legacy journal mode. S2 remains open: the benchmark's heap peak is sampled at phase boundaries, not a continuous peak, and no after measurement exists. S1, S4 and S5 remain unimplemented; S3 has baseline coverage only. T3 independent verification remains coordinator-owned and pending.

### T2 partial representation foundation
Added a standalone, version-tagged structural delta and append-log chunk codec, with three-year reconstruction, frozen state, alias and history-mutation regression coverage. It is **not wired into** the lifecycle runtime, capsule schemas, persistence, or projections; T2 remains open. The codec currently rejects modifications to an earlier log entry; before integrating it, verify that all production mutation paths preserve that invariant or extend the representation. Its previous-state argument is not yet bound to the supplied journal. No S1/S4/S5 completion is claimed.

After-foundation benchmark (same legacy runtime, not a delta performance result): init 164.13 ms; years 74.17/92.59/105.72 ms; ticks 5.31/2.08/1.67 ms; chronicles 6.40 ms; sheets 18.72 ms; persistence 445.84 ms; phase-sampled heap 63,149,400 bytes; max RSS 199,319,552 bytes; serialized journal 220,184/557,822/1,014,632 bytes. Foreground, cap-0, three years, in-memory SQLite. Continuous heap peak remains unmeasured; a timer cannot observe synchronous CPU-bound phases.

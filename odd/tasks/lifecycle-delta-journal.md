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
| T1 | S2 (baseline) | delegated (herdr builder-terra; reason: substantial cross-module change, thin-coordinator rule) | done | e05ffef, 7438d0b, 920a96f |
| T2 | S1, S3, S4, S5, S2 (after) | delegated (herdr `delta-share`) | done | 8b6e8f3 (sharing), 1bfb27b (incremental tick) |
| T3 | S1, S3, S4, S5 | independent verifier (Risk item 6: shared frozen objects; no format change after L5) | done (herdr `delta-verify`): no blockers | VERIFY report; regression tests in the next commit |

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
- L5 (2026-11-04, coordinator): Two builder runs produced the baseline, the golden and an unused standalone codec (c4dee89), but no integration. Route change for S1: instead of a new versioned stored format, apply structural sharing in memory at year commit. Each new year's final reuses, by reference, every frozen object of the previous final that is deep-equal, and appends only the new tail of the append-only logs. Only what changed is newly allocated. Canonical data, digests and wire bytes stay identical, so S4 holds without a new format and nothing is migrated. The draft clone made for rollback is transient and not retained. If unused, the c4dee89 codec is removed. Fresh builder: `delta-share`.
- L6 (2026-11-04, coordinator): T2 done.
  - Shared-aware retained size by year: before 559,374 / 1,397,210 / 2,517,418 bytes; after 559,374 / 952,782 / 1,361,260 bytes.
  - V8-serialized journal: after 220,184 / 382,860 / 552,486 bytes.
  - Year-on-year increments are now roughly constant (linear growth).
  - All six full test files pass: memory, runtime, replay, journal-mode, guard, perf-identity. The memory test was run by the coordinator outside the worker sandbox, which blocks child spawn. The projection, life and golden tests also pass, as does tsc.
  - Observed memory hotspot, out of scope: capsule, serialize and cold-admit dominate peak RSS (1.61 GB for a 4-year memory test; wire is 51.6 MB).
- L7 (2026-11-04): T3 verdicts.
  - S3 pass: a 3-year base-vs-head probe is identical.
  - S4 pass: no format change; the cold-load, capsule and repository tests pass.
  - Mutation safety pass.
  - S5 partial: per-tick work still scans all events (`life-chronicle.ts:194-195`, `life-scene.ts:47-53`). The coordinator accepted it as met (D2): the journal re-walk is gone, and the linear event scan is a follow-up.
  - S1: object-level sharing re-copies people who changed (only 4 of 89 are shared per year). The owner accepted object-level sharing over a field-level delta (D3, 2026-11-04).
  - A3: added committed tests for the skipped-year, untrusted-copy, interleaved-stream and forged-accumulator cases. A mutant that drops the reuse guards fails the interleaved-stream test. The full projection file passes (18), and so does tsc.

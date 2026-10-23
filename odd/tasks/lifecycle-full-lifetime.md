# Full lifetime — a life must run to death, not to a year horizon

Branch: `feat/narrative-engine`. Test runner: `pnpm test` (`npx vitest run`). Delivery: work units on
the branch, about 400 authored changed lines each, tests and docs with the behavior.

## Specs

- **S1** A life MUST run until its protagonist dies, or until the initialised world's own span ends.
  A fixed year horizon MUST NOT truncate a living protagonist. `LIFECYCLE_HORIZON_YEARS = 15` is the
  behaviour this feature removes.
- **S2** The run's retained memory MUST be bounded by the size of the STATE, not by the length of the
  HISTORY. No per-year full copy of the world MAY be retained after its year closes.
- **S3** No step of create, load, verification or persistence MAY materialise the whole life as a
  single string. V8 caps a string at ~512 MB and that cap, not RAM, is what makes 17+ years fail today.
- **S4** A life stored under the previous capsule schema MUST keep loading, or a documented migration
  MUST exist that regenerates it from its stored genesis. Nothing stored MAY become unreadable without
  a recovery path.
- **S5** The chronicle and person-sheet views MUST keep the same observable content and MUST stay
  served from the index (P3/P9 of `lifecycle-capsule-cost.md`).
- **S6** Every claim MUST distinguish measured values from extrapolations.

## Measured root cause (seed `cap-0`, world 1327–1427)

The journal retains, per year, a full `physicalSnapshot`, a full `economics` block, a full `final`
state copy and `positions`. Measured with an 8 GB heap, so memory cannot explain the failures:

| Years | Journal | `economics` | `final` | `physicalSnapshot` | **Read-only needed** |
|---|---|---|---|---|---|
| 15 | 345 MB | 313 MB | 19 MB | 13 MB | ~12 MB (3.5%) |
| 25 | 853 MB | 773 MB | 48 MB | 32 MB | **32 MB (3.8%)** |

Inside `economics`, `entries` alone is ~90%: `evidence()` in `e-favor-executor.ts` embeds a clone of
the whole `obligations`/`ties` ledger plus **every prior operation id ever** into every operation's
`consumed` field. That is O(operations × history) per year, i.e. quadratic overall.

**Nothing in production reads any of it.** `physicalSnapshot`, `economics`, `positions` and
`final.favors` are written and never read; the only journal field the views consume is
`final.owned` (`lifecycle-projection.ts:189`). It is retained audit data that no code path opening a
page, a capsule or a verification ever asks for.

The wall those bytes produce, all measured:

| Years | Simulation | `JSON.stringify(journal)` | `canonicalLifecycleData` |
|---|---|---|---|
| 15 | 89 s | 345 MB | 444 MB (fits) |
| 17 | 124 s | 444 MB | **THROWS** `Invalid string length` |
| 20 | 190 s | **THROWS** | THROWS |

## Tasks

| ID | Spec | Route | Status |
|---|---|---|---|
| P1 | S2: stop retaining per-year data nothing reads (compact journal mode) | inline | **done** |
| P2 | S3: capsule schema `cb2` over the compact journal, with `cb1` still loadable | inline | **done** |
| P3 | S3: incremental digest so the table is never one string | inline | **not needed (measured)** |
| P4 | S4: migration command that regenerates stored lives from their genesis | inline | **not needed (proven)** |
| P5 | S1: run the fixture to a real death and verify the views | inline | **done** |
| P6 | S5: re-verify index-served reads after the journal change | inline | **done** |

## Log

**L1** — The user's original request, verbatim:

> las vidas son de toda la vida, no solo 15, porque dejaste solo 15 años?

**L2** — Scope approved, verbatim:

> dale

answering "¿Arranco el rediseño del `journal` y el digest incremental, con schema de cápsula nuevo y
migración de lo ya guardado?"

**L3** — The 15-year horizon was NOT introduced by this work: it is `LIFECYCLE_HORIZON_YEARS = 15` in
`lifecycle-life.ts`, pinned by `expect(LIFECYCLE_HORIZON_YEARS).toBe(15)`, and specified in
`narrative-lifecycle-horizon.md` S1. It was inherited and never questioned, which is the fair criticism.
The 15-year fixture also never died: it ended `incomplete` with `horizonYear 1341`.

**L4** — Measurements in the table above, taken with `scripts/_probe-jsize.ts` against the real engine.
The compact journal (`{year, final: {owned}}`) is 3.8% of today's bytes at 25 years. P1 does not by
itself make 100 years fit; it removes the 26x that makes 17-20 years impossible, and it is the
prerequisite for the delta design that does.

**L5** — P1 landed as a runtime OPTION (`createLifecycleRuntime(input, { journal: "compact" })`), default
still `"audit"`, so no product behaviour changes until the create path opts in. Measured by running the
real engine with the compact journal, seed `cap-0`:

| Years | Status | Wall time | Peak VmHWM | Compact journal | Capsule wire |
|---|---|---|---|---|---|
| 25 | incomplete | 265 s | **0.82 GiB** | 47.6 MB | — |
| 40 | incomplete | 393 s | **1.25 GiB** | 108.8 MB | — |
| **57** | **complete (death)** | **471 s** | **1.53 GiB** | 198.6 MB | **11.8 MB** |

The last row is the point of the whole feature: the protagonist of `cap-0` dies at year 57, the run
finishes, the capsule is produced and the digest is computed, in **1.53 GiB** - inside the deployed
`mem_limit: 2560m`. Before P1 the same engine could not finish 17 years at any heap size.

What made it possible was not memory tuning: 90% of the journal was per-operation audit evidence that
no reader consumes. The compact journal keeps only `final`, which is what the chronicle, the person
sheets and the replay comparison actually read.

Still required before this reaches the product path (P2-P4):

- `streamLifecycleLife` still goes through `runLifecycle`, which unconditionally builds the LEGACY
  capsule via `canonicalLifecycleData` - the 444 MB string that throws at 17 years. The compact path
  above never touches it, so P2 must stop building it on the create path.
- The compact capsule currently reuses the `cb1` manifest while carrying a different journal shape, so
  `deserializeLifecycleCompactCapsule` would replay it in audit mode and refuse. P2 must version it.
- `verifyLifecycleLives` and the read paths must regenerate in compact mode for compact lives.

**L6** — P2/P5/P6 landed. `streamLifecycleLife` no longer calls `runLifecycle`: it uses the new
`runLifecycleOutput` (same run loop, no legacy capsule) and certifies with `createLifecycleCompactCapsule
(..., "compact")`, which writes manifest `lifecycle-capsule-compact-cb2-1`. `load` reads the schema the
binding records and regenerates in that journal mode, so `cb1` lives are still reproduced exactly.

The default budget is now `LIFECYCLE_MAX_STEPS` (the world span), not `LIFECYCLE_HORIZON_YEARS`: a life
runs until its protagonist dies. `LIFECYCLE_HORIZON_YEARS` survives only as an explicit short budget for
fixtures and tools.

Measured end to end through the REAL create path, seed `cap-0`, at the deployed
`--max-old-space-size=1536`:

| | Value |
|---|---|
| Years | **57**, then `status: complete` (death at 1383) |
| Ticks streamed | 57 |
| Create wall time | **499 s** |
| Peak VmHWM | **1.51 GiB** (inside `mem_limit: 2560m`) |
| Stored per life | genesis 0.09 MB + chronicle 0.11 MB + sheets 0.17 MB = **0.37 MB** |
| Chronicle | 61 entries, 218 people |
| Person sheet | **1 ms** |
| Cold `load` | 485 s, 1.43 GiB, reproduces 57 years and the same digest |
| `verifyLifecycleLives` | 513 s, 1 life, **0 issues**, 1.62 GiB |

**P3 is not needed**: at 57 years the compact capsule wire is 11.8 MB and the digest is computed over
it directly. The table never approaches the ~512 MB string cap, so an incremental digest would be
machinery for a wall that no longer exists. Revisit only if a life's wire approaches that cap.

**P4 is not needed**: `cb1` lives still load, because `load` regenerates them in audit mode from their
stored genesis and reproduces their bound digest exactly. `lifecycle-repository.test.ts` publishes a
`cb1` capsule and reloads it on every run, so this is pinned, not assumed.

The cost moved, it did not vanish: a full 57-year life takes ~8 minutes to create instead of ~2 minutes
for a truncated 15-year one. That is the product decision S1 asks for, and it is now serialized by the
create gate (concurrency 1, queue 4).

**L7** — Independent verification reproduced every L6 number and found one real BLOCKER, now fixed.

`replayOrReuse` reused any branded runtime output whose `genesisDigest` matched, WITHOUT checking that
its journal shape matched the mode being certified. `createLifecycleCompactCapsule({ genesis, output },
"compact")` therefore accepted an AUDIT output and minted a `cb2` capsule carrying
`physicalSnapshot`/`economics`/`positions`; `publish` stored it with a cb2 binding, and every later
`load` refused it with `Lifecycle binding/capsule disagreement`. A branded output proves provenance, not
shape, and the two entry paths to `publish` disagreed about the same bytes: cold admission refused them,
in-process creation accepted them. The defect produced UNREADABLE PERSISTED DATA instead of an error at
creation time, which is the worst shape a schema bug can take.

The fix refuses the mismatch at creation: `journalModeOfOutput` classifies a non-empty journal as audit
(has all three per-year blocks), compact (has none), or mixed (refused), and `replayOrReuse` refuses when
the declared mode disagrees. A zero-year journal is valid in BOTH modes and proves nothing, so it is not
classified.

The verifier also noted no test in the suite asserted anything about `cb2`, which is why the defect
survived the full run. `src/domain/e-lifecycle-journal-mode.test.ts` now covers S1-S6 in nine cases:
the default reaching death, the boundary budgets, identical chronicle/ticks/sheets from both journal
modes, cb1 and cb2 living side by side, manifest-swap refusal, and a re-signed journal that drops or
reorders a year being refused. Its S6 case is the RED test for the blocker.

Two documentation defects it also raised are fixed: the stale `LIFECYCLE_MAX_STEPS` comment and the
create-queue rationale that still quoted a 15-year create.


**L8 — create went from 499 s to 46 s, and the cost was a validation walk nobody needed.**

The user's constraint: "es un monton, fijate de cambiar o reducir cosas para que tarde al dededor de 1
minuto como mucho". A CPU profile of a 20-year compact run, not guesswork, put **91.5% of the time in
`ownData`**, reached through `guardCurrentView` from `inspectHelpOpportunities` and `currentHelpContext`.
That guard deep-walks the ENTIRE favour ledger - every person's mind, every event, every tie - and the
annual loop calls it once per creditor and slot, plus once per executed operation. It is O(state) per
call, so it is quadratic over a life.

The guard exists for CALLER-SUPPLIED state. The engine's own ledger was already validated when genesis
was admitted, and every clone and mutation it performs preserves that shape. Three changes, none of
which weakens the boundary:

1. `trustFavorState(state)` marks an engine-owned ledger in a `WeakSet`; `guardCurrentView` skips ONLY
   the deep `ownData` walk for marked objects. The cheap structural checks still run, and any object the
   module did not mark is walked exactly as before.
2. `requireAnnualPolicyView` skips its own `requireFavorData` walk for the same marked state.
3. `createFavorExecutor(..., { auditEvidence: false })` stops BUILDING the per-operation `consumed`
   evidence in compact mode. P1 only stopped persisting it; the clones of the whole ledger plus every
   prior operation id were still being computed for nothing.

Measured on seed `cap-0`, same machine, none of these touching the audit path or the lifecycle output:

| | Before | After |
|---|---|---|
| 10 years | 39 s | **3 s** |
| 20 years | 183 s | **6 s** |
| 57-year run | 471 s | **31.4 s** |
| Full create (run + capsule + views + publish) | 499 s | **46.4 s** |
| Peak VmHWM | 1.51 GiB | **1.36 GiB** |

A whole life now creates in **46 seconds**, comfortably inside the one-minute budget. The remaining
split is 31 s of simulation and 15 s of capsule encoding; the encode is the next lever if it is ever
worth another pass, and it is not needed to meet the requirement.

Two pins, because my first attempt at one was worthless. `favor-trust-boundary.test.ts` marks a malformed
ledger and proves the walk skips for THAT object, while a spread copy of it - a different object - is
still walked and still refused, and the cheap structural checks survive the skip.
`lifecycle-perf-identity.test.ts` pins the capsule digest, journal hash, chronicle hash and every person
sheet hash against what the pre-optimisation engine produced, so a future speedup that changes the life
fails a test instead of needing a re-measurement to notice.

The first test I wrote for the guard inspected `run.output.favors`, which is a frozen clone the engine
never marked: it passed even with the optimization deleted. Independent verification caught it, which is
exactly what a vacuous test is for.

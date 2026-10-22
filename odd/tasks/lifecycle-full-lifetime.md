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
| P2 | S3: capsule schema `cb2` over the compact journal, with `cb1` still loadable | inline | open |
| P3 | S3: incremental digest so the table is never one string | inline | open |
| P4 | S4: migration command that regenerates stored lives from their genesis | inline | open |
| P5 | S1: run the 15-year fixture to a real death and verify the views | inline | open |
| P6 | S5: re-verify index-served reads after the journal change | inline | open |

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


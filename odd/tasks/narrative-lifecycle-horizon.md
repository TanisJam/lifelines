# Horizon — a life is a chronicle up to 15 years

Objective: make the happy path work end to end with a life that has real length. A life is the
protagonist's chronicle up to a HORIZON of 15 journal years; a protagonist still alive at the
horizon is persisted and shown as alive, never as a death.
Branch: `feat/narrative-engine`. Delivery: work-unit commits. Test runner:
`node node_modules/vitest/vitest.mjs run <file> --maxWorkers=1 --pool=threads`; `pnpm typecheck`;
`npx eslint <files>`.

## Specs

S1. A life is the chronicle of one protagonist up to a horizon of 15 journal years. Completion and
horizon are DIFFERENT states: a death inside the horizon yields a `complete` life; a protagonist
still alive at the horizon yields an `incomplete` life that IS persisted and displayed as alive at
the horizon.

S2. The engine rule is untouched: alive is NEVER complete, and the horizon is NEVER a death. No
manufactured death, no `endYear` treated as `deathYear`, no forcing, no reseeding. The mortality fix
(commit `2c9d1f4`, decision 085) is the only mortality change authorized here.

S3. The create route persists BOTH statuses. The current refusal
`"This life has not yet ended."` was legacy parity and is superseded by S1; it must be removed for
the horizon path. A real failure still refuses and persists nothing: an abort, an admission or
projection refusal, a persistence error, or an abuse-guard rejection.

S4. Capacity: a 15-year capsule must fit a MEASURED wire profile and a MEASURED encode peak. Both
numbers come from a measurement at 15 years, reported with heap/RSS and wall time; no limit may be
raised without that measurement.

S5. Display must be honest: an alive life shows as alive at the horizon. The list and the detail may
not invent a `deathYear`, an `ageAtDeath` or a `causeOfDeath`. A `complete` life keeps showing its
real death.

S6. No legacy behavior change: legacy lives, legacy requests, the legacy list and the legacy detail
keep today's semantics. The two engines' storage stays disjoint.

S7. Evidence: focused tests per unit; the full suite at the single pre-existing failure
(`route.quiet`); typecheck and eslint clean; and a real production-build check that creates a
15-year life, shows it, survives a restart, and reloads identically.

## Tasks

| ID | Scope | Route | Status |
|----|-------|-------|--------|
| T1 | capacity profile from the 15-year measurement | measurement + delegated writer | DONE `dd0727a` |
| T2 | horizon 15 + persist incomplete lives (engine constant + create route) | delegated writer | DONE `dd0727a` |
| T3 | honest display of alive lives (projection, list, detail) | delegated writer | PENDING — blocked the `done` frame |
| T4 | whole-unit evidence (suite, typecheck, eslint, browser + restart) | inline | pending |

### T1/T2 evidence
- 15-year measurement (seed `cap-0`, 125 people): capsule 29,066,054 B, run 93 s / 646 MB heap,
  encode 2,164 MB heap.
- New published profile, derived from the certified 4-year point scaled by the measured wire ratio
  9.04x, with >=30% headroom: nodes 220,000 / edges 4,500,000 / depth 128 / bytes 36,000,000, and a
  320,000,000 work-text ceiling. `DEFAULT` untouched. The derivation and the measurement are in the
  constant's docstring; the exact-boundary tests now bind through the profile-lowering option path
  instead of allocating the published ceilings.
- `LIFECYCLE_HORIZON_YEARS = 15` is the run budget; `LIFECYCLE_MAX_STEPS` stays 100 because it fixes
  the genesis `endYear` that a non-editable route test pins. A run alive at the horizon is persisted
  as `incomplete` with its trusted status/frontier; the `"This life has not yet ended."` refusal is
  gone; abort, projection refusal and persistence errors still write nothing. Tests 231 + 32 green,
  typecheck and eslint clean.

### Known gap opened by T1/T2 (T3 must close it)
An alive-at-horizon life is persisted but emits NO `done` frame, because
`projectLifecycleChronicle` still refuses `status !== "complete"` and `Chronicle.protagonist.deathYear`
is a required number. So a horizon life is durable but not yet viewable; the SSE client gets no
`done`/`onSaved` for it. T3 must make the contract represent an alive life honestly (no invented
death year or cause) and then `lifecycle-life.ts` must project for the incomplete status too.

## Log

L1 (2026-10-21) — human decisions, verbatim, in order: `Sí: revertir tramos y hacer C + perfil
(Recomendado)`, `10-15 años (Recomendado)`, `Ambos motores (Recomendado)` for the mortality fix, and
`Vida = crónica hasta un horizonte de 15 años (Recomendado)`.

L2 (2026-10-21) — the mortality fix landed as `2c9d1f4` (decision 085): a founder newborn no longer
takes a duplicate age-0 biology roll, so every child's first roll is at age 1. Measured on 24 fixed
seeds with a 40-year window: deaths by age 1 went 12/24 (50%) → 5/24 (20.8%); 6/24 die before age 5
(ages 1,1,1,1,1,3); 4/24 die between 8 and 36; 14/24 are still alive at 40. The 15 demographic gates
pass (infant mortality 29.34%, e0 28.58, under-15 share 23.70%).

L3 (2026-10-21) — because most protagonists now outlive any short run, the old route behavior became
a product blocker: it waited for a death that never comes, ran the full 100-step budget (~15 minutes)
and then refused to persist. S1 replaces that with a bounded horizon.

L4 (2026-10-21) — capacity context from CP1: `postNative` was dropped from the journal record
(`05b82b0`), so a 20-year life now costs 49,191,002 B of wire and a 4,912 MB / 5,277 MB encode peak
(10 years: 13,774,890 B and 3,022 / 3,370 MB). The 15-year point is being measured for T1.

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
| T3 | honest display of alive lives (projection, list, detail) | inline — one coherent behavior (contract + projection + read + display + tests); no writer trigger holds | DONE `11c9c6f` |
| T4 | whole-unit evidence (suite, typecheck, eslint, browser + restart) | inline | pending — suite baseline is THREE pre-existing failures (`maternal-check-37`, `lockout-check-12`, `route.quiet`), not one |

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

### T3 implementation record (2026-10-21)
- Contract: `ProtagonistInfo.deathYear`/`ageAtDeath`/`causeOfDeath` are now explicitly nullable and
  `horizonYear?: number` carries the horizon of an alive life; `LifeListItem` mirrors it (and keeps
  `horizonYear` absent on every completed/legacy row, so the legacy list wire is unchanged).
  Invariant, enforced by the projection and pinned by tests: `deathYear === null` ⇔ `horizonYear`.
- Projection: the `status !== "complete"` refusals are gone from both `projectLifecycleChronicle` and
  `projectLifecycleProtagonist`. An alive life gets `epilogue: []` (no "lived on after her passing"),
  the existing honest "still living" `lifeSummary`, no death entry and `scene.span.end === null`.
  A status that disagrees with the protagonist's own record still refuses in both directions.
- Create path: the chronicle is projected for BOTH statuses before the persist, so an alive-at-horizon
  life finally emits its `done` frame (the T1/T2 gap) and the client gets `onSaved`.
- Display: the list renders `still alive in <horizon>` (en/es) with an open-ended `born–…` span and
  never borrows a death; the detail's intro panel renders no epitaph for an alive life (it falls back
  to the motto), and the sky's timeline is bounded by the horizon. The live streaming stand-in no
  longer fabricates `deathYear = birthYear`, `ageAtDeath = 0`, `causeOfDeath = ""`.

### Known gap opened by T1/T2 — CLOSED by T3
An alive-at-horizon life used to be persisted but emit NO `done` frame, because
`projectLifecycleChronicle` refused `status !== "complete"` and `Chronicle.protagonist.deathYear`
was a required number. T3 made the contract represent an alive life honestly (null death fields plus
the horizon) and `lifecycle-life.ts` now projects and emits `done` for both statuses.

### T3 evidence (commit `11c9c6f`)
- Focused, all green: `lifecycle-projection.test.ts` 13/13 (new: an alive life projects with
  `deathYear`/`ageAtDeath`/`causeOfDeath` null, `horizonYear` = frontier, `epilogue` empty, no death
  entry, "still living" summary; a status disagreeing with the protagonist refuses both ways),
  `lifecycle-life.test.ts` 7/7 (new: the alive-at-horizon run emits `done` with that chronicle),
  `lifecycle-read.test.ts` 7/7 (new: list + detail + side sheet for a persisted alive life, and the
  completed row keeps its death with no `horizonYear`), `route.lifecycle.test.ts` 6/6 (new: the list
  and the detail wire preserve the three nulls and the horizon), `live-model.test.ts` +
  `dictionary.test.ts` 13/13 (the streaming stand-in invents no death).
- `pnpm typecheck` clean; `npx eslint` clean over every changed file.
- Baseline verification for the full suite: the two `legacy-year.test.ts` canonical pins
  (`maternal-check-37`, `lockout-check-12`) and `route.quiet.test.ts` fail IDENTICALLY on the T3 base
  commit `8aefb23` in a scratch worktree (same seeds, same diff), so they are pre-existing and not
  caused by T3. That means the baseline has THREE failures, not the single `route.quiet` S7 names.
  The two hash pins most likely fell behind decision 085 (the mortality fix changed
  `gatherCandidatesForYear`, and 085 re-pinned only the runtime/memory canon); re-pinning them needs
  a fresh measurement and is NOT authorized inside a display unit, so they are reported, untouched.
- Full suite after T3: 130 files, 2866 passed, 1 skipped, 3 failed — exactly the three baseline
  failures above, none new.
- Native assessment of `8aefb23..HEAD` (`--committed-only`): risk `medium` (`executable_change` in
  `scripts/richness-stats.ts`), `review_due: false`, reason `under_budget` (448 changed lines), so no
  native review started and the reviewed boundary stays at `8aefb23`.

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

L5 (2026-10-21) — T3 landed as `11c9c6f`: the contract now has two honest protagonist states (a
complete life's real death, or an alive-at-horizon life's explicit nulls plus `horizonYear`), the
projection serves both, the create stream emits `done` for both, and the list/detail/streaming
surfaces invent no death. Route: inline, because this is ONE coherent behavior (contract + projection
+ read + display + tests) with no parallel units and no context backstop; the `delegated writer` in
the T3 row was a forecast, not a trigger. Evidence in "T3 evidence" above. New baseline fact found
while verifying: the full suite has THREE pre-existing failures at `8aefb23`, not the single
`route.quiet` S7 names — the two extra are `legacy-year` canonical pins (`maternal-check-37`,
`lockout-check-12`), reproduced byte-identically on the base commit in a scratch worktree. T4 must
record them as baseline; re-pinning them needs a fresh measurement and a decision, and is not part of
the display unit.


# Childhood survival guard — a child almost never dies before 18

Objective: below 18, death is very rare, and a lethal year becomes a narrow escape the reader can see.
Branch: `feat/childhood-survival` (WIP, suite red — see Log L4 before merging).
Test runner: `pnpm test`, `pnpm typecheck`, `pnpm lint`.

## Specs

S1 — Below 18 the base band hazard is multiplied by `CHILDHOOD_DEATH_FACTOR` (0.08), so a child almost always lives. Implemented in `actuarial.ts#childhoodMortalityFactor` and applied in `legacy-year.ts`'s death branch.

S2 — The dated pandemics are NOT damped: the Black Death and the second pestilence still take children. They are the period's own story beats.

S3 — The guard is scoped to the protagonist and their own children, not the whole village. Village-wide damping removed enough child deaths to grow the population, and the full lifecycle create went from ~46 s to over 60 s.

S4 — When the year's danger comes for the protagonist and the child survives, a `survived-a-close-call` reflection is recorded (protagonist only, gated at 12%), so the damping is narrated instead of leaving the year silently ordinary.

## Measured

73-year village (`cap-0`, 1327-1400), protagonist + children guarded: 39 people born in the window, **3 deaths under 18, all three the second pestilence of 1361**. Outside the pestilence no one under 18 dies. The protagonist records 2 close-call beats in 73 years.

## Blocking problem

Re-pinning is not sufficient. Several lifecycle tests exist to prove that the engine admits a genuine child death, e.g. `e-lifecycle-capsule.test.ts > admits genuine unforced death without relabeling alive horizons as completion`, which now gets `incomplete` where it asserts `complete`. Updating the expected value to `incomplete` would keep the test green while testing nothing.

Those fixtures need redesign (force the death through an override, or move the fixture to an adult death so the child-survival guard cannot suppress it), not a value refresh. 18-20 assertions across 12 files are affected, a mixture of pure determinism values and these premise-dependent fixtures.

## Tasks

| ID | Spec | Route | Status |
| --- | --- | --- | --- |
| T1 | S1, S3 | inline | done (in the WIP branch) |
| T2 | S2 | inline | done |
| T3 | S4 | inline | done |
| T4 | redesign the death-premise fixtures | pending | pending |
| T5 | re-pin the remaining determinism values | pending | pending |
| T6 | re-measure the lifecycle create at mem_limit 2g after the guard | pending | pending |

## Log

L1 (user, verbatim): "creo que mueren mucho de jovenes los niños ... podemos hacer que sea muy raro que mueran al menos hasta los 18 años? tipo si les agarra un evento de los que hoy mueren, que normalmente paso algo que haga que vivan"

L2 — Implemented as a damped hazard plus a narrated narrow escape. Measured result in L3 above.

L3 — Village-wide damping was tried first and rejected: population grew and `lifecycle-life.test.ts` began timing out at 60 s. Scoping to the protagonist's family restored the cost.

L4 — Suite state with the change applied: 20 failures across 12 files. Two (`simulate.test.ts`) were load timeouts and pass 79/79 standalone. The rest are lifecycle determinism values plus the premise-dependent death fixtures described above.

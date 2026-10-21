# RI1 — activate the canonical seam so the new engine creates, persists and serves lives

Objective: the shipped app must create, save and view lives produced by the NEW lifecycle
engine, by activating the canonical boundary inside the existing routes, without breaking any
existing legacy life or legacy behavior.
Branch: `feat/narrative-engine`. Delivery strategy: `ask-on-risk`, work-unit commits.
Test runner: `node node_modules/vitest/vitest.mjs run <file> --maxWorkers=1 --pool=threads`;
full suite via the same runner without a file argument; `pnpm typecheck`; `npx eslint <files>`.

## Specs

S1. Surface decision, human verbatim: "Activar el seam en la app legacy". The EXISTING routes
(`src/app/api/lives/stream/route.ts` and the read routes) must be able to create and view
new-engine lives. This is NOT a parallel new page.

S2. Legacy preservation: existing legacy lives, their stored data, and legacy requests keep
byte-identical behavior. Every test that passes at the RI1 baseline must still pass with its
assertions UNCHANGED; new cases are additive only. The only pre-existing failure is
`src/app/api/lives/stream/route.quiet.test.ts` ("Cannot read properties of undefined (reading
'data')") and it must remain the ONLY failure.

S3. Authority: for a new-engine life the lifecycle capsule
(`LIFECYCLE_CAPSULE_MANIFEST`) is the ONLY authority. Save = full current-authority
regeneration. Load = cold `deserializeLifecycleCapsule` + FULL replay. A stored digest, binding,
index, projection or summary is never authority and never short-circuits replay
(`keep_current_authority_full_replay_every_save`).

S4. Recognized-version dispatch, no implicit migration: a lifecycle binding carries its own
version and capsule manifest. The legacy canonical loader
(`canonical-branch-rb1` + `ANNUAL_CAPSULE_MANIFEST[0]`, `src/server/e-branch-repository.ts:128`)
must keep refusing a lifecycle binding, and the lifecycle loader must refuse an annual binding.
An unknown or foreign version is REFUSED, never coerced or translated into the other format.

S5. Additive schema, no migration: new tables are created with `CREATE TABLE IF NOT EXISTS`
alongside the existing ones in `src/server/db.ts`. Existing tables, columns and triggers are
untouched, and no existing row is rewritten or back-filled. Lifecycle capsule payloads live in
their own strict table with a conservative exact-schema check, mirroring the
`SqliteFavorRecords` guard style (`src/server/sqlite-favor-records.ts:26-40`); lifecycle
bindings live in their own table with the same immutability trigger pattern as
`canonical_branch_bindings` (`src/server/db.ts:85-92`).

S6. Save transaction: binding and capsule payload are written in ONE transaction using the
existing transaction helper (`withTransaction`, `src/server/db.ts:139`). The recorded digest is
recomputed from the admitted capsule, never accepted from the caller. An exact retry of the same
bytes is idempotent; a different digest for the same (life, branch) refuses.

S7. Create-route activation: the EXISTING create route gains a versioned branch that runs the
new engine (`runLifecycle`), streams the EXISTING SSE contract unchanged
(`LifeStreamEvent`, `src/contracts/life.ts:210-235`), and persists through S3-S6. A legacy
request follows the legacy path with no observable change. The existing abuse guard
(`guardSimulation`) is reused, never bypassed or weakened.

S8. Read activation: the existing read routes serve new-engine lives from a projection derived
ONLY from the trusted regenerated lifecycle output. No stored projection is authority, and a
projection that disagrees with regeneration is a refusal, not a repair. Legacy lives read
exactly as today.

S9. Evidence: each unit carries its own focused tests (RED observed before implementation where
a runnable deterministic expectation exists); `pnpm typecheck` exit 0; eslint clean on touched
files; full suite with S2's single pre-existing failure and nothing else.

S10. Every unit closes with a `Risk:` line naming a high-risk item or `none`.

## Tasks

| ID | Specs | Route | Status | Evidence |
|----|-------|-------|--------|----------|
| T1 RI1a persistence seam | S3,S4,S5,S6 | delegated writer + independent verifier | IN PROGRESS | — |
| T2 RI1b create route + SSE | S2,S7 | pending | pending | — |
| T3 RI1c read route + projection | S2,S8 | pending | pending | — |
| T4 RI1d whole-unit evidence | S2,S9 | pending | pending | — |

## Log

L1 (2026-10-21) — human verbatim: "mvp del motor nuevo". MVP scope is CA1b -> LC1 -> RI1 -> RA1
with CQ1 carried as open risk; RI1 is the third unit.

L2 (2026-10-21) — human verbatim: "Integrar LC1, gate como metrica". LC1 integrated as
`138b95b`, native review `review-d1c36c534c463771` approved and acknowledged, coverage demoted
to a reported `coverage-open` metric tracked as CQ1.

L3 (2026-10-21) — human verbatim: "Activar el seam en la app legacy". Chosen over a parallel new
surface after evidence: the canonical seam is exported and caller-free
(`life-store.ts:138-140`, doc-commented "Inactive canonical boundary; route activation belongs
to RI1"), both capsule digests already satisfy the binding key shape, and the binding is a single
`binding_json TEXT` (`db.ts:79-84`) so a new recognized version needs no schema change. The cost
of this choice was stated before the decision: the same seam currently admits only the annual
capsule (`e-branch-repository.ts:128,175`) and persists the legacy representation, so activation
touches existing files instead of only adding new ones.

L4 (2026-10-21) — RI1a started. Mapping evidence this unit rests on: zero production callers of
`e-lifecycle*` under `src/app` or `src/server`; the legacy write path binds the world through
`registerLife` (`life-store.ts:496`) with the whole `SimulationResult` plus per-year `snapshots`;
the read path builds chronicles from stored records (`life-chronicle.ts:227,238`); the SSE
contract is a POST-based `event:`/`data:` union parsed by `parseLifeStreamFrame`
(`life-client.ts:26`); `canonical_branch_bindings` is immutability-triggered and the legacy
loader refuses any binding whose version is not the annual one; `favor_records_v1` is schema-locked
to one exact physical shape with no extensions allowed.

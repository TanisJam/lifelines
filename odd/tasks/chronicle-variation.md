# Chronicle variation — no repeated event titles in one life

Objective: a life must never present the same vignette title twice; repeated situations must read differently.
Branch: `feat/chronicle-variation` off `main` (0227cd1). Delivery: work-unit commits, single PR at the end.
Test runner: `pnpm test` (vitest), `pnpm typecheck`, `pnpm lint`.

## Specs

S1 — Variants per vignette. Every vignette declares how many phrasings it has. `title` and each outcome's `prose` take a variant index in `[0, variants)` and must render that variant's text. A vignette with `variants: 1` behaves exactly as today.

S2 — Deterministic variant. The variant of an event is the number of times the same vignette already happened to this protagonist before it, in `(year, id)` order — so occurrence N uses phrasing N. The selection path and every read path (chronicle, person sheet, timeline) compute the same index from the same event log, without storing the choice on the event. A year-keyed hash was tried first and rejected: it made each vignette offer exactly one possible phrasing per year, so different years collided on the same phrasing and the pool exhausted long before its content ran out.

S3 — No repeated title within a life. A vignette whose variants are all already used by that protagonist is not offered again. Consequence under test: across a full life, the set of vignette titles has no duplicates.

S4 — Prose varies with the title. Each variant carries its own outcome prose, so a returned situation never repeats the same sentence verbatim.

S5 — Locale parity. Every variant renders non-empty, distinct EN and ES text, for the title and for every outcome's prose.

S6 — Nothing else changes. Other event kinds, season eligibility, the parent-decided attribution and the existing 5-year pacing window keep their current behavior.

S7 — Bounded fallback. If every eligible vignette has exhausted its variants, a year still gets one entry (existing fallback). That repetition is a documented edge, never the normal path; a life of ~70 years must not reach it.

S8 — Content coverage. Content must be sized from measurement, not guesswork: the variant count per vignette covers its observed frequency in a full life.

## Tasks

| ID | Spec | Route | Status |
| --- | --- | --- | --- |
| T1 | S1, S2 | inline | done — 693b89e |
| T2 | S3, S6 | inline | done — 693b89e |
| T3 | S4, S5 (frequent vignettes) | inline | done — 693b89e (four variants each) |
| T4 | S4, S5 (remaining vignettes) | inline | done — bdf11c1 (all 28 carry ≥3 phrasings, 88 total) |
| T5 | S3, S8 invariant test + measurement | inline | open — 70-year life still falls back late (see L5) |
| T6 | docs | inline | pending |

## Log

L1 (user, verbatim): "estoy probando una vida y si bien mejoro la siengo sintiendo medio repetitiva o vacia, el que se repitan titulos de eventos me quiza de la inmersion de que estoy leyendo una vida real, siepre deberia haver variaciones https://lifelines.mnr.ar/es/life/life10-mvl08wds?branch=lb15-mvl0bkq2"

L2 — Measured on `life10-mvl08wds` (Mario, 1327–1397, legacy engine): 71 entries for 70 years (exactly one per year), 38 distinct titles, 47 of 71 entries are vignettes with only 20 distinct prose texts. `A feast day in Middleton` appears 11 times with byte-identical prose. `src/domain/vignettes.ts` holds 28 vignettes, each with one fixed title and one fixed prose per outcome; selection only excludes a vignette used in the last 5 years, so it returns byte-identical after the window.

L3 — Synthetic full life (`cap-0`, 1327–1400, `protagonistId: protagonist`, rules engine): 80 entries, 57 vignette entries over an eligible pool of 19 vignettes. Frequency: feast-day 9, market-day 8, neighbor-needs-help 8, old-debt 8, hard-winter 5, poor-harvest 4, first-glance 2, aches-of-age 2, thirteen others once each. **Sizing:** a normal life needs ~57 distinct phrasings; the 28-vignette pool provides 28 with one phrasing each. Three variants per vignette (84) covers any plausible pool; four on the four most frequent covers 33 of the 57 on its own. This is why the task is content-bound, not code-bound.

L4 — After 693b89e (mechanism + four vignettes at four variants): same life, distinct texts 44 → 58. The remaining repeats come from the S7 exhaustion fallback (31 available phrasings for 57 vignette-years), which is exactly what T4 removes.

L5 — After bdf11c1 (all 28 vignettes at 3 phrasings, the four most frequent at 4; 88 in total): distinct texts 63, worst repeat 2×. The limiting factor is not the 88 but ELIGIBILITY: this protagonist's pool is 15 vignettes, so only ~48 of the 88 phrasings are reachable, against 57 vignette-years. The last ~9 years therefore hit the S7 fallback. Closing it needs either a fourth phrasing on the adult-eligible vignettes (~12 more slots) or more adult-eligible situations — content, not code.

L6 — The 2× in L5 was an artifact: the exhaustion check had been added only to the override-catalogue builder, not to the live single-pick path (`pickVignette` via `buildDailyLifeVignetteDescriptor`), so the filter never ran. Instrumented the real path: with the filter wired in, the eligible pool for this protagonist runs out around year 45 of a 70-year life, and the remaining ~25 years come from the S7 fallback. Also replaced the year-keyed variant with an occurrence index (S2): the year hash gave each vignette exactly one phrasing per year, so cross-year collisions were structural, not bad luck. Diagnosis is now measured, not inferred: unused pool 6–8 at year 30, 0 by year 45.




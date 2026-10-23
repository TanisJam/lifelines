# Chronicle variation — no repeated event titles in one life

Objective: a life must never present the same vignette title twice; repeated situations must read differently.
Branch: `feat/chronicle-variation` off `main` (0227cd1). Delivery: work-unit commits, single PR at the end.
Test runner: `pnpm test` (vitest), `pnpm typecheck`, `pnpm lint`.

## Specs

S1 — Variants per vignette. Every vignette declares how many phrasings it has. `title` and each outcome's `prose` take a variant index in `[0, variants)` and must render that variant's text. A vignette with `variants: 1` behaves exactly as today.

S2 — Deterministic variant. The variant of an event is derived only from `(world seed, vignette id, year)`. The selection path and every read path (chronicle, person sheet, timeline) must compute the same index for the same event without consulting mutable state or the order in which narration happens.

S3 — No repeated title within a life. A vignette whose variants are all already used by that protagonist is not offered again. Consequence under test: across a full life, the set of vignette titles has no duplicates.

S4 — Prose varies with the title. Each variant carries its own outcome prose, so a returned situation never repeats the same sentence verbatim.

S5 — Locale parity. Every variant renders non-empty, distinct EN and ES text, for the title and for every outcome's prose.

S6 — Nothing else changes. Other event kinds, season eligibility, the parent-decided attribution and the existing 5-year pacing window keep their current behavior.

S7 — Bounded fallback. If every eligible vignette has exhausted its variants, a year still gets one entry (existing fallback). That repetition is a documented edge, never the normal path; a life of ~70 years must not reach it.

S8 — Content coverage. Content must be sized from measurement, not guesswork: the variant count per vignette covers its observed frequency in a full life.

## Tasks

| ID | Spec | Route | Status |
| --- | --- | --- | --- |
| T1 | S1, S2 | inline | pending |
| T2 | S3, S6 | inline | pending |
| T3 | S4, S5 (frequent vignettes) | inline | pending |
| T4 | S4, S5 (remaining vignettes) | inline | pending |
| T5 | S3, S8 invariant test + measurement | inline | pending |
| T6 | docs | inline | pending |

## Log

L1 (user, verbatim): "estoy probando una vida y si bien mejoro la siengo sintiendo medio repetitiva o vacia, el que se repitan titulos de eventos me quiza de la inmersion de que estoy leyendo una vida real, siepre deberia haver variaciones https://lifelines.mnr.ar/es/life/life10-mvl08wds?branch=lb15-mvl0bkq2"

L2 — Measured on `life10-mvl08wds` (Mario, 1327–1397, legacy engine): 71 entries for 70 years (exactly one per year), 38 distinct titles, 47 of 71 entries are vignettes with only 20 distinct prose texts. `A feast day in Middleton` appears 11 times with byte-identical prose. `src/domain/vignettes.ts` holds 28 vignettes, each with one fixed title and one fixed prose per outcome; selection only excludes a vignette used in the last 5 years, so it returns byte-identical after the window.

# Narrative life-course — L1 shared biological distribution

## Current boundary

**L1 — IN PROGRESS:** the three-file implementation writer has completed the behavior-preserving extraction. Writer validation and both independent compatibility/parity checks passed. The verification freeze has ended; parent local work-unit commit, native COMMITTED assessment and unit-close review remain pending. **Not DONE.**

- Authority: user direction **7481**; preserve seeded life-course behavior and minimal-favor scope.
- Parent: [Narrative engine](narrative-engine.md). Its task document and main mirror **6902** remain unchanged.
- Baseline/current HEAD: `68036f77330ea72039e5e7d09a97d926284796a7` (read-only confirmation during tracker integration).
- Latest source commit: `4fd0bbe1245c0e47f2a80b119d1412be5082e92b` (`feat(storage): persist admitted annual capsules through immutable records`).
- H1, H2, H3, H4 and R1 remain closed; do not reopen them.
- Dedicated full-document mirror: observation **7483**, project `lifelines`, topic `odd/narrative-life-course/tasks`. Update the complete mirror and read it back during tracker integration. Do not replace observations **6902**, **7341** or **7467**.

## One task

- [ ] **L1 — Extract `biologyDistribution` unchanged and prove seeded parity.** Status: **IN PROGRESS — writer and independent verification complete; parent commit/native closure pending**. One implementation writer; parent owns orchestration, independent verification, native review and local work-unit commit.

This distribution-only seam is potentially usable by E2b. It does not implement, approve or certify whole life-course/physical migration, autonomous annual execution or resource policy.

### Completed implementation surfaces

| Path | Writer change | Authored diff |
|---|---|---|
| `src/domain/life-course-rules.ts` | Export the unchanged distribution with its type import. | 17 additions |
| `src/domain/life-course-rules.test.ts` | Pure distribution contract and legacy seeded-sample parity. | 61 additions |
| `src/domain/simulate.ts` | Import the export; delete only the old local function. | 1 addition / 16 deletions |

Actual source/test scope: **3 paths, 95 authored lines, 79 additions / 16 deletions**. Tracker integration may edit only this document and its explicitly authorized full mirror; it must not alter source. Pre-existing untracked `.claude/` is preserved. No provider, database, dependency or child-task changes are included.

### Read-only source fingerprints at integration

| Path | SHA-256 |
|---|---|
| `src/domain/life-course-rules.ts` | `bfd102ac0ec5601d16bccb326a4d706fdeb494841d313aa921d64a950e44ce3e` |
| `src/domain/life-course-rules.test.ts` | `be6ee9ee7e8c31b381f045e4d72f31cfab7bbec0cc62e92ac17f60b00677e40c` |
| `src/domain/simulate.ts` | `9bd1421bd861ff60bc357d88aac35afce9a224aa9ea5122c879410bcb8e5825a` |

### Preserved contract

Baseline CodeGraph mapping located `biologyDistribution` at `src/domain/simulate.ts:2271–2285`, with one caller: `resolveBiologyDecision` (baseline start line 3627, call line 3649). The integration read-only simulator diff contains only the import and deletion. `resolveBiologyDecision`, its sampling tuple, forced path and resulting records are unchanged.

| Kind | Ordered keys and weights |
|---|---|
| `illness` | `illness: p`, `healthy: 1 - p` |
| `death` | `die: p`, `survive: 1 - p` |
| `return` | `return: p`, `stay: 1 - p` |
| `arranged-match` | `arrange: p`, `no-match: 1 - p` |
| `levy` | `impose: p`, `spare: 1 - p` |
| default, including arrival kinds | `arrive: p`, `no-arrival: 1 - p` |

Preserve branch order, comments, arithmetic and insertion-ordered keys. No probability validation, normalization, clamping or default fallback change. No changes to hazards, sampling, overrides, mortality IDs, annual phase order, providers, quotas, migration activation or economy defaults.

## Observed writer evidence

The following lifecycle and validation results are supplied by the implementation writer, not independently rerun by this tracker-only integration:

- **RED:** missing new module; 1 failed suite, 0 tests collected.
- **GREEN:** 153 new-module tests passed.
- **Compatibility:** 288 tests across 4 files passed in **156.05 seconds** after an initial **120-second timeout**. Retain the timeout as execution history, not a current test failure.
- Nonincremental TypeScript, scoped lint and whitespace checks passed.
- Writer environment: Node **26.8.1**, Vitest **5**, TypeScript **5.9.3**, ESLint **9.39.5**, Next **16.3.5**. Vite warning was nonfatal.
- Triangulation covers explicit kinds and fallback, exact ordered arithmetic at boundaries/intermediate values, signed zero, out-of-range and nonfinite probabilities without validation/clamping, and fresh records.
- Seeded sample parity checks chosen outcome, noise and scores with the original `(seed, personId, year, kind)` tuple and ordered keys. These tests are distribution/sampling evidence, not whole life-course migration evidence.

## Independent verification — completed

Both independent checks completed under the candidate-write freeze; that freeze has now ended. Results below are parent-supplied evidence, not reruns by this tracker-only update.

- **Node 24.20:** 288 tests across 4 files passed in **145.37 seconds**; nonincremental TypeScript, scoped lint and whitespace checks passed.
- **Node 26.8:** focused 153 tests passed. Exact parent stdin baseline proof using `git show 68036f7` confirmed the exported helper body is byte-identical, including comments; the simulator differs only by one import and deletion of the local function. Sampling, forced path and caller bytes are unchanged.
- Four before/after SHA fingerprints were identical; HEAD and working-tree status were stable. The three source fingerprints above remain unchanged.
- No technical blocker remains. An ambiguous internal child Engram summary is bookkeeping context, not a validation failure.
- No whole-output golden, full-suite, build or browser validation is claimed. These checks prove the bounded extraction and seeded sampling parity, not whole-feature certification or a policy change.

## Remaining delivery gates

1. Complete this tracker-only update and update/read back the complete **7483** mirror at topic `odd/narrative-life-course/tasks`; confirm whitespace, baseline HEAD and the three source fingerprints remain unchanged.
2. Parent makes the local **four-path work-unit commit**: this tracker plus the three implementation surfaces above. No source edit is authorized by this tracker update.
3. Parent obtains native **ASSESS COMMITTED** assessment against base `68036f7`, then performs unit-close review before marking L1 **DONE**. This closes only L1, not the whole narrative feature. No commit, native assessment or closure is claimed here.

If a later gate requires a corrective source write, reopen the bounded integration and refreeze before repeating affected independent verification. Keep meaningful tests; the 400-line guidance is advisory and this coherent source diff is 95 authored lines.

## Next product boundary — not approved

E2b resource/replenishment policy remains unresolved. Ask only at the actual next affected boundary; do not auto-approve or implement any option:

- **A — finite resources** (scout option A).
- **B — conserved grain with renewable HELP** (scout option B).
- **C — annual abstract budgets** (scout option C).

Proposed question at that boundary: “Which E2b resource/replenishment policy should govern the next implementation: A, B or C?” L1 does not depend on silently selecting an answer.

## Key learnings

Factual closing distinguishes writer completion, completed independent verification and still-pending committed closure. The seam owns only ordered biological outcome probabilities; seeded sampling and physical life-course orchestration remain with existing callers. An unchanged extraction and sample-parity tests do not authorize whole life-course migration or economy policy. Preserve the historical timeout without misreporting it as a current failure, and keep source fingerprints and baseline HEAD fixed through tracker integration.

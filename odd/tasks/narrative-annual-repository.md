# Annual runtime repository — inactive E3 R1

## Status and parent boundary

**R1: IN PROGRESS — independently checked, not closed.** The bounded implementation writer and three independent checks are complete. The verification freeze has ended; source bytes remain unchanged. The parent local commit and native COMMITTED review boundary remain pending. R1 is not DONE; this document does not close all of E3.

Parent: [Narrative engine — E3 production forks and persistence](narrative-engine.md#e3--production-forks-and-persistence). Leave the parent file and its Engram6902/7341 observations unchanged.

Parent-provided bridge: H1–H4 are completed; latest source boundary is `6e7b57f`. Actual opening HEAD is `9a86855008f6077415b5143aa4e7d8d70acdf27c`. The latest passive bookkeeping assessed 24 authored lines, bringing the running total to **13,891**. Those are inherited receipts, not new R1 implementation or validation evidence.

Repository locator: `/home/tanisjam/Projects/Personal/lifelines`.
Full-file mirror topic: `odd/narrative-annual-repository/tasks`.

## R1 — Content-addressed AnnualRuntimeRepository

- [ ] **IN PROGRESS:** Implement, test, independently verify, review and locally commit an inactive `AnnualRuntimeRepository` over the existing injected `FavorRecords` port.

One coherent task; no separate adapter or production-activation task is included. The completed implementation writer was bounded to:

- `src/server/e-repository.ts`
- `src/server/e-repository.test.ts`

This bookkeeping writer changes only this tracker; the parent owns its full-file mirror update/readback, integration, human interaction, native review and terminal Git actions. This tracker-writing transaction starts no children and performs no source writes, tests, Git mutation or native review.

### Contract

| Operation | Required behavior |
| --- | --- |
| Save | Admit the input with `admitAnnualRuntimeCapsule`, serialize canonical wire and derive its validated digest key before using storage. |
| Existing record | Decode and semantically validate the stored capsule, require its digest to match the key, and require canonical bytes to equal the candidate wire. Reject corruption or conflicting wire; never silently accept an existing row. |
| Insert | Use the existing trusted atomic immutable-insert port contract. Preserve idempotent retries and concurrent-conflict behavior; do not replace port atomicity with a read-then-write assumption. Validate any existing winner through the same record checks. |
| Load | Reject keys other than exactly 64 lowercase hexadecimal characters before `port.read`, deserialization, replay or digest checking. Decode/replay admitted records and require their digest to match the requested key. |
| Failures | Propagate synchronous and asynchronous port/codec/replay failures without false successful publication. Do not invent rollback or retry guarantees beyond the trusted port. |
| Ownership | Return independently detached, deeply frozen admitted outputs on every load, including cold loads through a fresh repository instance. Never mutate caller input. |

The persisted runtime payload is **one complete capsule**, whether initial or annual output, not a retained checkpoint collection. Rules-only runtime admission does not establish human-history support, authenticated provenance or whole-E3 completion.

### Explicit exclusions

No new storage adapter, database import, route or life-store integration, branch binding, latest pointer, retention/deletion behavior or provider policy. No activation of the repository in production. Preserve existing architecture, port semantics and unrelated files, especially `.claude/`.

## Acceptance and evidence plan

Strict test-first development applied to the source transaction; writer receipts are recorded below. This passive tracker update has no meaningful behavioral RED and runs no source tests itself.

Use existing `MemoryFavorRecords` in repository tests; it is **not durability proof**. Build real runtime capsules with full source/checkpoint fixtures rather than hand-forged success envelopes. Cover:

- Strict codec and getter admission, including rejected inputs without getter execution or caller mutation.
- Invalid digest keys rejected before any storage read; missing records under the existing port convention.
- Corrupt wire, semantic tampering, digest/key mismatch and conflicting canonical wire.
- Synchronous/asynchronous read and insert failures, retry idempotence and concurrent insert races.
- UTF-16 actor IDs, including lone surrogates; independent cold loads, fidelity, deep freezing and detachment.

### Validation sequence

1. Writer: Node26 focused repository Vitest tests first; compatibility tests for existing favor repository, E capsule and E runtime; type checking, scoped lint and whitespace checks.
2. Independent verifier: fresh offline Node24 compatibility, types and scoped lint; Node26 adversarial capsule/runtime checks using existing tests; actual offline SQLite-injected `AnnualRuntimeRepository` stdin probes on both Node24 and Node26 using only `:memory:` and the existing adapter. No live database or filesystem database; no installation or network. Keep this proof distinct from memory-port tests, and report unavailable evidence rather than claim durability.
3. Parent: inspect exact source/test boundary and functional receipts, make the local commit, then ASSESS the committed unit/range against the applicable native review boundary. Keep R1 IN PROGRESS until functional checks, native boundary and local commit are satisfied.

Resolve exact existing validation commands before the future source transaction; this tracker does not authorize arbitrary scripts, generated out-of-scope output, dependency mutation, installation, provider/network calls or a live database. Do not claim skipped checks passed. Delivery is local only: no push or PR.

## Budget and closure

Forecast: source **40–70** authored lines plus tests **140–220**, totaling **180–290**; advisory review budget **400** authored lines. Measure actual authored changes, including tracker bookkeeping, before closure; forecasts are not receipts.

### Completed writer receipts (parent supplied)

- Authored implementation boundary: source **48** lines + tests **202** lines = **250** authored lines, excluding tracker bookkeeping; within the 400-line advisory review budget.
- `src/server/e-repository.ts` SHA-256: `7e5ee4fb0210cb557022e2c590b93861ab645486307810a1dcac6f71d5b83523`.
- `src/server/e-repository.test.ts` SHA-256: `69fb89c1b7e179975f9a8a8333ffbf18312854a08b540f10d9c66bca094e549c`.
- RED: missing implementation module, 0 tests executed and 1 failed suite. GREEN: 13 focused tests passed. Final focused run: 13 passed.
- Compatibility: 214 tests across 6 files passed. Type checking, scoped lint and whitespace checks passed; no unexpected failures reported.
- Writer environment: Node **26.8.1**, Vitest **5**, TypeScript **5.9.3**, ESLint **9.39.5**.
- Exact source-test commands were not supplied to this tracker transaction; these are parent-forwarded writer receipts, not independently rerun checks.
- The repository uses the injected `FavorRecords` port; atomic immutable insertion remains the trusted port's responsibility. Memory-port tests do not prove SQLite behavior or durability. Actual in-memory SQLite verification is recorded separately below.

### Completed independent checks (parent supplied)

All three independent checks completed before the verification freeze ended. These are forwarded receipts, not fresh tests or probes run by this tracker writer; exact invocation text was not supplied.

1. **Node24.20 compatibility:** 214 tests across 6 files passed. The parent's additional 13-test focused spot check, types, scoped lint and whitespace checks passed; no failures reported.
2. **Node26.8 adversarial checks:** 204 tests across 5 files passed in 7.71 seconds. Source audit confirmed admission before storage, strict keys and non-string wire rejection, rejection of forged records with matching digests, races, failures and ownership. This check does not claim a fresh probe.
3. **Actual SQLite injection:** the parent's stdin probe used `AnnualRuntimeRepository` → `SqliteFavorRecords` with `:memory:` on both Node24 and Node26. Each runtime passed 4 cases and 4,788 checks: prototype-sensitive, NUL and lone-surrogate Unicode fidelity, exact wire and keys, retry/conflict with unchanged table row, cold load and deep freezing. This proves only the exercised in-memory adapter behavior, not on-disk durability or production activation.

Three before/after hash sets preserved opening HEAD `9a86855008f6077415b5143aa4e7d8d70acdf27c` and both recorded source hashes. The two source files and their 250 authored lines are unchanged. Initial Engram summaries were ambiguous internal/nontechnical failures, not functional test failures; no successful mirror update is inferred from them.

### Remaining delivery gates

1. Parent makes the local commit of the three-path unit: `src/server/e-repository.ts`, `src/server/e-repository.test.ts` and this tracker. No commit is claimed here.
2. Parent then **ASSESS**es the native unit/range from opening HEAD `9a86855008f6077415b5143aa4e7d8d70acdf27c` and satisfies the **COMMITTED** boundary before checking R1 done. No native review is claimed here; preserve the reviewed source bytes.
3. Measure tracker bookkeeping and final authored totals before factual closure. Parent owns the explicitly memory-authorized full-document mirror update/readback at observation **7467**, topic `odd/narrative-annual-repository/tasks`, retaining repository locator `/home/tanisjam/Projects/Personal/lifelines`; leave parent observations **6902/7341** untouched. This tracker writer does not claim mirror readback.

Next action: parent local commit of the three paths, then native ASSESS of the committed unit/range from `9a86855`, before marking R1 done. Source hashes and opening HEAD are unchanged at this bookkeeping boundary. R1 remains IN PROGRESS; completion of this repository unit alone leaves production E3 integration and inherited-canon binding pending.

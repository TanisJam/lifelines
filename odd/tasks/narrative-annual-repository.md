# Annual runtime repository — inactive E3 R1

## Status and parent boundary

**R1: DONE — inactive repository unit only.** The bounded implementation, three independent checks, observed parent local commit and parent-reported native COMMITTED approval/consumed ACK close R1. Source bytes remain unchanged. This does not activate production storage or close all of E3.

Parent: [Narrative engine — E3 production forks and persistence](narrative-engine.md#e3--production-forks-and-persistence). Leave the parent file and its Engram6902/7341 observations unchanged.

Parent-provided bridge: H1–H4 are completed; latest source boundary is `6e7b57f`. Actual opening HEAD is `9a86855008f6077415b5143aa4e7d8d70acdf27c`. The latest passive bookkeeping assessed 24 authored lines, bringing the running total to **13,891**. Those are inherited receipts, not new R1 implementation or validation evidence.

Repository locator: `/home/tanisjam/Projects/Personal/lifelines`.
Full-file mirror topic: `odd/narrative-annual-repository/tasks`.

## R1 — Content-addressed AnnualRuntimeRepository

- [x] **DONE:** Implement, test, independently verify, review and locally commit an inactive `AnnualRuntimeRepository` over the existing injected `FavorRecords` port.

One coherent task; no separate adapter or production-activation task is included. The completed implementation writer was bounded to:

- `src/server/e-repository.ts`
- `src/server/e-repository.test.ts`

This bookkeeping writer changes only this tracker and its explicitly authorized full-file mirror at observation **7467**, project `lifelines`, topic `odd/narrative-annual-repository/tasks`. The parent owns integration, human interaction, native review and terminal Git actions. This tracker-writing transaction starts no children and performs no source writes, tests, Git mutation or native review.

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

### Observed local closure and parent native receipt

- Observed local HEAD: `4fd0bbe1245c0e47f2a80b119d1412be5082e92b`; exact committed tree: `eff843482d98d4133339d710436826c62d739a74`.
- Committed unit: three paths, **343 additions** = source/tests **250** + tracker **93**. Observed medium slice is under the 400-line advisory budget; slice closure was performed (parent receipt).
- Feature authored total through `4fd0bbe`: **13,891 + 343 = 14,234**. The parent's later passive closure commit is excluded from this total.
- Parent-reported native **COMMITTED** boundary: `9a86855` → `4fd0bbe`, review `review-598174870f7960a9`, approved; ACK **BURNED**. Target `16fd8318a32550b57e6a9b637c7040dd6a6d9176466482ff4a576b369ebf3529`; consumed `d7663786405cb286239c3c0cf877ef72bd2c7c4ff8bbd83848261e93eacae476`. This is the supplied approval/consumption receipt, not a STATUS inference or a fresh native call.
- Closure inspection preserved both recorded source SHA-256 values and HEAD `4fd0bbe`. All three independent functional receipts above remain distinct; Node24/Node26 SQLite `:memory:` checks establish neither on-disk durability nor production activation.
- Full-document mirror replacement/readback is authorized only for observation **7467** and this tracker topic/locator; parent observations **6902/7341** remain untouched.

Next: genuine **E2b policy approval** before autonomous E1 production work. There is no source authority beyond closed R1. Whole-E3 branch bindings, retention, UI/open-life policy and F-quality decisions remain human-owned later work. H1–H4 are already closed elsewhere; do not reopen them. Production E3 integration and inherited-canon binding remain pending.

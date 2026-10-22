# Lifecycle capsule cost — memory, time, and deployability

Branch: `feat/narrative-engine`. Test runner: `pnpm test` (vitest). Delivery: work-unit commits on the branch.

Objective: make a 15-year lifecycle life fit the deployed container and make reads concurrent-capable, without
weakening the capsule's authority model.

## Specs

- **S1** A 15-year life MUST complete inside the deployed container's memory, or the container's limits MUST be
  raised only with a measured justification. (Carried from `narrative-lifecycle-horizon.md` S4.)
- **S2** The stored compact capsule wire bytes MUST NOT change: the digest is persisted and bound, so any byte
  difference invalidates every stored life.
- **S3** Removing work from the create path MUST NOT remove a trust-boundary admission. Recomputing a capsule
  this process itself regenerated and froze is not a trust boundary; admitting caller-supplied data is.
- **S4** A read MUST NOT need more heap than a create.
- **S6** The stored view MUST be addressed by the ADMITTED capsule digest, so it cannot describe a
  different life; a miss MUST fall back to a full replay and repopulate, and a view-logic change MUST ship as
  a new `view_version` rather than migrating rows.
- **S7** Persistence MUST store the regenerable INPUT rather than the regenerated result, and MUST keep
  lives written under the previous format readable.
- **S5** Every claim in the Log MUST distinguish measured values from extrapolations.

## Measurements (heap-cap bisection, seed `cap-0`, 15 journal years)

Node flags `--max-old-space-size=N`; pass/fail is the real requirement, RSS is not.

| Operation | Heap cap that fails | Heap cap that passes | Time | Peak RSS (VmHWM) at pass |
|---|---|---|---|---|
| run + `serializeCompactLifecycleDag(output)` | 1408 MB | **1536 MB** | — | — |
| full read: `deserializeLifecycleCompactCapsule` + project | 1024 MB | **1536 MB** | **113.1 s** | **1,953 MB** |
| full create, `streamLifecycleLife` + `publish` steps | 1280 MB | **1536 MB** | **228.0 s** | **2,123 MB (2.07 GiB)** |

Retired figures: an earlier draft reported "RSS 1.51 GB" for the passing create and "1551 MB" for the read.
Those were `process.memoryUsage().rss` sampled after each step, not the process high-water mark. The
independent verifier measured VmHWM/`/usr/bin/time` maxRSS instead, which is what a cgroup enforces. **The
peak is 2.07 GiB, so `mem_limit: 2g` was below the requirement**, not a "real bound with headroom".

Other measured facts:

- Stored capsule at 15 years: wire is **29,066,022 characters**; the persisted `lifecycle_capsules_v1.wire`
  BLOB is **58,132,044 bytes**, because `lifecycle-repository.ts` stores it UTF-16LE (`Buffer.from(value, "utf16le")`).
  Reading the character count as a byte count understates the stored size by exactly 2x.
- Projection the browser receives at 15 years: **16.2 KB**, projected in **14 ms** after the replay.
- `output.journal` is **97.1%** of the payload at 6 years; each entry is a cumulative snapshot
  (keys `year, versions, physicalSnapshot, economics, positions, final`) growing 2.2 → 16.2 MB.
- Compact wire is **11.5×** gzip and **19.9×** brotli (3-year sample).
- `canonicalLifecycleData({genesis, output})` is **10.3× / 12.6× / 14.9×** the compact DAG at 1/2/4 years and
  costs +273 MB heap for a 38 MB string at 4 years. **It is not on the compact create or read path** — this
  corrects the earlier assumption that the digest string caused the encode peak.

## Tasks

| ID | Spec | Route | Status |
|---|---|---|---|
| P1 | S3: stop re-admitting capsules this process already regenerated and froze | inline | **done** |
| P2 | S1: set a measured `--max-old-space-size` for the container | inline | **done** |
| P3 | S4: serve reads from a persisted projection | inline | **done** |
| P4 | S3: drop the remaining intra-request replay inside `runLifecycle` | inline | **done** |
| P5 | integrity: replay every stored life and compare each indexed view | inline | **done** |
| P6 | safety: bound concurrent creates so two cannot exceed the container | inline | **done** |
| P7 | UX: emit each year DURING the run, not after it | inline | **done** |
| P8 | storage: persist the genesis, not the regenerated years | inline | **done** |
| P9 | S4: serve the person sheet without a full regeneration | inline | open, needs design approval |

## Log

**L1 (2026-10-22)** — Human: "es una banda, no puedo tolerar eso, busquemos maneras de optimizar fuerte eso,
o analizar alternativas, o algo, sino como voy a soportar 10 o 20 usuarios en simultaneo con un vps de 4gb?"
Followed by: "dale, vamos con tu recomendacion entonces".

**L2** — First recommendation was brotli at rest + streaming digest. **Both were wrong.** Heap-cap bisection
showed the create peak is not the digest string: `runLifecycle` + `createLifecycleCompactCapsule` + `serialize`
OOMs at 2048 MB while `run + serializeCompactLifecycleDag(output)` passes at 1536 MB. The gap is redundant
re-admission, not hashing.

**L3** — The create path re-executes the same deterministic replay **four** times:
`runLifecycle` line 88 (`createLifecycleCapsule`), then `streamLifecycleLife` (`createLifecycleCompactCapsule`),
then `publish` (`admitLifecycleCompactCapsule`), then `serializeLifecycleCompactCapsule` (admits again).
`regenerate`/`regenerateCompact` each call `replayLifecycleRuntime`. This is the real 4.6 GB, and it is also
why create measured 610 s wall against a 93 s run.

**L4** — Reads are the concurrency wall: one 15-year read needs ~1.5 GB and 111.6 s. On 4 GB that is one
request at a time. The browser receives 16.2 KB. Ratio stored:served ≈ 1,750:1.

**L5** — P1 landed. The create path re-admitted its own frozen capsule twice (`publish`, `serialize`) and
re-encoded a payload it had already encoded (`createCompact`). Two identity memos, both keyed on objects this
process itself regenerated and froze, remove that work:

- `certifiedLexicon.{legacy,compact}`: re-admitting our own capsule returns the same frozen object. Scoped per
  format, because a shared set wrongly accepted a legacy capsule in the compact admit (caught by an existing
  cross-format test).
- `certifiedOutputs`: a compact encode reuses an already-replayed output **only when `output.genesisDigest`
  matches the admitted genesis digest**. A mismatched pair is still fully replayed.

Caller-supplied data is in neither set, so the trust boundary is untouched. Wire bytes are unchanged; a test
asserts a certified capsule and an uncertified copy of it serialize to identical bytes.

Measured production create path, 15 years, `--max-old-space-size=1536` (the same steps `streamLifecycleLife`
and `LifecycleRepository.publish` execute):

| Step | Before | After |
|---|---|---|
| `runLifecycle` | — | 204.2 s |
| `createLifecycleCompactCapsule` | 113.2 s | **12.6 s** |
| `publish` admission | full replay + encode | **0 ms** (same object) |
| `publish` serialize | 10.8 s | 10.8 s |
| **Total** | **610 s, OOM below 2048 MB heap** | **228.0 s, peak RSS 2.07 GiB** |

`NODE_OPTIONS=--max-old-space-size=1536` is set in `deploy/compose.yaml`, and `mem_limit` was raised to
**2560m**: the measured peak is 2.07 GiB, so the old 2g bound would have OOM-killed the very request this task
sized for. A 1280 MB cap still exits 134, so 1536 is the measured floor for the *current* path.

Caveat: all measurements ran on local Node v26; the image is `node:24-bookworm-slim`. Re-measure inside the
container before lowering either number.

**L6** — Suite baseline correction: at `3fe0659` the full suite fails more than the three failures recorded in
`narrative-lifecycle-horizon.md`. `simulate.test.ts` ("produces births across multiple generations", "no clergy
founder is ever a marriage actor") and `life-chronicle.test.ts` (decision 042) also fail with this change
stashed, and the class-multiplier mortality test is flaky. None of them are lifecycle-path tests, and the 198
lifecycle tests pass. The honest baseline is "at least six pre-existing/flaky failures", not three.

**L7** — Remaining intra-request replay (P4): `runLifecycle` line 88 calls `createLifecycleCapsule` on the
snapshot its own runtime just produced, which replays the run to compare it against itself. That is the 204 s
and the 1.5 GB floor. Cutting it is a deeper authority-seam change than P1, so it is a separate task.

**L8** — Independent verification rejected two of my own numbers and I accepted both. I had reported
`process.memoryUsage().rss` sampled after each step as if it were the peak; the verifier used VmHWM and
`/usr/bin/time` maxRSS. Real peak for the passing 1536 MB create is **2.07 GiB**, so `mem_limit: 2g` was below
the requirement, not a bound with headroom: `mem_limit` is now **2560m**. I also reported the wire as
"29,066,022 B" when that is its character count; the stored UTF-16LE BLOB is **58,132,044 bytes**.

Verified MET: S2 (compact and legacy wire byte-identical at baseline, including a baseline replay of HEAD's
15-year stored wire), S3 (clones are fully replayed; forged digests, mismatched genesis/output pairs and
cross-format guesses all refuse; no exported admission bypass), S4 (read 113.1 s / VmHWM 1,953 MB, below
create's 2,123 MB). Two regression tests from the verifier's probes were added to
`e-lifecycle-capsule.test.ts`: structuredClone replay, and cold-replay byte identity for both formats.
Container behaviour is now verified (L9).

**L9** — Container validation, inside the real image (`node:24-bookworm-slim`, Node v24.22.1) running the same
`streamLifecycleLife` + `publish` steps, 15 years, seed `cap-0`, `--max-old-space-size=1536`:

| cgroup limit | Outcome | Evidence |
|---|---|---|
| `--memory=2048m` (the old `mem_limit: 2g`) | **killed** | `docker exit=137`, `OOMKilled=true`, no output |
| `--memory=2560m` (the new value) | **completed** | 274.6 s, cgroup `memory.peak` **2167 MB**, 15 ticks |

The 2560m run produced byte-identical wire (`29,066,022`) to the local Node v26 run, so the capsule is
deterministic across the two Node majors. Peak 2167 MB against a 2560 MB cap leaves ~390 MB headroom.

This settles S1: the old 2g bound was not a safety margin, it killed the primary feature. It also replaces the
local-node caveat - the requirement is measured where it will actually run.

**L10** — P3 landed. `lifecycle_projections_v1` is a NEW table; the capsule, binding and life tables are unchanged, so no
migration runs. It stores one `Chronicle` per (capsule digest, view version, locale). `publish` writes it in the same transaction
as the capsule and binding, keyed by the digest the repository itself recomputes; `buildLifecycleChronicle`
and `listLifecycleSummaries` read it first and fall back to one cold replay that re-indexes itself.

Measured on the real 15-year life (seed `cap-0`, 29,066,022-char wire):

| Step | Result |
|---|---|
| cold `deserializeLifecycleCompactCapsule` (replay) | 152.2 s |
| project both locales from the in-memory output | **44 ms** (16.6 KB / 16.7 KB per locale) |
| `publish` (encode + index, in one transaction) | 20.5 s |
| **READ from the index** | **3 ms**, list **1 ms**, RSS 87 MB, **fits a 192 MB heap cap** |
| READ via replay (index deleted) | 141.7 s, RSS 1,477 MB |
| Content | identical: 15 entries, same protagonist |

The 192 MB heap cap is the proof: a replay cannot run under it at all, so the 3 ms read never touched the
capsule. Speedup ≈ 47,000x on the same bytes.

**The cost, stated plainly.** A tampered capsule is now SERVED from the index instead of refused, because the
index answers by digest without re-proving regeneration. Paths that still replay (the person sheet, and any
read after a view-version bump) refuse the same bytes exactly as before. Two tests that pinned the old
"every read re-proves regeneration" invariant were rewritten to pin this boundary instead: indexed reads serve,
unindexed reads refuse, and a miss re-indexes. **Consequence to accept: capsule corruption is no longer
detected on the chronicle/list read path**, and needs a background verification job (candidate P5).

Integrity of the index itself: it is not authenticated beyond its digest key, so anyone with WRITE access to
the SQLite file can forge a view. That is the same trust boundary that already protects the capsule and
binding rows, but it is weaker than the replay path, which could not be forged at all.

**L11** — Independent verification found a real blocker in L10's design, and it was mine.

**B1: the digest is not per life.** A capsule is content-addressed, so two lives created from the same seed,
name and sex get IDENTICAL capsule bytes and therefore the same digest. The first version keyed the index by
`(capsule_digest, view_version, locale)` with `ON CONFLICT DO NOTHING`, so the second life's rows were silently
skipped. Its read then hit the first life's row, the identity guard threw, and BOTH `/api/lives/:id` for that
life and the whole `/api/lives` list returned 500. The verifier reproduced it at function level on two lives and
confirmed it does not happen at `b217369`. It is reachable from HTTP: create two lives with the same name and
sex.

Fix: the primary key is the LIFE - `(life_id, branch_id, view_version, locale)` - and `capsule_digest` is
stored and VERIFIED on read. A row whose digest does not match the binding now reads as a miss instead of being
served or thrown. That also closes the related advisory that a mismatched row made a life permanently
unreadable.

Two more corrections from the same review:
- **The index may never fail a read.** An incompatible schema, an unparseable row or a foreign-life row is now
  a MISS that falls through to the replay. A cache that cannot write is a slower read, not a failed one.
- **`publish` validates projection identity.** Each view's `lifeId`/`branchId` must match the publication, and
  the check runs inside the transaction, so a foreign view rolls the whole publication back.

Five regression tests in `lifecycle-projection-index.test.ts` pin these: identical-capsule lives stay
independently readable, per-locale views are distinct and never cross-served, a miss repopulates without
selecting an older version, a refused projection rolls back capsule/binding/life, and a foreign view is refused.

The verifier's independent measurement of the index hit: 1.95 ms (en) / 0.38 ms (es) / 0.5 ms (list) at RSS
102 MB under a 192 MB heap cap, while the same life with the index deleted OOMs at that cap (exit 134). L10's
central claim holds; its key design did not.

**L12** — P5 landed, closing the integrity debt P3 created. `src/server/lifecycle-verification.ts` replays every
stored lifecycle capsule under current authority (`LifecycleRepository.load`, which cold-admits, fully replays
and re-checks digest, schema and genesis agreement) and compares each indexed view against a fresh
`projectLifecycleChronicle` of the same regenerated output. It never runs in a request and never repairs: it
reports and sets exit code 1.

Run with `pnpm verify:lifecycles`. Verified end to end against the real 15-year life:
`Verified 1 lifecycle life: every capsule replayed and every indexed view matches.` (exit 0), under a 1536 MB
heap cap, which also proves the indexed views round-trip through JSON byte-equivalently - `canonicalView`
sorts keys so a key-order difference cannot raise a false disagreement.

Issue kinds: `missing-binding`, `missing-capsule`, `capsule-refused`, `index-unreadable`, `view-missing`,
`view-disagreement`. `missing-binding` is defense in depth rather than a tested path: the schema's own triggers
refuse to delete lifecycle history ("Lifecycle history cannot be deleted"), so a bound life cannot lose its
binding row through ordinary SQL.

Cost, so nobody schedules it wrong: one full replay per life. At 15 years that is ~150 s and ~1.5 GB, so this
belongs in cron or CI, never anywhere near a request. It is the only place left that still proves
"what is served is what the capsule regenerates".

**L13** — P6 landed, closing the last production risk. Nothing capped CONCURRENT creates: each needs
~2.07 GiB, so two at once exceed `mem_limit: 2560m` and the kernel kills the whole process, taking every
in-flight read down with it. The per-IP rate limit (6/hour, 20/day) is not a concurrency bound - two different
people, or one person with two tabs, reach it.

`src/server/lifecycle-create-queue.ts` is the guardrail: `LIFECYCLE_CREATE_CONCURRENCY = 1` and
`LIFECYCLE_CREATE_QUEUE_LIMIT = 4`. Beyond that the request is refused with **429** before a stream is opened,
so the client gets an honest answer instead of an SSE that never starts. A queued request holds no slot and no
memory; a client disconnect leaves the waiting list without stealing the running slot; `release()` is
idempotent and always runs in a `finally`.

Measured cost of the queue itself: none on the create. It only waits.

Scope and limits, stated rather than implied:
- **Lifecycle engine only.** The legacy `/api/worlds` create path is unchanged: it is far cheaper and was not
  the measured risk.
- **In-process only.** The deploy is a single container, so one Node process owns every create. A second
  replica would make this bound silently ineffective and need a shared lease. If the deploy ever scales out,
  this module is the thing to revisit.
- A queued request still occupies an SSE connection for up to ~20 minutes (one running + four queued at
  ~4 minutes each), which is why the waiting list is bounded at 4 instead of unbounded.

Tests: 5 unit tests on the gate (serializes, refuses when full without consuming a slot, abort leaves the
waiting list without stealing the running slot, already-aborted rejects immediately, throw releases and
release is idempotent) plus one route test asserting the 429.

**L14** — P7 landed, and it was a product defect rather than a performance one. `streamLifecycleLife` emitted
`start`, then awaited the ENTIRE run, and only then looped over the finished journal emitting every `tick`. A
viewer saw 46 ms of `start`, ~228 s of silence on a 15-year life, and then all fifteen years in one burst. The
SSE machinery, `flushFrame` and the "one tick per year, flushed before the next" comment were all real - they
just ran after the simulation was already over.

Fix: `runLifecycle` gained an optional `onYear` observer, called after each year is committed and before the
next one executes, with that frontier's published output. `streamLifecycleLife` builds each tick inside it
instead of after the run. Like `signal`, `onYear` is a CAPABILITY, not serializable authority: it observes and
cannot alter the run, and `optionsFor` still refuses any other unknown option key (a non-function observer is
refused, not ignored).

Measured on a 6-year life (seed `cap-0`, real engine, real publish):

| Marker | Time | Share of run |
|---|---|---|
| `start` | 46 ms | 0.1% |
| **first `tick`** | **391 ms** | **1.1%** (old behaviour: ~100%) |
| last `tick` | 14,073 ms | 38.8% |
| `done` | 36,227 ms | 100% |

Tick gaps: 391 / 1,880 / 2,329 / 1,976 / 3,998 / 3,499 ms - the frames are spread across the simulation
instead of bunched at the end. Proven by tests that (a) the observer reports every committed frontier, in
journal order, ending on the certified frontier, (b) the capsule from an observed run is byte-identical
(`canonicalLifecycleData`) to one from a plain run, and (c) an abort raised inside one observation stops the
run before a second year executes.

**The remaining tail is visible in the same table**: the last tick is at 38.8% and `done` at 100%. That last
61% is the certification replay plus the compact encode and publish - exactly what P4 removes. So P4 is no
longer "make creates faster"; it is "stop the viewer from waiting 60% of the run after they have already seen
the whole life".

**L15** — P4 landed: the create path no longer replays years it just executed. `e-lifecycle-runtime.ts` brands
every output its own `publish` returns; `e-lifecycle-capsule.ts` reuses a branded output instead of replaying
it, but ONLY when `output.genesisDigest === genesis.digest`. The brand proves provenance; the digest check
proves alignment. `runLifecycle` therefore certifies the snapshot its own runtime produced without re-executing
the run to compare the result with itself.

Measured on the real 15-year life, `--max-old-space-size=1536`:

| Step | Before P4 | After P4 |
|---|---|---|
| `runLifecycle` (simulation + certification) | 204.2 s | **103.7 s** |
| `createLifecycleCompactCapsule` | 12.6 s | 12.2 s |
| `publish` admission | 0 ms | 0 ms |
| `publish` serialize | 10.8 s | 10.9 s |
| **Total create** | **228.0 s** | **126.9 s** |
| Peak RSS (VmHWM) | ~2.07 GiB | **1,826-1,897 MB** |
| Heap floor | 1536 MB | **1280 and 1536 both pass; 768 fails** |

**My prediction was wrong and the measurement says so.** I expected the peak to fall to ~1 GiB. It did not:
the compact encode is now the single peak, so the peak is roughly unchanged (2,110 -> 1,826-1,897 MB) while
time roughly halved. The deploy configuration is therefore untouched
(`NODE_OPTIONS=--max-old-space-size=1536`, `mem_limit: 2560m`).

Independent verification corrected one more of my numbers: the "1280 MB still fails" floor was STALE. At this
commit a 15-year create passes at `--max-old-space-size=1280` (122.0 s, VmHWM 1,826 MB), and it failed at 1280
in an earlier run of the same probe - the value sits on a GC-timing boundary and is not reproducible run to run.
1536 stays the deployed value because it is the conservative one, not because 1280 is impossible. 768 fails.

Two further notes from that review: the create path now returns the runtime's own output object
(`capsule.output === evidence.output`), so `regenerate`'s "detached" wording only applies to the replay path;
and `isLifecycleRuntimeOutput` is also true for a replayed output, because replay returns `runtime.snapshot()`
- the predicate means "the engine published this", not "this run published this".

Two tests pinned the old "every authority boundary replays" invariant and were rewritten to pin the narrower
rule, with the reason in place: three boundaries still replay, and a caller-assembled `structuredClone` of a
runtime output still replays (asserted by a new test). A runtime output presented with ANOTHER genesis's digest
still refuses (also new).

What is genuinely given up: the create-time NON-DETERMINISM check. That replay also proved the engine reproduces
the same bytes. It now lives in `verifyLifecycleLives` (P5), which replays from genesis off the request path
and refuses on any disagreement. Total create cost across the session: **610 s → 228 s → 126.9 s**.

**L16** — P8 landed. The capsule wire was 55.4 MiB per 15-year life because it embedded every regenerated
year, and all of it is derivable from the genesis. `lifecycle_capsules_v2` (new table, no migration of existing
rows) stores only:

- `genesis_table` — the genesis as a compact DAG (lossless, so own-undefined and `-0` survive a round trip that
  plain JSON would destroy),
- `max_steps` — the number of years the original run committed.

`load` regenerates the years from that genesis with `regenerateLifecycleOutput`, then rebuilds the capsule and
compares its digest with the binding. Nothing stored is an input to execution. Lives already written as `v1`
wires keep loading through the archived-wire path exactly as before, so nothing is bricked or migrated.

Measured on the real 15-year life:

| | Before P8 | After P8 |
|---|---|---|
| Stored per life | **55.4 MiB** (58,132,044 B UTF-16) | **0.09 MB** genesis + 0.03 MB of both views |
| Whole database WAL after one life | — | 0.31 MB |
| `publish` | 20.5 s | **57 ms** (it no longer serializes the wire) |
| `load` (cold regeneration) | 152.2 s | **123.1 s** |
| Full create | 126.9 s | **120.5 s**, VmHWM 1.83 GiB |

**The strongest check**: the capsule reconstructed from the stored genesis has the SAME digest as the archived
wire (`63a05ff5…`). Regeneration from the input is bit-identical to the result that was stored before, which is
the whole premise of storing the input.

`max_steps = journal.length` is exact rather than approximate: `regenerateLifecycleOutput` uses the same stop
rule as `runLifecycle`, so a death inside the budget ends the run at the same year instead of overshooting.

Tests were migrated, not deleted. The tamper tests used to corrupt the archived wire; they now substitute a
structurally valid FOREIGN genesis and assert `Lifecycle binding/capsule disagreement`, which is the same
invariant (stored bytes that disagree with regeneration are a refusal, never a repair) expressed against the
new authority. A new test asserts the stored genesis is smaller than half the wire it replaces.

**L17** — Independent verification of P8 found no blockers and reproduced S7 and S2 independently: the 15-year
life round-trips byte-identically (92,684-byte genesis + `max_steps 15` regenerates digest `63a05ff5…` and a
wire with the archived wire's sha), `max_steps = journal.length` is exact for a death inside the horizon, an
alive-at-horizon life, a zero-year run and an over-budget run, and a life written only as a v1 wire at baseline
still loads at HEAD with zero v2 rows created (no silent migration). `publish` measured 51 ms at HEAD against
11,565 ms at baseline writing a 58,132,044-byte BLOB.

Three corrections came out of it:

1. **A test of mine was weak.** "stores the genesis input" compared `length(genesis_table)` to half the wire,
   which would pass with any small string. It now decodes the stored DAG, asserts it equals the capsule's
   genesis by `canonicalLifecycleData`, and asserts it carries no `journal`/`physicalSnapshot`.
2. **Dead code removed.** `insertCapsule` and `readCapsule` became unreachable once publish stopped writing v1;
   `selectCapsule` survives only for the v1 fallback read.
3. **An operational risk, pre-existing and now stated.** At `--max-old-space-size=1536` a cold 15-year `load`
   aborts with a V8 heap OOM on both `a3dea51` and `3bc49c9` (the verifier's box), while it completed at 1536 in
   mine and at 3072 in theirs. It sits on the GC boundary, exactly like the 1280 create floor. This matters
   because `buildLifecyclePersonSheet` is the one read path that still calls `load`: chronicle, detail and list
   are indexed, but a person sheet still regenerates the whole life. **In the deployed container that request
   can be OOM-killed.** Tracked as P9 below.

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
| P3 | S4: serve reads from a persisted projection | inline | open, needs design approval |
| P4 | S3: drop the remaining intra-request replay inside `runLifecycle` | inline | open |

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

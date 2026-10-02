# Narrative engine: simulate life, discover story, render language

**Status: architecture proposal, not implementation authorization.** Lifelines should generate a
seeded, deterministic world without LLM decisions, preserve its consequences, and select a much
smaller story from that history. This evolves the existing engine; it is not a replacement built
on a blank slate. Approval of this direction does **not** approve every algorithm or number below.

## Quick review path

1. Verify the current-code map and the boundary between reality and interpretation.
2. Review replay, scheduling, and the favor → obligation vertical slice before event density.
3. Resolve the readiness checklist before authorizing the first implementation work unit.

### Evidence and decision labels

| Label | Meaning |
|---|---|
| **Current** | Confirmed repository behavior or type, with `path:line` evidence. |
| **Adopted** | User-endorsed direction that this proposal must preserve. |
| **Default proposal** | Implementable starting point requiring implementation review. |
| **Hypothesis** | Calibration experiment, not a quota or measured result. |
| **Open** | A decision still needed before the affected phase ships. |

The source handoff is `lifelines_narrative_engine_handoff.md` (provided outside the repository).
Its event counts, weights, relationship dimensions, and phase order are suggestions, not approvals.
Repository artifacts are English; see [single-life contract](single-life-contract.md) and
[mind model](../mind-model.md). Those older documents contain superseded behavior: use the code
map below for current facts. The [decision log](../decisions.md) is append-only; any later adopted
reversal belongs in a new entry, not an edit to an old decision.

## 1. What already exists

All references are repository-relative. Line numbers describe the checkout reviewed for this design.

| Area | Current evidence | Consequence for this design |
|---|---|---|
| Canonical records | `src/domain/types.ts:148–158`: `Event` has ID, year, kind, actors, payload, causes, and optional mutable significance. | Extend the log; separate derived scores from immutable records. |
| People | `src/domain/types.ts:51–85`: identity, parents, spouse, occupation, class, literacy, death, and away-person marker. | Do not introduce a duplicate person registry. |
| Inner life | `src/domain/mind.ts:44–89`: dream, needs, thoughts, stress, facets, values, five memories, five ranked relationships. | Desires and traits exist; explicit fears, obligations, and multi-axis ties need scoped additions. |
| Mind effects | `src/domain/mind.ts:194–214`: keyed core-memory roll, bounded memory eviction, facet shifts, relationship updates. | Preserve causal continuity; memory currently contains text/year, not an event reference. |
| Life state | `src/domain/life-state.ts:14–38, 78–105`: decision slots, marital/residence/vocation axes, extensible situations. | Reuse state-machine and slot conventions rather than parallel bookkeeping. |
| Tick loop | `src/domain/simulate.ts:2296–2325, 3592–3600`: clones inputs, starts a fresh decision array, snapshots/yields annually, stops at protagonist death. | Multiple hidden events can start inside annual ticks; decision-prefix restoration needs explicit treatment. |
| Biology/order | `src/domain/simulate.ts:2373–2375`: illness precedes death for an actor. | Existing phase order matters; additional scheduler order must be versioned. |
| Social selection | `src/domain/simulate.ts:2733–2756`: adapter supplies joint selection probabilities; domain samples event-pick, then response. | Current model-driven opportunity selection must migrate as well as response decisions. |
| Rules adapter | `src/adapters/decision/rule-decision-maker.ts:19–43`: deterministic rule responses and hazard-based yearly selection. | Available migration base, not proof that all desired inner-life influences already exist. |
| Server provider | `src/server/decision-engine.ts:12–25, 49–56`; `src/server/abuse-guard.ts:55`: Jev/rules chosen by server configuration; background rules under Jev. | Current production path is not unconditionally model-free or deterministic. |
| Jev judgments | `src/adapters/decision/jev-decision-maker.ts:251–281`: cached remote distribution on miss. | Seeded sampling alone cannot guarantee replay across uncached model judgments. |
| RNG and identity | `src/domain/rng.ts:48–55`; `src/domain/events.ts:13–16`; `src/domain/decision-id.ts:25–33`. | Keyed RNG already exists; event occurrence counts and decision ordinal/attempt IDs are different identities. |
| Narrative | `src/domain/narrate.ts:1185–1205`: filters protagonist events, folds illness, returns significance with adapter/heuristic fallback. | Existing prose is template-based, not an unconstrained novel generator. |
| Chronicle | `src/server/life-chronicle.ts:195, 244–259`: live heuristic narration; final provider scoring; yearly vignette guarantee. | Separate presentation selection from that guarantee; do not equate stored events with cards. |
| Story circle | `src/domain/story-circle.ts:11–32`: protagonist, family, romance and feud partners. | Existing scope boundary is a good base for detailed social simulation. |
| Display time | `src/domain/month.ts:135–150`: derived month/fractional-year positions depend on year's event pool. | Display moments are not authoritative simulation timestamps. |
| Fork | `src/domain/fork.ts:12–18, 34–46`: restore year-before snapshot, force one option, resimulate suffix. | Preserve year-level fork semantics first; repeated rewrites need inherited override history. |
| Persistence | `src/server/life-store.ts:79–89, 230–245, 319–321`: read-time legacy class mapping; compressed result/snapshots; parent/override branch records. | Preserve legacy rows; add versioned envelopes and replay provenance. |
| Storage codec | `src/server/db.ts:43–74, 165–178`: cumulative snapshots in compressed JSON blobs, quality-5 Brotli. | More events can amplify cumulative-copy costs despite compression. |
| Streaming | `src/app/api/lives/stream/route.ts:97–135`; `src/server/sse.ts:12–44, 59–65`: annual live ticks, abort on disconnect, completion persistence, event-loop yield. | Keep quiet-year frontier updates and cancellation behavior. |
| Rewrite stream | `src/app/api/lives/[lifeId]/rewrite/stream/route.ts:55–79, 108–155`: recorded decision year, validation, restored inputs, divergence/ticks, completion-only registration. | Route/store/contract migration must be coordinated, not domain-only. |
| Period | `src/app/api/lives/stream/route.ts:14–17`; `src/domain/period/events.ts:79, 101, 141–145`. | Run starts 1327; dated pressures include 1348–49 and 1361–62 pestilences and labour legislation. |

**Current limitation:** the standalone rules replay and A-baseline measurements below do not prove
the full production invariant. Neither remote caching nor comments about determinism prove it.
The UI route permits up to 100 lifespan years after 1327; the named period does not imply every
later year has researched content. Older Tudor comments/specifications are not the current setting.

## 2. Authority and ownership

**Adopted:** simulation owns reality. Director, selector, graph analysis, and prose cannot rewrite it.

```text
seed + config + versions + initial state + override history
                         |
                  Simulation kernel <---- deterministic director
                  | rules / scheduler      (opportunity weights only)
                  | atomic effects
                  v
             Canonical event log + state checkpoints
                  | read-only, at an explicit frontier
                  v
        Derived narrative graph / live scorer / final sifter
                  v
        Selected beats + protected evidence bundles
                  v
        Templates [optional validated LLM wording] --> Chronicle / SSE
```

| Owner / port | Input → output | Forbidden authority |
|---|---|---|
| Domain kernel | Versioned state + commands → ordered committed events/state | Network models, wall-clock randomness, prose facts |
| Opportunity catalog | Read-only state/frontier → eligible candidate descriptors | State writes or invalid actor creation |
| Rules policy (`DecisionMaker` migration base) | Eligible options + person context → distribution | Director-driven response weights or invented options |
| Director | Prior committed history/state → bounded opportunity multipliers + diagnostics | Outcomes, preconditions, biology, forced closure |
| Effect reducer | Validated outcome + current state → atomic state delta | Narrative salience as an effect input |
| Event/checkpoint store | Validated commits → durable log/checkpoint | Reinterpreting old canonical facts |
| Narrative analyzer/selector | Log prefix + as-of state → graph/scores/evidence beats | Calling the kernel to manufacture better material |
| Prose adapter | Evidence bundle + locale/style → validated wording or template | Writing state, relations, memories, outcomes |
| API/chronicle adapter | Kernel ticks + selected beats → existing contract frames | Equating card count with simulation progress |

**Default proposal:** retain the hexagonal split (`src/domain`, adapters, server, contract).
Split the overloaded decision-provider responsibilities gradually: deterministic opportunity and
response policies in the kernel, optional language/scoring services downstream only. Freeze inputs
or pass immutable projections; assert canonical hashes before/after narrative operations in tests.

## 3. Small typed contracts, not a second world model

**Default proposal:** augment existing `Person`, `PersonMind`, `LifeState`, `Event`, and
`DecisionRecord`; these sketches show boundaries, not final exported names or complete code.

```ts
type EventId = string;
type TimeKey = { year: number; phase: number; sequence: number };
type Versions = { engine: string; rules: string; content: string; rng: string };
type RunManifest = {
  schema: number; versions: Versions; seed: string;
  configHash: string; initialStateHash: string; overridesHash: string;
};
type CanonicalEventV2 = {
  id: EventId; logicalId: string; at: TimeKey; kind: EventKind;
  actors: readonly string[]; payload: Readonly<Record<string, JsonValue>>;
  causes: readonly EventId[]; decisionId?: string;
  effects: readonly Effect[]; // registered, versioned discriminated union
};
type Obligation = {
  id: string; debtor: string; creditor: string; origin: EventId;
  status: "open" | "fulfilled" | "broken" | "lapsed";
};
type Thread = {
  id: string; origin: EventId; participants: readonly string[];
  kind: string; status: "open" | "dormant" | "resolved" | "abandoned";
};
type MemoryInterpretation = {
  eventId: EventId; appraisal: "gratitude" | "resentment" | "fear";
  intensity: number; core: boolean;
};
type NarrativeBeat = {
  id: string; evidence: readonly EventId[]; asOf: TimeKey;
  mode: "live" | "retrospective"; scoreVersion: string;
};
```

An `Effect` starts as a small discriminated union for resource transfer, obligation transition,
relationship delta, and memory creation; reject unknown discriminators/schema versions. Do not
hide arbitrary executable patches in `payload`. Store outcome effects so reducer replay is possible;
re-simulation separately checks that rules reproduce the same committed outcome/effects.

Keep facets and values on their existing scales. Retain dreams/needs as desires; add one typed
fear target only when a rule consumes it. Add a small resource balance (integer units, explicitly
abstract) for the favor slice, not an unimplemented land market or complete economy. Occupation,
class and literacy remain existing state rather than proxies for precise wealth.

Start directed relationship state with trust and resentment alongside compatibility/legacy bond
views. A→B need not equal B→A. Do not initialize every possible pair or add every suggested axis.
Obligations are objective commitments; a memory is an actor's appraisal of an evidenced event,
not proof that the other actor was selfish. Two appraisals may conflict without contradicting facts.
Simulation threads are persistent unresolved conditions; analyzer-only themes/echoes are separate.
Retain origins even when working-set memory text or dormant indexes are compacted.

## 4. Time, scheduling, and atomic causality

**Default proposal:** keep annual `simulateYears` ticks and annual snapshots/SSE initially.
Add bounded opportunity slots inside a year, rather than immediately adopting monthly simulation.
A canonical `TimeKey` orders within-year commits; a cause can be in the same year but must have a
strictly earlier key. Derived display months must not reverse this order or decide fork boundaries.
Seasonal/monthly ticks remain an **Open** later choice, with a temporal-version migration.

Proposed tick procedure:

1. Apply deterministic clock/decay and dated world pressures using existing biology conventions.
2. Construct a read-only opportunity frontier; gather eligible candidates from changed state,
   due obligations and registered storylets, not every storylet for every NPC.
3. Compute director weights from committed history only. Draw opportunity slots with keyed RNG.
4. Order candidates by versioned phase, priority, then stable candidate key using bytewise ordering.
5. Revalidate actor liveness, location, resources, relationship state and allowed options against
   current committed state; a candidate gathered before a death is not automatically still valid.
6. Resolve choices via deterministic person/rules policy and dedicated response RNG keys.
7. Validate the complete effect batch, apply it to a staged state, and append event(s) atomically.
8. Schedule caused continuations at a strictly later key; cap same-year cascades deterministically.
9. Checkpoint, derive live selection at that frontier, yield annual progress, and check cancellation.

Conflict proposal: exclusive writes (spouse change, consuming one resource unit, closing one
obligation) use ordered first-valid commit. Later candidates revalidate and are rejected or deferred
by their registered policy; never silently resample until a desired result appears. Diagnostic
rejections are not life events. Effects within a commit are a single transaction: no half-transfer,
no obligation without its favor, no committed child without required family links. Invalid effects
fail validation without changing state/log. Independent effect batches may execute computationally
in parallel only if deterministic merge produces the same serial commit order.

**Current:** existing biology explicitly resolves illness before death; retain that order in the
initial path. Introducing new event families must not multiply annual mortality/courtship hazards
by the number of hidden slots. Existing hazards remain once-per-year unless a reviewed conversion
preserves their total probability. Zero-event and quiet years are valid; no forced dramatic event.

### Identity and random streams

Current event IDs count prior events for `(year, kind, ordered actors)`; current decision IDs use
slot ordinals/attempts. Neither convention alone supplies a replayable multi-slot scheduler.

**Default proposal:** define a stable candidate key from rule/content ID, subject or canonical pair,
time slot, and local attempt ordinal persisted in scheduler state. Derive logical event IDs from
candidate key + outcome-event ordinal; do not use global array length, card order, timestamps, or
async completion order. Use length-prefixed/canonical encoding and reject duplicate IDs.

Namespace independent RNG purposes: world pressure, opportunity, response/option, memory,
director tie-break, presentation. Include RNG version, seed, candidate key, purpose, and draw index.
Retain the existing keyed mechanism where possible, but version changed key composition. Canonical
sorting, option order, numeric normalization/rounding, and hash encoding are part of the contract.
Do not promise bitwise cross-runtime numeric portability until the supported runtime is tested.

Branch-qualified public IDs may use `logicalId@<deterministic-branch-suffix>` for **new suffix events**.
Derive that suffix from canonical parent lineage + targeted decision + explicit override command,
not the server's wall-clock branch ID. Retain all pre-fork IDs verbatim, including causal references.
The suffix is **not** an RNG seed: an unrelated opportunity's draw should not change just because
another decision was overridden. Branch-qualified identity distinguishes histories; semantic
logical keys and recorded effects distinguish actual changes. Ghost matching remains a separate
comparison, not evidence that differently identified events are causally equivalent.

## 5. Director: opportunities, never outcomes

**Adopted:** the director is deterministic and may change opportunity probabilities only.
It may notice dormant obligations, repetition or social isolation; it may not choose reconciliation,
resurrect an actor, invent a relative, override resources, or guarantee resolution before death.
A response distribution has no director input. A multiplier cannot make an ineligible event eligible.

**Default proposal:** start disabled (all multipliers 1). Then test clamp `[0.75, 1.5]`, at most two
boosted families per year, and one-year cooldown per family. Persist policy version, cooldowns and
any counters in checkpoints; use stable tie-breaks, never model inference or runtime latency.
Cap total additional opportunity mass at 10% of the eligible baseline mass; preserve an explicit
no-op/quiet residual. If baseline mass is zero, the director adds none. Log proposed/effective
weights in diagnostics; do not store these as fictitious in-world events.

These are reviewable safety defaults, not demonstrated engagement improvements. Compare disabled,
neutral and enabled runs; excessive consequence concentration or drama inflation fails calibration.
Do not boost lethal pressures to repair a flat story. Unresolved obligations are not narrative
quotas; a quiet life can remain quiet, and threads can lapse, transform, or remain unfinished.

## 6. Select and weave; do not produce ten times the cards

**Adopted:** roughly tenfold hidden activity supplies a pool for weaving, selection and compression.
**Hypothesis:** compare hidden consequence-bearing activity against the measured current baseline,
normalized by lived years and story-circle exposure. Do not target exactly 800 events or force an
80-year lifespan. Merely duplicating vignettes creates volume without a richer life.

The canonical log is append-only evidence. A derived narrative graph indexes causal dependencies,
relationship trajectories, obligations and threads. Causal edges require existing earlier events;
reject missing, forward and cyclic edges at commit/import. The defensive walker at
`src/domain/causality.ts:14–22` is useful for display, not a substitute for those validations.
Echo/reversal/theme edges are interpretation edges in a separate graph with scorer version and
supporting event IDs; resemblance must never be presented as a proven cause.

**Default proposal:** use deterministic live scores from immediate state/effect magnitude,
relationship change, obligation/thread relevance and irreversibility; tie-break by canonical key.
Keep all retrospective scores outside `Event.significance`. Live analysis reads only the prefix and
as-of person state, not final people, later descendants, future deaths or final-theme labels.
Test prefix invariance: extending a run cannot change its previously emitted live evidence/score.

Retrospective analysis may count downstream consequences, propagate importance backward through
causes, and recognize echoes. Label resurfaced context as hindsight; do not rewrite an old live
claim as if the reader or character knew its future meaning. A final summary may differ from the
live chronology without changing the underlying records.

Selection preserves a causal closure bundle for each chosen beat: choice, obligation origin,
required relationship/resource changes, and immediate enabling causes. Compress minor antecedents
into cited context rather than dropping them for a fixed card budget. Bound graph traversal and
cache closures; if evidence cannot fit safely, use a factual short beat with an expandable context
bundle or defer selection, never invent a bridge. Anchors such as protagonist death stay explicit.

Allow empty `tick.entries` while the annual frontier advances. Adjacent quiet years may become one
period summary; repeated maintenance may become one beat supported by several real events.
A compressed beat must expose its individual editable decision, or not advertise a single turn.
Keep the contract's `level: 3`/turn agreement; richer multi-turn cards need separate contract review.
Selectors do not create memories or affect subsequent choices. Themes remain evidence-based,
optional interpretations, not preassigned arcs or mandatory lessons.

## 7. First vertical slice: a favor with a later cost

**Default proposal, illustrative fiction within the repository's fourteenth-century setting:**
use a small abstract grain favor between two living villagers in 1336, then a later help request.
This does not claim the repository already has a grain economy or this storylet.

| Commit | Valid preconditions | Canonical evidence and lasting effects |
|---|---|---|
| E1: favor granted | Both present/alive; lender has one transferable unit; borrower can receive it | Transfer unit; create obligation O1; record beneficiary's gratitude memory anchored to E1. |
| E2: help requested later | Creditor needs help; debtor alive/present; O1 open; help/refuse both feasible | E1 enables E2; record eligible options and deterministic response distribution informed by values, fear, resources and O1. |
| E3: help or refusal | Revalidate chosen option and O1 | Cause E2 (and O1 origin); fulfill/break O1; update directed trust/resentment; create evidenced appraisal. |

The earlier favor can remain hidden live, then be cited when E3 is selected. It becomes important
because a registered rule actually consumed O1, not because the sifter invented gratitude later.
Verify the choice distribution differs when the obligation is removed under otherwise equal
conditions; a probabilistic influence need not flip every seed. Record which state factors were
read so “why?” is answerable without asserting that one factor fully determined a human choice.

For the initial year-level fork fixture, E1 must occur in a year strictly before the E3 decision's
fork year. That refusal fork retains E1 and its ID, changes the E3 suffix, and produces different
relationship state; unrelated keyed draws remain unchanged unless their relevant state changed. Test death,
absence, exhausted resources, already-closed obligation, opposing values, and competing requests.
No automatic reconciliation, no mandatory repayment, no obligation duplicated by resuming.

## 8. Replay, storage, branches and streaming migration

**Adopted replay identity:** same seed, effective config, engine/rules/content/RNG versions,
initial conditions and ordered explicit override history produce the same canonical log and state.
Director policy/settings are part of rules/config. Narrative score/prose versions, locale, transport
IDs, timestamps and timing statistics are not reality inputs. If a canonical rule reads a field,
that field must be captured in the manifest/initial state or reproducibly generated by its version.

**Default proposal:** hash canonical serialization (sorted record keys, preserved ordered arrays,
finite normalized numbers). Store both manifest and initial-state data/reference, not hashes alone.
Version event schema, snapshot schema, reducer and scheduler state. Snapshot records include log
frontier/hash, person/relationship/obligation/thread state, slots, director state and pending queue.
Validate restored checkpoint/log agreement before replay. Reject unsupported versions explicitly.

Initially retain compressed result/year snapshots to avoid a simultaneous storage rewrite. Measure
cumulative duplication before adding checkpoint intervals or suffix-sharing. Later log-plus-periodic
checkpoints may reduce repeated history; reducer replay must reproduce the intervening state first.
Narrative graph/scores/prose are rebuildable caches keyed by log hash, frontier, versions and locale.

Legacy saves keep existing rows/IDs and read-only compatibility projections (as class mapping does
now). Do not fabricate obligations, causal links, missing initial conditions or cached judgments.
Legacy viewing stays available. **Default proposal:** allow exact legacy rewrites only with a
compatible engine/provenance; otherwise disclose unsupported replay and offer a separately named
new-generation life, not a silent upgrade. **Open:** supported legacy engine retention policy.

Keep year-before fork restoration initially. “Pre-fork” means years strictly before the fork year,
not every displayed month before the selected turn. Copy those events **and decisions** verbatim;
current simulation starts a fresh decision array, so prefix/lineage assembly must be explicit.
Carry inherited overrides in order for repeated forks and validate each targeted recorded decision;
the current one-start-year matching is not a general full-life override-history replay algorithm.
Same-year scheduler-prefix forks require a later explicit checkpoint/contract change.

Preserve `start`, annual `tick`, rewrite `divergence`, final `done`, and error shapes in
`src/contracts/life.ts`; hidden events stay server-side unless a separately reviewed evidence API
is needed. Keep immutable protagonist birth, editable death, ghost annotations and scene progress.
Model-free migration includes random-sex initialization (`src/app/api/lives/stream/route.ts:65`):
use seeded deterministic rules or capture explicit resolved sex as an initial condition, not a
remote judgment. Record any newly generated seed before simulation; seed generation is not replay.

Current disconnect cancellation abandons the unfinished run and does not register a partial branch.
Retain that behavior first. Resumability is a separate capability: an opted-in run checkpoint must
persist cursor, queue, manifest and override history atomically, then deduplicate emitted events on
resume. Restart from the last committed frontier; no half-effect checkpoint and no double favor.
SSE reconnect cursors/retention and cancellation checkpoint policy are **Open**, not existing support.
Never mark an incomplete run completed or advance the latest saved branch on cancellation.

### Unit A: standalone full-rules baseline

`src/domain/replay.ts` is a Node-only replay boundary, not production integration. It composes
existing `simulate` with a **fresh** `RuleDecisionMaker` per run; neither the kernel nor RNG nor
production provider selection changes. Tests independently generate complete small worlds at
1327 (six founders, end year 1332), retaining worldgen's initial events as well as people.

**Quick path:** create an envelope from `{ config, people, events, protagonistId }`, store its
canonical JSON, then call `replayRules` on the restored envelope. Existing provenance goes through
`validateReplayEnvelope`; never recreate an envelope to "repair" a failed input hash.

| Contract | Unit A behavior |
|---|---|
| Supported tuple | Envelope/projection `1`; engine `lifelines-d5d9ad5`, rules `rules-d5d9ad5`, content `content-d5d9ad5`, RNG `keyed-gumbel-d5d9ad5`. Every axis is required; unknown tuples fail before simulation. These name a reproducibility baseline, not promised future migrations. |
| Stored input | Resolved `WorldConfig` (including seed/town), complete initial people/minds/life state and events, effective protagonist ID or explicit `null`, actual person-registry traversal order, fixed effective options. Thought causes and memory text remain reality inputs. |
| Manifest | Stores tuple, seed, config hash and full input hash alongside the data. Seed/hash disagreement rejects rather than recomputing admission. |
| Supported mode | Full run, rules provider, concurrency 8, year-batch concurrency 64, no background adapter, director or overrides. Empty overrides and `fromYear === startYear` are equivalent to omission. Nonempty overrides, partial cursor, model requests and other options reject. |
| Canonical encoding | SHA-256 of strict canonical UTF-8 JSON; own plain records, sorted record keys, ordered arrays, finite JSON numbers, negative zero → zero. Reject undefined, array holes/extra properties, cycles, symbols, accessors, nonenumerable data, BigInt, functions and nonplain containers. |
| Canonical output | Complete final people plus actual traversal order; events retain ID/year/kind/ordered actors/payload/causes; decisions retain identity/year/person/optional partner/kind, ordered option IDs, chosen/source/causes/resulting-event IDs and final normalized distributions. |
| Excluded output | Event significance; decision question/labels/raw prior or Jev judgment/occurrence diagnostics/noise/fragility/surprise. Declared absent optional person/decision fields are deliberately omitted before strict encoding. Arbitrary nested undefined is not silently discarded. |
| Diagnostics | Original report remains available separately, including snapshots, counters and timings. Node/V8 versions and report diagnostics are returned separately, never hashed as reality. Unit A does not add snapshot hashes/storage. |

**Registry order is behavioral input.** Canonical key sorting only proves serialization stability,
not permutation-invariant simulation. The envelope encodes the original `Object.keys(people)`
sequence explicitly and restores that insertion order before invoking the kernel after a JSON
roundtrip. A different registry order has a different input identity even when the people-map
serialization is identical. Ordered events, actors, causes and options are not sorted.

**Validation boundary:** admission checks own-data JSON, required envelope/config fields, supported
options/versions, basic person identity/vocabulary/mind/life-state shapes, registry agreement and
basic unique event IDs/kinds/actors/payload/causes. Hashes detect disagreement with recorded inputs;
they do not authenticate their author or certify arbitrary domain structures. This is **not** a
complete causal/chronological/kinship/range validator or safe execution sandbox for untrusted input.
Changing data and recomputing its hashes creates a new candidate, not evidence of the old reality.
Only the fixed rules baseline is supported; historical override replay, checkpoints, durable
forks, semantic migrations and production model removal remain later work units.

**Runtime evidence:** focused tests run locally on Node **v26.8.1**, V8
**14.6.202.34-node.28**. Deployment targets Node 24/V8; Node 24 validation remains pending.
No installed `node24`/`node-24` executable was found on PATH and no runtime was downloaded.
Runtime diagnostics disclose this distinction without a gate that prevents local testing or a
claim of cross-runtime numeric portability. Bump/review baseline versions when behavior changes;
there is no implicit compatibility or migration promise.

### A-baseline: reproducible local measurements

**Observed:** `pnpm exec tsx scripts/replay-baseline.ts` completed locally on Node **v26.8.1**,
V8 **14.6.202.34-node.28**, Linux x64. Four seeds (`baseline-1327-0` through `-3`),
Baseline town, 1327–1362 cap, six adult founders and Alice/f (`protagonist`) produced eight
independent world generations and eight sequential rules replays. All input/output pairs matched;
envelopes and canonical output hashes stayed unchanged through measurement. Baseline Node 24
validation remains pending. The guarded CLI emits one JSON report to stdout, with no saved lives
or measurement data file; importing its helpers does not execute the corpus.

**Method:** retain both people and initial events from each independent world; create separate
Unit A envelopes and canonical-JSON-roundtrip the second. Replay instantiates a fresh rules adapter
each time. Fail on input/output mismatch or instrumentation mutation. Report resolved config,
generation/effective options, version tuple and their hashes. Time worldgen, envelope creation and
roundtrip separately from externally measured replay (admission, simulation, projection, hashing)
and the simulation report's wall time. Serialize result and year-keyed snapshot object independently;
count UTF-8 buffer bytes, with envelope/canonical bytes separate. Serialization includes buffer
creation; compression-only synchronous elapsed time uses gzip level 6 and persistence-compatible
Brotli quality 5. Full reports are released between runs, retaining only small observations.

The snapshot range starts at **1326**, the initial checkpoint, not a simulated year. Normalize by
**inclusive simulated years** (`last snapshot year - 1327 + 1`), not protagonist age. All four lives
stopped at death; only seeds 1 and 3 reached the 1348–49 plague window, and none reached the cap.

| Seed suffix | Last year / simulated years (age) | Snapshots | People initial → final | Events initial → final (generated) | Decisions / calls | Replay elapsed ms, runs 1 / 2 | Simulation wall ms, runs 1 / 2 |
|---|---|---|---|---|---|---|---|
| 0 | 1327 / 1 (0) | 2 | 11 → 11 | 14 → 15 (1) | 13 / 7 | 25.50 / 7.17 | 18 / 3 |
| 1 | 1351 / 25 (24) | 26 | 11 → 34 | 14 → 138 (124) | 594 / 212 | 178.58 / 142.69 | 134 / 105 |
| 2 | 1328 / 2 (1) | 3 | 9 → 10 | 11 → 15 (4) | 37 / 15 | 7.82 / 7.08 | 3 / 3 |
| 3 | 1349 / 23 (22) | 24 | 11 → 25 | 13 → 107 (94) | 491 / 186 | 110.39 / 98.88 | 83 / 78 |

All hazard-fallback maps were empty. Bytes matched within pairs; the following sizes are bytes,
not characters or MiB. Timings above are individual observations, not performance budgets.

| Seed suffix | Envelope / canonical | Result raw / gzip6 / Brotli5 | Snapshots raw / gzip6 / Brotli5 |
|---|---|---|---|
| 0 | 11,056 / 17,319 | 22,006 / 4,201 / 3,788 | 32,275 / 4,293 / 3,822 |
| 1 | 11,077 / 229,821 | 453,098 / 54,649 / 48,900 | 5,661,675 / 686,099 / 55,182 |
| 2 | 9,052 / 22,686 | 36,282 / 6,187 / 5,645 | 67,718 / 6,637 / 5,835 |
| 3 | 10,838 / 182,433 | 364,509 / 46,112 / 41,142 | 4,433,786 / 565,569 / 46,864 |

Across the eight observations, worldgen took 0.54–2.45 ms, envelope creation 1.67–5.21 ms,
and the four roundtrips 0.50–0.92 ms. Result serialization took 0.06–1.68 ms; snapshot serialization
0.14–26.87 ms. Compression-only result gzip/Brotli ranges were 0.30–3.53 / 0.57–6.27 ms;
snapshot gzip/Brotli ranges were 0.27–41.79 / 0.55–16.42 ms (rounded).

| Seed suffix | Matching canonical output SHA-256 (both runs, before/after measurement) |
|---|---|
| 0 | `154acbbfbd4eebc1135062fa22ffe62f711536a80447ae4094c62d0b7a46f698` |
| 1 | `885500759a850a9563f6f8c0207788a190009c504b519cc3eb37d6b505390dd7` |
| 2 | `7a58ffb067513e09ce11214433cf16045159e3ef5025255efc58695a6269852c` |
| 3 | `91ee04201c27b67b893cb97a63016e2688c819d085264be9895bb314207d748b` |

**Limits:** tiny corpus, one local invocation, no p95/true peak heap/scenario coverage guarantees,
no narration/storage/annual SSE/fork benchmarks and no cross-runtime portability claim. Seed 0's
first run includes cold-start effects. These observations do not calibrate future hidden density.

## 9. Optional LLM wording remains downstream

**Adopted:** no LLM in canonical world generation, opportunities, director or choice resolution.
Existing Jev probability judgments must leave the new canonical path; downstream optional language
is a separate service, never a fallback for unresolved simulation. Deterministic templates remain
the baseline and offline fallback. Final significance should be reproducible rules-based analysis
if reproducible selection is promised; optional model interpretations are labeled derived output.

**Default proposal:** send only selected evidence bundles with as-of identities, dates, relations,
choices and explicit emotional appraisals. Require structured claims tied to event IDs. Validate
entity existence, chronology, kinship, life/death state, choice and resource facts, and forbidden
future references before rendering. A model's self-citation does not prove a sentence is factual.
Free prose cannot be perfectly certified by ID checks: constrain factual clauses to verified slots,
allow stylistic wording around them, and fall back to templates when a claim cannot be checked.
Reject invented dialogue, relatives, reconciliation or motivations; no canonical write-back.
Cache by evidence/style/locale/model version, without promising identical prose on a remote miss.

## 10. Scale and measurement gates

**Default proposal:** grow detailed opportunities around protagonist/story circle; background
villagers retain coarser life-course rules, with aggregated world pressure where appropriate.
Promote a new participant deterministically when a committed encounter brings them into scope;
persist their initialized state and promotion evidence. Do not retroactively invent private history.
Away-person limitations in current types need targeted review before detailed off-village activity.

Start experiment limits at eight optional opportunity slots per story-circle actor/year, four
same-year continuation commits per initiating event, and two newly introduced detailed participants
per year. These are **proposals**, not performance budgets or narrative targets. Keep births,
deaths, required causal effects and valid overrides outside discretionary slot trimming; reaching
a hard safety limit must produce a diagnostic/failure or versioned deferral, never dropped canon.
Maintain sparse relationship indexes and active/dormant obligation indexes; preserve old evidence.

A-baseline above measures only the current standalone rules corpus, not the proposed workload.
`src/server/db.ts:165–168` records an older 81-year rules-life compression experiment
(~32MB JSON, ~71KB/80ms at quality 5);
it is repository evidence, **not** a benchmark for this proposed workload. Re-measure on the actual
supported runtime before agreeing p95 latency, heap, per-life bytes, or snapshot interval limits.

Capture baseline and candidate results with the same deterministic seed corpus and versions:
wall time (simulation/narration/serialization separately), peak heap, events and decisions per lived
year, candidate/rejection counts, active people/edges/obligations, raw/compressed bytes, checkpoint
restore time, fork time, annual SSE latency, and causal-closure traversal size. Instrumentation must
not change canonical output. Report p50/p95/max and corpus size; do not hide expensive crisis runs.

Corpus proposal: fixed seeds plus small hand-built initial states covering childhood death,
long quiet life, plague, migration/away life, crowded kin, isolation, conflicting obligations and
repeated rewrites. Compare director off/on and independent replay/resume/concurrency runs.
Measure consequence density (events with later rule-consumed effects), delayed obligation use,
causal depth, relationship trajectories, unresolved-thread share, repetition and cross-seed outcome
variation. Include negative controls: neutral director, disconnected filler events, invalid favors.
Do not require a betrayal, reconciliation, theme count, death quota or tidy ending per life.

## 11. Reviewable work units (future authorization required)

Candidate surfaces below are planning boundaries, **not permission to edit them now**. Each unit
needs a focused RED failure observed before implementation, GREEN evidence after, and review of its
own acceptance checks. New modules/tests listed here are candidates, not artifacts created by this doc.

| Unit / dependency | Candidate edit surfaces | RED → GREEN scenario and acceptance |
|---|---|---|
| A. Replay envelope and baseline; first | `src/domain/types.ts`, `src/domain/rng.ts`, `src/domain/simulate.test.ts`, new `src/domain/replay.ts`, `src/domain/replay.test.ts` | Missing/version-mismatched provenance rejected; independent rules runs hash equal; reordered serialization keys stable; baseline metrics do not mutate outputs. |
| B. Atomic favor state; A | `src/domain/types.ts`, `src/domain/mind.ts`, new `src/domain/obligations.ts`, `src/domain/obligations.test.ts`, `src/domain/effects.ts`, `src/domain/effects.test.ts` | Half-transfer/duplicate obligation/forward cause rejected; valid favor commits all effects; contradictory memories remain actor interpretations. |
| C. Annual multi-slot vertical slice; A+B | `src/domain/simulate.ts`, `src/domain/events.ts`, `src/domain/decision-id.ts`, `src/domain/simulate.test.ts`, `src/domain/decision-id.test.ts`, `src/adapters/decision/rule-decision-maker.ts`, `src/domain/rule-heuristics.ts`, `src/domain/rule-heuristics.test.ts`, new `src/domain/scheduler.ts`, `src/domain/scheduler.test.ts` | E1→O1→E2→E3 reproducible; absent/dead/resource conflicts reject; unrelated RNG streams stable; annual hazards unchanged; disabling O1 changes justified choice weights. |
| D. Durable replay/fork migration; A+C | `src/server/db.ts`, `src/server/life-store.ts`, `src/server/life-store.test.ts`, `src/domain/fork.ts`, `src/domain/fork.test.ts`, `src/domain/validate-override.ts`, `src/domain/validate-override.test.ts` | Cold load equals saved canon; pre-fork event/decision IDs identical; suffix IDs distinct; repeated override lineage and unsupported legacy policy tested. |
| E. Read-only sifter and stream integration; C+D | `src/domain/narrate.ts`, `src/domain/narrate.test.ts`, `src/server/life-chronicle.ts`, `src/server/life-chronicle.test.ts`, `src/server/decision-engine.ts`, `src/server/decision-engine.test.ts`, `src/domain/worldgen.ts`, `src/domain/worldgen.test.ts`, `src/app/api/lives/stream/route.ts`, `src/app/api/lives/stream/route.test.ts`, `src/app/api/lives/stream/route.quiet.test.ts`, `src/app/api/lives/[lifeId]/rewrite/stream/route.ts`, `src/app/api/lives/[lifeId]/rewrite/stream/route.test.ts`, new `src/domain/narrative.ts`, `src/domain/narrative.test.ts` | Future extension leaves live prefix unchanged; selected E3 protects E1/E2 context; quiet tick advances frontier; cancel saves no partial branch; model calls cannot occur in new canonical path, including random sex. |
| F. Director and corpus tuning; C+E | new `src/domain/director.ts`, `src/domain/director.test.ts`, `src/domain/narrative-corpus.test.ts`; `src/domain/simulate.ts`, `src/domain/simulate.test.ts` | Clamp/budget/cooldown deterministic; zero baseline stays zero; response policy isolated; measured consequence/variation changes accepted without quotas. |

Review A–C before expanding hidden density. Integrate D–E before treating the feature as shippable.
Optional prose validation and resumable transport need their own later, explicitly scoped work units;
no dependency changes or UI redesign are prerequisites for proving the favor slice.

## 12. Open decisions, risks, and readiness

| Open decision | Proposed review point |
|---|---|
| Minimal resource/fear vocabulary and relationship scale migration | Before B; preserve existing fields and avoid unsupported economic precision. |
| Multi-slot scheduling, annual hazard conversion if any, and supported numeric runtime | Before C; annual timing is the initial proposal, not an irreversible choice. |
| Deterministic branch suffix encoding and legacy engine retention/rewrite policy | Before D; no silent legacy canon changes. |
| Card compression/editability and display-month stability with hidden events | Before E; preserve public turns and causal order. |
| Calibrated director budgets, density and runtime/storage limits | Before F; accept measured distributions, not handoff quotas. |
| Resume retention/cursors, optional LLM scope and validation strictness | Before those later capabilities; neither is required for the first slice. |

Principal risks: rule proliferation; probability distortion from extra slots; stale candidate state;
order-dependent IDs; loss of decision prefixes in forks; snapshot memory growth; hindsight leakage;
invented prose claims; and optimizing drama metrics at the expense of quiet, believable lives.
The gates above reduce these risks but do not prove historical accuracy or literary quality.

**Non-goals:** simulate every NPC daily; a complete market/war/politics model; more UI cards by quota;
LLM-owned people or outcomes; fixed plot arcs, obligatory closure, invented historical subsystems;
rewriting legacy facts; changing settings, code, branches, or implementation artifacts in this task.

### Practical readiness checklist

- [ ] Confirm the fact map against the implementation checkout before code review.
- [ ] Approve A's exact surfaces and supported replay/numeric/version contract.
- [ ] Choose minimal B vocabulary; agree favor/help/refusal preconditions and atomic effects.
- [ ] Agree fork-year prefix, inherited overrides, suffix identity, and legacy compatibility policy.
- [ ] Capture baseline corpus timings/bytes before numerical performance acceptance thresholds.
- [ ] Require no model calls in canonical generation, prefix-invariant live analysis, causal DAG checks.
- [ ] Demonstrate a later decision consuming earlier obligation evidence, not only extra event count.
- [ ] Verify annual quiet ticks, death turns, cancellation and completed-branch persistence unchanged.

**Implementation boundary:** unit A now has a standalone full-rules envelope/projection and focused
replay tests (contract above); review and target-runtime verification are still required. This does
not close the full feature or authorize B–F. Next collect the separately scoped baseline, then prove
the small favor slice with the director disabled. Density and literary polish follow verified
consequences, not the other way around.

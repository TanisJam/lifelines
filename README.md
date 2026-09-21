# Lifelines

A small life simulator, inspired by Dwarf Fortress's Legends mode. Lifelines simulates a
town year by year — births, marriages, careers, feuds, deaths — and derives biographies
from the resulting event log instead of generating prose. Every choice point in a life is
a recorded **decision** (options, odds, what was chosen). You browse the town as **The
Loom** — one lane per person, decisions as dots on their lane — click any dot to inspect
it, and choose a different option than what actually happened. The app forks the world at
that decision, streams the re-simulation live, and shows exactly how the town's history
diverged: the original branch stays as a dashed ghost behind the new one.

**Simulate first, then describe.** Nothing here is written by an LLM. The event log is the
only source of truth; every sentence you read on screen is rendered from it by a template.

## Concept, in one paragraph

Each simulated year, every living person faces a set of possible life decisions (find a
partner, marry, change career, have a child, feud, reconcile, move away). Biology — aging,
fertility, illness, death — is computed directly from simple actuarial curves in code.
Everything psychological or social goes through a `DecisionMaker` port that returns a
probability distribution over the possible outcomes; the simulation engine then samples
that distribution with a **keyed random number generator**: `hash(worldSeed, personId,
year, decisionKind)`. Because every decision draws from its own independent stream instead
of one shared sequential one, editing history only changes outcomes through **state** — a
changed input shifts a downstream probability, and an outcome flips only where the same
draw now crosses a different threshold. That's the butterfly effect this app is built
around, and it's also what keeps forks reproducible: replay the same state through the same
key and you get the same draw, every time.

## Docs

The design log lives in [`docs/`](./docs), newest first:

- [`docs/decisions.md`](./docs/decisions.md) — what we chose and why, one numbered entry per decision.
- [`docs/findings.md`](./docs/findings.md) — measured results (live Jev runs, the determinism experiment, rules-engine sweeps).
- [`docs/research.md`](./docs/research.md) — prior art that shaped the design.

## Architecture (hexagonal)

```
src/domain/            Pure TypeScript engine — no Next.js, no SDK imports.
  types.ts               Person, Event, Override (generic: decisionId+optionId), Branch, ...
  decisions.ts            the DecisionMaker port + DecisionQuestion/Distribution/DecisionRecord
  rng.ts                 mulberry32 + keyed-hash RNG + Gumbel-max sampling + fragility/surprise
  rule-heuristics.ts      pure rule-based distribution (used as RuleDecisionMaker AND as
                           every decision's code-side `prior` when Jev isn't asked)
  actuarial.ts            aging / fertility / death curves (pure code, not AI)
  worldgen.ts             deterministic family-seeded founder generation from a seed
  simulate.ts             the yearly tick loop: gatherCandidatesForYear (pure, reused by
                           validation) -> resolve each decision (jev/rules/biology/forced)
                           -> Gumbel-sample -> apply outcome -> record -> snapshot
  fork.ts                 restore the snapshot before a decision's year, force its option,
                           resimulate
  validate-override.ts   "the decision exists at this state and the option is real"
  diff.ts                 compares two branches person by person, including who was
                           newly born or never born (the "butterfly" report)
  loom-data.ts            derives lane positions + a family-grouped lane order for the UI
  narrate.ts               event -> prose templates (varied, keyed-RNG-picked) +
                           narrative-significance scoring; merges/suppresses redundant
                           events (e.g. a same-year illness that caused a death)
  causality.ts            walks an event's causes[] chain backward ("why did this happen?")
  events.ts, names.ts, concurrency.ts   small supporting utilities

src/adapters/decision/  Adapters implementing the DecisionMaker port
  rule-decision-maker.ts   thin wrapper around rule-heuristics.ts (tests, offline dev, default)
  jev-decision-maker.ts    TypeSafe (@typesafe-ai/sdk) adapter: choice() + score(). Returns
                           and caches Jev's raw answer, unmodified (decision 016)
  cache.ts                 stable-hash cache keyed by (question id + serialized state)

src/server/             Server-only wiring (Node runtime; never imported by client code)
  world-store.ts          in-memory Map<worldId, WorldRecord>, globalThis-backed
  decision-engine.ts       picks the adapter from env, globalThis-backed singleton
  sse.ts                   text/event-stream Route Handler helper

src/app/api/worlds/...  Route handlers: create a world (+ /stream variant), read a branch,
                         apply an edit (+ /stream variant, validated before forking), diff
                         two branches, walk a causes chain.
src/app/, src/components/  Next.js App Router pages + client islands: theme toggle,
                         "why?" cause-chain viewer, and The Loom (loom.tsx) — the main
                         world view, an SVG storyline diagram with a click-to-inspect,
                         click-to-fork decision inspector.
src/lib/sse.ts          Client-side POST+SSE stream reader (EventSource is GET-only)

scripts/determinism.ts        Step 0 experiment (see docs/findings.md for the numbers)
scripts/check-demographics.ts Fast, no-network population/generations sanity check
```

### Why `DecisionMaker` is a port

`RuleDecisionMaker` is a pure function of the question's state — no network, no
randomness of its own — used by the domain tests and as the default when no API key is
configured. `JevDecisionMaker` calls TypeSafe's System One API (`choice()` for the
seven social/psychological decision kinds, `score()` for narrative significance) and
caches its answer, **unmodified**, by a stable hash of `(question id, serialized state)`.
**As of decision 016, Jev's answer is never blended with a code-side prior** — when the
engine is Jev, a decision's `final` distribution IS `jevRaw`. The demographic safety net
against a thin, conservative-feeling town comes from worldgen (decision 012: pre-seeded
families + occasional immigration), not from weighting Jev's judgment. The engine always
does its own sampling — via **Gumbel-max** (decision 009), not inverse-CDF — with a keyed
RNG; a `DecisionMaker` only ever returns a *distribution*, never an outcome. That split is
what makes forking cheap and reproducible: re-simulating a fork only pays for Jev calls
whose relevant state actually changed after the edit (81% cache hit rate measured on a
real fork at the very first simulated year — see `docs/findings.md`).

### Decisions and the generic override

Every choice point — the seven social `DecisionKind`s, plus "significant" illness/death/
immigration rolls (decision 007's recording threshold: kept if it happened, or if the
road not taken had ≥5% probability) — becomes a `DecisionRecord`: the question, each
option, `jevRaw`/`prior` (whichever applies) and `final`, the Gumbel noise per option, what
was `chosen`, `fragility` (Gumbel-score gap) and `surprise` (a long shot won), and `causes`. An `Override` (decision
008) is just `{ decisionId, optionId }` — "at this decision, choose this option instead."
Validating one is a single rule: re-derive the exact decision set for that year from the
restored state (the same pure function the simulator itself uses) and check the decision
exists and the option is one of its real options.

### Fork mechanics

A world's original simulation snapshots `{ people, events, decisions }` at the end of
every year. Forking at a decision restores the snapshot from the year before it, forces
that one decision's option, and re-simulates forward through the same yearly loop — via
`POST /api/worlds/[worldId]/edit/stream`, which streams per-year progress the same way
world creation does (decision 010). Both branches are kept, so the UI can show them side
by side — solid for the branch you're viewing, a dashed ghost for the one you forked from.

## Running it

```bash
pnpm install
cp env.example .env.local   # paste in your TypeSafe API key if you want Jev, or leave it out for the rules engine
pnpm dev
```

Open http://localhost:3000 and found a town from a seed. You'll see a "Writing the lives
of `<Town>`…" screen streaming the year, population and a few short event lines live while
it simulates, then land directly on **the Living Chronicle** of a rich life (round 6,
decision 029) — the app's primary screen, not a town-wide view.

### Using the Living Chronicle

The chronicle is one person's life, read top to bottom: a large name, their years, a
deterministic one-paragraph `lifeSummary`, then every event and decision in their life,
chronologically, each as a short title plus prose.

- **Every named person is a link** — click one to switch the protagonist to them, with
  their own chronicle, on the same page.
- **"change what happened"** appears under any entry that was a real decision. It opens a
  modal: the current outcome, the other outcomes as plain-language options, and a "Why
  this happened" disclosure that puts `fragility`/`surprise` into words ("She almost chose
  otherwise", "This was an unlikely choice") — raw percentages only show once you open it.
- **Choosing an alternative rewrites the life in place, on the same page**: the divergence
  entry is ringed, everything after it blurs and fades, a pill tracks the re-simulation
  live ("Rewriting `<name>`'s life from `<year>`…"), and the new entries replace the old
  ones once it's done. The previous branch is never deleted — switch back via the branch
  rail (desktop) or the branch drawer (mobile).
- **The top bar** reaches the secondary views: **People** (a searchable list of everyone
  in this life), **Town** (the town's own chronicle — town-wide events, notable deaths,
  dynasties, the biggest feuds), and **Tapestry** (The Loom — the multi-lane storyline
  view from earlier rounds, now secondary; see below).

### Using The Loom ("Tapestry")

One horizontal lane per person, left to right across the town's timespan. A solid line is
a life (brass while alive, crimson once they've died, dashed if they moved away); a
translucent band joins a married couple's lanes from their wedding year, and a bezier
curve connects a birth to the mother's lane. The dots along a lane are that person's
decisions — bigger and ringed in crimson the closer the call was (hidden by default
unless the roll actually did something; toggle "show all rolls" to see everything).

- **Click a dot** to open the inspector — same information as the Chronicle's change
  modal, in The Loom's own layout.
- **Click "Choose this instead"** to fork the timeline right there, with a live progress
  overlay, landing you back on The Loom (not the Chronicle) with the original branch
  overlaid as a dashed ghost.
- The **branch pills** switch between forks; click a person's name to jump to their
  Chronicle.

```bash
pnpm typecheck            # tsc --noEmit
pnpm test                 # vitest run — domain tests against RuleDecisionMaker
pnpm lint                 # eslint
pnpm build                # next build
pnpm determinism          # Step 0 experiment (needs TYPESAFE_API_KEY) — see docs/findings.md
pnpm exec tsx scripts/check-demographics.ts [seed]   # fast rules-engine population check
```

### Decision engine selection

Controlled by `DECISION_ENGINE` (`jev` | `rules`) in `.env.local`. If unset, the app
uses `jev` when `TYPESAFE_API_KEY` is present and falls back to `rules` otherwise — so
the app is always playable even without an API key.

## Quality gates (all pass as of this writing)

| Command | Result |
|---|---|
| `pnpm typecheck` | pass |
| `pnpm test` | 68/68 pass — determinism (events + decisions), no-op/real-edit/prevent-death fork via the generic override, unaffected-person check, causes-chain walk, multi-generation population growth, decision-record invariants + recording threshold, override validation, Gumbel-max determinism + counterfactual stability, fragility/surprise sanity, mind-model determinism/decay/memory/relationship rules, situation-trigger conditions, dead-actor guards, feud cooldowns, dream-realization gating, no-broken-grammar assertions, trait non-contradiction |
| `pnpm lint` | pass, no warnings |
| `pnpm build` | pass — 5 pages (home, Chronicle, Tapestry/Loom, compare, Town), 8 API routes (incl. 2 SSE streams) |

Verified live against the real API (both the `rules` engine and real Jev calls against
`:3000`, across rounds 2 and 3): create a world (streamed, `curl -N`-verified incremental
`tick` frames), view a narrated biography with significance highlighting, walk a causal
chain, fork via the generic override on a real close call (streamed), and read back the
resulting branch diff — plus the same flow through a real browser (Playwright), clicking a
decision dot and "Choose this instead" and confirming the ghost overlay. Numbers are in
[`docs/findings.md`](./docs/findings.md). The client bundle (`.next/static`) was checked
for the API key and the Jev adapter/SDK: zero matches for `TYPESAFE_API_KEY`,
`@typesafe-ai/sdk`/`TypeSafeClient`, and `JevDecisionMaker` — that code is server-only and
never reaches the browser.

## Known limitations

- **In-memory state.** World/branch data lives in a `globalThis`-backed `Map` for
  the life of the Node.js process (see `src/server/world-store.ts`, and decision 006,
  for why plain module-level state isn't safe under Next.js's per-route bundling). It's
  lost on restart, by design, per the MVP scope.
- **Simplified relationship model.** Romance/marriage pairing assumes opposite-sex
  partners for simplicity; "moved away" people are frozen out of future decisions (but
  still age and can die, so they don't become immortal) rather than fully simulated
  elsewhere. An `Override` now targets one specific decision (not "prevent this pair from
  ever marrying, forever") — simpler and matches decision 008 exactly, but a standing
  ban needs a separate override per attempt if the pair keeps trying.
- **Significance scoring** for `RuleDecisionMaker` falls back to a fixed per-event-kind
  heuristic (`DEFAULT_SIGNIFICANCE` in `narrate.ts`); only the Jev adapter implements
  real per-event `score()` calls, and only for the currently displayed person, per the
  call-budget note in the brief.
- **Seed-to-seed demographic variance.** A handful of seeds still produce a smaller,
  weaker town (see `docs/findings.md`) — expected stochastic variance, not a bug, but
  worth knowing before picking a seed for a demo. Per decision 016, this is no longer
  corrected with a code-side weight; the intended fix is round 4's richer state for Jev.
- **The Loom's lane order** is a simple family-grouped-plus-marriage-splice heuristic, not
  full crossing-minimization — a busy town with many cross-family marriages can still have
  some visually crossing connectors (see decision 020).
- **The inspector's "needle"** is the highlighted (checked) option bar, not a literal
  needle on a shared number line — Gumbel-max sampling doesn't produce a single-axis draw
  position the way the old inverse-CDF sampling did (see decision 011).
- **The situation catalog (round 4, `docs/mind-model.md`)** implements a prioritized
  subset — Y1, A1, A2, A3, Y3, Y4, A6, A8, A11 — not the full ~24-code catalog (no
  childhood situations, C1-C4; several youth/adult/old-age codes deferred). See decision
  017.

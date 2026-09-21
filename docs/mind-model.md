# Mind model (round 4 spec)

People in Lifelines should decide the way *they* would, given their personality, values, feelings, memories and relationships. Jev plays each person; there are no code-side weights. This doc is the spec for that. The research behind it is in [research.md](./research.md#dwarf-fortress-inner-life).

**Status (round 5, see decisions 017 and 025):** `PersonMind` itself is fully implemented as specified below — all 12 facets, 7 values, dream, needs, thoughts, memories, relationships, `createMind`/`renderPortrait`/`compactMindState`, and the deterministic post-outcome update rules. The situation catalog is implemented for **13 of ~27 codes**: Y1, A1, A2, A3, Y3, Y4, A6, A8, A11 (round 4), plus C2, A5 (town events), O2, O4 (round 5). Not yet implemented: C1, C3, C4 (rest of childhood), Y2, Y5, A4 (betrayal), A7 (crisis of faith), A9 (affair), A10 (mentor), O1 (inheritance), O3 (legacy) — a person still ages, works, marries and dies via the pre-round-4/5 code paths at those points, just without a mind-driven decision. A4/A9 in particular need new secret/discovered-later state machinery (an affair, discovered some years after the fact) that didn't fit round 5's budget alongside the Living Chronicle pivot (decision 026) — see decision 025 for the full scoping rationale and a round-5 live-run measurement (13 situation kinds observed in one world, within the call/time budget).
**Product pivot (round 5, decision 026):** per `docs/design/handoff.md`, the primary screen is shifting from The Loom (decision 011) to a single person's completed life read as an annotated biography ("the Living Chronicle"). This doc's situation catalog and mind model are unaffected — they're exactly what a rich chronicle needs — but see decision 026 for what data-layer work (per-viewer `{title, prose}` rendering, `lifeSummary`, town texture) round 5 added in support of that pivot, and what's deferred to round 6 (the actual chronicle page).

## The loop

```
world state + keyed RNG ──► code presents a SITUATION to a person   (a link in their chain)
person's MIND + situation ──► Jev returns a distribution over options
distribution + Gumbel noise ──► chosen option                        (a recorded Decision)
outcome ──► code updates minds: thoughts, memories, relationships     (deterministic)
```

- **Code** decides *what happens to* a person: which situations arise and when.
- **Jev** decides *how the person responds*.
- **Code** decides *what it does to them* afterwards.

The past shapes the future through the mind, not through extra rules.

## `PersonMind`

We borrow the *shape* of Dwarf Fortress's model, not its size (DF has about 50 facets, about 33 values and more than 100 emotions). The whole mind has to fit in roughly 1–2k tokens of Jev state.

| Part | Contents | Scale | DF / prior-art source |
|------|----------|-------|-----------------------|
| `facets` | 12: bravery, anxiety, anger, lovePropensity, ambition, greed, altruism, gregariousness, perseverance, trust, stressVulnerability, curiosity | 0–100 | DF personality facets |
| `values` | 7: family, tradition, craft, law, independence, faith, wealth | −50…+50 | DF beliefs |
| `dream` | one goal (e.g. start a family, master a craft, leave for the city, found something lasting) plus a status: pursuing, realized, abandoned | — | DF goals |
| `needs` | the 2–3 most unmet, each with a met% | 0–100 | DF needs (subset) |
| `thoughts` | active feelings: `{ emotion, cause, intensity, yearsLeft }` | — | RimWorld thoughts; DF thoughts |
| `mood` | derived: the sum of thought valences | −100…+100 | Sims moodlets; RimWorld mood |
| `stress` | accumulates from negative thoughts; breakdowns happen above a threshold | 0–100 | DF stress |
| `memories` | up to 5 salient ones: `{ year, text, emotion, personId?, core }` | — | DF memory tiers |
| `relationships` | top 5: `{ personId, bond: kin/friend/lover/spouse/rival/grudge, strength }` | −100…+100 | DF relationship ranks |

**Rendering for Jev:** send compact JSON with named fields, plus **one short prose portrait** built from band templates. For example: *"Mira is disciplined and wary of strangers, holds family above all, and has never forgiven her brother for the theft of 1512."* The JSON gives Jev reliable signal; the portrait gives it nuance. The facet and value bands (0–9, 10–24, 25–39, 40–60 neutral, 61–75, 76–90, 91–100) follow DF, where the neutral band produces no text.

## Situations: the links in the chain

Each situation has a trigger in code (world state plus a keyed roll), 2–4 options, the mind fields it depends on, and a question worded **from the person's perspective**. Codes are simple numbers (`C1`, `C2`, ...) so other docs can reference them.

**Childhood**

| Code | Situation | Trigger | Options |
|------|-----------|---------|---------|
| `C1` | Sibling rivalry | A sibling within 3 years of age | compete / bond / withdraw |
| `C2` | Losing a parent | The parent dies | grieve openly / harden / cling to the other parent |
| `C3` | Early calling | Age 10–14 | follow the family trade / seek an apprenticeship elsewhere / drift |
| `C4` | A bully | An anger-prone peer | fight back / endure / tell an elder |

**Youth**

| Code | Situation | Trigger | Options |
|------|-----------|---------|---------|
| `Y1` | Courtship offer | A compatible single person of similar age | encourage / decline / wait |
| `Y2` | Trade vs. dream | The dream conflicts with the current job | pursue the dream / stay practical |
| `Y3` | Leave or stay | An opportunity in the city | leave / stay |
| `Y4` | First grudge | A slight from someone with clashing values | confront / forgive / nurse it |
| `Y5` | Close friendship | Repeated contact with a compatible person | open up / keep distance |

**Adulthood**

| Code | Situation | Trigger | Options |
|------|-----------|---------|---------|
| `A1` | Proposal | A courtship has lasted 1 year or more | propose or accept / delay / end it |
| `A2` | Have a child | Married and within the fertility window | try / wait / refuse |
| `A3` | Career opportunity | A role opens up (miller, smith, elder...) | seize / pass it to a friend / ignore |
| `A4` | Betrayal discovered | A spouse's affair, or a partner's theft | confront / forgive / leave / revenge |
| `A5` | Town crisis | A town event (see below) | help / flee / profit |
| `A6` | Rivalry escalates | A grudge has been strong for 2 years or more | reconcile / feud / sabotage |
| `A7` | Crisis of faith | Faith value high and a run of bad outcomes | double down / lose faith / seek another path |
| `A8` | Dream check | Every 5 years while the dream is unrealized | push harder / adjust it / abandon it |
| `A9` | Affair temptation | Unhappy marriage and an attraction | resist / pursue |
| `A10` | Mentor | Skilled, with a youth nearby | take an apprentice / decline |
| `A11` | Breakdown | Stress above threshold | the dominant propensity picks the kind: rage, despair or withdrawal (code, like DF's breakdown types); the response is Jev's |

**Old age**

| Code | Situation | Trigger | Options |
|------|-----------|---------|---------|
| `O1` | Inheritance | Old, with property and heirs | the eldest / the favorite / split / the town |
| `O2` | Old grudge | A grudge that is still alive | reconcile / take it to the grave |
| `O3` | Legacy | An unrealized dream | a last attempt / pass it on / make peace with it |
| `O4` | Facing death | Terminal illness | peace / regret / a last wish |

**Town events:** code triggers these with keyed rolls, and each one presents `A5` to the adults in town:

- plague
- famine
- fire
- a festival
- a conflict with a neighboring town
- a bountiful harvest
- a traveling stranger

**Biology stays in code:** aging, fertility windows, illness and death.

## Updating the mind after an outcome

These updates are deterministic code; Jev never writes to minds.

1. **Thoughts.** Each outcome pushes one thought: `{ emotion, cause, intensity, yearsLeft }`. Intensity is scaled by the relevant facets; for example, grief is stronger when `lovePropensity` is high. Identical thoughts stack with diminishing returns, as in RimWorld.
2. **Yearly decay.** Every thought loses one year (`yearsLeft -= 1`) and expires at 0. Stress rises with negative mood, and each year about 20% of it drains, scaled by the `anxiety` facet.
3. **Memories.** Major outcomes write a memory. When a memory is recalled (a later situation involves the same person or theme), it can become **core**. That happens about 1 time in 3, following DF.
4. **A core memory changes the person.** It shifts one related facet by ±2–5, or creates or strengthens a relationship. This is the only way the mind rewrites itself, and it is why a betrayal at 25 still shows at 60.
5. **Relationships.** Each interaction moves `strength`. Value compatibility sets the drift direction, as in DF: values far apart push toward a grudge. Bond labels follow thresholds, e.g. friend at +50 and grudge at −50.

## Prose

Prose uses DF-style templates, filled deterministically. Template variants are chosen with the keyed RNG.

- Thoughts: *"She felt bitter upon being passed over for miller."* When a memory is revisited years later: *"…felt bitter remembering…"*
- Portraits: band templates, e.g. *"is always in love with somebody"* or *"has never forgiven Tomas for 1512"*.
- Dreams: *"dreamed of mastering the forge, and this dream was realized in 1541."*
- Every sentence is backed by an event or a mind field. No generated text is ever the source of truth ([decision 001](./decisions.md#001--the-event-log-is-the-source-of-truth)).

## Budget

- Situations are triggered, not polled: a person faces about 0–3 per year, not every possible decision every year.
- Target: under 1,500 Jev calls and under 60s per world. With streaming, that time is the show. Measure it and record the result in [findings.md](./findings.md).
- A richer state means more input tokens per call. Measure that cost as well.

## Open questions

- Values marked uncertain in the research (exact DF stress thresholds, the full facet count) don't matter here, because we define our own scales.
- Should a person's portrait include their *relationship partner's* short portrait when the decision involves them? That probably helps courtship and conflict coherence. Test it with and without.

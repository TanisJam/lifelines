# Research notes

Prior art that shaped Lifelines. Each section ends with **what we take from it**. Decisions live in [decisions.md](./decisions.md).

## Dwarf Fortress

- World generation is "a giant zero-player strategy game … and history is just a record of that" (Tarn Adams, [Game Developer](https://www.gamedeveloper.com/design/-i-dwarf-fortress-i-figuring-out-how-to-simulate-the-universe-one-step-at-a-time)).
- Legends mode renders prose from structured data: `historical_events`, `historical_event_collections` (wars, battles, duels), entities, sites and artifacts ([XML dump](https://dwarffortresswiki.org/index.php/DF2014:XML_dump)).
- The richness comes from simple interacting rules (personality, values, grudges, relationships), not authored plots ([Adams, *Emergent Narrative in DF*](https://www.taylorfrancis.com/chapters/edit/10.1201/9780429488337-15/emergent-narrative-dwarf-fortress-tarn-adams)).
- Limits: histories become repetitive, and players supply much of the story themselves (apophenia).

**What we take from it:** simulate first and describe afterwards; a few rules that interact; surface what matters, so readers don't have to dig through the volume.

## Dwarf Fortress inner life

DF's characters feel alive because of a layered psychological model. Where a source was unclear, the table says so.

| System | How it works | Source |
|--------|--------------|--------|
| Facets | About 50 personality facets on a 0–100 scale, rendered in 7 text bands (40–60 is neutral and produces no text). Example: ANGER 91–100 → "is in a constant state of internal rage" | [Personality facet](https://dwarffortresswiki.org/index.php/DF2014:Personality_facet) |
| Values | About 33 beliefs on a −50…+50 scale. Large value differences between two people breed grudges; a conflict between a value and a facet produces inner-conflict text | [Personality value](https://dwarffortresswiki.org/index.php/DF2014:Personality_value) |
| Goals | Dreams such as START_A_FAMILY or CRAFT_A_MASTERWORK. Fulfilling one gives a happy thought and the text "…and this dream was realized" | [Personality goal](https://dwarffortresswiki.org/index.php/DF2014:Personality_goal) |
| Needs | About 24 needs, each weighted by personality. Unmet needs cause stress and reduce focus | [Need](https://dwarffortresswiki.org/index.php/DF2014:Need) |
| Thoughts & stress | Events produce emotion-tagged thoughts, with intensity scaled by facets. Stress accumulates, and the breakdown type follows the dominant propensity: anger leads to a tantrum, anxiety to obliviousness, depression to melancholy. Exact thresholds are uncertain | [Emotion](https://dwarffortresswiki.org/index.php/DF2014:Emotion), [Insanity](https://dwarffortresswiki.org/index.php/DF2014:Insanity) |
| Memory | Short-term memories are promoted to long-term; about 1 in 3 long-term memories become core, and a core memory **permanently changes a facet** | [Memory](https://dwarffortresswiki.org/index.php/DF2014:Memory_(thought)) |
| Relationships | Repeated chats build rank: friend, then close friend, then kindred spirit; or a grudge on the negative side. Compatibility sets the direction. Courtship is gated by love propensity and age gap. Thresholds are uncertain | [Relationship](https://dwarffortresswiki.org/index.php/Relationship), [Marriage](https://dwarffortresswiki.org/index.php/Marriage) |
| Text | "He felt satisfied upon improving mining." Revisiting a memory changes the phrasing: "…remembering…" | [Thought](https://dwarffortresswiki.org/index.php/Thought) |

**Comparable systems:**

| System | What we take from it | Source |
|--------|----------------------|--------|
| The Sims | Emotion *derived* from summed moodlets | [ref](https://gamerant.com/the-sims-4-emotion) |
| RimWorld | Thoughts with durations, stacking with diminishing returns; mood lags behind its target | [ref](https://rimworldwiki.com/wiki/Thoughts) |
| CK3 | Stress when an action conflicts with a trait. CK3 uses authored weights; we replace them with Jev | [ref](https://ck3.paradoxwikis.com/Stress) |
| Prom Week (CiF) | "Volition" computed from traits, history and status | — |
| Versu | Separates social practices from character psychology | — |
| Talk of the Town | Salience, and fallible or decaying memory | — |

**What we take from it:** the [mind model](./mind-model.md). It keeps DF's shape with fewer fields. Code presents situations and updates minds; Jev plays the person.

## Counterfactual simulation

| Source | Technique | What we take from it |
|--------|-----------|----------------------|
| [Common Random Numbers](https://pmc.ncbi.nlm.nih.gov/articles/PMC3725537/) | Reuse the same draws across scenario variants | The formal name for our keyed RNG |
| [Random123 / Philox](https://www.thesalmons.org/john/random123/releases/1.06/docs/) | Counter-based RNG `f(key, counter)` | A well-tested hash for keyed draws |
| [Oberst & Sontag 2019](http://proceedings.mlr.press/v97/oberst19a/oberst19a.pdf) | Gumbel-max structural causal models; counterfactual stability | [Decision 009](./decisions.md#009--gumbel-max-sampling) |
| Event sourcing | State is a fold over an immutable log; a fork replays the prefix and then diverges | Our snapshots and forks |

## Story sifting

Story sifting means finding narratable patterns in a simulation's log.

- **Felt** ([paper](https://mkremins.github.io/publications/Felt_SimpleStorySifter.pdf), [code](https://github.com/mkremins/felt)): declarative sifting patterns queried over the event log.
- **Winnow** ([paper](https://cdn.aaai.org/ojs/18903/18903-52-22669-1-2-20211004.pdf)): incremental matching while events stream in.
- **James Ryan**: *Curating Simulated Storyworlds* ([thesis](https://escholarship.org/uc/item/1340j5h2)); [Talk of the Town](https://github.com/james-owen-ryan/talktown) (a 200-year town sim with fallible memory); Sheldon County / Hennepin.

**What we take from it:** phase 2. Highlight cascades automatically after a fork ("because X didn't marry Y, Z was never born").

## Similar games and generators

- **Caves of Qud**: generates events first and rationalizes causality afterwards with grammars ([paper](https://www.freeholdgames.com/papers/Generation_of_mythic_biographies_in_Cavesofqud.pdf)). It is cheaper, but its causality is fake; we keep real simulation.
- **RimWorld storytellers**: a pacing layer on top of the sim ([wiki](https://rimworldwiki.com/wiki/AI_Storytellers)).
- **Wildermyth**: procedural beats rendered as comic panels, which makes randomness feel authored.
- **Crusader Kings 3**: event cards that show each option's consequences, the template for our link inspector.
- **Legends viewers** ([LegendsViewer-Next](https://github.com/Kromtec/LegendsViewer-Next)): a cross-linked wiki built from the event export.
- **Generative Agents** ([paper](https://arxiv.org/pdf/2304.03442)): memory scored by recency, importance and relevance; the model is called only when importance crosses a threshold, which keeps cost bounded.

## UI precedents

| Precedent | Technique | Use in Lifelines |
|-----------|-----------|------------------|
| [xkcd #657](https://xkcd.com/657/), StoryFlow (Tanahashi & Ma 2012) | Storyline lanes, crossing minimization | Main weave |
| Git graph UIs, [Loom](https://github.com/socketteer/loom) | Branch lanes, a tree of alternatives | Forks and ghosts |
| Detroit: Become Human flowchart | Taken path highlighted against greyed-out branches | Ghost styling |
| Hypothetical Outcome Plots (Hullman), quantile dotplots (Kay et al.) | Animated re-draws, frequency framing | Draw needle and "reroll" |
| Outer Wilds ship log | The same data in map mode and causal-web mode | A future "why?" graph view |
| FlowingData, *A Day in the Life of Americans* | Many lives on one radial clock | Phase-2 town view |
| Cultist Simulator | Progressive disclosure | Probability details only on demand |

**Rendering:** custom SVG with visx helpers for the fixed timeline (d3-force works against a fixed time axis), Motion `layoutId` for fork transitions, and react-flow only for a zoomed single-life view. Canvas/WebGL is unnecessary below about 5,000 nodes; we have a few hundred.

## UI concepts

| Concept | Strength | Weakness | Verdict |
|---------|----------|----------|---------|
| **A. The Loom**: lanes plus git-style forks | Forks, ghosts and many lives in one view | Busy when many lanes cross | **MVP** |
| **B. Town Clock**: radial year rings | A striking "town being built" demo | No decision-level detail | Phase 2 |
| **C. Decision Card**: one card per link | Best for showing probabilities and close calls | No view of the whole town | Merged into A's inspector |

# Lifelines — Product / UX Handoff

## Core vision

Lifelines is a life-simulation game inspired by the historical depth of Dwarf Fortress Legends mode, but with a different interaction model.

The player does **not** primarily manage a town, inspect dashboards, optimize stats, or watch agents in real time.

The main object of the product is **a completed human life**.

A simulated person is born, lives through decades of events and decisions, interacts with other people, and eventually dies. When the player opens that person, they see the story of the life that actually happened — chronologically, as a readable historical record.

The experience should feel closer to reading an interactive biography or historical chronicle than using a simulation dashboard.

---

## The fundamental loop

1. The simulation generates a world and runs lives forward.
2. The player opens one person.
3. The player reads that person's full life, from birth to death.
4. The life is composed of chronological events:
   - things that happened to the person;
   - choices the person made;
   - meetings, relationships, births, deaths, departures, jobs, conflicts, etc.
5. Some events can be changed.
6. The player clicks one of those moments and selects a different possible outcome.
7. The simulation is rewound to that exact moment.
8. Everything after that moment is simulated again.
9. The person now has a new life.
10. The old life still exists as another branch/history.

The product is fundamentally about:

> "This is the life that happened. What if this one thing had happened differently?"

---

## What the user cares about

The user primarily cares about:

- what happened to this person;
- what choices they made;
- what other events shaped their life;
- who entered or left their life;
- where they ended up;
- how and when they died;
- what could have happened instead;
- how changing one moment rewrites everything that follows.

The UI should NOT make personality stats, trait scores, model probabilities, simulation internals, or character sheets the main attraction.

Those systems can exist internally and may be exposed in optional/debug/advanced views, but they are not the core fantasy.

The core fantasy is **reading a life and rewriting history**.

---

## Primary screen: one person's completed life

The default screen should be centered around one individual.

Example:

# Mara Ashwell
1498 — 1558

Mara Ashwell died at sixty in Ravenford, surrounded by her children. She spent most of her life as a healer and never permanently left the town where she was born.

Then the full history begins.

### 1498
Mara Ashwell is born during the winter storm that destroys the northern bridge.

### 1506
Her mother dies after a long illness.

### 1512
She meets Tomas Vell at the autumn fair.

### 1514
Tomas asks Mara to leave Ravenford with him.

**Mara stays in Ravenford.**

`change what happened`

### 1515
Tomas leaves Ravenford alone.

### 1518
Mara marries Aldric Marek.

`change what happened`

### 1519
Elin is born.

...

### 1558
Mara dies.

That page IS the game.

---

## Events vs decisions

Not every entry needs to be a player-style choice.

There are two broad types.

### Events

Things that happened in the world.

Examples:

- a parent dies;
- war reaches the region;
- a fire destroys a mill;
- a child is born;
- someone falls ill;
- another person leaves town;
- a job opportunity appears;
- a stranger arrives.

Some events may themselves be editable if the simulation exposes alternate possibilities.

### Decisions

Moments where the simulated person had multiple possible responses.

Examples:

- accept a marriage proposal;
- refuse;
- leave town;
- remain;
- forgive someone;
- retaliate;
- take a job;
- abandon a dream;
- tell the truth;
- hide a betrayal.

The default chronicle only shows what actually happened.

The alternatives appear only when the player opens that moment.

---

## Editing a life

When a player opens a changeable moment, show a focused chooser.

Example:

### Tomas asks Mara to leave Ravenford with him.

Current history:

- She stays in Ravenford.

Other possible outcomes:

- She leaves with Tomas.
- She asks Tomas to remain.
- She ends the relationship.

The UI should clearly communicate:

> Everything after this point will be simulated again.

Once the player selects an alternative:

1. keep all earlier events untouched;
2. visually mark the selected event as the divergence point;
3. fade/erase/de-emphasize all later events from the old history;
4. regenerate the simulation from that year;
5. write the new events into the same chronicle;
6. preserve the previous history as another branch.

This transition should be the main visual "wow" moment of the product.

The old life should feel like history being erased and rewritten, not like navigating to an analytics comparison screen.

---

## Branches

Alternate histories should exist, but branch management is secondary.

The user should not be forced into a branch tree to understand what happened.

The default experience remains a readable life.

A subtle branch control can say something like:

- Original life
- Branch from 1514
- Branch from 1518

Switching branches loads that version of the person's complete biography.

A dedicated branch tree can exist as an advanced/history view.

---

## Other people

Every named person in the biography should be navigable.

Example:

> In 1512 Mara met **Tomas Vell** at the autumn fair.

Clicking Tomas changes the protagonist.

Now the UI shows Tomas Vell's complete life.

This creates the feeling of an enormous interconnected history without requiring a graph as the primary UI.

The graph/network exists conceptually through the biographies themselves.

A person can therefore appear in many lives from different viewpoints.

Example:

Mara's life:
> 1518 — Mara married Aldric Marek.

Aldric's life:
> 1518 — Aldric married Mara Ashwell.

Elin's life:
> 1519 — Elin was born to Mara Ashwell and Aldric Marek.

The player explores the world by following names through history.

This is similar to reading historical records or Wikipedia biographies.

---

## World view

A town/world view can exist, but it is secondary.

It should answer questions such as:

- who lived here during this period;
- which people are related;
- what major events happened;
- which lives intersected;
- which people existed in this branch but not another.

It should never replace the single-person life as the central product experience.

The design priority is:

1. person's life;
2. events and decisions;
3. rewriting from a divergence;
4. navigating to related people;
5. branch history;
6. town/global visualization.

Not the reverse.

---

## World creation

The town is initially generated and simulated year by year.

This can still have an atmospheric visualization, but it is just the entry experience.

The loading state should communicate that lives are being written.

Possible language:

- "Writing the lives of Ravenford..."
- "1512"
- "Mara Ashwell meets Tomas Vell."
- "A child is born."
- "Jon Calder leaves home."
- "The mill burns."

The user is essentially watching a history book being authored.

Once simulation finishes, take them into one person's completed life.

---

## Visual direction

Avoid generic SaaS UI.

Avoid:

- dashboards;
- stat cards;
- radar charts;
- trait meters;
- analytics-first layouts;
- giant graph views as the default;
- RPG character sheets as the main screen.

Prefer:

- editorial typography;
- historical chronicle / archive feel;
- generous whitespace;
- readable long-form layouts;
- subtle years and separators;
- names embedded naturally in prose;
- minimal controls;
- quiet visual hierarchy;
- restrained animation.

The UI should feel like:

- a historical archive;
- an annotated biography;
- a family chronicle;
- a book whose text can be rewritten.

Not literally fake parchment everywhere. It should be contemporary and elegant, with historical/editorial character.

---

## Suggested primary layout

Desktop:

- narrow optional left rail:
  - people relevant to this life;
  - clicking switches protagonist.

- large center column:
  - person's name;
  - birth/death;
  - one-paragraph summary of how the life ended;
  - full chronological life history.

- subtle optional right rail:
  - current branch;
  - branch switcher/history;
  - no stat dashboard.

On mobile:
- center chronicle dominates;
- people and branch controls move into drawers/sheets.

---

## Event design principles

Each event should visually answer:

1. When did it happen?
2. What happened?
3. Who was involved?
4. Was this something the player can change?
5. If changed, what part of history will be rewritten?

Normal events should remain visually quiet.

Changeable moments should be slightly more prominent, but not look like large game cards everywhere.

Example:

1514

Tomas asked Mara to leave Ravenford with him.

**She stayed in Ravenford.**

`change what happened`

This is enough.

---

## Causality

The simulation has causal information linking earlier events to later outcomes.

Expose this sparingly.

For example:

> Elin leaves Ravenford.

Small secondary annotation:

`Follows Mara forbidding Elin's relationship in 1542.`

Clicking that annotation scrolls/navigates to the earlier event.

Avoid turning causal data into a large node graph unless the player explicitly requests a deeper analysis mode.

---

## Probabilities

The model internally assigns probabilities to possible options.

These probabilities are useful for simulation and can potentially support an optional explanation view.

However:

- do not make them the primary visual language;
- do not turn every decision into a probability chart;
- do not require the user to understand sampling or model probabilities.

If exposed, they should appear after opening a decision, perhaps under an "Why this happened" or "Possibilities" disclosure.

The emotional meaning matters more than the numeric representation.

Examples:

- "She almost stayed."
- "This was an unlikely choice."
- "Either outcome was plausible."

Numbers can appear secondarily if useful.

---

## Regeneration interaction

This deserves special attention.

When a choice changes:

### Phase 1 — divergence

Keep all history up to the selected moment exactly as-is.

Mark the divergence event.

Example:

1514

ORIGINAL:
She stayed in Ravenford.

NEW:
She leaves with Tomas.

### Phase 2 — erase the future

All entries after 1514 lose contrast, blur slightly, or disappear progressively.

It should visually communicate:

> These events no longer necessarily happened.

### Phase 3 — simulate

Show a short state such as:

"Rewriting Mara's life from 1514..."

No generic spinner if possible.

### Phase 4 — rewrite

New entries appear chronologically.

1515 — Mara leaves Ravenford.

1516 — She arrives in Bellhaven.

1518 — Elin is born.

1520 — News arrives that her father has died.

...

The user should remain on the same person's page throughout the entire process.

---

## Technical mental model

Suggested entities:

### Person
- id
- name
- birthYear
- deathYear
- summary
- relationships
- currentBranchId

### LifeEvent
- id
- personId
- year
- type
- title
- prose
- involvedPersonIds
- causalEventIds
- decisionId?
- branchId

### Decision
- id
- eventId
- chosenOptionId
- options[]

### DecisionOption
- id
- label
- modelProbability
- metadata

### Branch
- id
- parentBranchId
- divergenceEventId
- selectedAlternativeId
- createdAt

The main UI should not expose this schema directly.

---

## Simulation behavior

When an event is changed:

1. preserve world state immediately before the event;
2. apply the alternative outcome;
3. fork the current branch;
4. regenerate all relevant future simulation state;
5. rebuild affected biographies;
6. mark people/events that no longer exist in this branch;
7. preserve the original branch.

The simulation can affect more than the selected person's life.

For example:

Changing Mara's decision may cause:

- a different marriage;
- different children;
- some people never being born;
- new people being born;
- different jobs;
- different relationships;
- deaths occurring elsewhere;
- people moving to different towns;
- downstream choices changing.

That systemic butterfly effect is the magic of Lifelines.

But it should first be experienced **through the rewritten biography**, not through a data visualization.

---

## Product statement

A concise way to describe Lifelines:

> Lifelines generates complete human lives inside a simulated world. You read a person's history from birth to death, then change one moment and watch the rest of their life — and the lives connected to it — be written again.

Another:

> A life has already happened. Change one thing.

---

## North-star UX principle

If an interface element does not help the player answer one of these questions, it is probably secondary:

- What happened to this person?
- What did they choose?
- What could have happened instead?
- What changed because I rewrote this moment?
- Who else was part of this life?

The biography is the game.

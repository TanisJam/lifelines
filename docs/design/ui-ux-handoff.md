# Lifelines — UI/UX Design Handoff

## 1. Product UX premise

Lifelines is not a dashboard, a character sheet, or a city-management interface.

The primary experience is:

> **Read the complete life of one person. Find a moment in that life. Change what happened. Watch the rest of their life get rewritten.**

The biography itself is the main interface.

When opening a person, the user should immediately understand:

* who this person was;
* how their life ended;
* what happened to them over the years;
* which moments could have gone differently;
* which choices they made;
* that any editable moment can rewrite everything that comes after it.

The design should prioritize **story, causality and consequence** over data density.

---

# 2. North-star interaction

The ideal user session looks like this:

1. Open a person.
2. Read their life chronologically.
3. Encounter an interesting decision/event.
4. Open it.
5. See what else could have happened.
6. Choose an alternative.
7. Stay on the same page.
8. Watch the old future disappear.
9. Watch a new future get written.
10. Continue reading.
11. Click the name of another person involved.
12. Read their life from their perspective.

This interaction should feel almost frictionless.

There should be very little traditional application chrome around it.

---

# 3. Core visual metaphor

Do **not** make the primary metaphor a timeline chart, graph, loom, Gantt chart, RPG stat panel, or family tree.

The strongest metaphor is:

## A historical chronicle whose history can be rewritten.

It should feel like reading:

* a biography;
* an archive;
* a historical manuscript;
* an annotated chronicle;
* a beautifully typeset book.

But it must still feel contemporary and interactive.

Avoid exaggerated fake parchment, medieval borders, fantasy ornaments or RPG HUD elements.

Think:

**editorial design + historical archive + modern interactive fiction.**

---

# 4. Main screen hierarchy

The single-person life view should dominate the product.

Suggested desktop structure:

```text
┌───────────────────────────────────────────────────────────────┐
│ Lifelines                         People      World    History │
├───────────────────────────────────────────────────────────────┤
│                                                               │
│  Related people        MARA ASHWELL          Branch           │
│                       1498 — 1558                             │
│                                                               │
│                     short life summary                        │
│                                                               │
│                       1498                                    │
│                       birth                                   │
│                                                               │
│                       1506                                    │
│                       mother dies                             │
│                                                               │
│                       1512                                    │
│                       meets Tomas                             │
│                                                               │
│                       1514                                    │
│                       Tomas asks her to leave                 │
│                                                               │
│                       SHE STAYS                               │
│                       change what happened                    │
│                                                               │
│                       1515                                    │
│                       Tomas leaves                            │
│                                                               │
│                       ...                                     │
└───────────────────────────────────────────────────────────────┘
```

The center column is the product.

The side areas are secondary and should never compete with the biography.

---

# 5. Person header

At the beginning of the page, show only information that establishes the story.

Example:

# Mara Ashwell

*1498 — 1558*

> Mara Ashwell died at sixty in Ravenford, surrounded by her children. She spent most of her adult life as the town's healer and never permanently left the place where she was born.

That is much more valuable than:

* occupation cards;
* personality charts;
* mood indicators;
* relationship scores;
* trait statistics.

Do not put a character dashboard above the story.

The user should start reading almost immediately.

---

# 6. Chronology layout

The history should be vertically scrollable.

Vertical chronology is preferable to horizontal because:

* it reads naturally;
* biographies can be very long;
* events can contain prose;
* mobile works naturally;
* changing a moment clearly divides "before" and "after";
* it supports rich events without becoming a chart.

Each chronological item should have:

### Year

Visually distinctive but quiet.

Example:

`1514`

### Event title

Short and human-readable.

> Tomas asks Mara to leave Ravenford.

### Optional prose

One or two short paragraphs maximum by default.

> Tomas plans to travel east and asks Mara to go with him. Leaving would mean abandoning her father and the only town she has ever known.

### Outcome

If this event contained a choice:

> **She stays in Ravenford.**

### Edit affordance

Small, obvious, not visually aggressive:

`change what happened`

---

# 7. Event visual hierarchy

There should be three visual levels.

## Level 1 — Ordinary event

Examples:

* someone is born;
* someone dies;
* they move house;
* they get a job;
* a storm destroys something;
* another person leaves town.

These should be understated.

---

## Level 2 — Significant event

A major life event without an editable choice.

Examples:

* spouse dies;
* child is born;
* war arrives;
* house burns;
* family leaves town.

These can receive slightly stronger typography or spacing.

---

## Level 3 — Turn / editable moment

A moment where another outcome can be selected.

This should be visually noticeable without becoming a huge card.

Example:

```text
1514

Tomas asks Mara to leave Ravenford with him.

She stays in Ravenford.

◇ change what happened
```

The event itself remains part of the biography.

Do not suddenly turn it into a dashboard component.

---

# 8. Opening a changeable moment

Clicking "change what happened" should not navigate to another page.

Prefer:

* a side sheet;
* an anchored popover;
* a centered editorial modal;
* or the event expanding in place.

The interaction should preserve the user's sense of position inside the life.

Example:

```text
Tomas asks Mara to leave Ravenford.

What happened:

✓ She stays in Ravenford

Other possibilities:

○ She leaves with Tomas
○ She asks Tomas to remain
○ She ends the relationship
```

At the bottom:

> Everything after 1514 will be simulated again.

Then:

`Rewrite from here`

Avoid technical terminology such as:

* rerun;
* inference;
* sampling;
* state regeneration;
* probability distribution.

The language should remain narrative.

---

# 9. Do not foreground probabilities

The simulation may have probability information, but the normal player should not need it.

Do not render every decision as:

```text
Stay        42%
Leave       38%
Wait        15%
Refuse       5%
```

That makes the experience feel like model inspection instead of history.

If probabilities are exposed, make them optional.

For example:

`Why did she choose this?`

Then an expanded section can say:

> Staying and leaving were both plausible outcomes. This was a close decision.

Or:

> This outcome was unusual.

Numbers can optionally appear beneath that.

The prose interpretation is more important than the percentages.

---

# 10. The rewrite interaction is the key UX moment

This needs to be one of the most polished interactions in the entire product.

Suppose the user changes:

> 1514 — Mara stays in Ravenford.

to:

> Mara leaves with Tomas.

Everything above 1514 is immutable history.

Everything below 1514 becomes uncertain.

## Animation sequence

### A. Mark the divergence

The selected event changes visually.

For a few seconds it may show:

```text
ORIGINAL
She stayed in Ravenford.

NEW
She leaves with Tomas.
```

A subtle line or symbol indicates:

**history diverges here.**

---

### B. Invalidate the future

All later events progressively:

* lose opacity;
* blur very slightly;
* desaturate;
* collapse;
* or disappear.

Do not instantly replace the entire page.

The player should emotionally register:

> None of this necessarily happened anymore.

This is critical.

---

### C. Show regeneration

Keep the user in place.

For example:

> Rewriting Mara's life from 1514…

Then show years appearing progressively.

Avoid a giant loading spinner.

Possible states:

```text
1515    …
1516    …
1517    …
```

or ghost placeholders representing unwritten years.

---

### D. Write the new life

New events appear one by one.

Example:

> **1515**
> Mara leaves Ravenford with Tomas.

Then:

> **1516**
> They arrive in Bellhaven.

Then:

> **1518**
> Mara gives birth to Elin.

The animation should feel like history being authored.

---

# 11. Preserve scroll position

A changed decision could occur thirty years into a long biography.

Never dump the player back at the top.

The divergence moment should remain physically anchored on screen.

After regeneration, scroll should remain centered around that moment.

This will greatly improve perceived continuity.

---

# 12. Old history as a ghost

Do not force the user into a comparison view immediately.

The new biography should become the primary history.

However, small traces of the old history can appear contextually.

Example:

New event:

> **1518 — Elin is born in Bellhaven.**

Small annotation:

`In the original life, Mara married Aldric this year.`

This is enough to communicate consequence.

The user can open a deeper comparison if desired.

---

# 13. Branches

Branch management should be subtle.

Possible top-level control:

```text
History ▾

✓ Original life
  Branch from 1514
  Branch from 1518
```

Each branch represents a different completed version of this person's life.

The branch system should feel like versions of history, not Git.

Avoid terminology such as:

* commit;
* parent branch;
* diff;
* fork hash.

Prefer:

* Original life
* Changed in 1514
* Changed in 1531

The player should understand it without knowing version control concepts.

---

# 14. Comparing two histories

Comparison is a secondary mode.

Do not make the default interface permanently split-screen.

When requested, a comparison could show:

```text
ORIGINAL                           NEW HISTORY

1514                               1514
She stays.                         She leaves.

1515                               1515
Tomas leaves.                      They travel together.

1518                               1518
She marries Aldric.                Elin is born.

1520                               1520
...                                Elias dies in Ravenford.
```

Common events can align.

Changed events should be highlighted.

Events that no longer happened can be muted/struck through.

Events that exist only in the new history should feel newly written.

---

# 15. Navigating between people

Person names inside events are links.

Example:

> Mara meets **Tomas Vell** at the autumn fair.

Hover:

* underline/highlight;
* possibly tiny contextual preview.

Click:

transition to Tomas Vell's life.

This transition should feel like changing protagonist, not opening an entity inspector.

Useful transition:

Mara's heading fades out.

`Tomas Vell`

takes its place.

The chronology updates underneath.

Back navigation should preserve the previous scroll position.

This is important because following people through history is one of the core exploration mechanics.

---

# 16. Related people rail

Desktop may have a narrow contextual rail showing recurring characters.

Example:

### People in this life

Tomas Vell
*husband*

Elin Marek
*daughter*

Elias Ashwell
*father*

Jon Calder
*friend*

Beatrice Marek
*rival*

Do not add meters or scores.

This rail exists primarily for navigation.

It can update as the user moves through the chronology.

On mobile, move this into a drawer.

---

# 17. World navigation

The global town/world screen exists, but should never steal focus from the person.

The main header could contain:

`People`

`World`

`History`

The World view can later expose:

* inhabitants;
* families;
* deaths;
* arrivals;
* marriages;
* migrations;
* major town events.

But returning to a life should always be easy.

---

# 18. World generation UX

The initial simulation should feel like history being written.

Do not use:

```text
Generating...
72%
```

Instead:

```text
Writing Ravenford's history

1498
Mara Ashwell is born.

1502
The old bridge collapses.

1506
Anne Ashwell dies.

1512
Tomas Vell arrives in Ravenford.
```

The year advances.

Names begin appearing.

Events stream in.

The experience should communicate:

**these lives are happening right now.**

After completion:

> Ravenford, 1490–1565
> 31 lives were lived.

Then open one biography.

---

# 19. Typography

Typography is extremely important because the product is primarily reading.

Use an editorial serif for:

* names;
* years;
* event titles;
* biography prose.

Potential directions:

* Source Serif 4
* Libre Baskerville
* Newsreader
* Literata
* Lora
* Fraunces, used carefully

Use a restrained sans-serif for:

* buttons;
* navigation;
* labels;
* system states.

Examples:

* Inter
* Geist
* IBM Plex Sans
* Instrument Sans

Recommended pairing:

**Newsreader + Geist**

or:

**Source Serif 4 + Inter**

The serif should carry the emotional identity.

---

# 20. Text width

Never allow biography text to span the full viewport.

Readable prose width:

approximately **60–75 characters per line**.

The central life column should probably be around:

`680–820px`

depending on typography.

Large desktop screens should create more whitespace rather than stretching the text.

---

# 21. Color direction

Avoid overly saturated colors.

Light mode recommendation:

* warm paper / bone background;
* dark charcoal text;
* muted brown rules;
* oxblood / dried red accent;
* subtle brass/gold accent.

Example:

```text
background      #EEE6D8
text            #28241F
secondary       #756B60
rules           #CBBDA7
interactive     #8E413D
historical      #96784C
ghost history   #969BA1
```

Dark mode:

* charcoal/navy-black;
* warm off-white text;
* muted bronze;
* faded red;
* slate gray ghost history.

Avoid pure black and pure white.

---

# 22. Texture

Texture should be subtle.

Potential use:

* faint paper grain;
* archival speckle;
* imperfect horizontal rules;
* very slight ink variation.

Do not make it look like a scanned parchment texture.

The product should still feel premium and digital.

---

# 23. Motion language

Motion should be restrained most of the time.

Most page navigation:

150–250ms.

Biography transitions:

200–350ms.

Rewriting history:

may be slower and more theatrical.

Recommended motion principles:

* opacity;
* vertical reveal;
* slight blur;
* line drawing;
* text appearing sequentially.

Avoid:

* bouncing;
* springy SaaS animation;
* particle explosions;
* excessive parallax.

The one place where more dramatic motion is justified is changing history.

---

# 24. Hover behavior

Hovering a normal event should do almost nothing.

Hovering a linked person:

* underline;
* slight color change.

Hovering an editable event:

* make `change what happened` visible or more prominent;
* subtly emphasize the event.

Do not put every event inside a bordered card.

The page should read continuously.

---

# 25. Empty space is important

The design should not try to fill every area.

Life events need breathing room.

Some years may contain only one small event.

Some years may have multiple events.

The rhythm of the page should reflect the rhythm of a life.

Dense period:

```text
1518
event

1519
event

1520
event
event
```

Quiet period:

```text
1521


1524
event
```

Do not artificially normalize spacing so every year looks identical.

---

# 26. Years without meaningful events

Do not render every year.

Only show narratively meaningful entries.

The player should read a life, not a database log.

A 75-year life might have:

* 25–60 visible moments;
* depending on simulation richness.

Allow periods to be summarized.

Example:

> **1528–1532**
> Mara's practice grows steadily, and her relationship with Aldric becomes increasingly distant.

This is better than rendering five trivial annual entries.

---

# 27. Event density controls

Later, advanced UX could offer:

`Story detail`

* Essential
* Full
* Everything

Essential:

major events only.

Full:

normal intended experience.

Everything:

debug/Legends-style exhaustive history.

Do not make this prominent initially.

---

# 28. Death

Death should feel like a natural end of the biography.

Example:

```text
1558

Mara dies.

She becomes ill during late winter.
Elin returns to Ravenford three days before her death.

                     ◆

                 END OF LIFE
```

Below:

`View Elin's life`

`Return to Ravenford`

`Change an earlier moment`

This gives the page closure.

---

# 29. Birth

Birth can mirror death.

The first event should feel like the beginning of the record.

Example:

```text
1498

Mara Ashwell is born.

A winter storm destroys the northern bridge on the same night.
```

No need for a giant cinematic intro.

The biography itself carries the drama.

---

# 30. Search

Search should focus on history.

Useful search targets:

* people;
* year;
* event;
* location.

Example:

`Search Ravenford…`

Typing:

`Jon Calder`

shows:

> Jon Calder
> 1492–1537

and relevant historical occurrences.

Search should not dominate the UI.

---

# 31. Mobile UX

Mobile should not attempt to preserve the desktop rails.

Primary layout:

```text
Header

Mara Ashwell
1498 — 1558

summary

1498
event

1506
event

...
```

People drawer:

tap header / People.

Branch switcher:

bottom sheet or compact menu.

Decision alternatives:

bottom sheet.

This product can actually work extremely well on mobile because the core interaction is reading.

---

# 32. Accessibility

Do not communicate history changes using color alone.

Changed event:

* label;
* icon;
* text.

Ghost/original history:

* opacity plus explicit "Original history".

Editable moments:

must be keyboard accessible.

The chronology should remain semantic HTML:

* article;
* headings;
* buttons;
* links;
* ordered chronological content.

Animations should respect:

`prefers-reduced-motion`.

---

# 33. Things Claude should explicitly avoid

Do not turn Lifelines into:

### A traditional RPG screen

No:

* strength;
* charisma;
* loyalty;
* personality gauges;
* inventory-style panels.

---

### A simulation dashboard

No:

* 12 KPIs;
* pie charts;
* statistical overview;
* city population cards;
* large data tables.

---

### A graph-first product

Do not make:

* node graphs;
* relationship networks;
* giant woven timelines

the default experience.

They may exist as secondary exploratory views.

---

### A card wall

Avoid putting every life event inside a large floating card.

It destroys narrative continuity.

---

### Fake medieval UI

Avoid:

* scroll borders;
* fantasy icons everywhere;
* wax seals;
* fake burned parchment;
* ornate frames.

Use historical influence subtly.

---

# 34. The defining visual moment

The design must make one interaction unforgettable:

## rewriting the future.

The player changes something in 1514.

Everything below it visibly becomes obsolete.

The page pauses.

Then an entirely different life starts appearing.

The user should instinctively understand:

> I just destroyed forty years of this person's history and created another forty years.

That is Lifelines.

Spend disproportionately more design and engineering effort on this moment.

---

# 35. UX priority order

When making design decisions, optimize in this order:

1. **Reading the person's life**
2. **Understanding what happened**
3. **Recognizing editable moments**
4. **Changing an event**
5. **Understanding where history diverged**
6. **Reading the regenerated future**
7. **Navigating to another person's life**
8. **Switching alternate histories**
9. **Exploring the larger world**
10. **Inspecting simulation internals**

If a secondary feature hurts items 1–6, simplify or remove it.

---

# 36. Main design principle

The most important rule:

> **The biography is not a report produced by the simulation. The biography is the game interface itself.**

And the second:

> **Changing history should happen inside the biography, not in a separate configuration screen.**

And the third:

> **The player should think about people and events, not model state and simulation data.**

---

# 37. Desired emotional feeling

The product should create:

* curiosity;
* attachment;
* melancholy;
* surprise;
* regret;
* discovery;
* temptation to alter the past.

The ideal player thought is:

> "Wait. What if she hadn't done that?"

followed immediately by:

> "I need to see what happens."

That loop should drive the entire UI.

---

# 38. Final design target

When someone sees Lifelines for the first time, it should not look like:

> "an AI agent simulator."

It should look like:

> **a record of a person's entire life that somehow lets you edit history.**

That distinction is essential.

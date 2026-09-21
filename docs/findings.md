# Findings

Measured results, newest first. Each entry records the setup, the numbers, and the conclusion drawn from them.

## 2026-09-21 — Jev throughput limits (documented + probed live)

**Documented** ([models](https://docs.typesafe.ai/models.md), [API](https://docs.typesafe.ai/api.md)):

- 64k tokens per request (32k for `state` plus the longest question); up to 255 options per Choice.
- Rate limit: 1,200 requests/min and 250,000 tokens/s. The docs warn these can change.
- Price: $0.042 per million **input** tokens; output tokens are free.
- On 429/529, retry with exponential backoff.
- Questions in one request are scored independently: "batching neither shifts the answer nor adds variance" ([parallel questions](https://docs.typesafe.ai/cookbooks/parallel_questions.md)).

**Probed live** (`jev-latest`; small state, 2-option Choice questions):

| Questions in one request | Latency | Input tokens |
|---|---|---|
| 1 | 860 ms (cold) | 407 |
| 100 | 347 ms | 7,130 |
| 500 | 1,041 ms | 34,730 |
| 950 | 1,826 ms | 65,780 |
| 1,200 | **fails**: `400 max_tokens_exceeded` | — |

| Parallel requests (1 question each) | Result |
|---|---|
| 64 | 64/64 ok in 539 ms |
| 200 | 200/200 ok in 666 ms (a burst; the sustained limit is 1,200/min) |

**Conclusions:**

- There is no fixed cap on the number of questions: the limit is the **token budget**, roughly 900 short questions per request.
- The state is paid once per request, and each extra question costs about 68 tokens. Batching every question a person faces in a year into one request is far cheaper and faster than one request per question.
- Bursts of 200 parallel requests work. Sustained use must stay under 20 requests/s, so the adapter needs a rate limiter plus backoff on 429/529.

## 2026-09-21 — Eighth round: the rewrite moment (all 4 phases, live), event levels, narrative titles, causal noun phrases, grammar (seed `round8-final-1`)

### The rewrite moment, verified live end-to-end

Two real forks against a fresh Jev world (worldId `w1-mubm0j6i`), on Quill Fairwind's chronicle:

1. **Fork 1** (the A2 decision that produced his own birth, "They decided to have a child" → "They decide to wait"): phases A, B and C/D all fired correctly (captured live: the ORIGINAL/NEW divergence block, the staggered blur/fade/desaturate of later entries, the regen pill with ghost year placeholders `1501 …`/`1502 …`/`1503 …` advancing per tick), but the final re-fetch 404'd — in the new branch, this exact person was never born, since the fork changed the very decision that created him. The UI caught it cleanly ("Couldn't load the rewritten life.", no crash), reverting to the pre-fork view. A real, disclosed edge case: forking a person's own cause-of-existence can un-write them.
2. **Fork 2** (a later, ordinary decision — the C3 "early calling" choice at 1512, "follows the family trade" → "seeks an apprenticeship elsewhere"): completed end-to-end. Phase D showed REAL streamed entries appearing one at a time as ticks arrived — *"1516 · Quill Fairwind seizes the weaver role"*, *"1520 · Quill Fairwind pushes harder toward his dream"* — italicized and provisional, before the final fetch replaced them with the fully-narrated versions. After completion, the right rail read "Changed in 1512", the 1512 entry showed "Original history: Quill Fairwind follows the family trade", and — the diff-ghost annotations (§12) — the 1527 "Meets Cressida Fairwind" entry read *"In the original life, marries Cressida Fairwind (1528)."* and the 1528 "Marries Cressida Fairwind" entry read *"In the original life, meets Cressida Fairwind (1527)."* — both correctly derived by diffing against the pre-fork chronicle, both genuinely informative (the marriage still happens in both branches, just reordered relative to when the courtship began).

Screenshots (scratchpad): `r8-modal-narrative-title.png`, `r8-phaseA-divergence.png`, `r8-phaseB-invalidate.png`, `r8-phaseD-streaming.png`, `r8-after-rewrite.png` (fork 1, showing the disclosed edge case), `r8b-modal.png`, `r8b-phaseC-streaming.png`, `r8b-phaseD-streaming2.png`, `r8b-after-rewrite.png` (fork 2, completing successfully with diff ghosts visible).

### Full chronicle — Quill Fairwind (b. 1500, d. 1565, age 65, weaver), original branch, before either fork

```
1500 · Is born — Junia Fairwind and Garrick Fairwind welcomed a child, Quill Fairwind, in the first days of spring.
   ◆ They decided to have a child (37% · fragility 1.41)
1501 · Feud breaks out with Dorian Stonebrook — began a bitter feud. He felt furious.
   ◆ Dorian Stonebrook confronts Quill Fairwind openly (23% · fragility 1.30)
1505 · Makes peace with Dorian Stonebrook — made peace at last. He felt relieved.
   ◆ They reconcile (72% · fragility 3.40)
   ↳ Follows his feud with Dorian Stonebrook (1501)
1506 · Starts school.
1512 · Followed the family trade — resolved to follow in the family's footsteps.
   ◆ Quill Fairwind follows the family trade (13% · fragility 2.67 · SURPRISE)
1516 · Becomes a weaver.
   ◆ Quill Fairwind seizes the weaver role (94% · fragility 0.92)
1520 · A dream realized — dreamed of mastering a craft, realized in 1520. He felt proud.
   ◆ Quill Fairwind pushes harder toward his dream (100% · fragility 28.37 — NOT a turn, no change link)
1527 · Meets Cressida Fairwind — at the old well, in the first days of spring.
   ◆ Cressida Fairwind encourages Quill Fairwind (25% · fragility 0.93)
1528 · Marries Cressida Fairwind — were wed. He felt joyful. This would stay with him for years.
   ◆ Quill Fairwind proposes marriage (54% · fragility 3.69)
   ↳ Follows his courtship with Cressida Fairwind (1527)
1565 · Dies — passed away at age 65.
   ◆ Quill Fairwind dies (3% · fragility 0.34 · SURPRISE)
```

Life summary: *"Quill Fairwind died at 65 in Ashford. He spent much of his life as a weaver. He never permanently left the town where he was born. His dream of mastering a craft came true."*

**What this demonstrates:** every "◆" line above is a decision that DID clear the `isRealTurn` bar and got a "change what happened" link live (confirmed against the screenshots) — except the 1520 dream-realization (100% chosen, fragility 28.37, no surprise — correctly NOT a turn, and indeed shows no change link in the screenshots) — proving the three-event-level gating is working on real data, not just the unit tests. The 1565 death, despite being level-2 by default, IS a turn here because it was a genuine surprise (only 3% probability) — also confirmed live. Both causal annotations are clean noun phrases with correctly-capitalized names.

### Grammar and title fixes, confirmed live

- Modal title: "Quill Fairwind is born." (third-person, narrative) — not "I am getting old enough to think about what I'll make of myself. What calls to me?" (Jev's actual first-person prompt for the C3 decision, confirmed never shown anywhere in the UI).
- "◆ HE FOLLOWS THE FAMILY TRADE" / "seeking a trade of his own, away from home" — C3's pronoun bug (missed in round 7) fixed and confirmed.
- "◆ DORIAN STONEBROOK CONFRONTS QUILL FAIRWIND OPENLY" — the other-party's real name, not a wrongly-gendered pronoun (round 7's self-caught bug, re-confirmed still correct).
- No remaining "a innkeeper"/"a weaver"-style article bugs found in this world's chronicle (this seed's jobs happened not to include "innkeeper" for this person, but the `article()` helper is now unit-tested against the full `JOB_POOL`).

## 2026-09-21 — Seventh round: content polish, the mock's visual design ported, ui-ux-handoff.md adopted (seed `chronicle-report-1`)

### Live Jev world

| Metric | Value |
|---|---|
| Social decisions (Jev calls) | 282 |
| Wall time | 34.0s |
| Input / output tokens | 445,929 / 20,240 (adapter totals are process-cumulative across this session's runs, not this world alone) |
| People (ever existed) | 34 |
| Events | 182 |
| Decisions recorded | 562 |
| Landing person picked | Kaelan Ravensworth (`pickRichPerson`, decision 030) |

Within budget (≤1,500 calls, ≤60s — decisions 017/025's standing budget note).

### The landing person's full chronicle — Kaelan Ravensworth (b. 1507, still living at world's end, innkeeper)

`pickRichPerson`'s pool of "born in-sim AND dead by end" was empty in this particular world, so it fell back to scoring the full population by event-kind variety — Kaelan, still alive, was the richest life anyway (16 entries, 9 distinct event kinds: birth, school, reflection, feud ×3, romance, marriage, dream ×4, child, illness, job ×3).

```
1507 · Is born — Kaelan Ravensworth was born to Briala Ravensworth and Elric Ashford, during the golden days of autumn of 1507.
1513 · Starts school — Kaelan Ravensworth started school.
1519 · Drifted — Kaelan Ravensworth drifted, not yet sure what to make of themselves.
1524 · Feud breaks out with Merric Nightwood — Merric Nightwood confronts Kaelan Ravensworth openly. He felt furious. This would stay with him for years.
1527 · Feud with Merric Nightwood deepens — Merric Nightwood struck back at Kaelan Ravensworth, and the feud deepened.
1527 · Meets Orla Ashford — at the old well, during the depths of winter; they began courting.
1530 · Feud with Merric Nightwood deepens — Merric Nightwood escalated the feud with Kaelan Ravensworth further.
1531 · Marries Orla Ashford — Kaelan Ravensworth and Orla Ashford were wed.
1533 · Sets a new dream — After marrying, Kaelan Ravensworth began to dream of mastering a craft.
1536 · Son Silas Ashford is born — during the golden days of autumn of 1536.
1537 · Recovers from illness — Kaelan Ravensworth took ill for a time, then recovered.
1543 · Becomes a blacksmith — Kaelan Ravensworth took up the trade of blacksmith.
1544 · Sets a new dream — After taking up a new trade, Kaelan Ravensworth began to dream of founding something lasting. He felt hopeful.
1545 · Sets a new dream — After taking up a new trade, Kaelan Ravensworth began to dream of leaving for the city. He felt hopeful.
1557 · Lets go of a dream — Kaelan Ravensworth let go of his dream of leaving for the city. He felt despairing.
1563 · Becomes an innkeeper — After 20 years as a blacksmith, Kaelan Ravensworth became an innkeeper.
```

Life summary: *"Kaelan Ravensworth is still living, in Stonebridge. He works as an innkeeper."*

**What this demonstrates, point by point:** childhood/youth content exists now (school at 6, C3's "drifted" at 12 — the "Sought an apprenticeship elsewhere" variant appears on other lives in the same world, e.g. Liora Embermoor's below); the "Merric Nightwood confronts Kaelan Ravensworth openly" line uses the RIVAL's real name (a same-round bug fix — the first attempt at gendering this line wrongly derived the pronoun from Kaelan's own sex, which would have been flat wrong had the rival been the opposite sex); "his dream"/"her dream" throughout, never singular "their"; three dream changes, each with a stated real cause (marrying, a job change, another job change) — not unmotivated churn; two real career changes with tenure named ("After 20 years as a blacksmith..."); the feud with Merric Nightwood escalates twice then never re-triggers (decision 022's cooldown, still holding).

### A second life from the same world, showing the durable dream + career pattern again

**Liora Embermoor** (b. 1492, d. 1570 away from home, merchant) — courted, married, two children, one lasting feud, three dream changes each with a real cause, career: innkeeper → merchant:

```
1492 · Is born — welcomed by Fira Embermoor and Torin Embermoor, in high summer.
1504 · Sought an apprenticeship elsewhere.
1508 · Becomes an innkeeper.
1512 · Meets Hollis Fairwind — at the chapel, in high summer.
1513 · Marries Hollis Fairwind.
1515 · Sets a new dream — After marrying, began to dream of mastering a craft. She felt hopeful. This would stay with her for years.
1517 · Son Branwell Embermoor is born — in high summer.
1528 · Becomes a merchant — After 20 years as an innkeeper.
1528 · Feud breaks out with Greta Ravensworth.
1529 · Sets a new dream — After taking up a new trade, began to dream of founding something lasting.
1531 · Daughter Nella Embermoor is born — during the golden days of autumn.
1532 · Sets a new dream — After the birth of a child, began to dream of starting a family. She felt hopeful.
1544 · Leaves for a distant town.
1570 · Dies — word reached town that she had died elsewhere, at age 78.
```

Life summary: *"Liora Embermoor died at 78, survived by her children far from home. She spent much of her life as a merchant. She left Oakhaven behind and never returned. Her dream of starting a family never came to pass."*

**Disclosed, pre-fix data point kept for the record:** this exact chronicle was captured BEFORE the other-party-pronoun bug fix, and originally read "Liora Embermoor confronts her openly" for the feud line — "her" was wrong here only by coincidence-of-sex (the rival, Greta Ravensworth, happens to be female); the fix (reverting to the rival's real name) was verified live afterward on Kaelan Ravensworth's chronicle above and via `pnpm test`, not by re-fetching this specific cached world (regenerating it would cost another full live Jev run).

## 2026-09-21 — Sixth round: population-decline root cause, depth fixes, the Living Chronicle UI (seeds `chronicle-3` pre-fix; `living-1`/`living-2`/`living-3` post-fix)

The round-6 brief's sample biographies below **supersede round 5's** (Ilva Nightwood / Briala Oakhaven, in the entry below this one) — kept as a historical record of the earlier fact-list chronicle style, not because they're still representative.

### Population decline: found the real cause, not seed variance

Round 5 reported two seeds collapsing (24→13, 24→8) and called it disclosed variance. The coordinator was right to push back — a THIRD seed this round (`chronicle-3`) also collapsed, worse (24→5, only 3 real simulated births in 75 years), which is a pattern, not noise. Traced it directly: `A2` decisions for one founder, Quilla Greyhollow, sampled `jevRaw.try ≈ 0.02` three years running. Her actual mind state: `family: -49` (essentially the value's floor), `lovePropensity: 14`, `gregariousness: 1`. Jev was answering *correctly* for who she was — the bug was upstream, in `worldgen.ts`'s `familyValueBias`: both founders in a couple share one `familyIndex`, so when the random 1-2 biased values happened to include `family`, an entire founding line could land near-maximally anti-family purely by chance. Fixed by excluding `family` from the biasable pool (decision 028) — a worldgen/demographics change, never a Jev-answer weight (decision 016 stands).

| Metric | `living-1` | `living-2` | `living-3` |
|---|---|---|---|
| Social decisions (Jev calls) | 323 | 395 | 289 |
| Wall time | 35.3s | 38.4s | 28.9s |
| Input tokens | 292,959 | 653,174 (cumulative across seeds run so far this session) | 913,968 (cumulative) |
| Output tokens | 13,733 | 30,401 (cumulative) | 42,621 (cumulative) |
| Population: start → mid (1537) → end | 25 → ~22 → 17 | 23 → ~26 → 20 (peaked 28) | 22 → ~20 → 8 |
| Births / marriages (simulated years only) | 13 / 11 | 18 / 13 | 6 / 4 |

**2 of 3 seeds now healthy** (`living-1`, `living-2` — population stable or growing through the midpoint, ending well above zero); **1 of 3 still declined** (`living-3`, 22→8). This is a large, measured improvement over EVERY pre-fix seed collapsing (`chronicle-1/2` from round 5: 24→13/8; `chronicle-3` this round: 24→5), and the remaining variance is exactly the kind decision 016 already anticipated and explicitly said not to paper over with weights — reported honestly rather than cherry-picking only the healthy seeds.

### A8, A3 call-shape (decision 028)

A8 (dream check) moved from a blind 5-year timer to a 10-year milestone plus two real-reason triggers (a recent setback, a recent dream-related event). Raw call counts across the three seeds: 98, 120, 84 — not dramatically lower than round 5's 84-121, because these worlds are also carrying MORE living people (the population fix's side effect: more people alive means more people with a still-unrealized dream to occasionally re-check). Disclosed as a partial improvement, not a resolved one.

A3 (career) moved from every 15 years to every 20, and now names real tenure in the prose — see Branwell Nightwood's biography below ("After 20 years as a blacksmith, ... became a scholar").

### Fork from the Chronicle page, done in the browser

Via Playwright, on Sable Underhill's chronicle (seed `living-chronicle-1`, world `w1-mubjaqc4`): opened "Do I fall ill this year?" (year 1504, `jevRaw`: 2% illness / 98% healthy — a genuine long-shot that had landed on "illness"), chose "Sable Underhill stays healthy" instead. The in-place rewrite: the 1504 entry rang in brass, every entry after it blurred/faded, a pill tracked "Rewriting Sable's life from 1504… now at 1575 (`N` living)" through the live SSE `tick` stream, then the page swapped in the new branch's chronicle without a full navigation (`router.replace`) — the 1504 "Recovers from illness" entry is simply gone in the new branch, and every entry after it re-narrates from the new state. The branch rail now lists both "Original timeline" and the new branch, either reachable at any time.

### Two grammar bugs found live while building the inner-life prose (decision 028)

Screenshotting the fix for "Ilva's chronicle is a list of facts" surfaced two real bugs: both the new `innerLifeClause` and the existing (round-5) death-of-a-family-member clause used the SUBJECT pronoun in an OBJECT position — "This would stay with **she** for years" / "the loss stayed with **she** for years" instead of "her". Fixed with a proper `objectPronoun` helper; verified live via `curl` against the running world (`"This would stay with her for years"`, confirmed twice) before re-screenshotting.

### Two sample biographies (seed `living-chronicle-1`, world `w1-mubjaqc4`)

**Sable Underhill** (b. 1454, d. 1545, age 91) — married, one daughter, three dream changes, dies of illness at home:

```
1487 · Marries Roran Underhill — Sable Underhill married Roran Underhill.
1488 · Daughter Kira Underhill is born — during high summer.
1504 · Recovers from illness — Sable Underhill fell ill, but recovered.
1504 · Sets a new dream — sights on mastering a craft.
1510 · Becomes a farmer.
1512 · Sets a new dream — sights on leaving for the city.
1524 · Sets a new dream — sights on founding something lasting.
1534 · Lets go of a dream — let go of founding something lasting. She felt despairing. This would stay with her for years.
1545 · Dies — passed away at age 91. Follows illness in 1545.
```

Life summary: *"Sable Underhill died at 91 in Stonebridge. She spent much of her life as a farmer. She never permanently left the town where she was born. Her dream of founding something lasting was let go along the way."*

**Branwell Nightwood** (b. 1492, d. 1572, age 80) — three real career changes with tenure named in the prose, a realized dream, a late marriage and child, a feud:

```
1492 · Is born — welcomed by Hana Nightwood and Silas Nightwood, in the first days of spring.
1508 · Becomes a blacksmith.
1512 · A dream realized — dreamed of founding something lasting, realized in 1512. He felt proud.
1528 · Becomes a scholar — after 20 years as a blacksmith.
1540 · Meets Talia Underhill — at the market square, in the first days of spring; began courting.
1543 · Recovers from illness.
1548 · Feud breaks out with Dana Brightwater — he felt furious.
1548 · Becomes a guard — after 20 years as a scholar.
1549 · Marries Talia Underhill — he felt joyful.
1566 · Son Kaelan Underhill is born — during high summer.
1572 · Dies — passed away at age 80.
```

Life summary: *"Branwell Nightwood died at 80, surrounded by his child in Stonebridge. He spent much of his life as a guard. He never permanently left the town where he was born. His dream of founding something lasting came true."*

**Honest critique against round 5:** both biographies are noticeably richer without being longer — real career narratives with tenure, inline emotional beats ("He felt proud", "she felt despairing... this would stay with her"), and a genuine fork demonstrated in place on the same page. Neither biography shows the new C2/O2/O4/A5 situations (they fired elsewhere in these worlds — town events "a bountiful harvest" and "a festival" appear on the Town chronicle page — just not for these two specific people), and Branwell's chronicle still reads as fact-forward for the earlier, purely-biological entries (birth, illness-recovery) — the inner-life weave only applies where a decision actually produced a memory, by design, not everywhere.

Screenshots (scratchpad): `r6-world-creation.png`, `r6-person-desktop.png`, `r6-person-mobile.png`, `r6-change-modal.png`, `r6-change-modal-why.png`, `r6-mid-rewrite.png`, `r6-after-rewrite.png`, `r6-town.png`. Honest critique of the world-creation screenshot: it was captured too early in the stream (still on the `start` frame), so it shows only the "Writing the lives of Stonebridge…" headline with no year/population/event-line content yet — the screen does populate those once `tick` frames arrive (visible in the later screenshots' top bar context), but this particular screenshot doesn't prove it.

## 2026-09-21 — Fifth round: monotone-loop fixes, grammar, 4 new situations, Living Chronicle data layer (seeds `chronicle-1`/`chronicle-2`)

Two live Jev worlds via `POST /api/worlds/stream`, plus a fork of a fragile decision. The round-5 brief's sample biographies below **supersede round 4's** (Orla Cinderfell / Kira Juniperwick, in the entry below this one) — those two are kept as a historical record of what the grammar/repetition bugs looked like before this round's fixes, not because they're still representative.

### World creation (two seeds, to distinguish a systemic issue from seed variance)

| Metric | `chronicle-1` | `chronicle-2` |
|---|---|---|
| Social decisions (Jev calls) | 310 | 339 |
| Wall time | 32.9s | 35.2s |
| Input tokens | 274,344 | 577,589 (adapter total is process-cumulative across both worlds; per-call average ≈890-1,700) |
| Output tokens | 13,273 | 27,891 |
| People (ever existed) | 38 | 34 |
| Events | 201 | 181 |
| Decisions recorded | 566 | 586 |
| Population, start → end | 23 → 13 | 24 → 8 |
| Births / marriages / deaths | 15 / 13 / 25 | 13 / 11 / 26 |

Both comfortably within budget (≤1,500 calls, ≤60s per world — decision 017/025's budget note).

**Decision-kind counts, `chronicle-2`** (showing catalog variety — 13 kinds observed, up from round 4's 9): A8 121, death 89, illness 82, immigration 76, A3 58, Y1 40, A2 37, A1 24, Y3 23, **A5 13**, Y4 9, A6 8, **O4 3**, **O2 2**, **C2 1**. (Biology kinds — illness/death/immigration — are recorded whenever the road-not-taken had ≥5% probability, per decision 007's threshold, not only when they fire.)

**A8's high count (105-121) is an expected side effect of decision 023's dream-realization gate**, not a bug: since "push-harder" can no longer succeed without a matching real event already on the person's log, more people keep "still chasing" their dream and get re-asked every 5 years instead of resolving early. Worth watching if a future round wants to trim the call budget.

**Population decline, disclosed honestly:** both seeds end noticeably smaller than round 4's `mind-1` run (24→13 and 24→8, vs. round 4's 27→24). No code-side weight was added anywhere this round (per decision 016's standing rule), and no bug was found in the death-probability path (the only change there, a `hardshipMultiplier`, is 1.0 except during the rare `plague`/`famine`/`fire` town-event year — one such year occurred in `chronicle-1`, none flagged in `chronicle-2`'s sampled output). The proximate cause is fewer of `A2`'s 34-37 "try for a child" decisions converting to `A2: try` (13-15 actual births) — Jev's own, unweighted judgment, which decision 016 already anticipated could vary seed to seed. Flagged as a finding to watch across more seeds, not treated as a regression to fix with a weight.

### Fork: forced a fragile decision

Forked a real `A6` decision (`chronicle-2`, year 1522: "My feud with Talia Nightwood has gone on for years...") with **`fragility: 0.007`** (about as close a call as the run produced) and **`surprise: true`** (Jev's own distribution favored `reconcile` at 75%, but the Gumbel draw picked the 11%-probability `sabotage`) — forced `reconcile` instead.

| Metric | Value |
|---|---|
| `changedPeopleCount` | 15 |
| New (real) Jev calls for the fork | 227 |
| Wall time | 19.3s |
| New people born (different marriages) | 9 |

**The cascade:** forcing reconciliation between Branwell Kestrelholt and Talia Nightwood (instead of Jev's sampled "sabotage") rewired the town's entire marriage web downstream: Talia married Branwell instead of Hollis Nightwood; Branwell married Talia instead of Nella Nightwood; Nella ended up unmarried instead; Hollis married a different immigrant (Quilla Ashford) instead of Talia. That chain of reassigned marriages produced 9 different children who never existed in the base branch (different parents → different people, per decision 014's content-derived ids). A textbook butterfly effect from one forced decision at a `fragility` this low.

### B1-B6 (round-5 point 1-6) fixes, verified live

- **Point 3 (dead actor):** confirmed fixed by direct test (`situations.test.ts`) — see decision 022. No dead-actor decision observed in either live run.
- **Point 6 (contradictory traits):** Ilva Nightwood's page shows "unshakable, hardy, selfless, greedy" and Briala Oakhaven's shows "bold, set in their ways, self-interested, unmaterialistic" — no opposite pairs in either. See decision 024.
- **Point 4 (grammar):** no broken "upon <past-tense verb>" or "dreamed of leave for the city" forms found in either live biography below. See decision 023.
- **Point 1 (monotone loops):** Briala Oakhaven's feud with Loran Kestrelholt escalates twice (1500 → 1506 → 1509) then never resurfaces for the remaining 53 years of her life — contrast with round 4's Orla Cinderfell, who re-feuded with the same 1-2 people five times over. See decision 022.
- **Point 5 (dream realization tied to a real event):** Ilva Nightwood's dream of "mastering a craft" is marked realized in 1508, backed by her becoming a healer in 1504 (a real, non-forced `job` event) — the qualifying event predates the realization, as decision 023 requires.
- **A bug found live and fixed, not in the original list:** the portrait's grudge line read "has never forgiven p007" (a raw internal person id) before decision 027's fix; verified fixed via before/after screenshots.

### Two sample biographies (richest lives in `chronicle-2`, with title + prose, decision 026's new shape)

**Ilva Nightwood** (b. 1488, d. 1570, age 82, died away from town) — a founder's daughter who became a healer, realized her dream, married, raised four children, then left town as a weaver and never returned:

```
1488 · Is born — Ilva Nightwood was born to Sable Nightwood and Garrick Nightwood, during high summer of 1488.
1504 · Becomes a healer — Ilva Nightwood took up the trade of healer.
1508 · A dream realized — Ilva Nightwood dreamed of mastering a craft, and this dream was realized in 1508.
1514 · Meets Loran Kestrelholt — Ilva Nightwood met Loran Kestrelholt at the market square during the depths of winter, and they began courting.
1515 · Marries Loran Kestrelholt — Loran Kestrelholt and Ilva Nightwood were wed.
1516 · Daughter Nella Nightwood is born — during the depths of winter of 1516.
1517 · Daughter Aria Nightwood is born — during the first days of spring of 1517.
1518 · Son Hollis Nightwood is born — during the depths of winter of 1518.
1524 · Son Merric Nightwood is born — Ilva and Loran welcomed a child, Merric, in the depths of winter.
1534 · Becomes a weaver — Ilva Nightwood became a weaver.
1536 · Leaves for a distant town — Ilva Nightwood moved away to a distant town.
1570 · Dies — Word reached town that Ilva Nightwood had died elsewhere, at age 82.
```

Life summary (`lifeSummary`, deterministic): *"Ilva Nightwood died at 82, survived by her children far from home. She spent much of her life as a weaver. She left Ashford behind and never returned. Her dream of mastering a craft came true."*

**Briala Oakhaven** (b. 1490, d. 1562, age 72) — a founder's daughter with a lifelong feud, a marriage, an abandoned dream, and three career changes:

```
1490 · Is born — Briala Oakhaven was born to Fira Oakhaven and Ivo Oakhaven, during the first days of spring of 1490.
1500 · Feud breaks out with Loran Kestrelholt — a bitter feud broke out.
1506 · Becomes a guard.
1506 · Feud with Loran Kestrelholt deepens — struck back, and the feud deepened.
1508 · Meets Roran Kestrelholt — at the old well, in the first days of spring; they began courting.
1509 · Marries Roran Kestrelholt.
1509 · Feud with Loran Kestrelholt deepens — escalated the feud further (then never resurfaces again).
1510 · Sets a new dream: mastering a craft.
1515 · Sets a new dream: leaving for the city.
1521 · Becomes a scholar.
1525 · Lets go of a dream — let go of the dream of leaving for the city.
1536 · Becomes an innkeeper.
1548 · Recovers from illness.
1551 · Becomes a healer.
1562 · Dies — died at age 72.
```

Life summary: *"Briala Oakhaven died at 72 in Ashford. She spent much of her life as a healer. She never permanently left the town where she was born. Her dream of leaving for the city was let go along the way."* Her portrait: *"Briala Oakhaven is fearless in the face of danger, and is set in their ways, and looks out for themselves first. Briala Oakhaven has never forgiven Loran Kestrelholt for what passed between them."*

**Honest critique of these two against round 4's:** clearly richer and cleaner — real courtship/marriage/children present (round 4's Orla had none, being a founder with no backfilled marriage event), season/landmark texture throughout, zero broken grammar, and the feud in Briala's life reads as one real escalating conflict instead of a five-times-repeated loop. What's NOT yet demonstrated here: neither biography includes a `C2`, `O2`, `O4`, or `A5` situation (those did fire elsewhere in the same world — see the per-kind counts above — just not for these two specific people), so this pair doesn't show off the full round-5 catalog expansion in one place. A richer catalog-showcase biography would need a person who lived through a plague AND lost a parent young AND carried a grudge into old age — not guaranteed to exist in any given 75-year, ~30-person town.

Screenshots: `r5-person-ilva.png`, `r5-person-briala.png` (before the portrait-name fix), `r5-person-briala-fixed.png` (after), in the scratchpad.

## 2026-09-21 — Fourth round: PersonMind + situation catalog, fragility/surprise, B1-B5 fixes (seed `mind-1`)

Live Jev world creation via `POST /api/worlds/stream`, worldId `w1-mubgwtqv`, followed by a fork of a genuinely fragile decision.

### World creation

| Metric | Value |
|---|---|
| Social decisions (Jev calls, cache misses) | 578 |
| Wall time | 40.3s |
| Input tokens | 523,065 (≈905/call) |
| Output tokens | 24,697 |
| People | 55 |
| Events | 364 |
| Decision records kept | 916 |
| Births | 25 |
| Marriages | 15 |
| Deaths | 31 |

**Population over time:** 1500: 27 → 1510: 31 → 1520: 32 → 1530: 35 → 1540: 36 → 1550: 31 → 1560: 30 → 1570: 27 → 1575: 24.

**On decision 016's open question ("if Jev alone makes marriages/births rare again, fix the mind not the weights"):** population stayed healthy across the full 75-year span (never below 24, peaked at 36) with a full PersonMind state and zero code-side weight — the same shape of result as the round-3 run, now with the richer inner-life state doing the work rather than the pre-round-4 worldgen safety net alone. This directly answers B5: no population collapse observed; no weights were added.

### Fork: forced a fragile decision

Forked a Y4 (first grudge) decision with `fragility: 0.001` — essentially a toss-up between Gumbel scores — forcing `"forgive"` where the original run had sampled `"confront"`.

| Metric | Value |
|---|---|
| `changedPeopleCount` | 1 |
| Total decisions re-evaluated | 72 |
| New (uncached) Jev calls | 6 |
| Cache reuse | 66/72 = 91.7% |
| Wall time | 2.76s |

**Conclusion:** the cache-by-(question id + serialized state) design (decision 004) scales correctly even with the much larger per-decision state a PersonMind adds — a single fragile edit still only pays for the handful of downstream decisions whose actual state changed, not the whole town.

### B1 (fragility vs. surprise) — verified live

A real A8 (dream check) decision: chosen option `abandon-it` had only 14% probability — correctly flagged `surprise: true` — but a moderate `fragility: 1.83` (not the closest possible call). A separate, decisive decision where the 97% favorite won was correctly flagged `surprise: false, fragility: 8.53` (not fragile). The two signals diverge on real data as intended — see [decision 018](./decisions.md#018--fragility-and-surprise-replace-margin).

### B2/B3 (Loom clutter and weaving) — screenshots

Screenshots taken via Playwright, saved to the scratchpad (`r4-loom.png`, `r4-inspector.png`, `r4-person.png`).

- **B2:** default dot count dropped from showing every roll to 393/916 visible (noteworthy-only: produced an event, forced, fragile, or a surprise); a "show all rolls" checkbox reveals the rest.
- **B3, honest critique:** marriage bands (translucent, spanning from the marriage year) and bezier birth curves are a clear, visible improvement over round 3's flat parallel lines — family clusters are now recognizable at a glance in `r4-loom.png`. What's *not* fully solved: lane ordering is still a DFS-plus-splice heuristic, not true crossing-minimization, so towns with many cross-family marriages still show some long connector lines; and relationship arcs (friend/grudge) are hover-only, so the "weave" of the social fabric isn't visible in a static screenshot, only interactively. See [decision 020](./decisions.md#020--the-loom-shows-weaving-marriage-bands-birth-curves-relationship-arcs).

### B4 (duplicate names) — verified

0 duplicate given+surname combinations among the living, checked across 3 worldgen seeds (46, 35, 47 people) with a throwaway script (not kept in the repo). See [decision 019](./decisions.md#019--given-names-unique-among-the-living).

### Two sample biographies (richest lives in this run)

**Orla Cinderfell** (b. 1476, d. 1563, age 87) — a life defined almost entirely by feuds and reconciliations, with one realized dream early on:

```
1500 - A bitter feud broke out between Roran Cinderfell and Orla Cinderfell.
1503 - Orla Cinderfell and Roran Cinderfell made peace at last.
1506 - Orla Cinderfell dreamed of leave for the city, and this dream was realized in 1506.
1507 - A bitter feud broke out between Orla Cinderfell and Petra Mossgate.
1515 - Orla Cinderfell and Petra Mossgate began a bitter feud.
1526 - Orla Cinderfell and Petra Mossgate reconciled.
1533 - A bitter feud broke out between Orla Cinderfell and Briala Underhill.
1535 - Briala Underhill and Orla Cinderfell made peace at last.
1542 - Orla Cinderfell and Briala Underhill began a bitter feud.
1544 - Briala Underhill and Orla Cinderfell made peace at last.
1558 - Orla Cinderfell and Briala Underhill began a bitter feud.
1560 - Briala Underhill and Orla Cinderfell reconciled.
1562 - A bitter feud broke out between Orla Cinderfell and Fira Underhill.
1563 - Orla Cinderfell passed away at age 87.
1564 - Fira Underhill and Orla Cinderfell made peace at last.
```

**Kira Juniperwick** (b. 1463, d. 1546, age 83, died away from town) — a life with one early realized dream, illness survived, a decades-long feud that outlasts her move to a distant town:

```
1502 - A bitter feud broke out between Kira Juniperwick and Cedric Juniperwick.
1503 - Kira Juniperwick dreamed of found something lasting, and this dream was realized in 1503.
1504 - Kira Juniperwick and Cedric Juniperwick made peace at last.
1509 - Kira Juniperwick took up the trade of innkeeper.
1511 - A bitter feud broke out between Hana Stonebrook and Kira Juniperwick.
1518 - Kira Juniperwick took ill for a time, then recovered.
1521 - Hana Stonebrook struck back at Kira Juniperwick, and the feud deepened.
1521 - Kira Juniperwick packed up and left for a distant town.
1523 - Hana Stonebrook struck back at Kira Juniperwick, and the feud deepened.
1531 - Hana Stonebrook escalated the feud with Kira Juniperwick further.
1535 - Hana Stonebrook escalated the feud with Kira Juniperwick further.
1537 - Hana Stonebrook escalated the feud with Kira Juniperwick further.
1541 - Hana Stonebrook struck back at Kira Juniperwick, and the feud deepened.
1546 - Word reached town that Kira Juniperwick had died elsewhere, at age 83.
```

Kira's biography is also what surfaced [decision 021](./decisions.md#021--escalated-feuds-get-their-own-prose) — before that fix, every "escalated the feud" line here read as a fresh "began a bitter feud," which made a single long-running, repeatedly-sabotaged feud with Hana Stonebrook look like five separate feuds breaking out from scratch.

**Observed but not fixed this round (disclosed, low-severity):** these two biographies both lean heavily on feuds/dreams because Y4/A6/A8 are the most frequently-triggered situations in the implemented subset; a life with, say, an A2 (child) but no romance ever accepted looks comparatively thin. This is a direct consequence of decision 017's scoped subset (9 of ~24 situations, no C1-C4 childhood situations), not a bug — expanding the catalog is the natural next round.

## 2026-09-21 — Third round: decision records, Gumbel-max, generic override, SSE, The Loom (seed `loom-2`)

Live Jev run against `:3000`, exercising the round-3 rebuild end to end: `POST /api/worlds/stream` (world creation), then `POST /api/worlds/[worldId]/edit/stream` (a generic-override fork of a close call), both via `curl -N` and confirmed incrementally streaming (`tick` frames arriving per simulated year, not buffered until the end), then the same flow again through a real browser (Playwright, screenshots in the report) clicking a decision dot and "Choose this instead."

| Step | Social decisions asked | Wall time | Notes |
|------|------------------------|-----------|-------|
| World creation | 218 | 28.7s | 30 people (23 at start), 100 events, **602 decision records** kept (illness/death/immigration filtered by the 5% recording threshold — see decision 007). `jevRaw` confirmed present and un-blended: e.g. a `move` decision recorded `jevRaw: {"stay":1,"move":0}` exactly equal to `final` (decision 016 verified live, not just by code inspection). |
| Fork 1: forced an `accept-partner` close call (`margin: 0`, 58% said "decline" would win, Gumbel noise picked "decline", forced "accept" instead) at year 1500 — the very first simulated year | 212 | 5.3s | `changedPeopleCount: 4` — a 4-person spouse-reassignment chain (forcing one new couple bumped their original partners into each other). Cumulative process cache after this fork: 237 calls, **193 cache hits (81%)** — even forking at year 1 and re-simulating the full 75-year span, most of the town's OTHER decisions ask the exact same question with the exact same state as the original run, so the cache (keyed by question id + serialized state, unchanged since round 1) still does most of the work. |
| Fork 2 (browser, via "Choose this instead" on a `death` decision, 88% survive / 12% die) | — | ~a few seconds | `changedPeopleCount: 1` at the moment of forcing (immediate); the Loom's ghost overlay correctly showed the person's original (longer) lifeline continuing past their new, earlier death — screenshot in the round-3 report. |

**Conclusions:**
- SSE streaming works as designed: `curl -N` shows `tick` frames arriving one simulated year at a time, not all at once at the end; a browser sees the same via `src/lib/sse.ts`.
- The generic override (decision 008) reproduces the "prevent a death" and "force/prevent a marriage" style edits from round 2 exactly as anticipated, with no special-cased code — a death decision's `"survive"` option, an `accept-partner` decision's `"accept"` option.
- Cascades are still real and multi-person under the new architecture (4-person chain from a single early accept-partner override), consistent with round 2's demographic fixes.
- **On decision 016 (blend removed):** this round's live run did not reproduce the "zero births, town dies out" failure from round 1 — 602 decisions recorded, real marriages and children present in the log, a 4-person cascade from one edit. That is evidence the worldgen safety net (decision 012: pre-seeded families + immigration) is carrying the load on its own, without the blend. It is **not** a large-sample claim across many seeds — round 2's finding that seed-to-seed variance exists (some towns thrive, some struggle) still applies, and a future run finding Jev-alone systematically thin on marriages/children again would not contradict this entry. Per the brief, if that happens the fix is round 4's richer inner-life state for Jev, not re-adding weights.
- One visible UI rough edge, not a data bug: `decisionMargin` reports `0` (maximally "close call") both for genuine 50/50 toss-ups AND for a low-probability option that won against the noise (e.g. 1% beating 99%) — both are technically "the story could have gone differently," but the second case can read oddly next to a "1%" label in the inspector. Documented in decision 009 as a known nuance rather than fixed this round.

## 2026-09-21 — Second live Jev run, post-fixes (seed `butterfly-2`)

World creation and two forks against the running `:3000` dev server with `DECISION_ENGINE=jev` (real key). The `:3000` process is a single shared `JevDecisionMaker` singleton (see [decision 006](./decisions.md#006--server-state-lives-on-globalthis)), and the person testing it live in a browser was using the same process concurrently, so the *cumulative* `adapterStats` numbers below are process-wide, not isolated to a single request — the per-request `decisionCalls`/`wallTimeMs` figures are the reliable per-call numbers.

| Step | Decisions (this call) | Wall time (this call) | Notes |
|------|------------------------|------------------------|-------|
| World creation | 246 | 26.0s | 33 people (23 at start), 162 events. First request after a cold `next dev` start also triggered a second, concurrent `POST /api/worlds` from live browser testing on the same seed — see caveat above; cumulative process-wide calls after both had run: 432, 0 cache hits (both were genuinely new work, racing on an empty cache). |
| Edit 1: prevent-marriage (a marriage that had produced a child) | 125 | 10.5s | `changedPeopleCount: 14`. Cumulative cache hits after this edit: 94/593 process-wide calls. |
| Edit 2: prevent-death (a parent, at his actual death year) | 68 | 1.9s | `changedPeopleCount: 8`, including one newly-nonexistent person (`missingPeople`) and one newly-existing one (`newPeople`) correctly identified by id, not misreported as a field change — see [decision 014](./decisions.md#014--content-derived-ids-for-children-and-immigrants). Cumulative cache hits after this edit: 159/596 process-wide calls. |

**Compared to the first run:** 33 people (vs. 16), 162 events (vs. 49), multi-generational births present, and both edits cascaded through 8-14 people instead of 1-2 — the demographic and cascade fixes (round 2) hold up against the live API, not just the rules-engine unit tests. Both edit-1 and edit-2 forks show real cache reuse (partial for edit 1, since much of the post-1514 timeline is genuinely new state; much stronger for edit 2, a smaller, later, more localized change).

**Rules-engine comparison** (same code path, `RuleDecisionMaker`, no network — see `scripts/check-demographics.ts`), 10 seeds including `butterfly-1` and `butterfly-2`: population at end ranged 12-51 (mostly 18-41), births 5-50 (mostly teens-to-30s), decisions per world 116-405. One seed (`butterfly-1` itself) still ends up population-poor (12 alive, 5 births) — natural seed-to-seed variance in a stochastic sim, not a regression: it went from "the town dies out" (2 alive, 0 births) to "a town that struggles but survives."

## 2026-09-21 — First live Jev run (seed `butterfly-1`)

| Metric | Value |
|--------|-------|
| World | 16 people, 49 events, 1500–1575 |
| World creation | 115 Jev calls, 15.0s wall |
| Edit: prevent a death | 67 decisions, 66 cache hits, 1.2s |
| Edit: prevent a marriage | 101 decisions, 0.9s |

**Problems found:**

1. **No births in 75 years.** Founders were born 1448–1483, so the town dies out, with 2 people alive at the end. Without new generations there is no causal web, and edits barely cascade: 1–2 people changed per edit.
2. **Invalid edits return 200.** Forcing a marriage with someone who is already dead silently did nothing.
3. **Repetitive prose.** One person "fell ill" three times in five years, and romances started around age 53.

**Status:** fixed in round 2 — see the live re-run above (seed `butterfly-2`) and [decisions 012-015](./decisions.md). Demographics (family-seeded worldgen + immigration), edit validation (400 on invalid targets), and prose (illness cooldown/recovery, merged birth/child events, template variety) all verified against the real API.

## 2026-09-21 — Determinism experiment

**Setup:** `pnpm determinism` sends the same question and state to `jev-1.13.0` 10 times, uncached.

| Option | Min | Max | Spread |
|--------|-----|-----|--------|
| marry | 0.24 | 0.35 | 0.11 |
| continue | 0.65 | 0.76 | 0.11 |
| breakup | 0.00 | 0.01 | 0.01 |

- The top choice was the same in all 10 runs. Average latency was 580ms.
- **Conclusion:** Jev is not bit-for-bit reproducible. The judgment cache is required for fork replay ([decision 004](./decisions.md#004--pin-the-model-and-cache-every-judgment)).

## 2026-09-21 — Rules-engine smoke run

19 people, 118 events and 180 decisions in 34ms. The full API flow works: create, biography, "why?", edit, diff.

## 2026-09-21 — Round 11 (decision 044): partial live verification, budget-scoped

Implemented `decideYear` batching (one Jev request per person per year, occurrence + speculative
response + optional significance in one call, rate limiter, widened retry, request splitting,
cache keyed by state+questions+model). `pnpm typecheck`/`pnpm test` (138 passing)/`pnpm lint` all
clean; new unit/integration tests cover batching, caching, retry, splitting, the protagonist
guarantee, and multiple same-year events (see decision 044's "Verified" section).

**Not completed this round, disclosed:** the full same-seed before/after live comparison (seed
`batch-1`, name `Lucía`, previous commit `d3fe03c` vs this round's change) and the `/rewrite`
cache-reuse live measurement, both specified in this round's brief. One live smoke test was run
against the new code (`POST /api/lives/stream`, seed `batch-1`, `Lucía`) to confirm the server
starts and streams without error post-refactor: the `start` event arrived correctly
(`Stonebridge`, born 1500), and the server log showed the request still in flight, still healthy,
past 60s (no crash, no error) when this round's tool budget ran out before the life finished
streaming and before a second (pre-refactor, worktree-based) run could be captured for comparison.
**Occurrence-inflation measurement (brief point 7) was not performed** for the same reason — no
"events per year per person" count was collected this round. Both are the natural first things to
run in the next round, before further building on this batching change, given decision 044 already
discloses that `occurrence` isn't yet load-bearing for triggering the general candidate catalog.

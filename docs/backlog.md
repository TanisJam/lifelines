# Backlog

Open items and product calls, newest first. Move an item to `decisions.md` once it is decided and built.

## Product calls (2026-09-21)

- **The vignette share is accepted.** Everyday scenes make up about 48% of protagonist events (decision 047), and that stays. A medieval life was mostly ordinary; that is fine.
- **Everything should be editable.** The user likes that most entries are turns (38 of 50 in seed `noop-1`). Don't reduce the number of turns to follow ui-ux-handoff §7. Instead, lean toward making every entry changeable.

## To review

- [ ] **One Follett-plausible marriage-age target still fails (decision 080).** Gentry women marry at 21.46–21.55 (band 14–18) — a genuine structural gap: gentry is "one household per village" in worldgen (decisions 068–071's own repeated finding), so the sample is a handful of daughters across the whole run, dominated by individual life-course timing, not a hazard-curve parameter. A clean fix needs more gentry supply (gentry-class immigrants, or a cross-manor gentry match); `spawnImmigrant` deliberately never produces gentry today (decision 049), and changing that is a real design-invariant change, not a small nudge. The other two marriage-age misses (women overall, gentry men) and both population-trajectory targets now pass as of decision 080.

- [ ] **Rewrite ghost annotations come back empty.** The "In the original life, …" matching is too narrow when the butterfly effect shifts later events by a year or more (decision 039).

## Next session

- [ ] A UI revamp from a strong-inspiration mockup the user will provide. Port its visual values faithfully, and keep the four-phase rewrite moment.

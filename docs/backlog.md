# Backlog

Open items and product calls, newest first. Move an item to `decisions.md` once it is decided and built.

## Product calls (2026-09-21)

- **The vignette share is accepted.** Everyday scenes make up about 48% of protagonist events (decision 047), and that stays. A medieval life was mostly ordinary; that is fine.
- **Everything should be editable.** The user likes that most entries are turns (38 of 50 in seed `noop-1`). Don't reduce the number of turns to follow ui-ux-handoff §7. Instead, lean toward making every entry changeable.

## To review

- [ ] **Three Follett-plausible marriage-age targets still fail (decision 079).** Women marry at 23.02, just 0.02 over the 18–23 band. Gentry women marry at 21.55 (band 14–18) — a genuine structural gap (gentry is "one household per village" in worldgen, decisions 068–071's own repeated finding), not a rate this slice's levers touch. Gentry men marry at 26.41, just 0.41 over the 20–26 band. The population targets (pre-plague growth, post-plague recovery) both pass as of decision 079.

- [ ] **The engine has no population ceiling.** Sustained births above deaths compound, so long runs slow down fast. Decision 079 bounded its post-plague immigration to 1350–1361 and raised four test timeouts to 20–100 s instead of fixing this. A carrying-capacity feedback would bound run time and let those timeouts come back down.
- [ ] **The merchet test reads social class at simulation end, not at marriage time.** Decision 079 skips the class check for marriages before a later widowhood, because "widow keeps the trade" can reclassify a spouse afterwards. Recording the class on the marriage event would restore the full check.

- [ ] **Rewrite ghost annotations come back empty.** The "In the original life, …" matching is too narrow when the butterfly effect shifts later events by a year or more (decision 039).
- [ ] **SSE ticks replay the finished life** grouped by year, instead of narrating the simulation as it runs (decision 036).

## Next session

- [ ] A UI revamp from a strong-inspiration mockup the user will provide. Port its visual values faithfully, and keep the four-phase rewrite moment.

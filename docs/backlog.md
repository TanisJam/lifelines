# Backlog

Open items and product calls, newest first. Move an item to `decisions.md` once it is decided and built.

## Product calls (2026-09-21)

- **The vignette share is accepted.** Everyday scenes make up about 48% of protagonist events (decision 047), and that stays. A medieval life was mostly ordinary; that is fine.
- **Everything should be editable.** The user likes that most entries are turns (38 of 50 in seed `noop-1`). Don't reduce the number of turns to follow ui-ux-handoff §7. Instead, lean toward making every entry changeable.

## To review

- [ ] **People marry about 15 years too late.** The mean age at first marriage is 40.2 for women and 44.0 for men over 60 seeds, against about 25 and 27 in research.md. The class floors from 053 hold; the delay comes from the person-year event lottery, where marriage competes with every other event each year. Fixing it means changing how marriage is drawn, not tuning a number. It pushes fertility, widowhood and inheritance off history (decision 053).

- [ ] **Rewrite ghost annotations come back empty.** The "In the original life, …" matching is too narrow when the butterfly effect shifts later events by a year or more (decision 039).
- [ ] **SSE ticks replay the finished life** grouped by year, instead of narrating the simulation as it runs (decision 036).

- [ ] **Test DATA_DIR survives between runs.** `vitest.setup.ts` keys the directory on the pool id and never cleans it up, so default-store state leaks across runs and test files. Use a per-run directory and clean it up in teardown (review R3, 2026-09-22).

## Later

- [ ] **Possible double departure.** Seed `noop-1` shows "Leaves for Ravensworth, a city" and later "Leaves for Raven's Reach". Check whether this is a return home followed by a second departure (which is fine, but the return should appear in the chronicle) or a bug in the away-from-home logic (decision 040).

## Next session

- [ ] A UI revamp from a strong-inspiration mockup the user will provide. Port its visual values faithfully, and keep the four-phase rewrite moment.

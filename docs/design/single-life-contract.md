# Single-life contract (round 9)

This is the contract between the **engine** work (`src/domain`, `src/server`, `src/app/api`) and the **UI** work (`src/app` pages, `src/components`), which run in parallel worktrees. The types live in [`src/contracts/life.ts`](../../src/contracts/life.ts). Neither side changes them without updating both.

## Product

1. The player names a newborn and picks "a daughter", "a son" or "let fate decide".
2. One protagonist is born in a medieval village, and the simulation writes their life **until death**. Early death is possible.
3. The player reads the chronicle and can change any **turn** in it, including turns decided by other people or by chance. The life is then rewritten from that point.
4. The whole village is still simulated, and Jev plays everyone. The protagonist gets priority in the budget.

## Endpoints

| Method | Path | Returns |
|--------|------|---------|
| POST | `/api/lives/stream` | SSE `LifeStreamEvent`: `start`, then `tick` per year, then `done` |
| POST | `/api/lives/:lifeId/rewrite/stream` | SSE: `start`, `divergence`, then `tick` per year, then `done` (with `ghosts`) |
| GET | `/api/lives` | `LifeListItem[]` |
| GET | `/api/lives/:lifeId?branchId=` | `Chronicle` (defaults to the latest branch) |
| GET | `/api/lives/:lifeId/people/:personId?branchId=` | `PersonSheet` |

Errors are returned as JSON `{ error }` with a 4xx status, or as an SSE `error` event.

## Rules both sides rely on

- The protagonist's id is always `"protagonist"`. Their birth is immutable: rewrites are allowed only at or after their birth year.
- The simulation stops when the protagonist dies.
- The protagonist's death is **always** a turn. The alternative is "survived", and choosing it continues the life.
- `level: 3` entries always have a `turn`; other levels never do.
- Prose marks people as `{{personId}}`, and `links` resolves them. The UI renders these as buttons that open the read-only `PersonSheet`.
- Branch labels are "Original life" and "Changed in <year>". The UI never shows git terms.
- `tick.entries` contains only the protagonist's **new** entries for that year, in chronicle order. For a rewrite, ticks start at the divergence year.

## Parallel work split

| Worktree | Owns | Must not touch |
|----------|------|----------------|
| `engine` | `src/domain/**`, `src/server/**`, `src/app/api/**`, `src/adapters/**`, `scripts/**`, domain tests | `src/components/**`, page files under `src/app/` (outside `api/`), `globals.css` |
| `ui` | `src/app/**` except `api/`, `src/components/**`, `src/lib/**`, `globals.css` | `src/domain/**`, `src/server/**`, `src/app/api/**` |

- **The UI builds against the contract with a fixture adapter.** It uses `src/lib/fixtures/life-fixture.ts`, generated from the types, until the engine merges.
- **The engine verifies its endpoints with curl** and unit tests.
- **Docs:** the engine appends decisions 034 and up to `docs/decisions.md`; the UI appends decisions 040 and up. This keeps the numbers from clashing.

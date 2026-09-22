import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Every store's default (globalThis-cached) instance resolves its SQLite DB path from `DATA_DIR`
 * (see `src/server/db.ts`). Vitest re-evaluates `setupFiles` for every test file, so this runs
 * once per file — but it always computes the SAME directory for a given worker (keyed by the
 * worker's own pool id, not anything random) and just re-creates it if it's already there
 * (`mkdirSync(..., { recursive: true })` is idempotent). That gives each vitest worker its own
 * `DATA_DIR`, so two workers never open the same SQLite file concurrently (which was surfacing as
 * `SQLITE_BUSY` under the shared single temp dir this used to set up in `vitest.config.ts`), while
 * still never touching the real `.data/`. Falls back to the process id when no pool id is
 * available (e.g. a single-worker/no-pool run).
 */
const workerId = process.env.VITEST_POOL_ID ?? process.env.VITEST_WORKER_ID ?? String(process.pid);
const dir = path.join(os.tmpdir(), `lifelines-test-data-${workerId}`);
mkdirSync(dir, { recursive: true });
process.env.DATA_DIR = dir;

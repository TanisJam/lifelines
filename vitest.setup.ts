import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll } from "vitest";

/**
 * Every store's default (globalThis-cached) instance resolves its SQLite DB path from `DATA_DIR`
 * (see `src/server/db.ts`), read lazily on first use (`dataDir()` is a function, not a module-level
 * constant) — so setting it here before any test runs is enough, even though this file itself runs
 * before the store modules are imported. Vitest re-evaluates `setupFiles` for every test file, so
 * this runs once per file: `mkdtempSync` hands each file its own uniquely-named temp directory
 * (never touching the real `.data/`), which fixes the two problems the old
 * `pool-id`/`worker-id`-keyed version had — two workers could never collide (no shared key to
 * collide on in the first place), and, unlike a deterministic key, a fresh random suffix can never
 * collide with a directory a PREVIOUS `pnpm test` invocation left behind, since that one never
 * cleaned up after itself. `afterAll` below removes this file's directory once its tests finish, so
 * nothing outlives the run.
 */
const dir = mkdtempSync(path.join(os.tmpdir(), "lifelines-"));
process.env.DATA_DIR = dir;

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

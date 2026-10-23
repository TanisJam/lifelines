import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // A full-span simulation test legitimately takes 7-30 s when several workers share the CPU, and
    // the 5 s default produced a ROTATING set of false failures: the same commit was green on one run
    // and red on the next, with different tests. This is a ceiling, not a target - a hanging test
    // still fails, just later. Individual tests may still set a smaller bound.
    testTimeout: 60_000,
    hookTimeout: 120_000,
    // See vitest.setup.ts: gives each worker its own DATA_DIR (temp dir), so tests never touch the
    // real .data/ and workers never share one SQLite file.
    setupFiles: ["./vitest.setup.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});

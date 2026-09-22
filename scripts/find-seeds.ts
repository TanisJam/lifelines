/**
 * Reseeding helper (decision-identity capability, PR1 — see docs/decisions.md): searches
 * `${baseSeed}-1` .. `${baseSeed}-${maxAttempts}` for the first seed whose simulated world satisfies
 * a given predicate, and picks it. Used whenever a slice of this change breaks a curated test's
 * fixed-seed assumption (decision 053 precedent) — reseed with the first match, then log the
 * old -> new seed and the reason in docs/decisions.md.
 *
 * Usage (library): `import { findSeed } from "../scripts/find-seeds"`, call it from a one-off script
 * or from a test's setup when hand-picking a replacement seed.
 * Usage (CLI): `tsx scripts/find-seeds.ts <baseSeed> <predicateName> [maxAttempts]`
 */
import { RuleDecisionMaker } from "../src/adapters/decision/rule-decision-maker";
import { simulate, type SimulateReport } from "../src/domain/simulate";
import { generateWorld } from "../src/domain/worldgen";

const DEFAULT_MAX_ATTEMPTS = 50;

/**
 * Runs a small world for each candidate seed (`${baseSeed}-1`, `${baseSeed}-2`, ...) until
 * `predicate` returns true, and returns that seed — or `undefined` if none of the first
 * `maxAttempts` candidates satisfy it. Pure with respect to the caller's own state; every candidate
 * world is generated fresh and discarded.
 */
export async function findSeed(
  baseSeed: string,
  predicate: (report: SimulateReport) => boolean,
  options: { readonly startYear?: number; readonly endYear?: number; readonly founderCount?: number; readonly maxAttempts?: number } = {},
): Promise<string | undefined> {
  const startYear = options.startYear ?? 1327;
  const endYear = options.endYear ?? 1361;
  const founderCount = options.founderCount ?? 16;
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;

  for (let n = 1; n <= maxAttempts; n++) {
    const candidateSeed = `${baseSeed}-${n}`;
    const { config, people, events } = generateWorld({ seed: candidateSeed, startYear, endYear, founderCount });
    const report = await simulate(config, people, events, { decisionMaker: new RuleDecisionMaker(), engineSource: "rules" });
    if (predicate(report)) return candidateSeed;
  }
  return undefined;
}

/** Named predicates for the CLI — mirrors the kind of fixed-outcome assertion a curated test wants
 * a seed to satisfy (see decision 053's precedent: "a seed that produces a declined Y1 courtship"). */
const PREDICATES: Record<string, (report: SimulateReport) => boolean> = {
  "has-declined-y1": (report) => report.result.decisions.some((d) => d.kind === "Y1" && d.chosen === "decline"),
  "has-death": (report) => report.result.decisions.some((d) => d.kind === "death" && d.chosen === "die"),
  "has-marriage": (report) => report.result.events.some((e) => e.kind === "marriage"),
};

async function main(): Promise<void> {
  const [baseSeed, predicateName, maxAttemptsArg] = process.argv.slice(2);
  if (!baseSeed || !predicateName) {
    console.error("Usage: tsx scripts/find-seeds.ts <baseSeed> <predicateName> [maxAttempts]");
    console.error(`Known predicates: ${Object.keys(PREDICATES).join(", ")}`);
    process.exitCode = 1;
    return;
  }
  const predicate = PREDICATES[predicateName];
  if (!predicate) {
    console.error(`Unknown predicate "${predicateName}". Known predicates: ${Object.keys(PREDICATES).join(", ")}`);
    process.exitCode = 1;
    return;
  }
  const maxAttempts = maxAttemptsArg ? Number(maxAttemptsArg) : undefined;
  const found = await findSeed(baseSeed, predicate, maxAttempts !== undefined ? { maxAttempts } : {});
  if (!found) {
    console.error(`No seed among ${baseSeed}-1..${maxAttempts ?? DEFAULT_MAX_ATTEMPTS} satisfies "${predicateName}".`);
    process.exitCode = 1;
    return;
  }
  console.log(found);
}

// Only run the CLI when this file is invoked directly (e.g. `tsx scripts/find-seeds.ts ...`), not
// when `findSeed` is imported as a library function.
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

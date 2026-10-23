import { verifyLifecycleLives } from "../src/server/lifecycle-verification";

/**
 * Background verification of every stored lifecycle life: replays each capsule under current authority
 * and compares each indexed view against a fresh regeneration. Never runs in a request, never repairs.
 * Exit code 0 = everything verified, 1 = at least one issue (printed), 2 = the verification itself threw.
 *
 *   pnpm verify:lifecycles
 */
verifyLifecycleLives().then(report => {
  if (report.issues.length === 0) {
    console.log(`Verified ${report.lives} lifecycle ${report.lives === 1 ? "life" : "lives"}: every capsule replayed and every indexed view matches.`);
    return;
  }
  for (const issue of report.issues) console.error(`${issue.lifeId}\t${issue.kind}\t${issue.detail}`);
  console.error(`\n${report.issues.length} issue(s) across ${report.lives} lifecycle ${report.lives === 1 ? "life" : "lives"}.`);
  process.exitCode = 1;
}).catch(error => {
  console.error(`Verification could not run: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 2;
});

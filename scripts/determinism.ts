/**
 * Step 0: determinism experiment.
 *
 * Calls Jev 10 times, uncached, for one realistic decision question and
 * state (the "marry" decision two people in an established romance face),
 * and reports the max absolute difference in the returned option
 * probabilities. This tells us whether a single call to Jev is
 * reproducible on its own, or whether re-simulating a fork MUST go through
 * the cache to get identical results for years before the edit.
 *
 * It also lists the models available to the account, to confirm whether a
 * concrete pinned version exists (rather than relying on the `jev-latest`
 * alias, which can move to a new release without any code change on our
 * side).
 *
 * Run with: pnpm determinism
 */
import { TypeSafeClient, choice, type ChoiceResponse } from "@typesafe-ai/sdk";

try {
  process.loadEnvFile(".env.local");
} catch {
  try {
    process.loadEnvFile();
  } catch {
    // No .env file present; rely on real environment variables.
  }
}

if (!process.env.TYPESAFE_API_KEY?.trim()) {
  console.error(
    [
      "Missing TYPESAFE_API_KEY.",
      "",
      "Copy env.example to .env.local and paste in your TypeSafe API key, then re-run:",
      "  pnpm determinism",
    ].join("\n"),
  );
  process.exit(1);
}

const MODEL = process.env.TYPESAFE_MODEL ?? "jev-1.13.0";
const RUNS = 10;

// A realistic "marry" decision — the same shape JevDecisionMaker sends for
// this DecisionKind (see src/adapters/decision/jev-decision-maker.ts).
const STATE = {
  self: { name: "Elowen Ashford", sex: "f", age: 24, traits: ["romantic", "stubborn", "cheerful"], job: "healer", married: false },
  partner: { name: "Cedric Duskwood", sex: "m", age: 26, traits: ["ambitious", "loyal", "reserved"], job: "blacksmith", married: false },
  town: "Millbrook",
  year: 1524,
};

const INSTRUCTIONS = "Given this couple's personalities and how long they have been together, what do they do this year?";
const CRITERIA = {
  marry: "The couple gets married this year.",
  breakup: "The couple breaks up this year.",
  continue: "The couple stays together as they are, without marrying or breaking up.",
};

async function main(): Promise<void> {
  const client = new TypeSafeClient({ timeout: 20000 });

  console.log(`Calling ${MODEL} ${RUNS} times, uncached, for the same question + state...\n`);

  const results: ChoiceResponse<typeof CRITERIA>[] = [];
  const latencies: number[] = [];

  for (let i = 0; i < RUNS; i++) {
    const started = Date.now();
    const result = await client.systemOne({
      state: STATE,
      questions: { outcome: choice(INSTRUCTIONS, CRITERIA) },
      model: MODEL,
    });
    latencies.push(Date.now() - started);
    results.push(result.answers.outcome);
    console.log(
      `run ${String(i + 1).padStart(2, "0")}: choice=${result.answers.outcome.choice.padEnd(9)} confidence=${result.answers.outcome.confidence.toFixed(3)}  ` +
        Object.entries(result.answers.outcome.probabilities)
          .map(([k, v]) => `${k}=${(v as number).toFixed(3)}`)
          .join("  "),
    );
  }

  console.log();
  console.log("Per-option spread across the 10 runs:");
  let maxAbsDiff = 0;
  for (const option of Object.keys(CRITERIA)) {
    const values = results.map((r) => r.probabilities[option as keyof typeof CRITERIA] as number);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const spread = max - min;
    maxAbsDiff = Math.max(maxAbsDiff, spread);
    console.log(`  ${option.padEnd(10)} min=${min.toFixed(3)} max=${max.toFixed(3)} spread=${spread.toFixed(3)}`);
  }

  console.log();
  console.log(`Max absolute difference across all options and runs: ${maxAbsDiff.toFixed(4)}`);
  console.log(
    maxAbsDiff > 0.01
      ? "-> Non-zero: Jev's own sampling is NOT bit-for-bit reproducible across calls. The cache in JevDecisionMaker is what guarantees a fork's untouched years replay identically."
      : "-> Effectively zero for this question: this call happened to be stable, but the cache is still required as a general guarantee (and to bound cost).",
  );

  const uniqueChoices = new Set(results.map((r) => r.choice));
  console.log(`Distinct top choices across ${RUNS} runs: ${uniqueChoices.size} (${[...uniqueChoices].join(", ")})`);

  const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
  console.log(`Average latency: ${avgLatency.toFixed(0)} ms`);

  console.log();
  console.log("Available models:");
  try {
    const models = await client.models.list();
    for (const model of models) console.log(`  ${model.name.padEnd(16)} ${model.release_date}  ${model.description}`);
    const pinned = models.find((m) => m.name === MODEL);
    console.log(pinned ? `\nUsing pinned model "${MODEL}" (found in the account's model list).` : `\nModel "${MODEL}" not present in /v1/models' listed aliases, but the API accepts versioned ids not shown there (per the docs).`);
  } catch (error) {
    console.log(`  (could not list models: ${error instanceof Error ? error.message : String(error)})`);
  }
}

main().catch((error: unknown) => {
  console.error("Determinism experiment failed:", error);
  process.exitCode = 1;
});

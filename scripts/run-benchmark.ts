/**
 * Manual operator-benchmark pass (2026-08-06): `npm run benchmark:scan`.
 *
 * Exists so the first data point on /accuracy's "Operator benchmark"
 * section doesn't have to wait a week for the Wednesday cron — Takeshi can
 * seed it once from a machine with DATABASE_URL + BASE_RPC_URL set. Runs
 * the exact same runner the cron route calls.
 */
import { runBenchmarkScan } from "../src/lib/benchmark/runner";

async function main() {
  const result = await runBenchmarkScan();
  console.log(JSON.stringify(result, null, 2));
  if (result.recorded === 0) {
    console.error(
      "benchmark: nothing was recorded — check DATABASE_URL and that the verdict_outcomes table exists",
    );
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("benchmark: fatal", error);
  process.exitCode = 1;
});

import { indexFeedbackEvents } from "../src/lib/indexer/feedback-indexer";

async function main() {
  const maxBlocks = Number(process.argv[2] ?? 400_000);
  const result = await indexFeedbackEvents({
    maxBlocks: BigInt(maxBlocks),
  });

  console.log("Feedback indexer complete");
  console.log(`  blocks:         ${result.fromBlock} → ${result.toBlock}`);
  console.log(`  coverage start: ${result.coverageStart}`);
  console.log(`  events:         ${result.events}`);
  console.log(`  inserted:       ${result.inserted}`);
  console.log(`  pruned:         ${result.pruned}`);
  console.log(`  caught up:      ${result.caughtUp}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

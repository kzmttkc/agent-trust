import { indexOwnerAgents } from "../src/lib/indexer/owner-indexer";

async function main() {
  const maxBlocks = Number(process.argv[2] ?? 150_000);
  const result = await indexOwnerAgents({
    maxBlocks: BigInt(maxBlocks),
  });

  console.log("Owner indexer complete");
  console.log(`  blocks: ${result.fromBlock} → ${result.toBlock}`);
  console.log(`  registered events: ${result.registeredEvents}`);
  console.log(`  transfer events:   ${result.transferEvents}`);
  console.log(`  upserted:          ${result.upserted}`);
  console.log(`  removed:           ${result.removed}`);
  console.log(`  caught up:         ${result.caughtUp}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

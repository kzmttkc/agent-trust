import { indexFunderWallets } from "../src/lib/indexer/funder-indexer";

async function main() {
  const limit = Number(process.argv[2] ?? 50);
  const result = await indexFunderWallets({ limit });

  console.log("Funder indexer complete");
  console.log(`  scanned: ${result.scanned}`);
  console.log(`  indexed: ${result.indexed}`);
  console.log(`  skipped: ${result.skipped}`);
  console.log(`  errors:  ${result.errors}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

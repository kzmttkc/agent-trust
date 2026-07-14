import { detectOutcomes } from "../src/lib/indexer/outcome-detector";

async function main() {
  const limit = Number(process.argv[2] ?? 50);
  const result = await detectOutcomes({ limit });

  console.log("Outcome detector complete");
  console.log(`  scanned:  ${result.scanned}`);
  console.log(`  recorded: ${result.recorded}`);
  console.log(`  errors:   ${result.errors}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

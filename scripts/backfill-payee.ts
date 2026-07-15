/**
 * Backfills x402_payments.payee for rows recorded before that column
 * existed, by re-fetching each row's already-verified txHash on-chain and
 * extracting the receiving wallet (same logic POST /v1/payments/x402 now
 * runs at write time — see extractPayeeFromReceipt in
 * src/lib/chain/x402-verify.ts).
 *
 * Safety (explicit Takeshi requirement): defaults to a dry run. No row is
 * ever written unless --apply is passed. Also fails safe — logs a clear
 * message and exits non-zero, without attempting any write — if the
 * `payee` column (or the whole table) doesn't exist yet, i.e. if
 * scripts/sql/2026-07-15-x402-payee.sql hasn't been applied to this
 * database. This mirrors the lesson from a prior session where a newly
 * added table was queried before its production migration had run.
 *
 * Usage:
 *   tsx scripts/backfill-payee.ts --dry-run [--limit 500]
 *   tsx scripts/backfill-payee.ts --apply   [--limit 500] [--delay-ms 150]
 */
import { eq, isNull } from "drizzle-orm";
import { extractPayeeFromReceipt } from "../src/lib/chain/x402-verify";
import { getPublicClient } from "../src/lib/chain/client";
import { getDb } from "../src/lib/db/client";
import { isMissingSchemaError } from "../src/lib/db/pg-errors";
import { x402Payments } from "../src/lib/db/schema";

type Args = { dryRun: boolean; limit: number; delayMs: number };

function parseArgs(argv: string[]): Args {
  let apply = false;
  let limit = 500;
  let delayMs = 150;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--apply") apply = true;
    else if (argv[i] === "--dry-run") apply = false;
    else if (argv[i] === "--limit" && argv[i + 1]) limit = Number(argv[++i]);
    else if (argv[i] === "--delay-ms" && argv[i + 1]) delayMs = Number(argv[++i]);
  }

  return { dryRun: !apply, limit: Math.max(1, limit), delayMs: Math.max(0, delayMs) };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const { dryRun, limit, delayMs } = parseArgs(process.argv.slice(2));

  console.log(
    `backfill-payee: mode=${dryRun ? "DRY-RUN (no writes)" : "APPLY (will write payee values)"} limit=${limit}`,
  );

  const db = getDb();
  if (!db) {
    console.error(
      "backfill-payee: DATABASE_URL not configured — aborting safely, no writes attempted.",
    );
    process.exit(1);
  }

  let rows: { id: string; wallet: string; txHash: string; network: string }[];
  try {
    rows = await db
      .select({
        id: x402Payments.id,
        wallet: x402Payments.wallet,
        txHash: x402Payments.txHash,
        network: x402Payments.network,
      })
      .from(x402Payments)
      .where(isNull(x402Payments.payee))
      .limit(limit);
  } catch (error) {
    if (isMissingSchemaError(error)) {
      console.error(
        "backfill-payee: x402_payments.payee column (or the table itself) does not exist in this database yet.",
      );
      console.error(
        "Apply scripts/sql/2026-07-15-x402-payee.sql first, then re-run this script. Aborting safely — no writes attempted.",
      );
      process.exit(1);
    }
    throw error;
  }

  console.log(`backfill-payee: ${rows.length} row(s) with payee IS NULL in this batch`);

  const client = getPublicClient();
  let resolved = 0;
  let unresolved = 0;
  let skippedNetwork = 0;
  let errors = 0;

  for (const row of rows) {
    if ((row.network ?? "base").toLowerCase() !== "base") {
      skippedNetwork++;
      continue;
    }
    if (!row.wallet || !row.txHash) {
      unresolved++;
      continue;
    }

    try {
      const receipt = await client.getTransactionReceipt({
        hash: row.txHash as `0x${string}`,
      });
      if (!receipt || receipt.status !== "success") {
        unresolved++;
        console.log(`  [skip] ${row.id} tx=${row.txHash} — receipt missing or not successful`);
        continue;
      }

      const { payee, confidence } = extractPayeeFromReceipt(receipt, row.wallet.toLowerCase());
      if (!payee) {
        unresolved++;
        console.log(`  [skip] ${row.id} tx=${row.txHash} — could not resolve a payee`);
        continue;
      }

      if (dryRun) {
        resolved++;
        console.log(
          `  [dry-run] ${row.id} tx=${row.txHash} -> payee=${payee} (${confidence})`,
        );
      } else {
        await db.update(x402Payments).set({ payee }).where(eq(x402Payments.id, row.id));
        resolved++;
        console.log(
          `  [updated] ${row.id} tx=${row.txHash} -> payee=${payee} (${confidence})`,
        );
      }
    } catch (error) {
      errors++;
      console.error(
        `  [error] ${row.id} tx=${row.txHash}:`,
        error instanceof Error ? error.message : error,
      );
    }

    if (delayMs > 0) await sleep(delayMs);
  }

  console.log("backfill-payee: complete");
  console.log(`  resolved:         ${resolved}${dryRun ? " (dry-run — no rows written)" : ""}`);
  console.log(`  unresolved:       ${unresolved}`);
  console.log(`  skipped(network): ${skippedNetwork}`);
  console.log(`  errors:           ${errors}`);

  if (dryRun) {
    console.log("\nThis was a dry run — no rows were written. Re-run with --apply to write.");
  }
}

main().catch((error) => {
  console.error("backfill-payee: fatal error", error instanceof Error ? error.message : error);
  process.exit(1);
});

/**
 * Gate2 PMF judgement — CLI wrapper.
 *
 * Core logic lives in src/lib/gate2/report.ts (shared with the production
 * API route GET /api/admin/gate2, added 2026-07-26 to unblock measurement
 * when DATABASE_URL is unreadable locally — see that file's header comment
 * for why). This script remains useful whenever a local DATABASE_URL *is*
 * available (e.g. a future non-Sensitive rotation, or a dev/staging DB).
 *
 * Usage:
 *   DATABASE_URL=... tsx scripts/gate2-report.ts
 *   DATABASE_URL=... SELF_ACCOUNT_EMAILS="a@x.com,b@x.com" tsx scripts/gate2-report.ts
 *
 * Writes a timestamped entry to state/gate2-ledger.json (gitignored — the
 * ledger holds external signup emails, which is PII) and prints a summary.
 * Fails safe (exits 1, writes nothing) if DATABASE_URL isn't configured or
 * the expected tables don't exist yet.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { buildGate2Report, Gate2NotConfiguredError, Gate2SchemaMissingError } from "../src/lib/gate2/report";

async function main() {
  let report;
  try {
    report = await buildGate2Report();
  } catch (error) {
    if (error instanceof Gate2NotConfiguredError) {
      console.error(
        "gate2-report: DATABASE_URL not configured — aborting safely, no report written.",
      );
      process.exit(1);
    }
    if (error instanceof Gate2SchemaMissingError) {
      console.error(
        "gate2-report: accounts table doesn't exist in this database yet — aborting safely, no report written.",
      );
      process.exit(1);
    }
    throw error;
  }

  console.log(JSON.stringify(report, null, 2));
  console.log(
    `\nGate2: ${report.gate2Pass ? "PASS" : "not yet"} — external signups=${report.judgementA.externalSignups}/5, external integration=${report.judgementC.continuousUsage.length + report.judgementC.settlementWriteback.length}/1`,
  );

  const ledgerDir = path.join(__dirname, "..", "state");
  fs.mkdirSync(ledgerDir, { recursive: true });
  const ledgerPath = path.join(ledgerDir, "gate2-ledger.json");
  const existing: unknown[] = fs.existsSync(ledgerPath)
    ? JSON.parse(fs.readFileSync(ledgerPath, "utf8"))
    : [];
  existing.push(report);
  fs.writeFileSync(ledgerPath, JSON.stringify(existing, null, 2) + "\n");
  console.log(`\nappended to ${ledgerPath} (${existing.length} run(s) recorded)`);
}

main().catch((error) => {
  console.error("gate2-report: fatal error", error instanceof Error ? error.message : error);
  process.exit(1);
});

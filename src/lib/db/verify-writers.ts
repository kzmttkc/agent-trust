// ============================================================
// vet402 — monotonic verify writers with graceful pre-migration fallback
// (2026-08-18).
//
// The signature-freshness fix adds an `issued_at` column and a monotonic
// write guard. Production runs on the `vouch` Neon database, and its migration
// (scripts/sql/2026-08-18-signature-freshness.sql) is applied by hand in the
// Neon SQL editor — a step that lands separately from the code deploy. Without
// this fallback, deploying the code before the migration would make every
// payee/agent verify POST 503 (the insert names a column that doesn't exist
// yet), breaking a live feature.
//
// So: attempt the monotonic write with issued_at; if the COLUMN is missing,
// fall back to the legacy write (no issued_at, no monotonic guard) — exactly
// what main did before this change, so no regression. Once the migration
// lands, the column exists and the full guard activates automatically with no
// second deploy. If the whole TABLE is missing, both attempts fail and the
// caller returns 503 (correct — the store really is unavailable).
// ============================================================
import { sql } from "drizzle-orm";
import type { getDb } from "./client";
import { isMissingSchemaError } from "./pg-errors";
import { agentPassports, verifiedPayees } from "./schema";

type Db = NonNullable<ReturnType<typeof getDb>>;

export type MonotonicWriteResult = "written" | "stale_signature" | "store_unavailable";

export async function writePayeeVerification(
  db: Db,
  input: { wallet: string; name: string; url: string | null; signature: string; issued: string },
): Promise<MonotonicWriteResult> {
  const walletLower = input.wallet.toLowerCase();
  const issuedDate = new Date(input.issued);
  try {
    const rows = await db
      .insert(verifiedPayees)
      .values({ wallet: walletLower, name: input.name, url: input.url, signature: input.signature, issuedAt: issuedDate })
      .onConflictDoUpdate({
        target: verifiedPayees.wallet,
        set: { name: input.name, url: input.url, signature: input.signature, verifiedAt: new Date(), issuedAt: issuedDate },
        setWhere: sql`${verifiedPayees.issuedAt} is null or ${verifiedPayees.issuedAt} < ${input.issued}::timestamptz`,
      })
      .returning();
    return rows.length === 0 ? "stale_signature" : "written";
  } catch (error) {
    if (!isMissingSchemaError(error)) throw error;
    // issued_at column not migrated yet → legacy write (no monotonic guard),
    // matching pre-2026-08-18 behaviour. RAW SQL naming only the pre-migration
    // columns: drizzle's insert builder emits EVERY schema column (issued_at
    // filled with `default`), so an ORM insert would reference the missing
    // column even when the value is omitted. If the table itself is gone this
    // statement also throws missing-schema → store_unavailable.
    try {
      await db.execute(sql`
        INSERT INTO verified_payees (wallet, name, url, signature, verified_at)
        VALUES (${walletLower}, ${input.name}, ${input.url}, ${input.signature}, now())
        ON CONFLICT (wallet) DO UPDATE
          SET name = excluded.name, url = excluded.url,
              signature = excluded.signature, verified_at = now()
      `);
      return "written";
    } catch (fallbackError) {
      if (isMissingSchemaError(fallbackError)) return "store_unavailable";
      throw fallbackError;
    }
  }
}

export async function writeAgentPassportVerification(
  db: Db,
  input: { agentId: bigint; wallet: string; name: string; url: string | null; signature: string; issued: string },
): Promise<MonotonicWriteResult> {
  const walletLower = input.wallet.toLowerCase();
  const issuedDate = new Date(input.issued);
  try {
    const rows = await db
      .insert(agentPassports)
      .values({ agentId: input.agentId, wallet: walletLower, name: input.name, url: input.url, signature: input.signature, issuedAt: issuedDate })
      .onConflictDoUpdate({
        target: agentPassports.agentId,
        set: { wallet: walletLower, name: input.name, url: input.url, signature: input.signature, verifiedAt: new Date(), issuedAt: issuedDate },
        setWhere: sql`${agentPassports.issuedAt} is null or ${agentPassports.issuedAt} < ${input.issued}::timestamptz`,
      })
      .returning();
    return rows.length === 0 ? "stale_signature" : "written";
  } catch (error) {
    if (!isMissingSchemaError(error)) throw error;
    // Legacy raw-SQL fallback — see writePayeeVerification for why the ORM
    // insert can't be used here.
    try {
      await db.execute(sql`
        INSERT INTO agent_passports (agent_id, wallet, name, url, signature, verified_at)
        VALUES (${input.agentId}, ${walletLower}, ${input.name}, ${input.url}, ${input.signature}, now())
        ON CONFLICT (agent_id) DO UPDATE
          SET wallet = excluded.wallet, name = excluded.name, url = excluded.url,
              signature = excluded.signature, verified_at = now()
      `);
      return "written";
    } catch (fallbackError) {
      if (isMissingSchemaError(fallbackError)) return "store_unavailable";
      throw fallbackError;
    }
  }
}

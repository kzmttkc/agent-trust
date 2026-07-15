import { count, countDistinct, desc, eq, gte, sql } from "drizzle-orm";
import { getDb } from "./client";
import { isMissingSchemaError } from "./pg-errors";
import { x402Payments } from "./schema";
import { logServerError } from "@/lib/util/log";

export type X402PaymentStats = {
  paymentCount: number;
  uniqueDays: number;
  lastPaymentAt: string | null;
};

export type RecordX402PaymentInput = {
  wallet: string;
  txHash: string;
  amount?: string | null;
  apiKeyId?: string | null;
  network?: string;
  resource?: string | null;
  /** Receiving wallet, when resolvable — see extractPayeeFromReceipt. */
  payee?: string | null;
};

/**
 * Idempotent insert keyed by tx_hash. Returns whether a new row was created.
 *
 * Defensive against the `payee` column not existing yet (see
 * scripts/sql/2026-07-15-x402-payee.sql / scripts/backfill-payee.ts): a
 * migration lag between deploying this code and applying that migration
 * must not take the live payment-ingest path down. On an "undefined column"
 * error we retry once without `payee` rather than failing the whole request.
 */
export async function recordX402Payment(
  input: RecordX402PaymentInput,
): Promise<{ created: boolean; id: string }> {
  const db = getDb();
  if (!db) throw new Error("database_unavailable");

  const wallet = input.wallet.toLowerCase();
  const txHash = input.txHash.toLowerCase();
  const network = (input.network ?? "base").toLowerCase();
  const payee = input.payee ? input.payee.toLowerCase() : null;

  const existing = await db
    .select({ id: x402Payments.id })
    .from(x402Payments)
    .where(eq(x402Payments.txHash, txHash))
    .limit(1);

  if (existing[0]) {
    return { created: false, id: existing[0].id };
  }

  const baseValues = {
    wallet,
    txHash,
    amount: input.amount ?? null,
    apiKeyId: input.apiKeyId ?? null,
    network,
    resource: input.resource ?? null,
  };

  try {
    const inserted = await db
      .insert(x402Payments)
      .values({ ...baseValues, payee })
      .returning();
    return { created: true, id: inserted[0]!.id };
  } catch (error) {
    if (!isMissingSchemaError(error)) throw error;

    logServerError(
      "x402_payment_payee_column_missing",
      new Error("payee column not migrated yet; inserted without it"),
    );
    const inserted = await db.insert(x402Payments).values(baseValues).returning();
    return { created: true, id: inserted[0]!.id };
  }
}

/**
 * Intentionally global (not scoped by apiKeyId/customer): x402 settlement
 * history is a cross-provider trust signal by design (docs/x402-integration.md,
 * docs/ecosystem-x402-foundation.md) — a wallet that has paid other x402
 * providers should read as more trustworthy everywhere, the same way
 * ERC-8004 reputation and wallet-age signals are global on-chain facts
 * rather than per-customer counters. Scoping this per API key would defeat
 * that cross-provider network effect.
 *
 * The integrity guarantee instead lives at write time: `POST
 * /v1/payments/x402` (src/app/api/v1/payments/x402/route.ts) now requires
 * `verifyX402PaymentOnChain` to confirm the tx is real, succeeded, and is
 * attributable to the claimed wallet before a row can ever be inserted here.
 * Only genuinely-settled payments can contribute to this aggregate.
 */
export async function getX402PaymentStats(wallet: string): Promise<X402PaymentStats> {
  const db = getDb();
  if (!db) {
    return { paymentCount: 0, uniqueDays: 0, lastPaymentAt: null };
  }

  const walletLower = wallet.toLowerCase();
  const rows = await db
    .select({
      paymentCount: count(),
      uniqueDays: sql<number>`count(distinct date_trunc('day', ${x402Payments.createdAt}))`,
      lastPaymentAt: sql<string | null>`max(${x402Payments.createdAt})`,
    })
    .from(x402Payments)
    .where(eq(x402Payments.wallet, walletLower));

  const row = rows[0];
  return {
    paymentCount: Number(row?.paymentCount ?? 0),
    uniqueDays: Number(row?.uniqueDays ?? 0),
    lastPaymentAt: row?.lastPaymentAt ?? null,
  };
}

export type PayeeStats = {
  paymentCount: number;
  uniqueDays: number;
  distinctPayers: number;
  firstPaymentAt: string | null;
  lastPaymentAt: string | null;
};

/**
 * Receiving-side settlement history for a payee (the "did agents actually
 * pay this provider and keep paying" signal for GET /v1/payees/{address}).
 * Degrades to zeroed stats — never throws — when the `payee` column isn't
 * migrated yet, mirroring recordX402Payment's fallback: a payee lookup
 * during migration lag should read as data-poor (cold start), not error out.
 */
export async function getPayeeStats(payee: string): Promise<PayeeStats> {
  const db = getDb();
  const empty: PayeeStats = {
    paymentCount: 0,
    uniqueDays: 0,
    distinctPayers: 0,
    firstPaymentAt: null,
    lastPaymentAt: null,
  };
  if (!db) return empty;

  const payeeLower = payee.toLowerCase();
  try {
    const rows = await db
      .select({
        paymentCount: count(),
        uniqueDays: sql<number>`count(distinct date_trunc('day', ${x402Payments.createdAt}))`,
        distinctPayers: countDistinct(x402Payments.wallet),
        firstPaymentAt: sql<string | null>`min(${x402Payments.createdAt})`,
        lastPaymentAt: sql<string | null>`max(${x402Payments.createdAt})`,
      })
      .from(x402Payments)
      .where(eq(x402Payments.payee, payeeLower));

    const row = rows[0];
    return {
      paymentCount: Number(row?.paymentCount ?? 0),
      uniqueDays: Number(row?.uniqueDays ?? 0),
      distinctPayers: Number(row?.distinctPayers ?? 0),
      firstPaymentAt: row?.firstPaymentAt ?? null,
      lastPaymentAt: row?.lastPaymentAt ?? null,
    };
  } catch (error) {
    if (!isMissingSchemaError(error)) throw error;
    logServerError(
      "payee_stats_column_missing",
      new Error("payee column not migrated yet; returning empty stats"),
    );
    return empty;
  }
}

export async function countX402PaymentsForApiKey(apiKeyId: string): Promise<number> {
  const db = getDb();
  if (!db) return 0;

  const rows = await db
    .select({ value: count() })
    .from(x402Payments)
    .where(eq(x402Payments.apiKeyId, apiKeyId));

  return Number(rows[0]?.value ?? 0);
}

export async function countTotalX402Payments(): Promise<number> {
  const db = getDb();
  if (!db) return 0;

  const rows = await db.select({ value: count() }).from(x402Payments);
  return Number(rows[0]?.value ?? 0);
}

/** Payments attributed in the last N days (ops / coverage). */
export async function countRecentX402Payments(days = 30): Promise<number> {
  const db = getDb();
  if (!db) return 0;

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({ value: count() })
    .from(x402Payments)
    .where(gte(x402Payments.createdAt, since));

  return Number(rows[0]?.value ?? 0);
}

export async function countDistinctPaymentWallets(): Promise<number> {
  const db = getDb();
  if (!db) return 0;

  const rows = await db.select({ value: countDistinct(x402Payments.wallet) }).from(x402Payments);
  return Number(rows[0]?.value ?? 0);
}

export type X402PaymentRow = {
  id: string;
  wallet: string;
  amount: string | null;
  txHash: string;
  network: string;
  resource: string | null;
  createdAt: Date | null;
};

export async function listX402PaymentsForApiKey(
  apiKeyId: string,
  limit = 50,
): Promise<X402PaymentRow[]> {
  const db = getDb();
  if (!db) return [];

  const safeLimit = Math.min(100, Math.max(1, limit));
  return db
    .select({
      id: x402Payments.id,
      wallet: x402Payments.wallet,
      amount: x402Payments.amount,
      txHash: x402Payments.txHash,
      network: x402Payments.network,
      resource: x402Payments.resource,
      createdAt: x402Payments.createdAt,
    })
    .from(x402Payments)
    .where(eq(x402Payments.apiKeyId, apiKeyId))
    .orderBy(desc(x402Payments.createdAt))
    .limit(safeLimit);
}

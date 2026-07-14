import { count, countDistinct, desc, eq, gte, sql } from "drizzle-orm";
import { getDb } from "./client";
import { x402Payments } from "./schema";

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
};

/** Idempotent insert keyed by tx_hash. Returns whether a new row was created. */
export async function recordX402Payment(
  input: RecordX402PaymentInput,
): Promise<{ created: boolean; id: string }> {
  const db = getDb();
  if (!db) throw new Error("database_unavailable");

  const wallet = input.wallet.toLowerCase();
  const txHash = input.txHash.toLowerCase();
  const network = (input.network ?? "base").toLowerCase();

  const existing = await db
    .select({ id: x402Payments.id })
    .from(x402Payments)
    .where(eq(x402Payments.txHash, txHash))
    .limit(1);

  if (existing[0]) {
    return { created: false, id: existing[0].id };
  }

  const inserted = await db
    .insert(x402Payments)
    .values({
      wallet,
      txHash,
      amount: input.amount ?? null,
      apiKeyId: input.apiKeyId ?? null,
      network,
      resource: input.resource ?? null,
    })
    .returning();

  return { created: true, id: inserted[0]!.id };
}

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

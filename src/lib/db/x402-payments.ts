import { and, count, countDistinct, desc, eq, gte, sql } from "drizzle-orm";
import { getDb } from "./client";
import { isMissingSchemaError } from "./pg-errors";
import { BASE_USDC_ADDRESS } from "@/lib/chain/config";
import { funderWallets, x402Payments } from "./schema";
import { logServerError } from "@/lib/util/log";

/**
 * vet402 2026-08-13 — score-eligibility. A payment row moves a trust score
 * only when it is a genuine, chain-confirmed USDC settlement whose owner signed
 * for it. Three columns, each closing a separate forgery:
 *   token = BASE_USDC     the settlement leg actually moved USDC, not a token
 *                         the payer minted themselves (the wallet-match alone
 *                         was satisfied by any ERC20 Transfer).
 *   amount_verified       the declared figure matched the on-chain USDC amount.
 *   ownership_verified    the write-back carried a valid EIP-191 signature by
 *                         the paying wallet — so a stranger's real transfer,
 *                         posted by someone who does not control that wallet,
 *                         records a row but never counts.
 * Legacy rows (NULL on the new columns) are excluded, which is correct: that
 * history was forgeable and must not keep counting.
 */
const scoreEligible = and(
  eq(x402Payments.token, BASE_USDC_ADDRESS.toLowerCase()),
  eq(x402Payments.amountVerified, true),
  eq(x402Payments.ownershipVerified, true),
);

/**
 * The on-chain block time is the authoritative day axis; created_at (DB insert
 * time) is a caller-manipulable fallback used only for rows that predate the
 * block_timestamp column. Dripping inserts of one day's txs across a fortnight
 * no longer inflates uniqueDays, because block time is not something the caller
 * picks.
 */
const settledAt = sql`coalesce(${x402Payments.blockTimestamp}, ${x402Payments.createdAt})`;

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
  /** What the CHAIN said the settlement leg moved, in the token's base units.
   *  Authoritative: `amount` above is the caller's claim, this is the fact. */
  onchainAmount?: string | null;
  /** ERC20 contract that actually moved (only Base USDC counts as x402). */
  token?: string | null;
  /** null = the caller declared no amount; false = declared but unconfirmed. */
  amountVerified?: boolean | null;
  /** On-chain block time of the settlement tx (authoritative day axis). */
  blockTimestamp?: Date | null;
  /** vet402 2026-08-13: true only when a valid EIP-191 signature by `wallet`
   *  accompanied the write-back. Rows without it are stored but never counted. */
  ownershipVerified?: boolean | null;
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

  // Widest set first, then degrade one migration at a time. Same reasoning as
  // the payee fallback above: a migration lag must not take payment ingest
  // down, and every degradation is logged so the lag is visible rather than
  // permanent. (2026-08-05: onchain_amount / token / amount_verified —
  // scripts/sql/2026-08-05-x402-amount-verification.sql. 2026-08-13:
  // block_timestamp / ownership_verified —
  // scripts/sql/2026-08-13-x402-block-time-and-ownership.sql.)
  const verificationValues = {
    onchainAmount: input.onchainAmount ?? null,
    token: input.token ? input.token.toLowerCase() : null,
    amountVerified: input.amountVerified ?? null,
    blockTimestamp: input.blockTimestamp ?? null,
    ownershipVerified: input.ownershipVerified ?? null,
  };

  try {
    const inserted = await db
      .insert(x402Payments)
      .values({ ...baseValues, payee, ...verificationValues })
      .returning();
    return { created: true, id: inserted[0]!.id };
  } catch (error) {
    if (!isMissingSchemaError(error)) throw error;

    logServerError(
      "x402_payment_verification_columns_missing",
      new Error(
        "onchain_amount/token/amount_verified not migrated yet; inserted without them",
      ),
    );
    try {
      const inserted = await db
        .insert(x402Payments)
        .values({ ...baseValues, payee })
        .returning();
      return { created: true, id: inserted[0]!.id };
    } catch (retryError) {
      if (!isMissingSchemaError(retryError)) throw retryError;

      logServerError(
        "x402_payment_payee_column_missing",
        new Error("payee column not migrated yet; inserted without it"),
      );
      const inserted = await db.insert(x402Payments).values(baseValues).returning();
      return { created: true, id: inserted[0]!.id };
    }
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
 * The integrity guarantee instead lives at write time AND in the filter here.
 * `POST /v1/payments/x402` (src/app/api/v1/payments/x402/route.ts) confirms the
 * tx is real, succeeded, and is attributable to the claimed wallet, and records
 * whether the poster proved ownership of that wallet. This aggregate then
 * counts ONLY score-eligible rows (`scoreEligible`): a genuine USDC settlement,
 * amount-confirmed, owner-signed. A real transfer posted by someone who does
 * not control the wallet, or in a token the payer minted, contributes nothing.
 */
export async function getX402PaymentStats(wallet: string): Promise<X402PaymentStats> {
  const db = getDb();
  const empty: X402PaymentStats = { paymentCount: 0, uniqueDays: 0, lastPaymentAt: null };
  if (!db) return empty;

  const walletLower = wallet.toLowerCase();
  try {
    const rows = await db
      .select({
        paymentCount: count(),
        uniqueDays: sql<number>`count(distinct date_trunc('day', ${settledAt}))`,
        lastPaymentAt: sql<string | null>`max(${settledAt})`,
      })
      .from(x402Payments)
      .where(and(eq(x402Payments.wallet, walletLower), scoreEligible));

    const row = rows[0];
    return {
      paymentCount: Number(row?.paymentCount ?? 0),
      uniqueDays: Number(row?.uniqueDays ?? 0),
      lastPaymentAt: row?.lastPaymentAt ?? null,
    };
  } catch (error) {
    // Deploy-ordering safety (vet402 2026-08-13). The score-eligibility filter
    // and block-time axis reference block_timestamp / ownership_verified. If
    // the code ships before scripts/sql/2026-08-13-x402-block-time-and-ownership
    // .sql is applied, those columns do not exist yet. Without this guard the
    // query throws, the engine flags x402_unavailable, and assessSybilRisk turns
    // that into a BLOCK for EVERY wallet — a fail-closed outage caused purely by
    // migration lag. Degrade to "no eligible history" (a neutral x402 signal)
    // instead, mirroring getPayeeStats and recordX402Payment's own tolerance.
    if (!isMissingSchemaError(error)) throw error;
    logServerError(
      "x402_stats_column_missing",
      new Error("block_timestamp/ownership_verified not migrated yet; reading as no eligible history"),
    );
    return empty;
  }
}

export type PayeeStats = {
  paymentCount: number;
  uniqueDays: number;
  distinctPayers: number;
  /**
   * vet402 2026-08-13 — the number of distinct FUNDING SOURCES behind the
   * distinct payers, not the raw payer count. Ten wallets all funded by one
   * address are one sybil cluster wearing ten faces, not ten independent
   * customers; counting them as ten let a payee buy a full receiving-diversity
   * bonus from a single funder. Computed from the funder index (same source as
   * the payer-side funding_cluster check); a payer whose funder is unknown
   * counts as its own source, so an unpopulated index degrades to
   * distinctFunders == distinctPayers (no penalty we cannot justify).
   */
  distinctFunders: number;
  firstPaymentAt: string | null;
  lastPaymentAt: string | null;
};

/**
 * Receiving-side settlement history for a payee (the "did agents actually
 * pay this provider and keep paying" signal for GET /v1/payees/{address}/score).
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
    distinctFunders: 0,
    firstPaymentAt: null,
    lastPaymentAt: null,
  };
  if (!db) return empty;

  const payeeLower = payee.toLowerCase();
  try {
    const rows = await db
      .select({
        paymentCount: count(),
        uniqueDays: sql<number>`count(distinct date_trunc('day', ${settledAt}))`,
        distinctPayers: countDistinct(x402Payments.wallet),
        firstPaymentAt: sql<string | null>`min(${settledAt})`,
        lastPaymentAt: sql<string | null>`max(${settledAt})`,
      })
      .from(x402Payments)
      .where(and(eq(x402Payments.payee, payeeLower), scoreEligible));

    const row = rows[0];
    const distinctPayers = Number(row?.distinctPayers ?? 0);

    return {
      paymentCount: Number(row?.paymentCount ?? 0),
      uniqueDays: Number(row?.uniqueDays ?? 0),
      distinctPayers,
      distinctFunders: await countDistinctFunders(db, payeeLower, distinctPayers),
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

/**
 * vet402 2026-08-13 — collapse a payee's distinct payers down to their distinct
 * funding sources. Sybil clusters share one funder, so counting funders instead
 * of wallets stops a payee from manufacturing "many independent customers" out
 * of one funded set. A payer with no funder row counts as its own source
 * (coalesce to the wallet), so an empty/lagging funder index simply returns the
 * raw payer count — the diversity bonus is never penalized on data we lack.
 * Reads the same funder_wallets index the payer-side funding_cluster check
 * uses (populated only by the trusted indexer, never by API scoring).
 */
async function countDistinctFunders(
  db: NonNullable<ReturnType<typeof getDb>>,
  payeeLower: string,
  distinctPayers: number,
): Promise<number> {
  if (distinctPayers === 0) return 0;
  try {
    const payers = db
      .selectDistinct({ wallet: x402Payments.wallet })
      .from(x402Payments)
      .where(and(eq(x402Payments.payee, payeeLower), scoreEligible))
      .as("payers");

    const rows = await db
      .select({
        distinctFunders: sql<number>`count(distinct coalesce(${funderWallets.funder}, ${payers.wallet}))`,
      })
      .from(payers)
      .leftJoin(funderWallets, sql`lower(${funderWallets.wallet}) = ${payers.wallet}`);

    const value = Number(rows[0]?.distinctFunders ?? distinctPayers);
    // Never report MORE funding sources than payers — a defensive floor in case
    // a wallet somehow carries multiple funder rows in the index.
    return Math.min(value, distinctPayers);
  } catch (error) {
    // The funder index is an optimization for a sybil discount, not a
    // correctness gate: if it cannot be read (e.g. funder_wallets not migrated),
    // fall back to the raw payer count rather than failing the whole payee read.
    if (!isMissingSchemaError(error)) {
      logServerError("payee_distinct_funders", error);
    }
    return distinctPayers;
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
